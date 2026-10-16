-- ============================================================================
-- diag_camilo_cual_tiene_caja.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- El candado de PROD_camilo_devolucion_nc11_completo.sql freno con:
--     "Alguno de los documentos SI tiene transaccion de caja"
--
-- O sea que el PC-3576 o el PC-4026 tiene una caja detras, y eso significa que
-- ALGUIEN COBRO ESA PLATA de verdad. Si es asi, ese documento NO puede quedar
-- pendiente — habria que cobrarlo dos veces.
--
-- Esta consulta muestra cual de los dos es, cuanto cobro esa caja, con que
-- medio de pago y cuando.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Cli INT = 4;

-- ── 1 · Cual de los dos tiene caja ────────────────────────────────────────
SELECT Panel = '1 - CAJA DEL DOCUMENTO',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocIdDocumento,
       Fecha = CONVERT(VARCHAR(19), d.DocFechaEmision, 120),
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocPagado, d.DocEstado,
       TieneCaja = CASE WHEN d.TcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       d.TcaIdTransaccion,
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), ''),
       CajaFecha = CONVERT(VARCHAR(19), t.TcaFecha, 120),
       CajaNeto = CAST(t.TcaTotalNeto AS DECIMAL(18,2)),
       CajaCobrado = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaMonedaBase, t.TcaEstado,
       Veredicto = CASE
         WHEN d.TcaIdTransaccion IS NULL THEN 'sin caja — puede quedar pendiente'
         WHEN ISNULL(t.TcaEstado,'') IN ('ANULADO','ANULADA') THEN 'la caja esta ANULADA — el cobro no vale, puede quedar pendiente'
         WHEN ISNULL(t.TcaTotalCobrado,0) <= 0.01 THEN 'la caja existe pero NO cobro nada — mirar'
         ELSE 'LA CAJA COBRO DE VERDAD — este documento NO deberia quedar pendiente' END
FROM dbo.DocumentosContables d
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = d.TcaIdTransaccion
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('3576','4026')
ORDER BY d.DocFechaEmision;

-- ── 2 · Los pagos de esas cajas ───────────────────────────────────────────
SELECT Panel = '2 - PAGOS DE ESA CAJA',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       p.PagIdPago, Metodo = mp.MPaDescripcionMetodo,
       Monto = CAST(p.PagMontoPago AS DECIMAL(18,2)),
       Moneda = CASE WHEN p.PagIdMonedaPago = 2 THEN 'US$' ELSE '$' END,
       p.PagCotizacion, Convertido = CAST(p.PagMontoConvertido AS DECIMAL(18,2)),
       p.PagTipoMovimiento,
       Fecha = CONVERT(VARCHAR(19), p.PagFechaPago, 120)
FROM dbo.DocumentosContables d
JOIN dbo.Pagos p ON p.PagTcaIdTransaccion = d.TcaIdTransaccion
LEFT JOIN dbo.MetodosPagos mp ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('3576','4026')
ORDER BY d.DocFechaEmision, p.PagIdPago;

-- ── 3 · Todos los movimientos de esos dos, con su respaldo ────────────────
SELECT Panel = '3 - MOVIMIENTOS',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       m.MovIdMovimiento, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Fecha = CONVERT(VARCHAR(19), m.MovFecha, 120),
       m.PagIdPago,
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), '(sin recibo)'),
       Anulado = ISNULL(m.MovAnulado, 0),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 45)
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('3576','4026')
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY d.DocFechaEmision, m.MovIdMovimiento;

-- ── 4 · La deuda de cada uno y con que se pago ────────────────────────────
SELECT Panel = '4 - DEUDAS',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       dd.DDeIdDocumento,
       Original = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado,
       ImputadoPor = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       TipoDePago = ISNULL(p.PagTipoMovimiento, '(sin imputacion)'),
       TieneCaja = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END
FROM dbo.DocumentosContables d
JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
LEFT JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('3576','4026')
ORDER BY d.DocFechaEmision;
