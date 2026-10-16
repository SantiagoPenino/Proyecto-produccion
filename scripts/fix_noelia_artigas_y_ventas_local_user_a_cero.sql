/* ============================================================================
   Noelia artigas (CliIdCliente 749) y Ventas local USER (CliIdCliente 8627):
   dejar las cuatro cuentas DINERO en 0, corrigiendo cada movimiento en su fecha.

   QUÉ PASÓ (22-sep-2026, verificado en la réplica local = grilla DESPUES del lote D):

   NOELIA ARTIGAS — cuenta 319 (US$) +1.980,00 / cuenta 2443 ($) −1.980,00
     ET-4999 (doc 7991, $ 1.980, ACEPTADO_DGI) se cobró el 13/8 por $ 1.980
     (Pagos 58219, caja 7483 con base USD). La caja escribió el cobro (mov 34628,
     +1.980) en la cuenta US$ y el cargo (mov 34627, −1.980) en la cuenta $.
     → Mover el cobro 34628 a la cuenta 2443. Las dos cuentas quedan en 0.

   VENTAS LOCAL USER — cuenta 1586 ($) +1.998,39 / cuenta 1778 (US$) −2.004,57
     Ventas de mostrador de julio (14 al 17/7), todas en pesos, con tres bugs:
     a) cargos en la cuenta US$: ET-1980 (mov 18441, −75), ET-2137 (mov 19272,
        −1.980) y ET-3050 (mov 20225, −99); el cobro de ET-3050 (mov 20226, +99,
        caja 4312 $ 99 efectivo) también quedó en la US$.
        → Moverlos a la cuenta 1586 (moneda del documento), como ya se hizo con
          ET-2061 y ET-2074 de este mismo cliente.
     b) cobro doble: además del cobro del documento (+75 mov 18443, +1.980 mov
        19274, +675 mov 24144, todos en $), la caja asentó el cobro "a nivel orden"
        convertido a dólares: mov 18442 (+US$ 1,84 = 75/40,84), mov 19273
        (+US$ 48,59 = 1.980/40,75) y mov 19630 (+16,55 = 675/40,78, en la cuenta $).
        → Anularlos (mismo criterio que FIX_COBRO_DOBLE_JULIO de los lotes).
     c) ET-1982 (doc 4000, E-Ticket Crédito $ 75): la caja 3888 cobró $ 75
        (Pagos 53100, $ 75, cotización 40,84) pero el libro guardó el equivalente
        en dólares (+1,84, mov 18445) en la cuenta $, y la deuda 6234 quedó
        VENCIDA por 73,16.
        → mov 18445 pasa a +75,00; deuda 6234 COBRADA (pendiente 0, fecha del
          cobro 14/7); ET-1982 marcado como pagado (DocPagado = 1).

   QUÉ HACE: exactamente lo de arriba (5 movimientos cambian de cuenta, 3 se
   anulan, 1 cambia de importe, 1 deuda se salda) + recalcula MovSaldoPosterior
   y CueSaldoActual de las cuentas 319, 2443, 1586 y 1778. Mantiene las fechas
   originales. No toca ningún otro cliente ni ningún otro movimiento.

   CANDADOS: cada cuenta, documento, movimiento, cobro real y deuda tiene que
   estar EXACTAMENTE como se diagnosticó y las cuatro cuentas tienen que tener
   hoy los saldos de arriba; si no, no escribe nada y dice por qué. Después de
   aplicar, si alguna cuenta no queda en 0,00 hace ROLLBACK.

   ESPERADO DESPUÉS: 319 = 0,00 · 2443 = 0,00 · 1586 = 0,00 · 1778 = 0,00 ·
   ET-4999, ET-1980, ET-1982, ET-2137, ET-2187 y ET-3050 con neto 0 en la
   cuenta $ · sin deudas vivas.

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

DECLARE @Tag VARCHAR(60) = 'fix_noelia_artigas_y_ventas_local_user_a_cero.sql';

/* Cuentas: cliente, id, tipo y saldo libro que tienen que tener HOY */
DECLARE @Ctas TABLE (CueIdCuenta INT PRIMARY KEY, CliIdCliente INT, Cliente VARCHAR(30), CueTipo VARCHAR(20), SaldoHoy DECIMAL(18,2));
INSERT INTO @Ctas VALUES (319,  749,  'Noelia artigas',    'DINERO_USD',  1980.00),
                         (2443, 749,  'Noelia artigas',    'DINERO_UYU', -1980.00),
                         (1586, 8627, 'Ventas local USER', 'DINERO_UYU',  1998.39),
                         (1778, 8627, 'Ventas local USER', 'DINERO_USD', -2004.57);

/* Documentos involucrados (todos en pesos) */
DECLARE @Docs TABLE (DocIdDocumento INT PRIMARY KEY, Doc VARCHAR(20), CliIdCliente INT, Total DECIMAL(18,2));
INSERT INTO @Docs VALUES (7991, 'ET-4999', 749,  1980.00),
                         (3999, 'ET-1980', 8627,   75.00),
                         (4000, 'ET-1982', 8627,   75.00),
                         (4188, 'ET-2137', 8627, 1980.00),
                         (4256, 'ET-2187', 8627,  675.00),
                         (4461, 'ET-3050', 8627,   99.00);

/* 1) Movimientos que cambian de cuenta (importe y fecha quedan igual) */
DECLARE @Mover TABLE (MovIdMovimiento INT PRIMARY KEY, CtaHoy INT, CtaNueva INT, DocIdDocumento INT, MovTipo VARCHAR(20), Importe DECIMAL(18,4), Motivo VARCHAR(200));
INSERT INTO @Mover VALUES
 (34628, 319,  2443, 7991, 'PAGO',     1980.00, 'cobro de ET-4999 ($ 1.980, Pagos 58219) escrito en la cuenta US$ porque la caja 7483 tenia base USD; el cargo esta en la cuenta $'),
 (18441, 1778, 1586, 3999, 'VTA_CAJA',  -75.00, 'cargo de ET-1980 ($ 75) escrito en la cuenta US$; su cobro (+75, mov 18443) esta en la cuenta $'),
 (19272, 1778, 1586, 4188, 'VTA_CAJA',-1980.00, 'cargo de ET-2137 ($ 1.980) escrito en la cuenta US$; su cobro (+1.980, mov 19274) esta en la cuenta $'),
 (20225, 1778, 1586, 4461, 'VTA_CAJA',  -99.00, 'cargo de ET-3050 ($ 99) escrito en la cuenta US$'),
 (20226, 1778, 1586, 4461, 'PAGO',       99.00, 'cobro de ET-3050 ($ 99 efectivo, caja 4312 / Pagos 53594) escrito en la cuenta US$');

/* 2) Cobros dobles a anular (el cobro real del documento ya esta en la cuenta $) */
DECLARE @Anular TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, DocIdDocumento INT, Importe DECIMAL(18,4), MovCobroReal INT, ImporteReal DECIMAL(18,2), Motivo VARCHAR(200));
INSERT INTO @Anular VALUES
 (18442, 1778, 3999,  1.84, 18443,   75.00, 'cobro a nivel orden de ET-1980 convertido a dolares (75/40,84); el cobro real del e-ticket (+$ 75, mov 18443) ya esta'),
 (19273, 1778, 4188, 48.59, 19274, 1980.00, 'cobro a nivel orden de ET-2137 en dolares (48,59 = 1.980/40,75, caja 4061); el cobro real del e-ticket (+$ 1.980, mov 19274) ya esta'),
 (19630, 1586, 4256, 16.55, 24144,  675.00, 'cobro a nivel orden de ET-2187 convertido a dolares (675/40,78) y escrito en la cuenta $; el cobro real del e-ticket (+$ 675, mov 24144) ya esta');

/* 3) Cobro con el importe en la moneda equivocada + deuda que queda saldada */
DECLARE @MovCorregir INT = 18445, @CtaCorregir INT = 1586, @DocCorregir INT = 4000, @ImporteHoy DECIMAL(18,4) = 1.84, @ImporteNuevo DECIMAL(18,4) = 75.00;
DECLARE @Deuda INT = 6234, @DeudaPendienteHoy DECIMAL(18,2) = 73.16;

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
IF EXISTS (SELECT 1 FROM @Ctas k
           WHERE NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta = k.CueIdCuenta AND cc.CliIdCliente = k.CliIdCliente AND cc.CueTipo = k.CueTipo AND cc.CueActiva = 1))
BEGIN RAISERROR('CANDADO: las cuentas 319/2443 (Noelia artigas) y 1586/1778 (Ventas local USER) no son las diagnosticadas. No se toca nada.', 16, 1); RETURN; END

IF EXISTS (SELECT 1 FROM @Ctas k
           CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = k.CueIdCuenta
                                               AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0)) s
           WHERE ABS(s.Saldo - k.SaldoHoy) > 0.02)
BEGIN RAISERROR('CANDADO: alguna de las cuatro cuentas no tiene hoy el saldo del diagnostico (319 +1.980 / 2443 -1.980 / 1586 +1.998,39 / 1778 -2.004,57). Cambio algo desde el 21/9: revisar antes de aplicar. No se toca nada.', 16, 1); RETURN; END

IF EXISTS (SELECT 1 FROM @Docs x
           WHERE NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables d WHERE d.DocIdDocumento = x.DocIdDocumento
                             AND RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) = x.Doc AND d.CliIdCliente = x.CliIdCliente
                             AND d.MonIdMoneda = 1 AND d.DocTotal = x.Total AND d.CfeEstado = 'ACEPTADO_DGI'))
BEGIN RAISERROR('CANDADO: algun documento (ET-4999, ET-1980, ET-1982, ET-2137, ET-2187, ET-3050) no esta como se diagnostico (cliente, pesos, total, ACEPTADO_DGI). No se toca nada.', 16, 1); RETURN; END

IF EXISTS (SELECT 1 FROM @Mover x
           WHERE NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WHERE m.MovIdMovimiento = x.MovIdMovimiento AND m.CueIdCuenta = x.CtaHoy
                             AND m.DocIdDocumento = x.DocIdDocumento AND m.MovTipo = x.MovTipo AND ABS(m.MovImporte - x.Importe) < 0.005 AND ISNULL(m.MovAnulado, 0) = 0))
   OR EXISTS (SELECT 1 FROM @Mover x JOIN @Ctas k ON k.CueIdCuenta = x.CtaNueva JOIN @Ctas h ON h.CueIdCuenta = x.CtaHoy WHERE k.CliIdCliente <> h.CliIdCliente OR k.CueTipo <> 'DINERO_UYU')
BEGIN RAISERROR('CANDADO: alguno de los 5 movimientos a mover (34628, 18441, 19272, 20225, 20226) no esta como se diagnostico (cuenta, documento, tipo, importe, vivo). No se toca nada.', 16, 1); RETURN; END

IF EXISTS (SELECT 1 FROM @Anular x
           WHERE NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WHERE m.MovIdMovimiento = x.MovIdMovimiento AND m.CueIdCuenta = x.CueIdCuenta
                             AND m.DocIdDocumento = x.DocIdDocumento AND m.MovTipo = 'PAGO' AND ABS(m.MovImporte - x.Importe) < 0.005 AND ISNULL(m.MovAnulado, 0) = 0)
              OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta r WHERE r.MovIdMovimiento = x.MovCobroReal AND r.CueIdCuenta = 1586
                             AND r.DocIdDocumento = x.DocIdDocumento AND r.MovTipo = 'PAGO' AND ABS(r.MovImporte - x.ImporteReal) < 0.005 AND ISNULL(r.MovAnulado, 0) = 0))
BEGIN RAISERROR('CANDADO: alguno de los 3 cobros dobles (18442, 19273, 19630) o de los cobros reales (18443, 19274, 24144) no esta como se diagnostico. No se toca nada.', 16, 1); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WHERE m.MovIdMovimiento = @MovCorregir AND m.CueIdCuenta = @CtaCorregir AND m.DocIdDocumento = @DocCorregir
               AND m.MovTipo = 'PAGO' AND ABS(m.MovImporte - @ImporteHoy) < 0.005 AND ISNULL(m.MovAnulado, 0) = 0)
   OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta c WHERE c.CueIdCuenta = @CtaCorregir AND c.DocIdDocumento = @DocCorregir AND c.MovTipo = 'VTA_CAJA'
                  AND ABS(c.MovImporte + @ImporteNuevo) < 0.005 AND ISNULL(c.MovAnulado, 0) = 0)
   OR NOT EXISTS (SELECT 1 FROM dbo.Pagos p WHERE p.PagIdPago = 53100 AND p.PagTcaIdTransaccion = 3888 AND p.PagIdMonedaPago = 1 AND p.PagMontoPago = 75)
   OR NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = @Deuda AND dd.DocIdDocumento = @DocCorregir AND dd.CueIdCuenta = @CtaCorregir
                  AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO') AND ABS(dd.DDeImportePendiente - @DeudaPendienteHoy) < 0.01)
BEGIN RAISERROR('CANDADO: ET-1982 no esta como se diagnostico (mov 18445 +1,84 en la cuenta 1586, cargo -75, Pagos 53100 $ 75 de la caja 3888, deuda 6234 viva por 73,16). No se toca nada.', 16, 1); RETURN; END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'ANTES' AS Momento, k.Cliente, k.CueIdCuenta, CASE WHEN k.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END AS Moneda,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = k.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       DeudasVivas = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = k.CueIdCuenta
                                  AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0) AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM @Ctas k JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = k.CueIdCuenta ORDER BY k.CliIdCliente, k.CueIdCuenta;

SELECT 'A MOVER' AS Paso, d.Doc, m.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.MovTipo, CAST(m.MovImporte AS DECIMAL(18,2)) AS Importe,
       x.CtaHoy, x.CtaNueva, x.Motivo
FROM @Mover x JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = x.MovIdMovimiento JOIN @Docs d ON d.DocIdDocumento = x.DocIdDocumento ORDER BY m.MovFecha;

SELECT 'A ANULAR' AS Paso, d.Doc, m.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.CueIdCuenta AS Cta, CAST(m.MovImporte AS DECIMAL(18,2)) AS Importe,
       LEFT(m.MovConcepto, 40) AS Concepto, x.MovCobroReal, x.ImporteReal, x.Motivo
FROM @Anular x JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = x.MovIdMovimiento JOIN @Docs d ON d.DocIdDocumento = x.DocIdDocumento ORDER BY m.MovFecha;

SELECT 'A CORREGIR' AS Paso, 'ET-1982' AS Doc, m.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.CueIdCuenta AS Cta,
       CAST(m.MovImporte AS DECIMAL(18,2)) AS ImporteHoy, @ImporteNuevo AS ImporteNuevo, LEFT(m.MovConcepto, 40) AS Concepto,
       Deuda = @Deuda, DeudaPendienteHoy = dd.DDeImportePendiente, DeudaEstadoHoy = dd.DDeEstado, DeudaDespues = 'COBRADO / 0'
FROM dbo.MovimientosCuenta m CROSS JOIN dbo.DeudaDocumento dd WHERE m.MovIdMovimiento = @MovCorregir AND dd.DDeIdDocumento = @Deuda;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.CueIdCuenta      = x.CtaNueva,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' | Migrado de cuenta ' + CAST(x.CtaHoy AS VARCHAR) + ' a ' + CAST(x.CtaNueva AS VARCHAR)
                              + ' (moneda del documento). FIX 22-sep-2026: ' + x.Motivo + '. ' + @Tag), 500)
    FROM dbo.MovimientosCuenta m JOIN @Mover x ON x.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE m
    SET m.MovAnulado       = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' ANULADO 22-sep-2026 (FIX_COBRO_DOBLE_JULIO): ' + x.Motivo + '. ' + @Tag), 500)
    FROM dbo.MovimientosCuenta m JOIN @Anular x ON x.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE dbo.MovimientosCuenta
    SET MovImporte       = @ImporteNuevo,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones, '') + ' FIX_MONEDA_2026-09-22: la caja 3888 cobro $ 75 (Pagos 53100, cotizacion 40,84) pero el libro guardo el equivalente en dolares (1,84) en la cuenta $. Se pone el importe cobrado. ' + @Tag), 500)
    WHERE MovIdMovimiento = @MovCorregir;

    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0,
        DDeEstado           = 'COBRADO',
        DDeFechaCobro       = ISNULL(DDeFechaCobro, (SELECT MovFecha FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovCorregir)),
        DDeObservaciones    = LEFT(LTRIM(ISNULL(DDeObservaciones, '') + ' FIX_MONEDA_2026-09-22: ET-1982 se cobro entero el 14/7 ($ 75, caja 3888); el libro tenia el cobro en dolares. ' + @Tag), 500)
    WHERE DDeIdDocumento = @Deuda;

    UPDATE dbo.DocumentosContables SET DocPagado = 1 WHERE DocIdDocumento = @DocCorregir;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM @Ctas) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM @Ctas);

    /* Verificación dura: las cuatro cuentas tienen que quedar en 0,00 */
    IF EXISTS (SELECT 1 FROM @Ctas k
               WHERE ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = k.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0)) > 0.02)
    BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR('VERIFICACION: alguna cuenta no quedo en 0,00 despues de aplicar. Se deshizo todo (ROLLBACK). No se escribio nada.', 16, 1);
        RETURN;
    END

    COMMIT TRANSACTION;
    PRINT 'Aplicado: 5 movimientos movidos a la cuenta $, 3 cobros dobles anulados, ET-1982 con su cobro de $ 75 y deuda saldada. Las 4 cuentas en 0,00.';
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS ──────────────────────────────────────────────────────────────── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento, k.Cliente, k.CueIdCuenta, CASE WHEN k.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END AS Moneda,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = k.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       DeudasVivas = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = k.CueIdCuenta
                                  AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0) AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM @Ctas k JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = k.CueIdCuenta ORDER BY k.CliIdCliente, k.CueIdCuenta;

SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento, d.Doc, m.CueIdCuenta AS Cta,
       Cargo = CAST(SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END) AS DECIMAL(18,2)),
       Cobro = CAST(SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END) AS DECIMAL(18,2)),
       Neto  = CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
FROM @Docs d JOIN dbo.MovimientosCuenta m ON m.DocIdDocumento = d.DocIdDocumento
WHERE ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
GROUP BY d.Doc, m.CueIdCuenta ORDER BY d.Doc, m.CueIdCuenta;
