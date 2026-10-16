-- Movimientos del PC-3576 en la cuenta, con su respaldo de caja
SELECT m.MovIdMovimiento, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Fecha = m.MovFecha, m.PagIdPago, m.CueIdCuenta,
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), '(sin recibo de caja)'),
       CobradoPorElRecibo = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaEstado, t.TcaMonedaBase,
       TipoDePago = ISNULL(p.PagTipoMovimiento, '(sin fila en Pagos)'),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 55),
       Observaciones = LEFT(ISNULL(m.MovObservaciones,''), 70)
FROM dbo.MovimientosCuenta m
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE m.DocIdDocumento = (SELECT DocIdDocumento FROM dbo.DocumentosContables
                          WHERE CliIdCliente = 4 AND RTRIM(DocSerie) = 'PC' AND RTRIM(DocNumero) = '3576')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovIdMovimiento;
