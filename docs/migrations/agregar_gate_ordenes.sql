-- =====================================================================
-- GATE SECUENCIAL: "Comprar y personalizar" (Retiro WMS → Bordado/DTF/TPU → Estampado)
-- =====================================================================
-- Contexto: cuando se compra una prenda y se personaliza (Bordado/DTF/TPU/
-- Estampado), la prenda ahora es una fila real de Ordenes (mecanismo
-- TipoStock='PRODUCTO_TERMINADO', ya existente) en vez de pasar por WMS/
-- PedidosCobranza. Bordado/DTF/TPU no pueden trabajarse hasta que el
-- almacenero confirme el retiro físico del depósito WMS, y Estampado no
-- puede trabajarse hasta que su DTF o TPU correspondiente termine.
--
-- Ordenes.EstadoDependencia YA EXISTE en el schema (columna reservada,
-- nunca escrita hasta ahora) — se usa como el flag del gate:
--   NULL / 'OK'              → sin gate, comportamiento de siempre
--   'ESPERANDO_RETIRO_WMS'   → prenda comprada + Bordado/DTF/TPU, esperando
--                              que el almacenero confirme el retiro WMS
--   'ESPERANDO_IMPRESION'    → Estampado, esperando a que termine su DTF/TPU
--
-- Solo falta esta columna nueva, para encadenar Estampado a la Orden de la
-- que depende:

ALTER TABLE dbo.Ordenes ADD LiberaCuandoOrdenID INT NULL;

-- La prenda comprada por WMS guarda acá su wms_variante_id (id de variante en el WMS
-- externo, distinto de ProIdProducto/CodArticulo locales) — hace falta para poder
-- descontar el stock correcto cuando el almacenero confirma el retiro.
ALTER TABLE dbo.Ordenes ADD WmsVarianteId INT NULL;

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME IN ('EstadoDependencia', 'LiberaCuandoOrdenID', 'FechaHabilitacion', 'WmsVarianteId');
