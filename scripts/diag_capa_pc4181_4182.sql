-- ============================================================================
-- diag_capa_pc4181_4182.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Los dos Pedidos Caja de CAPA del 11/09 salieron raros:
--       PC-4181  $  2.100,00  Contado  -> DocPagado = 1 pero SIN cobro y SIN caja
--       PC-4182  $ 32.491,05  Credito  -> DeudaViva = 0 y su caja quedo ANULADA
--
-- Un contado que dice "pagado" sin que entre plata, y un credito sin deuda que
-- nadie va a cobrar. Esta consulta muestra la fila de deuda de cada uno (si
-- existe), con que se cubrio, y que paso con la caja anulada del PC-4182.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Cli INT = 854;

-- ── 1 · Los dos documentos ────────────────────────────────────────────────
SELECT Panel = '1 - DOCUMENTOS',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), d.DocIdDocumento,
       Fecha = CONVERT(VARCHAR(19), d.DocFechaEmision, 120),
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocPagado, d.DocEstado, d.CfeEstado, d.CicIdCiclo,
       d.TcaIdTransaccion,
       CajaEstado = ISNULL((SELECT t.TcaEstado FROM dbo.TransaccionesCaja t
                            WHERE t.TcaIdTransaccion = d.TcaIdTransaccion), '(sin caja)')
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('4181','4182')
ORDER BY d.DocFechaEmision;

-- ── 2 · Su fila de deuda (si la tienen) y con que se cubrio ──────────────
SELECT Panel = '2 - DEUDA',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       dd.DDeIdDocumento, dd.CueIdCuenta,
       Original = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado, dd.DDeFechaCobro,
       Imputado = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       TipoDePago = ISNULL(p.PagTipoMovimiento, '(sin imputacion)'),
       TieneCaja = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
LEFT JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('4181','4182')
ORDER BY d.DocFechaEmision;

-- ── 3 · Todos sus movimientos ─────────────────────────────────────────────
SELECT Panel = '3 - MOVIMIENTOS',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       m.MovIdMovimiento, Hora = CONVERT(VARCHAR(8), m.MovFecha, 108),
       m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       m.PagIdPago, Anulado = ISNULL(m.MovAnulado, 0),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 50)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('4181','4182')
ORDER BY d.DocFechaEmision, m.MovIdMovimiento;

-- ── 4 · La caja anulada del PC-4182, y sus pagos ─────────────────────────
SELECT Panel = '4 - LA CAJA ANULADA', t.TcaIdTransaccion,
       Fecha = CONVERT(VARCHAR(19), t.TcaFecha, 120),
       Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
       Neto = CAST(t.TcaTotalNeto AS DECIMAL(18,2)),
       Cobrado = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaMonedaBase, t.TcaEstado, t.TcaFechaAnulacion, t.TcaUsuarioAnula,
       Obs = LEFT(ISNULL(t.TcaObservaciones,''), 80)
FROM dbo.TransaccionesCaja t
WHERE t.TcaIdTransaccion = 11199;

SELECT Panel = '4b - PAGOS DE ESA CAJA', p.PagIdPago,
       Monto = CAST(p.PagMontoPago AS DECIMAL(18,2)),
       Moneda = CASE WHEN p.PagIdMonedaPago = 2 THEN 'US$' ELSE '$' END,
       p.PagTipoMovimiento, p.PagFechaPago,
       Metodo = mp.MPaDescripcionMetodo
FROM dbo.Pagos p
LEFT JOIN dbo.MetodosPagos mp ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE p.PagTcaIdTransaccion = 11199;

-- ── 5 · El ciclo del PC-4182 (nacio de un cierre) ────────────────────────
SELECT Panel = '5 - EL CICLO', c.CicIdCiclo, c.CueIdCuenta, c.CicEstado,
       c.CicFechaInicio, c.CicSaldoFacturar,
       MonedaDelCiclo = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END
FROM dbo.CiclosCredito c
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta
WHERE c.CicIdCiclo = (SELECT CicIdCiclo FROM dbo.DocumentosContables
                      WHERE CliIdCliente = @Cli AND RTRIM(DocSerie) = 'PC' AND RTRIM(DocNumero) = '4182');
