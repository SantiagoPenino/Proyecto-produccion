-- ============================================================================
-- PROD_camilo_devolucion_v2.sql
-- ----------------------------------------------------------------------------
-- REEMPLAZA a PROD_camilo_devolucion_nc11_completo.sql, que freno en el candado
-- porque el PC-3576 SI tiene caja. El diagnostico lo confirmo:
--
--       PC-3576  ->  Tca 10476, recibo PC-3576, 27/08 15:39:32
--                    $ 15.920,03 / 40,83 = US$ 389,91, Contado, COBRADO
--                    Pago real: PagIdPago 63649
--
--       PC-4026  ->  sin caja. No se cobro.
--
-- O sea que administracion tenia razon en DOS de los tres, no en los tres:
--       PC-2877  ($   270,00)  queda PENDIENTE  (ya lo esta)
--       PC-4026  (US$  31,81)  queda PENDIENTE
--       PC-3576  (US$ 389,91)  ESTA COBRADO — hay recibo. No queda pendiente.
--
-- QUE HACE:
--
--   (1) Registra el EGRESO por la devolucion de la nota de credito NC-11
--       (US$ 541,27) con la FECHA DE LA NC (31/07/2026 16:23:08), con sus
--       cuatro piezas: EgresosCaja, asiento, comprobante EG-VC-xxx y el vinculo.
--       Asiento:  2.3.1 Anticipos de Clientes  a  1.1.2 Caja ME.
--
--   (2) Descuenta esa devolucion de la cuenta corriente.
--
--   (3) PC-3576: le saca el ANTICIPO_APLICADO (estaba cobrado dos veces) y en
--       su lugar imputa el COBRO REAL de caja (PagIdPago 63649). La deuda sigue
--       COBRADA, pero ahora contra la plata que entro, no contra el saldo a favor.
--
--   (4) PC-4026: le saca el ANTICIPO_APLICADO y repone la deuda: 31,81 PENDIENTE.
--
-- COMO QUEDA:
--       cuenta 11   (US$)  +509,46  ->  -31,81   (= el PC-4026, lo unico que debe en USD)
--       cuenta 1534 ($)    -270,00  ->  -270,00  (el PC-2877)
--
--       Pendientes:  PC-2877  $   270,00
--                    PC-4026  US$  31,81
--       Cobrado:     PC-3576  US$ 389,91  (recibo de caja del 27/08)
--       Devuelto:    NC-11    US$ 541,27  (egreso con fecha 31/07)
--
-- Idempotente: si la devolucion ya se asento, aborta y avisa.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli        INT = 4;
DECLARE @CueUsd     INT = 11, @CuePesos INT = 1534;
DECLARE @DocNC      INT = 6360;                      -- NC-11
DECLARE @Monto      DECIMAL(18,4) = 541.27;
DECLARE @Cotiz      DECIMAL(18,4) = 40.81;           -- la del cobro original del ET-3643
DECLARE @Convertido DECIMAL(18,4) = 22089.23;
DECLARE @Usuario    INT = 11;
DECLARE @CtaAnticipos INT = 22;                      -- 2.3.1
DECLARE @CtaCajaUsd   INT = 4;                       -- 1.1.2
DECLARE @CliGenerico  INT = 2089;
DECLARE @Fecha DATETIME;

-- El cobro REAL del PC-3576 (el que tiene caja)
DECLARE @Doc3576 INT, @Deuda3576 INT, @PagoReal3576 INT;
-- El PC-4026, que queda pendiente
DECLARE @Doc4026 INT, @Deuda4026 INT;

-- ══ CANDADOS ═══════════════════════════════════════════════════════════════

-- 1 · la NC-11
SELECT @Fecha = DocFechaEmision
FROM dbo.DocumentosContables
WHERE DocIdDocumento = @DocNC AND CliIdCliente = @Cli
  AND RTRIM(DocSerie) = 'NC' AND MonIdMoneda = 2
  AND ABS(DocTotal - @Monto) <= 0.01 AND ISNULL(DocEstado,'') <> 'ANULADO';

IF @Fecha IS NULL
BEGIN
    RAISERROR('La NC-11 no esta como esperabamos. No se toca nada.', 16, 1);
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

-- 3 · el PC-3576 tiene que tener su caja COBRADA y su pago real
SELECT @Doc3576 = d.DocIdDocumento
FROM dbo.DocumentosContables d
JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = d.TcaIdTransaccion
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '3576'
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA')
  AND t.TcaTotalCobrado > 0.01;

IF @Doc3576 IS NULL
BEGIN
    RAISERROR('El PC-3576 ya no tiene una caja cobrada. Cambio algo desde el diagnostico. No se toca nada.', 16, 1);
    RETURN;
END

SELECT TOP 1 @PagoReal3576 = p.PagIdPago
FROM dbo.Pagos p
JOIN dbo.DocumentosContables d ON d.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE d.DocIdDocumento = @Doc3576 AND ABS(p.PagMontoConvertido - 15920.03) <= 1.00
ORDER BY p.PagIdPago;

IF @PagoReal3576 IS NULL
BEGIN
    RAISERROR('No se encontro el pago real del PC-3576 en su caja. No se toca nada.', 16, 1);
    RETURN;
END

SELECT @Deuda3576 = DDeIdDocumento FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc3576;

-- 4 · el PC-4026 NO puede tener caja
SELECT @Doc4026 = DocIdDocumento
FROM dbo.DocumentosContables
WHERE CliIdCliente = @Cli AND RTRIM(DocSerie) = 'PC' AND RTRIM(DocNumero) = '4026'
  AND ISNULL(DocEstado,'') <> 'ANULADO' AND TcaIdTransaccion IS NULL;

IF @Doc4026 IS NULL
BEGIN
    RAISERROR('El PC-4026 no existe o SI tiene caja: entonces tambien esta cobrado y no corresponde dejarlo pendiente. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

SELECT @Deuda4026 = DDeIdDocumento FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc4026;

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
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado,
       TieneCaja = CASE WHEN d.TcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    DECLARE @EgrId INT, @AsiId INT, @DocEgreso INT, @Voucher VARCHAR(30);

    -- ── (1a) EL EGRESO ────────────────────────────────────────────────────
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
         'DEVOLUCION_NC11: devolución en efectivo del saldo a favor de la nota de crédito NC-11 (anula el ET-3643, cobrado por transferencia). Registrado con la fecha de la NC.',
         1);
    SET @EgrId = SCOPE_IDENTITY();
    SET @Voucher = 'VC-' + CONVERT(VARCHAR(20), @EgrId);

    -- ── (1b) EL ASIENTO ───────────────────────────────────────────────────
    INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, AsiEstado, UsuarioId, TcaIdTransaccion, SysOrigen)
    VALUES (@Fecha, 'Devolución a Cliente: CAMILO-7008 (NC-11)', 'REGISTRADO', @Usuario, @EgrId, 'CAJA_EGRESOS');
    SET @AsiId = SCOPE_IDENTITY();

    INSERT INTO dbo.Cont_AsientosDetalle
        (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
    VALUES
        (@AsiId, @CtaAnticipos, @Convertido, 0, @Monto, @Cotiz, 2, @Cli, 'CLIENTE'),
        (@AsiId, @CtaCajaUsd,   0, @Convertido, @Monto, @Cotiz, 2, NULL, NULL);

    -- ── (1c) EL COMPROBANTE ───────────────────────────────────────────────
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

    UPDATE dbo.EgresosCaja SET DocIdDocumento = @DocEgreso WHERE EgrIdEgreso = @EgrId;

    -- ── (2) DESCONTAR LA DEVOLUCION DE LA CUENTA ─────────────────────────
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         MovFecha, MovUsuarioAlta, DocIdDocumento, MovObservaciones)
    VALUES
        (@CueUsd, 'AJUSTE', 'Devolución en efectivo - Nota de crédito NC-11',
         -@Monto, 0, @Fecha, @Usuario, @DocNC,
         'DEVOLUCION_NC11_2026-09-09: se le devolvió al cliente el saldo a favor de la NC-11 (US$ 541,27 @ 40,81 = $ 22.089,23). Egreso Nro ' + CONVERT(VARCHAR(20), @EgrId) + ', comprobante EG-' + @Voucher + '.');

    -- ── (3) PC-3576: el cobro real reemplaza al anticipo ─────────────────
    -- Estaba cobrado dos veces: con la caja (Tca real) y con el saldo a favor.
    -- Se saca el anticipo y se imputa el cobro que de verdad entro.
    DECLARE @PagosAnticipo TABLE (PagIdPago INT PRIMARY KEY);
    INSERT INTO @PagosAnticipo (PagIdPago)
    SELECT DISTINCT ip.PagIdPago
    FROM dbo.ImputacionPago ip
    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE ip.DDeIdDocumento = @Deuda3576
      AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL;

    DELETE ip FROM dbo.ImputacionPago ip
    WHERE ip.DDeIdDocumento = @Deuda3576
      AND ip.PagIdPago IN (SELECT PagIdPago FROM @PagosAnticipo);

    -- El cobro real queda imputado a la deuda (si no lo estaba ya)
    IF NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago
                   WHERE DDeIdDocumento = @Deuda3576 AND PagIdPago = @PagoReal3576)
        INSERT INTO dbo.ImputacionPago (PagIdPago, DDeIdDocumento, CueIdCuenta, ImpImporte, ImpFecha, ImpUsuarioAlta, ImpObservaciones)
        VALUES (@PagoReal3576, @Deuda3576, @CueUsd, 389.91, @Fecha, @Usuario,
                'FIX_CAMILO_2026-09-09: la deuda figuraba cubierta por el saldo a favor de la NC-11 cuando en realidad se cobro en caja (Tca 10476, $ 15.920,03 = US$ 389,91). Se imputa el cobro real.');

    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0, DDeEstado = 'COBRADO',
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_CAMILO_2026-09-09: cobrada con la caja Tca 10476 (recibo PC-3576, $ 15.920,03).' +
            ' Se le saco la cobertura con el saldo a favor de la NC-11, que era doble.'), 500)
    WHERE DDeIdDocumento = @Deuda3576;

    -- ── (4) PC-4026: queda PENDIENTE ─────────────────────────────────────
    DECLARE @PagosAnticipo4026 TABLE (PagIdPago INT PRIMARY KEY);
    INSERT INTO @PagosAnticipo4026 (PagIdPago)
    SELECT DISTINCT ip.PagIdPago
    FROM dbo.ImputacionPago ip
    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE ip.DDeIdDocumento = @Deuda4026
      AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL;

    DELETE ip FROM dbo.ImputacionPago ip JOIN @PagosAnticipo4026 f ON f.PagIdPago = ip.PagIdPago;

    DELETE p FROM dbo.Pagos p
    JOIN (SELECT PagIdPago FROM @PagosAnticipo UNION SELECT PagIdPago FROM @PagosAnticipo4026) f
      ON f.PagIdPago = p.PagIdPago
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip2 WHERE ip2.PagIdPago = p.PagIdPago);

    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = DDeImporteOriginal, DDeEstado = 'PENDIENTE', DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_CAMILO_2026-09-09: figuraba cobrada contra el saldo a favor de la NC-11, que' +
            ' se le devolvio en efectivo. No hay caja: queda PENDIENTE de cobro.'), 500)
    WHERE DDeIdDocumento = @Deuda4026;

    UPDATE dbo.DocumentosContables SET DocPagado = 0 WHERE DocIdDocumento = @Doc4026;

    -- ── Saldo corrido y saldo de cuenta ──────────────────────────────────
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
           Asiento = @AsiId, Documento = @DocEgreso, Fecha = @Fecha,
           Monto = @Monto, Cotizacion = @Cotiz, EnPesos = @Convertido;

COMMIT TRANSACTION;

-- ══ DESPUES ════════════════════════════════════════════════════════════════
-- Esperado:  cuenta 11 (US$) = -31,81   |   cuenta 1534 ($) = -270,00
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
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado,
       TieneCaja = CASE WHEN d.TcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

SELECT Momento = 'DESPUES - EGRESO', e.EgrIdEgreso, F = e.EgrFecha, e.EgrConcepto,
       e.EgrProveedor, e.EgrMonto, e.EgrMoneda, e.EgrCotizacion, e.EgrMontoConvertido,
       e.EgrEstado, Comprobante = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       AsientoDebe  = (SELECT SUM(DetDebeUYU)  FROM dbo.Cont_AsientosDetalle WHERE AsiId = d.AsiIdAsiento),
       AsientoHaber = (SELECT SUM(DetHaberUYU) FROM dbo.Cont_AsientosDetalle WHERE AsiId = d.AsiIdAsiento)
FROM dbo.EgresosCaja e
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = e.DocIdDocumento
WHERE e.EgrObservaciones LIKE '%DEVOLUCION_NC11%';

SELECT Momento = 'CONTROL',
       DeudaUsd = CAST(31.81 AS DECIMAL(18,2)),
       SaldoCuentaUsd = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       Cuadra = CASE WHEN ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) + 31.81) <= 0.02
                     THEN 'SI' ELSE 'NO - revisar' END;
