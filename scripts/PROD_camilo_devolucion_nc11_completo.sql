-- ============================================================================
-- PROD_camilo_devolucion_nc11_completo.sql
-- ----------------------------------------------------------------------------
-- CAMILO-7008 (CliIdCliente 4). Hace TODO de una, sin tocar ninguna pantalla:
--
--   (1) REGISTRA EL EGRESO DE CAJA por la devolucion de la nota de credito
--       NC-11 (US$ 541,27), con la FECHA DE LA NOTA DE CREDITO (31/07/2026
--       16:23:08), no con la de hoy. Genera las cuatro piezas que arma el
--       sistema cuando se carga un egreso por pantalla:
--           . EgresosCaja
--           . Cont_AsientosCabecera + Cont_AsientosDetalle (el asiento)
--           . DocumentosContables (comprobante EG-VC-xxx) + su linea
--           . el vinculo DocIdDocumento de vuelta en EgresosCaja
--
--       El asiento es el que corresponde a una devolucion:
--           2.3.1  Anticipos de Clientes        22.089,23   (US$ 541,27 @ 40,81)
--              a  1.1.2  Caja Moneda Extranjera            22.089,23
--
--       Se hace por SQL porque la pantalla de Salida de Dinero solo ofrece
--       cuentas de GASTO (filtra CueTipoBase='PERDIDA') y 2.3.1 es de PASIVO,
--       asi que desde ahi no se puede elegir. El tipo DEVOLUCION_CLIENTE existe
--       en Config_CuentasEgreso y apunta justo a 2.3.1, pero el front no lo usa.
--
--   (2) DESCUENTA la devolucion de la cuenta corriente del cliente, para que
--       ese saldo a favor deje de estar disponible.
--
--   (3) Deja PENDIENTES los tres documentos que pidio administracion:
--           PC-2877  ($   270,00)
--           PC-3576  (US$ 389,91)
--           PC-4026  (US$  31,81)
--       Hoy los dos de dolares figuran cobrados contra ese saldo a favor
--       (ANTICIPO_APLICADO sin caja), y el PC-3576 ademas tiene un pago espejo
--       sin recibo: estaba cobrado dos veces.
--
-- LA COTIZACION: 40,81, la misma a la que entro la plata (Pago 55752 del
-- ET-3643, que la NC-11 anula). 541,27 x 40,81 = 22.089,23, exactamente lo que
-- cobro la caja ese dia. Se devuelve al mismo cambio al que entro.
--
-- COMO QUEDA:
--       cuenta 11   (US$)  +119,55  ->  -421,72   = 389,91 + 31,81, lo que debe
--       cuenta 1534 ($)    -270,00  ->  -270,00   (sin cambios)
--       Sin saldo a favor. Tres pedidos para cobrar y la plata devuelta.
--
-- Idempotente: si la devolucion ya se asento, aborta y avisa.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli        INT = 4;
DECLARE @CueUsd     INT = 11, @CuePesos INT = 1534;
DECLARE @DocNC      INT = 6360;                      -- NC-11
DECLARE @Monto      DECIMAL(18,4) = 541.27;
DECLARE @Cotiz      DECIMAL(18,4) = 40.81;           -- la del cobro original
DECLARE @Convertido DECIMAL(18,4) = 22089.23;        -- 541,27 x 40,81
DECLARE @Usuario    INT = 11;
DECLARE @CtaAnticipos INT = 22;                      -- 2.3.1 Anticipos de Clientes
DECLARE @CtaCajaUsd   INT = 4;                       -- 1.1.2 Caja Moneda Extranjera
DECLARE @CliGenerico  INT = 2089;                    -- CONSUMIDOR FINAL, como todo egreso
DECLARE @Fecha DATETIME;

-- ══ CANDADOS ═══════════════════════════════════════════════════════════════

-- 1 · la NC-11 tiene que existir, viva, en dolares y por 541,27
SELECT @Fecha = DocFechaEmision
FROM dbo.DocumentosContables
WHERE DocIdDocumento = @DocNC AND CliIdCliente = @Cli
  AND RTRIM(DocSerie) = 'NC' AND MonIdMoneda = 2
  AND ABS(DocTotal - @Monto) <= 0.01
  AND ISNULL(DocEstado,'') <> 'ANULADO';

IF @Fecha IS NULL
BEGIN
    RAISERROR('La NC-11 no esta como esperabamos (viva, del cliente 4, en USD, por 541,27). No se toca nada.', 16, 1);
    RETURN;
END

-- 2 · la devolucion no puede estar ya asentada
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
           WHERE CueIdCuenta = @CueUsd AND (MovAnulado IS NULL OR MovAnulado = 0)
             AND MovObservaciones LIKE '%DEVOLUCION_NC11%')
   OR EXISTS (SELECT 1 FROM dbo.EgresosCaja
              WHERE ISNULL(EgrEstado,'') NOT IN ('ANULADO','ANULADA')
                AND EgrObservaciones LIKE '%DEVOLUCION_NC11%')
BEGIN
    RAISERROR('La devolucion de la NC-11 YA esta registrada. No se duplica. No se toca nada.', 16, 1);
    RETURN;
END

-- 3 · la conversion tiene que cerrar
IF ABS(@Monto * @Cotiz - @Convertido) > 0.02
BEGIN
    RAISERROR('541,27 x 40,81 no da 22.089,23. Revisar la cotizacion. No se toca nada.', 16, 1);
    RETURN;
END

-- Los dos documentos de dolares que tienen que quedar pendientes
DECLARE @Docs TABLE (DocIdDocumento INT PRIMARY KEY, Etiqueta VARCHAR(20));
INSERT INTO @Docs (DocIdDocumento, Etiqueta)
SELECT d.DocIdDocumento, RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero)
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('3576','4026')
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

-- 4 · ninguno puede tener caja: si la tuviera, ese cobro seria real
IF EXISTS (SELECT 1 FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento
           WHERE d.TcaIdTransaccion IS NOT NULL)
BEGIN
    RAISERROR('Alguno de los documentos SI tiene transaccion de caja: ese cobro es real. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- ══ ANTES ══════════════════════════════════════════════════════════════════
SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

SELECT Momento = 'ANTES - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    DECLARE @EgrId INT, @AsiId INT, @DocEgreso INT, @Voucher VARCHAR(30);

    -- ── (1a) EL EGRESO DE CAJA ─────────────────────────────────────────────
    INSERT INTO dbo.EgresosCaja
        (StuIdSesion, EgrFecha, EgrUsuarioId, EgrConcepto, EgrProveedor,
         EgrMonto, EgrMoneda, EgrCotizacion, EgrMontoConvertido,
         MPaIdMetodoPago, EgrTipoDocumento, EgrSerieDoc, EgrNumeroDoc,
         EgrTipoEgreso, EgrEstado, EgrObservaciones, EsCajaAdmin)
    VALUES
        (NULL, @Fecha, @Usuario, 'Devolución a Cliente', 'CAMILO-7008',
         @Monto, 'USD', @Cotiz, @Convertido,
         1, 'EGRESO', 'EG', NULL,
         'DEVOLUCION_CLIENTE', 'REGISTRADO',
         'DEVOLUCION_NC11: devolución en efectivo del saldo a favor que dejó la nota de crédito NC-11 (anula el ET-3643, cobrado por transferencia). Fecha de la NC.',
         1);

    SET @EgrId = SCOPE_IDENTITY();
    SET @Voucher = 'VC-' + CONVERT(VARCHAR(20), @EgrId);   -- mismo formato que usa el sistema

    -- ── (1b) EL ASIENTO CONTABLE ──────────────────────────────────────────
    INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, AsiEstado, UsuarioId, TcaIdTransaccion, SysOrigen)
    VALUES (@Fecha, 'Devolución a Cliente: CAMILO-7008 (NC-11)', 'REGISTRADO', @Usuario, @EgrId, 'CAJA_EGRESOS');
    SET @AsiId = SCOPE_IDENTITY();

    INSERT INTO dbo.Cont_AsientosDetalle
        (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
    VALUES
        (@AsiId, @CtaAnticipos, @Convertido, 0, @Monto, @Cotiz, 2, @Cli, 'CLIENTE'),
        (@AsiId, @CtaCajaUsd,   0, @Convertido, @Monto, @Cotiz, 2, NULL, NULL);

    -- ── (1c) EL COMPROBANTE DE SALIDA DE CAJA ─────────────────────────────
    INSERT INTO dbo.DocumentosContables
        (CueIdCuenta, CliIdCliente, DocTipo, DocSerie, DocNumero,
         DocSubtotal, DocImpuestos, DocTotalDescuentos, DocTotalRecargos, DocTotal,
         MonIdMoneda, DocEstado, DocFechaEmision, DocUsuarioAlta, DocPagado,
         TcaIdTransaccion, AsiIdAsiento, DocObservaciones)
    VALUES
        (@CtaCajaUsd, @CliGenerico, 'EGRESO_CAJA', 'EG', @Voucher,
         @Monto, 0, 0, 0, @Convertido,
         2, 'PAGADO', @Fecha, @Usuario, 1,
         @EgrId, @AsiId,
         'Devolución a Cliente | CAMILO-7008 | NC-11 (US$ 541,27 @ 40,81)');
    SET @DocEgreso = SCOPE_IDENTITY();

    INSERT INTO dbo.DocumentosContablesDetalle
        (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
    VALUES
        (@DocEgreso, 'Egreso: Devolución a Cliente',
         'CAMILO-7008 - Devolución del saldo a favor de la nota de crédito NC-11',
         1, @Monto, @Monto, 0, @Monto);

    -- ── (1d) VINCULAR EL DOCUMENTO AL EGRESO ──────────────────────────────
    UPDATE dbo.EgresosCaja SET DocIdDocumento = @DocEgreso WHERE EgrIdEgreso = @EgrId;

    -- ── (2) DESCONTAR LA DEVOLUCION DE LA CUENTA CORRIENTE ────────────────
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         MovFecha, MovUsuarioAlta, DocIdDocumento, MovObservaciones)
    VALUES
        (@CueUsd, 'AJUSTE',
         'Devolución en efectivo - Nota de crédito NC-11',
         -@Monto, 0, @Fecha, @Usuario, @DocNC,
         'DEVOLUCION_NC11_2026-09-09: se le devolvió al cliente el saldo a favor de la NC-11 (US$ 541,27 @ 40,81 = $ 22.089,23). Egreso de caja Nro ' + CONVERT(VARCHAR(20), @EgrId) + ', comprobante EG-' + @Voucher + '. Asiento 2.3.1 Anticipos de Clientes a 1.1.2 Caja ME.');

    -- ── (3) LOS TRES PENDIENTES ───────────────────────────────────────────
    -- Anular los pagos espejo (cobros sin PagIdPago, sin caja, junto al cargo)
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_CAMILO_2026-09-09: pago espejo sin PagIdPago, sin recibo y sin transaccion' +
            ' de caja, creado junto con el cargo. No entro plata: el documento queda PENDIENTE.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Docs x ON x.DocIdDocumento = m.DocIdDocumento
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
      AND m.PagIdPago IS NULL
      AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta c
                  WHERE c.DocIdDocumento = m.DocIdDocumento
                    AND c.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                    AND (c.MovAnulado IS NULL OR c.MovAnulado = 0)
                    AND ABS(DATEDIFF(SECOND, c.MovFecha, m.MovFecha)) <= 1);

    -- Sacar las coberturas con saldo a favor (ANTICIPO_APLICADO sin caja)
    DECLARE @PagosFantasma TABLE (PagIdPago INT PRIMARY KEY);
    INSERT INTO @PagosFantasma (PagIdPago)
    SELECT DISTINCT ip.PagIdPago
    FROM dbo.ImputacionPago ip
    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
    JOIN @Docs x ON x.DocIdDocumento = dd.DocIdDocumento
    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL;

    DELETE ip FROM dbo.ImputacionPago ip JOIN @PagosFantasma f ON f.PagIdPago = ip.PagIdPago;

    DELETE p FROM dbo.Pagos p JOIN @PagosFantasma f ON f.PagIdPago = p.PagIdPago
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip2 WHERE ip2.PagIdPago = p.PagIdPago);

    UPDATE dd
    SET dd.DDeImportePendiente = dd.DDeImporteOriginal,
        dd.DDeEstado = 'PENDIENTE',
        dd.DDeFechaCobro = NULL,
        dd.DDeObservaciones = LEFT(LTRIM(ISNULL(dd.DDeObservaciones,'') +
            ' FIX_CAMILO_2026-09-09: figuraba cobrada contra el saldo a favor de la NC-11,' +
            ' pero no entro plata y esa NC se le devolvio en efectivo. Queda PENDIENTE.'), 500)
    FROM dbo.DeudaDocumento dd
    JOIN @Docs x ON x.DocIdDocumento = dd.DocIdDocumento
    WHERE dd.DDeEstado NOT IN ('PENDIENTE','PARCIAL','VENCIDO');

    UPDATE d SET d.DocPagado = 0
    FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento;

    -- ── Saldo corrido y saldo de cuenta (convencion de la casa) ───────────
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (@CueUsd, @CuePesos) AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

    SELECT Resultado = 'EGRESO CREADO', EgresoNro = @EgrId, Comprobante = 'EG-' + @Voucher,
           Asiento = @AsiId, Documento = @DocEgreso,
           Fecha = @Fecha, Monto = @Monto, Moneda = 'USD',
           Cotizacion = @Cotiz, EnPesos = @Convertido;

COMMIT TRANSACTION;

-- ══ DESPUES ════════════════════════════════════════════════════════════════
-- Esperado:  cuenta 11 (US$) = -421,72   |   cuenta 1534 ($) = -270,00
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

SELECT Momento = 'DESPUES - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado,
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- El egreso, tal como quedo, con su asiento cuadrado
SELECT Momento = 'DESPUES - EGRESO', e.EgrIdEgreso, F = e.EgrFecha, e.EgrConcepto,
       e.EgrProveedor, e.EgrMonto, e.EgrMoneda, e.EgrCotizacion, e.EgrMontoConvertido,
       e.EgrTipoEgreso, e.EgrEstado, Comprobante = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Asiento = d.AsiIdAsiento,
       AsientoDebe  = (SELECT SUM(DetDebeUYU)  FROM dbo.Cont_AsientosDetalle WHERE AsiId = d.AsiIdAsiento),
       AsientoHaber = (SELECT SUM(DetHaberUYU) FROM dbo.Cont_AsientosDetalle WHERE AsiId = d.AsiIdAsiento)
FROM dbo.EgresosCaja e
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = e.DocIdDocumento
WHERE e.EgrObservaciones LIKE '%DEVOLUCION_NC11%';

-- Control final: la deuda en dolares tiene que dar igual al saldo de la cuenta
SELECT Momento = 'CONTROL',
       DeudaUsd = CAST(389.91 + 31.81 AS DECIMAL(18,2)),
       SaldoCuentaUsd = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       Cuadra = CASE WHEN ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) + 421.72) <= 0.02
                     THEN 'SI' ELSE 'NO - revisar' END;
