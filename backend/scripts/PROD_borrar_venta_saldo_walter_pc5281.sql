/* =====================================================================================
   BORRAR una "Venta de saldo" hecha por error + la billetera que se creó para ella.
   Caso 08-oct-2026: WALTER DE LOS SANTOS (#LOCOSPORLASCANCHAS2025, cliente 5380),
   billetera CTA-USD-7795 "BILLETERA USD" con US$ 3.000 a favor por el PC-5281 del 07/10.

   Una Venta de saldo cobrada en caja deja (cfeController.crearFacturaManual +
   contabilidadController.cargaPrepago + crearCuenta):
     - CuentasCliente (la billetera) y CuentasClienteArticulosPermitidos (si es restringida)
     - DocumentosContables + DocumentosContablesDetalle (el PC: Pedido Caja, BORRADOR, no fiscal)
     - TransaccionesCaja + Pagos (el cobro de caja)
     - MovimientosCuenta: VTA_CAJA −X y PAGO +X en la cuenta principal (se compensan),
       CARGA_PREPAGO +X en la billetera (y TRANSFERENCIA_SALIDA −X en la principal si la
       plata salió del saldo a favor)
     - Cont_AsientosCabecera + Cont_AsientosDetalle (el asiento de la venta)
   Este script BORRA todo eso y devuelve el saldo de la cuenta principal a como estaba.
   No toca el número de serie (el PC-5281 queda como número salteado).

   Antes de borrar guarda cada fila (en JSON) en dbo._bk_VentaSaldoBorrada.

   Frenos (no toca nada y explica por qué):
     - El documento no existe, no es de este cliente, no es por el importe/moneda esperados,
       o ya fue ACEPTADO por DGI (eso va con Nota de Crédito, no se borra).
     - La billetera tiene otros movimientos además de esta carga (ej. ya consumió órdenes).
     - El pago fue con cheque o consumiendo saldo, o la transacción de caja tiene otros documentos.
     - Algún movimiento es de otro cliente o de un tipo no esperado.
     - Alguna otra tabla de la base apunta al documento, la billetera, la transacción, el
       asiento o los pagos (bloque REFERENCIAS: "NO ESPERADA").

   @Aplicar = 0 → muestra qué haría y hace ROLLBACK.   @Aplicar = 1 → COMMIT.
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar      BIT           = 0;
DECLARE @CliIdCliente INT           = 5380;    -- WALTER DE LOS SANTOS
DECLARE @CueIdCuenta  INT           = 7795;    -- CTA-USD-7795 "BILLETERA USD"
DECLARE @DocSerie     VARCHAR(10)   = 'PC';
DECLARE @DocNumero    VARCHAR(20)   = '5281';
DECLARE @Importe      DECIMAL(18,2) = 3000;
DECLARE @MonIdMoneda  INT           = 2;       -- 2 = US$, 1 = $

DECLARE @Msg NVARCHAR(2048);

-- ── 1. Documento ───────────────────────────────────────────────────────────────────
DECLARE @Doc INT, @Tca INT, @Asi INT, @Cfe VARCHAR(30), @Total DECIMAL(18,2), @Mon INT;
DECLARE @NDocs INT = (SELECT COUNT(*) FROM dbo.DocumentosContables
                      WHERE DocSerie = @DocSerie AND LTRIM(RTRIM(DocNumero)) = @DocNumero AND CliIdCliente = @CliIdCliente);
IF @NDocs <> 1
BEGIN
    SET @Msg = CONCAT('Se esperaba 1 documento ', @DocSerie, '-', @DocNumero, ' del cliente ', @CliIdCliente, ' y hay ', @NDocs, '. No se tocó nada.');
    THROW 50001, @Msg, 1;
END

SELECT @Doc = DocIdDocumento, @Tca = TcaIdTransaccion, @Asi = AsiIdAsiento,
       @Cfe = CfeEstado, @Total = DocTotal, @Mon = MonIdMoneda
FROM dbo.DocumentosContables
WHERE DocSerie = @DocSerie AND LTRIM(RTRIM(DocNumero)) = @DocNumero AND CliIdCliente = @CliIdCliente;

SELECT 'DOCUMENTO' AS Bloque, DocIdDocumento, DocTipo, DocSerie, DocNumero, DocFechaEmision, DocTotal, MonIdMoneda,
       CfeEstado, DocEstado, DocPagado, TcaIdTransaccion, AsiIdAsiento, CueIdCuenta
FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc;

IF @Cfe = 'ACEPTADO_DGI'
    THROW 50002, 'El documento ya fue ACEPTADO por DGI: no se puede borrar, se revierte con Nota de Crédito. No se tocó nada.', 1;
IF ABS(@Total - @Importe) > 0.01 OR @Mon <> @MonIdMoneda
BEGIN
    SET @Msg = CONCAT('El documento es por ', @Total, ' (moneda ', @Mon, ') y se esperaba ', @Importe, ' (moneda ', @MonIdMoneda, '). No se tocó nada.');
    THROW 50003, @Msg, 1;
END

-- ── 2. Billetera ───────────────────────────────────────────────────────────────────
SELECT 'BILLETERA' AS Bloque, CueIdCuenta, CliIdCliente, CueTipo, CueNombre, CueSaldoActual, CueActiva,
       CueEsPrincipal, CueRestringida, CueModalidadFiscal,
       (SELECT COUNT(*) FROM dbo.CuentasClienteArticulosPermitidos a WHERE a.CueIdCuenta = cc.CueIdCuenta) AS ArticulosPermitidos
FROM dbo.CuentasCliente cc WHERE CueIdCuenta = @CueIdCuenta;

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente
               WHERE CueIdCuenta = @CueIdCuenta AND CliIdCliente = @CliIdCliente
                 AND ISNULL(CueEsPrincipal, 0) = 0 AND CueTipo LIKE 'DINERO%')
    THROW 50004, 'La billetera no existe, no es de este cliente, es la cuenta PRINCIPAL o no es de dinero. No se tocó nada.', 1;

IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @CueIdCuenta AND ISNULL(DocIdDocumento, 0) <> @Doc)
BEGIN
    SELECT 'BILLETERA_OTROS_MOVIMIENTOS' AS Bloque, MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovConcepto, DocIdDocumento, OrdIdOrden, MovAnulado
    FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @CueIdCuenta AND ISNULL(DocIdDocumento, 0) <> @Doc;
    THROW 50005, 'La billetera tiene movimientos que no son de esta carga (bloque BILLETERA_OTROS_MOVIMIENTOS). No se tocó nada.', 1;
END

-- ── 3. Cobro de caja ───────────────────────────────────────────────────────────────
IF OBJECT_ID('tempdb..#Pagos') IS NOT NULL DROP TABLE #Pagos;
SELECT * INTO #Pagos FROM dbo.Pagos WHERE @Tca IS NOT NULL AND PagTcaIdTransaccion = @Tca;

SELECT 'COBRO' AS Bloque, t.TcaIdTransaccion, t.TcaFecha, t.TcaEstado, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalNeto, t.TcaMonedaBase, t.EsCajaAdmin, t.StuIdSesion,
       p.PagIdPago, p.MPaIdMetodoPago, mp.MPaDescripcionMetodo, p.PagIdMonedaPago, p.PagMontoPago, p.PagTipoMovimiento
FROM dbo.TransaccionesCaja t
LEFT JOIN #Pagos p ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
LEFT JOIN dbo.MetodosPagos mp ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE t.TcaIdTransaccion = @Tca;

IF EXISTS (SELECT 1 FROM #Pagos WHERE PagIdCheque IS NOT NULL OR PagSaldoConsumidoId IS NOT NULL)
    THROW 50006, 'El cobro tiene un cheque o un consumo de saldo vinculado: hay que revisarlo a mano. No se tocó nada.', 1;
IF @Tca IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.DocumentosContables WHERE TcaIdTransaccion = @Tca AND DocIdDocumento <> @Doc)
    THROW 50007, 'La transacción de caja también tiene otros documentos. No se tocó nada.', 1;

-- ── 4. Movimientos de cuenta ───────────────────────────────────────────────────────
IF OBJECT_ID('tempdb..#Movs') IS NOT NULL DROP TABLE #Movs;
SELECT * INTO #Movs FROM dbo.MovimientosCuenta
WHERE DocIdDocumento = @Doc
   OR CueIdCuenta = @CueIdCuenta
   OR PagIdPago IN (SELECT PagIdPago FROM #Pagos);

SELECT 'MOVIMIENTOS' AS Bloque, m.MovIdMovimiento, m.CueIdCuenta, cc.CueNombre, cc.CueEsPrincipal, m.MovFecha, m.MovTipo,
       m.MovImporte, m.MovAnulado, m.MovConcepto, m.DocIdDocumento, m.PagIdPago
FROM #Movs m LEFT JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
ORDER BY m.MovIdMovimiento;

IF EXISTS (SELECT 1 FROM #Movs m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta WHERE cc.CliIdCliente <> @CliIdCliente)
    THROW 50008, 'Hay movimientos de este documento en cuentas de OTRO cliente. No se tocó nada.', 1;
IF EXISTS (SELECT 1 FROM #Movs WHERE MovTipo NOT IN ('VTA_CAJA', 'PAGO', 'CARGA_PREPAGO', 'TRANSFERENCIA_SALIDA'))
    THROW 50009, 'Hay movimientos de un tipo no esperado (bloque MOVIMIENTOS). No se tocó nada.', 1;

-- ── 5. Asientos ────────────────────────────────────────────────────────────────────
IF OBJECT_ID('tempdb..#Asientos') IS NOT NULL DROP TABLE #Asientos;
SELECT AsiId INTO #Asientos FROM dbo.Cont_AsientosCabecera
WHERE AsiId = @Asi OR (@Tca IS NOT NULL AND TcaIdTransaccion = @Tca);

SELECT 'ASIENTO' AS Bloque, c.AsiId, c.AsiFecha, c.AsiConcepto, c.SysOrigen, c.AsiEstado,
       d.DetId, d.CueId AS CuentaContable, d.DetDebeUYU, d.DetHaberUYU, d.DetImporteOriginal, d.DetMonedaId
FROM dbo.Cont_AsientosCabecera c
LEFT JOIN dbo.Cont_AsientosDetalle d ON d.AsiId = c.AsiId
WHERE c.AsiId IN (SELECT AsiId FROM #Asientos)
ORDER BY c.AsiId, d.DetId;

-- ── 6. ¿Quién más apunta a estos registros? (toda la base) ─────────────────────────
IF OBJECT_ID('tempdb..#Refs') IS NOT NULL DROP TABLE #Refs;
CREATE TABLE #Refs (Tabla SYSNAME, Columna SYSNAME, Filas INT);

DECLARE @sqlRefs NVARCHAR(MAX);
SELECT @sqlRefs = STRING_AGG(CAST(
         N'INSERT INTO #Refs SELECT N' + QUOTENAME(t.name, '''') + N', N' + QUOTENAME(c.name, '''')
       + N', COUNT(*) FROM dbo.' + QUOTENAME(t.name) + N' WHERE ' + QUOTENAME(c.name)
       + CASE WHEN c.name IN ('DocIdDocumento', 'DocIdDocumentoRef')       THEN N' = @Doc'
              WHEN c.name = 'CueIdCuenta'                                  THEN N' = @Cue'
              WHEN c.name IN ('TcaIdTransaccion', 'PagTcaIdTransaccion')   THEN N' = @Tca'
              WHEN c.name IN ('AsiIdAsiento', 'AsiId')                     THEN N' IN (SELECT AsiId FROM #Asientos)'
              ELSE                                                              N' IN (SELECT PagIdPago FROM #Pagos)' END
       + N';' AS NVARCHAR(MAX)), NCHAR(10))
FROM sys.tables t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
WHERE t.schema_id = SCHEMA_ID('dbo')
  AND ty.name IN ('int', 'bigint', 'smallint')
  AND c.name IN ('DocIdDocumento', 'DocIdDocumentoRef', 'CueIdCuenta', 'TcaIdTransaccion', 'PagTcaIdTransaccion', 'AsiIdAsiento', 'AsiId', 'PagIdPago')
  AND t.name NOT LIKE '[_]bk%' AND t.name NOT LIKE 'Backup%' AND t.name NOT LIKE '%[_]Copia' AND t.name NOT LIKE '%[_]bak%';

EXEC sp_executesql @sqlRefs, N'@Doc INT, @Cue INT, @Tca INT', @Doc = @Doc, @Cue = @CueIdCuenta, @Tca = @Tca;
DELETE FROM #Refs WHERE Filas = 0;

SELECT 'REFERENCIAS' AS Bloque, r.Tabla, r.Columna, r.Filas,
       CASE WHEN a.Tabla IS NULL THEN 'NO ESPERADA — frena' ELSE 'se borra' END AS Accion
FROM #Refs r
LEFT JOIN (VALUES
    ('DocumentosContables', 'DocIdDocumento'), ('DocumentosContablesDetalle', 'DocIdDocumento'), ('MovimientosCuenta', 'DocIdDocumento'),
    ('CuentasCliente', 'CueIdCuenta'), ('MovimientosCuenta', 'CueIdCuenta'), ('CuentasClienteArticulosPermitidos', 'CueIdCuenta'),
    ('TransaccionesCaja', 'TcaIdTransaccion'), ('DocumentosContables', 'TcaIdTransaccion'), ('Pagos', 'PagTcaIdTransaccion'),
    ('Cont_AsientosCabecera', 'TcaIdTransaccion'), ('Cont_AsientosCabecera', 'AsiId'), ('Cont_AsientosDetalle', 'AsiId'),
    ('DocumentosContables', 'AsiIdAsiento'), ('Pagos', 'PagIdPago'), ('MovimientosCuenta', 'PagIdPago')
) a(Tabla, Columna) ON a.Tabla = r.Tabla AND a.Columna = r.Columna
ORDER BY CASE WHEN a.Tabla IS NULL THEN 0 ELSE 1 END, r.Tabla;

IF EXISTS (SELECT 1 FROM #Refs r WHERE NOT EXISTS (SELECT 1 FROM (VALUES
    ('DocumentosContables', 'DocIdDocumento'), ('DocumentosContablesDetalle', 'DocIdDocumento'), ('MovimientosCuenta', 'DocIdDocumento'),
    ('CuentasCliente', 'CueIdCuenta'), ('MovimientosCuenta', 'CueIdCuenta'), ('CuentasClienteArticulosPermitidos', 'CueIdCuenta'),
    ('TransaccionesCaja', 'TcaIdTransaccion'), ('DocumentosContables', 'TcaIdTransaccion'), ('Pagos', 'PagTcaIdTransaccion'),
    ('Cont_AsientosCabecera', 'TcaIdTransaccion'), ('Cont_AsientosCabecera', 'AsiId'), ('Cont_AsientosDetalle', 'AsiId'),
    ('DocumentosContables', 'AsiIdAsiento'), ('Pagos', 'PagIdPago'), ('MovimientosCuenta', 'PagIdPago')
) a(Tabla, Columna) WHERE a.Tabla = r.Tabla AND a.Columna = r.Columna))
    THROW 50010, 'Otra tabla apunta a estos registros (bloque REFERENCIAS, "NO ESPERADA"). No se tocó nada: mandá ese bloque.', 1;

-- ── 7. Borrar ──────────────────────────────────────────────────────────────────────
DECLARE @Ref NVARCHAR(60) = CONCAT(@DocSerie, '-', @DocNumero, ' / cuenta ', @CueIdCuenta);

BEGIN TRY
    BEGIN TRAN;

    -- Respaldo: cada fila en JSON, con su tabla de origen
    IF OBJECT_ID('dbo._bk_VentaSaldoBorrada') IS NULL
        CREATE TABLE dbo._bk_VentaSaldoBorrada (
            BkId INT IDENTITY(1,1) PRIMARY KEY, BkFecha DATETIME NOT NULL DEFAULT GETDATE(),
            BkRef NVARCHAR(60) NOT NULL, BkTabla SYSNAME NOT NULL, BkFila NVARCHAR(MAX) NOT NULL);

    INSERT INTO dbo._bk_VentaSaldoBorrada (BkRef, BkTabla, BkFila)
    SELECT @Ref, 'CuentasCliente', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.CuentasCliente x WHERE x.CueIdCuenta = @CueIdCuenta
    UNION ALL SELECT @Ref, 'CuentasClienteArticulosPermitidos', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.CuentasClienteArticulosPermitidos x WHERE x.CueIdCuenta = @CueIdCuenta
    UNION ALL SELECT @Ref, 'MovimientosCuenta', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.MovimientosCuenta x WHERE x.MovIdMovimiento IN (SELECT MovIdMovimiento FROM #Movs)
    UNION ALL SELECT @Ref, 'DocumentosContables', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.DocumentosContables x WHERE x.DocIdDocumento = @Doc
    UNION ALL SELECT @Ref, 'DocumentosContablesDetalle', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.DocumentosContablesDetalle x WHERE x.DocIdDocumento = @Doc
    UNION ALL SELECT @Ref, 'TransaccionesCaja', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.TransaccionesCaja x WHERE x.TcaIdTransaccion = @Tca
    UNION ALL SELECT @Ref, 'Pagos', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.Pagos x WHERE x.PagIdPago IN (SELECT PagIdPago FROM #Pagos)
    UNION ALL SELECT @Ref, 'Cont_AsientosCabecera', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.Cont_AsientosCabecera x WHERE x.AsiId IN (SELECT AsiId FROM #Asientos)
    UNION ALL SELECT @Ref, 'Cont_AsientosDetalle', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.Cont_AsientosDetalle x WHERE x.AsiId IN (SELECT AsiId FROM #Asientos);
    DECLARE @FilasRespaldo INT = @@ROWCOUNT;

    -- Saldo guardado de las OTRAS cuentas (la principal): se deshace lo que sumaron sus
    -- movimientos. Igual que el SP, las ORDEN / ORDEN_ANTICIPO no mueven el saldo.
    UPDATE cc SET cc.CueSaldoActual = cc.CueSaldoActual - x.Suma
    FROM dbo.CuentasCliente cc
    JOIN (SELECT CueIdCuenta, SUM(MovImporte) AS Suma FROM #Movs
          WHERE ISNULL(MovAnulado, 0) = 0 AND MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO') AND CueIdCuenta <> @CueIdCuenta
          GROUP BY CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

    DELETE FROM dbo.MovimientosCuenta WHERE MovIdMovimiento IN (SELECT MovIdMovimiento FROM #Movs);
    DELETE FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @CueIdCuenta;
    DELETE FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta;
    DELETE FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = @Doc;
    DELETE FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc;
    DELETE FROM dbo.Cont_AsientosDetalle WHERE AsiId IN (SELECT AsiId FROM #Asientos);
    DELETE FROM dbo.Cont_AsientosCabecera WHERE AsiId IN (SELECT AsiId FROM #Asientos);
    DELETE FROM dbo.Pagos WHERE PagIdPago IN (SELECT PagIdPago FROM #Pagos);
    DELETE FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca;

    -- Verificación: no tiene que quedar nada apuntando a lo borrado
    TRUNCATE TABLE #Refs;
    EXEC sp_executesql @sqlRefs, N'@Doc INT, @Cue INT, @Tca INT', @Doc = @Doc, @Cue = @CueIdCuenta, @Tca = @Tca;
    DELETE FROM #Refs WHERE Filas = 0;
    IF EXISTS (SELECT 1 FROM #Refs)
    BEGIN
        SELECT 'QUEDO_ALGO' AS Bloque, * FROM #Refs;
        THROW 50011, 'Después de borrar quedó algo apuntando a los registros (bloque QUEDO_ALGO). Se deshizo todo.', 1;
    END

    SELECT 'DESPUES' AS Bloque, @FilasRespaldo AS FilasRespaldadas,
           (SELECT COUNT(*) FROM #Movs) AS MovimientosBorrados, (SELECT COUNT(*) FROM #Pagos) AS PagosBorrados,
           (SELECT COUNT(*) FROM #Asientos) AS AsientosBorrados;

    SELECT 'CUENTAS_DEL_CLIENTE' AS Bloque, cc.CueIdCuenta, cc.CueTipo, cc.CueNombre, cc.CueEsPrincipal, cc.CueActiva,
           cc.CueSaldoActual,
           (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
             WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0
               AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')) AS SumaMovimientos
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @CliIdCliente AND cc.CueTipo LIKE 'DINERO%'
    ORDER BY cc.CueTipo, cc.CueEsPrincipal DESC, cc.CueIdCuenta;

    IF @Aplicar = 1
    BEGIN
        COMMIT;
        PRINT CONCAT('APLICADO: ', @Ref, ' borrado. Respaldo en dbo._bk_VentaSaldoBorrada (', @FilasRespaldo, ' filas).');
    END
    ELSE
    BEGIN
        ROLLBACK;
        PRINT 'PRUEBA (ROLLBACK): no se borró nada. Poné @Aplicar = 1 para aplicar.';
    END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
