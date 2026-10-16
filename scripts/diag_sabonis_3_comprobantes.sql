-- ============================================================================
-- diag_sabonis_3_comprobantes.sql   (SOLO LECTURA — no cambia nada)
-- ----------------------------------------------------------------------------
-- Los US$ 11.488,77 a favor de SABONIS salen de tres comprobantes donde se
-- cobró más de lo que se asentó como cargo:
--
--   FA-598  (doc 7314)  cobrado 20.000,00  cargo 14.999,95  → sobran 5.000,05
--   FA-1150 (doc 9406)  cobrado  5.082,63  cargo     80,16  → sobran 5.002,47
--   FA-1007 (doc 7857)  cobrado  1.568,64  cargo     38,40  → sobran 1.530,24
--   (menos el PAGO_CRUZADO de −43,99 que cubrió 1.800 en pesos)  = 11.488,77
--
-- Falta saber POR QUÉ el cargo es menor. Las dos posibilidades se distinguen
-- mirando las LÍNEAS del comprobante:
--
--   a) Las líneas suman el total (20.000): el comprobante está bien y lo que
--      falta es el CARGO en la cuenta → hay que asentar la diferencia.
--   b) Las líneas suman lo mismo que el cargo (14.999,95): el comprobante se
--      emitió por MÁS de lo que dicen sus líneas → cabezal ≠ líneas, y lo que
--      fue a DGI es el importe de las líneas. Ahí el "a favor" es plata cobrada
--      de más, no un error de asiento.
-- ============================================================================

-- ── 1) Cabezal vs suma de líneas ────────────────────────────────────────────
SELECT d.DocIdDocumento,
       Documento  = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       DocTipo    = RTRIM(d.DocTipo),
       d.DocFechaEmision,
       d.DocTotal,
       SumaLineas = ISNULL((SELECT SUM(dd.DcdTotal) FROM dbo.DocumentosContablesDetalle dd
                            WHERE dd.DocIdDocumento = d.DocIdDocumento), 0),
       Lineas     = (SELECT COUNT(*) FROM dbo.DocumentosContablesDetalle dd
                     WHERE dd.DocIdDocumento = d.DocIdDocumento),
       CargoEnCuenta = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                               WHERE m.DocIdDocumento = d.DocIdDocumento
                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                 AND m.MovImporte < 0), 0),
       CobroEnCuenta = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                               WHERE m.DocIdDocumento = d.DocIdDocumento
                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                 AND m.MovImporte > 0), 0),
       d.CfeEstado, d.TcaIdTransaccion, d.DocObservaciones
FROM dbo.DocumentosContables d
WHERE d.DocIdDocumento IN (7314, 9406, 7857)
ORDER BY d.DocIdDocumento;

-- ── 2) Las líneas, una por una ──────────────────────────────────────────────
SELECT dd.DocIdDocumento,
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       dd.OrdCodigoOrden,
       Item = LEFT(dd.DcdNomItem, 60),
       dd.DcdCantidad, dd.DcdPrecioUnitario, dd.DcdSubtotal, dd.DcdImpuestos, dd.DcdTotal
FROM dbo.DocumentosContablesDetalle dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE dd.DocIdDocumento IN (7314, 9406, 7857)
ORDER BY dd.DocIdDocumento, dd.DcdIdDetalle;

-- ── 3) La transacción de caja que los originó (qué se cobró y con qué) ──────
--    TcaTotalNeto = lo que valía la venta · TcaTotalCobrado = lo que entregó el
--    cliente. Si Cobrado > Neto, la plata de más entró a propósito por caja.
SELECT t.TcaIdTransaccion, t.TcaFecha, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalBruto, t.TcaTotalAjuste, t.TcaTotalNeto, t.TcaTotalCobrado,
       t.TcaMonedaBase, t.TcaEstado, t.TcaObservaciones
FROM dbo.TransaccionesCaja t
WHERE t.TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM dbo.DocumentosContables
                             WHERE DocIdDocumento IN (7314, 9406, 7857) AND TcaIdTransaccion IS NOT NULL);

-- ── 3.b) LA MONEDA: ¿el pago era en pesos y entró a la cuenta de dólares? ───
--    Sospecha (01-09-2026): 1.568,64 ÷ 38,40 = 40,85 y 5.082,63 ÷ 124,15 = 40,94.
--    Eso es cotización, no plata a favor: el importe en PESOS se asentó en la
--    cuenta USD sin convertir (~41x). Confirmación: MonedaDoc = 1 ($) o
--    MonedaPago = 1 con el movimiento cayendo en una cuenta DINERO_USD.
SELECT m.MovIdMovimiento,
       Documento   = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       MonedaDoc   = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CuentaDelMov = m.CueIdCuenta,
       MonedaCuenta = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, m.MovImporte,
       p.PagIdPago,
       MonedaPago  = CASE WHEN p.PagIdMonedaPago = 2 THEN 'US$' ELSE '$' END,
       p.PagMontoPago, p.PagCotizacion, p.PagMontoConvertido,
       d.DocTotal, d.DocCotizacion
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
WHERE m.DocIdDocumento IN (7314, 9406, 7857)
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.DocIdDocumento, m.MovIdMovimiento;

-- ── 4) El plan de metros: qué recarga entró y por cuánto ────────────────────
--    Confirmar si la recarga del 07/08 (+2.142,85 mts) corresponde a FA-598:
--    2.142,85 × 7,00 = 14.999,95 = exactamente el cargo asentado. Si el cliente
--    pagó 20.000, le faltarían 714,29 mts (5.000,05 ÷ 7,00) en el plan.
SELECT m.MovIdMovimiento, m.MovTipo, m.MovImporte, m.MovFecha,
       Concepto = LEFT(m.MovConcepto, 90)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE RTRIM(ISNULL(c.CioRuc,'')) = '213866340011'
  AND cc.CueTipo = 'MTS'
  AND m.MovImporte > 0
ORDER BY m.MovIdMovimiento DESC;
