/* ============================================================================
   crear_ficha_rfa_sas_y_deuda_4860.sql
   ----------------------------------------------------------------------------
   QUÉ HACE
   Le da a RFA SAS su propia ficha y registra la deuda que hoy no existe.

   EL PROBLEMA
   El 21-jul-2026 se emitió la E-Factura a Crédito FA-226 (doc 4860) por
   $33.540 (pesos) a RFA SAS — "26 Equipos Basquet CÍRCULO SPORTIVO",
   CAE 90262053670 Serie A 27503, aceptada por DGI. Se emitió colgada de la
   ficha 2089, que es el CONSUMIDOR FINAL genérico del sistema. Como el código
   le niega cuenta corriente al genérico (isRealClient excluye a
   CONSUMIDOR_FINAL_ID = 2089, cfeController.js:747 y :1403), la factura quedó
   SIN DeudaDocumento y SIN MovimientosCuenta: la deuda no existe, no aparece
   en el estado de cuenta y nadie la va a reclamar.

   QUÉ HACE ESTE SCRIPT (en una sola transacción)
     1. Crea la ficha de RFA SAS (RUC 160360060013).
     2. Le crea la cuenta corriente en PESOS (DINERO_UYU, moneda 1).
     3. Reasigna el documento 4860 de la ficha 2089 a la ficha nueva.
     4. Da de alta la deuda de $33.540 (DeudaDocumento, PENDIENTE).
     5. Registra el movimiento de cuenta (VTA_CAJA, -33.540) y deja el saldo.

   QUÉ NO TOCA
   El comprobante ante DGI. El documento conserva su snapshot de receptor
   (DocCliNombre = 'RFA SAS', DocCliDocumento = '160360060013'), su CAE, su
   serie y su número. Solo cambia a qué ficha interna está asociado.

   ORDEN DE EJECUCIÓN
   Correr ESTE script PRIMERO, y recién después
   restaurar_consumidor_final_2089.sql. Así no se pierde el dato de a quién se
   le facturó.

   CÓMO CORRERLO
   Ejecutar entero. Transaccional e idempotente: si la ficha o la deuda ya
   existen, no duplica nada y avisa. Verifica todo antes de escribir: si el
   documento no está en el estado esperado, aborta sin tocar nada.
   ============================================================================ */

/* La base del sistema es SecureAppDB. En el mismo servidor hay bases viejas
   (importa, SecureAppDB2205, SecureAppDB_Vieja): si SSMS quedó apuntando a
   cualquiera de esas, el script falla entero con "Invalid object name". */
USE SecureAppDB;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ── PARÁMETROS ──────────────────────────────────────────────────────────── */
DECLARE @DocId            INT           = 4860;
DECLARE @RucRfa           VARCHAR(20)   = '160360060013';
DECLARE @NombreRfa        NVARCHAR(200) = 'RFA SAS';
DECLARE @DireccionRfa     NVARCHAR(500) = 'Artigas 1851';   -- la que había quedado en la ficha 2089
DECLARE @CondicionPago    INT           = 1;   -- 1 = Contado. Es lo que usa el sistema para
                                               -- todas las facturas a crédito (ver CondicionesPago).
                                               -- Cambialo a 3 si RFA SAS tiene 30 días pactados.
DECLARE @DiasVencimiento  INT           = 0;   -- 0 = vence el mismo día de emisión (convención actual).
DECLARE @UsuarioAlta      INT           = 11;  -- Naty, quien emitió la factura.

/* ── 1) VERIFICACIONES: si algo no cuadra, no se escribe nada ────────────── */
DECLARE @Total       DECIMAL(18,4);
DECLARE @FechaEmis   DATETIME;
DECLARE @Moneda      INT;
DECLARE @CliActual   INT;
DECLARE @Serie       VARCHAR(20);
DECLARE @Numero      VARCHAR(20);
DECLARE @Motivo      NVARCHAR(300) = NULL;

SELECT @Total     = DocTotal,
       @FechaEmis = DocFechaEmision,
       @Moneda    = MonIdMoneda,
       @CliActual = CliIdCliente,
       @Serie     = LTRIM(RTRIM(ISNULL(DocSerie, ''))),
       @Numero    = CAST(ISNULL(DocNumero, 0) AS VARCHAR(20))
FROM dbo.DocumentosContables
WHERE DocIdDocumento = @DocId;

IF @Total IS NULL
    SET @Motivo = 'El documento ' + CAST(@DocId AS VARCHAR(10)) + ' no existe.';
ELSE IF @CliActual <> 2089
    SET @Motivo = 'El documento ya NO está en la ficha 2089 (está en la ' + CAST(@CliActual AS VARCHAR(10)) + '). ¿Ya se corrigió?';
ELSE IF EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DocIdDocumento = @DocId)
    SET @Motivo = 'El documento YA tiene deuda registrada: no hay nada que regularizar.';
ELSE IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE DocIdDocumento = @DocId AND MovAnulado = 0)
    SET @Motivo = 'El documento YA tiene movimiento de cuenta: revisar a mano antes de seguir.';

IF @Motivo IS NOT NULL
BEGIN
    PRINT '[ABORTADO] ' + @Motivo;
    PRINT 'No se modificó nada.';
    RETURN;
END

PRINT '--- ANTES ---';
PRINT 'Documento ' + CAST(@DocId AS VARCHAR(10)) + '  ' + @Serie + '-' + @Numero
    + '  |  Total: ' + CAST(@Total AS VARCHAR(30))
    + '  |  Moneda: ' + CAST(@Moneda AS VARCHAR(5)) + ' (1=pesos, 2=USD)'
    + '  |  Ficha actual: ' + CAST(@CliActual AS VARCHAR(10)) + ' (Consumidor Final)';
PRINT 'Deuda registrada: NO  |  Movimiento de cuenta: NO';
PRINT '';

/* ── 2) EJECUCIÓN ────────────────────────────────────────────────────────── */
BEGIN TRY
    BEGIN TRANSACTION;

    /* 2.1 — Ficha de RFA SAS (si ya existe una con ese RUC, se reutiliza) */
    DECLARE @CliRfa INT = (
        SELECT TOP 1 CliIdCliente FROM dbo.Clientes
        WHERE LTRIM(RTRIM(ISNULL(CioRuc, ''))) = @RucRfa AND CliIdCliente <> 2089
        ORDER BY CliIdCliente
    );

    IF @CliRfa IS NULL
    BEGIN
        -- Mismo criterio que usa la app al dar de alta un cliente
        -- (clientsController.js: CodCliente = MAX(CodCliente) + 1, ESTADO 'ACTIVO').
        DECLARE @NuevoCod INT = (SELECT ISNULL(MAX(CodCliente), 0) + 1 FROM dbo.Clientes);

        INSERT INTO dbo.Clientes
            (CodCliente, Nombre, NombreFantasia, IDCliente, CioRuc, DireccionTrabajo, ESTADO)
        VALUES
            (@NuevoCod, @NombreRfa, @NombreRfa, @NombreRfa, @RucRfa, @DireccionRfa, 'ACTIVO');

        SET @CliRfa = SCOPE_IDENTITY();
        PRINT '[1] Ficha creada para RFA SAS -> CliIdCliente = ' + CAST(@CliRfa AS VARCHAR(10))
            + '  (CodCliente ' + CAST(@NuevoCod AS VARCHAR(10)) + ')';
        -- IDReact queda NULL a propósito: el alta web 3116 es la del Consumidor
        -- Final y tiene que seguir apuntando a la ficha 2089, no a RFA SAS.
    END
    ELSE
        PRINT '[1] Ya existía una ficha con el RUC ' + @RucRfa + ' -> CliIdCliente = ' + CAST(@CliRfa AS VARCHAR(10)) + '. Se reutiliza.';

    /* 2.2 — Cuenta corriente en pesos */
    DECLARE @Cuenta INT = (
        SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente
        WHERE CliIdCliente = @CliRfa AND CueTipo = 'DINERO_UYU' AND ISNULL(MonIdMoneda, 1) = 1
        ORDER BY CueIdCuenta
    );

    IF @Cuenta IS NULL
    BEGIN
        INSERT INTO dbo.CuentasCliente
            (CliIdCliente, CPaIdCondicion, CueTipo, MonIdMoneda, CueSaldoActual,
             CueLimiteCredito, CuePuedeNegativo, CueCicloActivo, CueActiva,
             CueFechaAlta, CueUsuarioAlta, CueObservaciones)
        VALUES
            (@CliRfa, @CondicionPago, 'DINERO_UYU', 1, 0,
             0, 0, 0, 1,
             @FechaEmis, @UsuarioAlta,
             N'Cuenta creada para regularizar la factura FA-226 (doc 4860), emitida sobre la ficha del Consumidor Final.');

        SET @Cuenta = SCOPE_IDENTITY();
        PRINT '[2] Cuenta corriente creada (DINERO_UYU) -> CueIdCuenta = ' + CAST(@Cuenta AS VARCHAR(10));
    END
    ELSE
        PRINT '[2] Ya existía cuenta DINERO_UYU -> CueIdCuenta = ' + CAST(@Cuenta AS VARCHAR(10)) + '. Se reutiliza.';

    /* 2.3 — Reasignar el documento a la ficha nueva */
    UPDATE dbo.DocumentosContables
       SET CliIdCliente = @CliRfa
     WHERE DocIdDocumento = @DocId AND CliIdCliente = 2089;
    PRINT '[3] Documento ' + CAST(@DocId AS VARCHAR(10)) + ' reasignado de la ficha 2089 a la '
        + CAST(@CliRfa AS VARCHAR(10)) + '. (El receptor del CFE ante DGI no cambia.)';

    /* 2.4 — Alta de la deuda */
    INSERT INTO dbo.DeudaDocumento
        (CueIdCuenta, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente,
         DDeFechaEmision, DDeFechaVencimiento, DDeCuotaNumero, DDeCuotaTotal,
         DDeEstado, DDeObservaciones)
    VALUES
        (@Cuenta, @DocId, @Total, @Total,
         CAST(@FechaEmis AS DATE), DATEADD(DAY, @DiasVencimiento, CAST(@FechaEmis AS DATE)), 1, 1,
         'PENDIENTE',
         N'Regularización: la factura se emitió sobre la ficha del Consumidor Final (2089), que no tiene cuenta corriente, y quedó sin deuda registrada.');
    PRINT '[4] Deuda dada de alta por ' + CAST(@Total AS VARCHAR(30)) + ' (PENDIENTE).';

    /* 2.5 — Movimiento de cuenta y saldo
       Se inserta explícitamente en vez de llamar a SP_RegistrarMovimiento para
       replicar exactamente la forma de los movimientos que el sistema ya genera
       para una E-Factura a Crédito (MovTipo 'VTA_CAJA', importe negativo). */
    DECLARE @SaldoPrevio DECIMAL(18,4) = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cuenta);
    DECLARE @SaldoNuevo  DECIMAL(18,4) = @SaldoPrevio - @Total;

    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    VALUES
        (@Cuenta, 'VTA_CAJA',
         N'Venta E-Factura Credito: ' + @Serie + '-' + @Numero,
         -@Total, @SaldoNuevo,
         @DocId, @FechaEmis, @UsuarioAlta, 0,
         N'Regularización de la factura FA-226, emitida sobre la ficha del Consumidor Final (2089).');

    UPDATE dbo.CuentasCliente SET CueSaldoActual = @SaldoNuevo WHERE CueIdCuenta = @Cuenta;
    PRINT '[5] Movimiento registrado. Saldo de la cuenta: ' + CAST(@SaldoNuevo AS VARCHAR(30)) + ' (negativo = debe).';

    COMMIT TRANSACTION;
    PRINT '';
    PRINT '=== LISTO. Ahora sí se puede correr restaurar_consumidor_final_2089.sql ===';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT '[X] ERROR: ' + ERROR_MESSAGE() + '  -> se deshizo todo, no quedó nada a medias.';
    THROW;
END CATCH

/* ── 3) VERIFICACIÓN ─────────────────────────────────────────────────────── */
PRINT '';
PRINT '--- DESPUES ---';

SELECT 'Ficha'    AS Que, c.CliIdCliente, LTRIM(RTRIM(c.Nombre)) AS Nombre,
       LTRIM(RTRIM(c.CioRuc)) AS Ruc, c.CodCliente, c.ESTADO
FROM dbo.Clientes c
WHERE LTRIM(RTRIM(ISNULL(c.CioRuc,''))) = '160360060013' AND c.CliIdCliente <> 2089;

SELECT 'Documento' AS Que, d.DocIdDocumento, d.CliIdCliente AS FichaAhora,
       LTRIM(RTRIM(d.DocTipo)) AS Tipo, d.DocTotal, d.DocPagado,
       LTRIM(RTRIM(ISNULL(d.DocCliNombre,''))) AS ReceptorCFE,
       LEFT(ISNULL(d.CfeNumeroOficial,''), 44) AS CAE
FROM dbo.DocumentosContables d WHERE d.DocIdDocumento = 4860;

SELECT 'Deuda' AS Que, dd.DDeIdDocumento, dd.CueIdCuenta, dd.DDeImporteOriginal,
       dd.DDeImportePendiente, dd.DDeFechaEmision, dd.DDeFechaVencimiento, dd.DDeEstado
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = 4860;

SELECT 'Movimiento' AS Que, m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo,
       m.MovConcepto, m.MovImporte, m.MovSaldoPosterior, m.MovFecha
FROM dbo.MovimientosCuenta m WHERE m.DocIdDocumento = 4860;

SELECT 'Cuenta' AS Que, cu.CueIdCuenta, cu.CliIdCliente, cu.CueTipo,
       cu.MonIdMoneda, cu.CueSaldoActual, cu.CueActiva
FROM dbo.CuentasCliente cu
JOIN dbo.Clientes c ON c.CliIdCliente = cu.CliIdCliente
WHERE LTRIM(RTRIM(ISNULL(c.CioRuc,''))) = '160360060013' AND c.CliIdCliente <> 2089;

/* Para deshacer TODO lo que hizo este script (reemplazar los ids por los que
   imprimió arriba):

   BEGIN TRAN;
     DELETE FROM dbo.MovimientosCuenta WHERE DocIdDocumento = 4860;
     DELETE FROM dbo.DeudaDocumento    WHERE DocIdDocumento = 4860;
     UPDATE dbo.DocumentosContables SET CliIdCliente = 2089 WHERE DocIdDocumento = 4860;
     DELETE FROM dbo.CuentasCliente WHERE CueIdCuenta = <CueIdCuenta creada>;
     DELETE FROM dbo.Clientes       WHERE CliIdCliente = <CliIdCliente creada>;
   COMMIT;
*/
