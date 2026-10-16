-- DIAGNOSTICO pre-factura multimoneda de UN cliente (SOLO LECTURA) - 4/9/2026
-- Abrir en SSMS con File -> Open (no copiar/pegar del chat), cambiar @Nombre si hace falta,
-- ejecutar contra SecureAppDB y pegar los TRES resultados.
DECLARE @Nombre NVARCHAR(100) = 'GLIDE SAS';

DECLARE @Cli INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE LTRIM(RTRIM(Nombre)) = @Nombre);
SELECT @Cli AS CliIdCliente, @Nombre AS Cliente, (SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC) AS CotDolarHoy;

-- 1) Movimientos ORDEN pendientes: cuenta/moneda, ciclo, traslado ([MULTIMONEDA]) y marca
SELECT m.MovIdMovimiento, m.MovConcepto, m.MovImporte, m.CueIdCuenta,
       CASE WHEN cc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS MonedaCuenta,
       m.CicIdCiclo, m.OrdIdOrden, LEFT(m.MovObservaciones, 60) AS Obs
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY cc.MonIdMoneda, m.MovIdMovimiento;

-- 2) Pedido congelado de cada orden pendiente: total, moneda, y si tiene lineas en OTRA moneda
--    o si el total ya no coincide con el movimiento (contaminacion)
SELECT o.CodigoOrden, pc.ID AS PedidoCobranzaID, pc.MontoTotal, pc.Moneda,
       (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK) WHERE d.PedidoCobranzaID = pc.ID) AS Lineas,
       (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK) WHERE d.PedidoCobranzaID = pc.ID AND d.Moneda <> pc.Moneda) AS LineasOtraMoneda,
       ABS(m.MovImporte) AS MovImporte,
       CASE WHEN cc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS MonedaMov
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.PedidosCobranza pc WITH(NOLOCK) ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
WHERE cc.CliIdCliente = @Cli
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND (pc.ID IS NULL
       OR pc.Moneda <> CASE WHEN cc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END
       OR EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK) WHERE d.PedidoCobranzaID = pc.ID AND d.Moneda <> pc.Moneda)
       OR ABS(ABS(m.MovImporte) - pc.MontoTotal) > 0.011)
ORDER BY o.CodigoOrden;

-- 3) Lineas de los pedidos con moneda mezclada o contaminados (detalle para el ajuste)
SELECT o.CodigoOrden, d.ID AS DetalleID, d.PedidoCobranzaID, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.Moneda, d.MonedaOriginal, d.PrecioUnitarioOriginal
FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
JOIN dbo.PedidosCobranza pc WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
JOIN dbo.Ordenes o WITH(NOLOCK) ON LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) = LTRIM(RTRIM(pc.NoDocERP)) AND o.CliIdCliente = @Cli
WHERE (d.Moneda <> pc.Moneda OR pc.Moneda = 'UYU' OR d.Moneda = 'UYU')
  AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WITH(NOLOCK) WHERE m.OrdIdOrden = o.OrdenID AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.DocIdDocumento IS NULL AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))
ORDER BY o.CodigoOrden, d.ID;
