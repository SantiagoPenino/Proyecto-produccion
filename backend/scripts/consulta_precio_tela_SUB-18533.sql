-- SOLO LECTURA. Precio de la tela de la orden SUB-18533 y cuándo cambió.
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @Codigo NVARCHAR(50) = 'SUB-18533';

-- 1) La orden y su tela/material
SELECT 'ORDEN' AS Bloque, o.OrdenID, o.CodigoOrden, o.AreaID, o.Cliente, o.CliIdCliente, o.CodCliente,
       o.DescripcionTrabajo, o.Estado, RTRIM(o.Material) AS Material, o.Magnitud, o.UM, o.CostoTotal,
       o.CodArticulo, o.ProIdProducto, o.Variante, o.PerfilesPrecio, o.FechaIngreso
FROM dbo.Ordenes o
WHERE o.CodigoOrden = @Codigo;

-- 2) Precio base vigente del artículo y fecha de la última actualización
SELECT 'PRECIO_BASE' AS Bloque, pb.*
FROM dbo.PreciosBase pb
WHERE pb.ProIdProducto IN (SELECT ProIdProducto FROM dbo.Ordenes WHERE CodigoOrden = @Codigo)
   OR RTRIM(pb.CodArticulo) IN (SELECT RTRIM(CodArticulo) FROM dbo.Ordenes WHERE CodigoOrden = @Codigo);

-- 3) Historial formal de precios (suele estar vacío)
SELECT 'HISTORICO' AS Bloque, h.*
FROM dbo.HistoricoPreciosProductos h
WHERE h.ProIdProducto IN (SELECT ProIdProducto FROM dbo.Ordenes WHERE CodigoOrden = @Codigo)
ORDER BY h.HPPFechaAlta DESC;

-- 4) Qué se le cobró efectivamente en esta orden (precio unitario, perfil, traza)
SELECT 'COBRO_ORDEN' AS Bloque, pc.NoDocERP, pc.FechaGeneracion, pc.MontoTotal, pc.Moneda AS MonedaPedido, pc.PerfilesPrecio,
       pcd.CodArticulo, pcd.Cantidad, pcd.PrecioUnitario, pcd.Subtotal, pcd.Moneda, pcd.PerfilAplicado, pcd.LogPrecioAplicado
FROM dbo.PedidosCobranzaDetalle pcd
JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE pcd.OrdenID IN (SELECT OrdenID FROM dbo.Ordenes WHERE CodigoOrden = @Codigo);

-- 5) Reglas de precio especial del cliente para ese artículo (y cuándo se crearon)
SELECT 'EXCEPCION_CLIENTE' AS Bloque, pe.ID, pe.ClienteID, RTRIM(pe.NombreCliente) AS NombreCliente, pe.FechaCreacion, pe.UltimaActualizacion, pe.PerfilesIDs,
       pei.ItemID, pei.CodArticulo, pei.TipoRegla, pei.Valor, pei.MinCantidad, pei.MonIdMoneda
FROM dbo.PreciosEspeciales pe
LEFT JOIN dbo.PreciosEspecialesItems pei ON pei.ClienteID = pe.ClienteID
  AND pei.ProIdProducto IN (SELECT ProIdProducto FROM dbo.Ordenes WHERE CodigoOrden = @Codigo)
WHERE pe.CliIdCliente IN (SELECT CliIdCliente FROM dbo.Ordenes WHERE CodigoOrden = @Codigo);

-- 6) Evolución del precio base del artículo según los cobros reales (cuándo cambió de verdad)
SELECT 'EVOLUCION_BASE' AS Bloque, pcd.PrecioUnitario, pcd.Moneda, COUNT(*) AS Cobros,
       MIN(pc.FechaGeneracion) AS Desde, MAX(pc.FechaGeneracion) AS Hasta
FROM dbo.PedidosCobranzaDetalle pcd
JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE pcd.ProIdProducto IN (SELECT ProIdProducto FROM dbo.Ordenes WHERE CodigoOrden = @Codigo)
  AND pcd.PerfilAplicado = 'Precio Base'
GROUP BY pcd.PrecioUnitario, pcd.Moneda
HAVING COUNT(*) >= 5
ORDER BY Desde;

-- 7) Evolución del precio que pagó ESTE cliente por esa tela
SELECT 'EVOLUCION_CLIENTE' AS Bloque, pcd.PrecioUnitario, pcd.Moneda, pcd.PerfilAplicado, COUNT(*) AS Cobros,
       MIN(pc.FechaGeneracion) AS Desde, MAX(pc.FechaGeneracion) AS Hasta
FROM dbo.PedidosCobranzaDetalle pcd
JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE pcd.ProIdProducto IN (SELECT ProIdProducto FROM dbo.Ordenes WHERE CodigoOrden = @Codigo)
  AND pc.ClienteID IN (SELECT CliIdCliente FROM dbo.Ordenes WHERE CodigoOrden = @Codigo)
GROUP BY pcd.PrecioUnitario, pcd.Moneda, pcd.PerfilAplicado
ORDER BY Desde;
