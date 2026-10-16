-- DIAGNOSTICO pre-factura Rolymajenski (SOLO LECTURA) - 3/9/2026
-- Abrir en SSMS con File -> Open (no copiar/pegar del chat) y ejecutar contra SecureAppDB.
-- Pegame los DOS resultados y te digo exactamente que precio poner en cada linea.

-- 1) Movimientos ORDEN pendientes del cliente: en que CUENTA (moneda) vive cada uno
--    y si ya fue trasladado ([MULTIMONEDA] en Obs).
SELECT m.MovIdMovimiento,
       m.MovConcepto,
       m.MovImporte,
       cc.CueIdCuenta,
       CASE WHEN cc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS MonedaCuenta,
       m.CicIdCiclo,
       LEFT(m.MovObservaciones, 100) AS Obs
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE c.Nombre LIKE '%Rolymajen%'
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')
ORDER BY m.MovIdMovimiento;

-- 2) Lo congelado en PedidosCobranza para las ordenes que eran EN PESOS
--    (MontoTotal actual tras tus ediciones + la Moneda que quedo grabada).
SELECT o.CodigoOrden, pc.ID AS PedidoCobranzaID, pc.MontoTotal, pc.Moneda
FROM dbo.PedidosCobranza pc WITH(NOLOCK)
JOIN dbo.Ordenes o WITH(NOLOCK)
  ON LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) = LTRIM(RTRIM(pc.NoDocERP))
WHERE o.CodigoOrden IN ('SUB-11590','SUB-15391','SUB-16489','SUB-17079');
