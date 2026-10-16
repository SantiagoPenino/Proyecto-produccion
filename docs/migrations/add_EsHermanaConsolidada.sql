-- =====================================================================
-- PedidosCobranzaDetalle.EsHermanaConsolidada
-- =====================================================================
-- Contexto: cuando un pedido tiene una orden madre PRO, sus hermanas
-- (EMB/DF/TPU/EST/TWC/TWT/SB) se facturan CONSOLIDADAS en la línea de PRO
-- para no duplicar el total. Antes, erpSyncService.js borraba esas líneas
-- hermanas del detalle guardado; ahora las MARCA con EsHermanaConsolidada=1
-- en vez de borrarlas (se ven en "Cotizar Productos" como desglose de
-- solo lectura, pero no suman al "Nuevo Total" ni se refacturan).
--
-- Falta esta columna en PedidosCobranzaDetalle — sin ella, quotationController.js
-- y erpSyncService.js tiran "Invalid column name 'EsHermanaConsolidada'".

ALTER TABLE dbo.PedidosCobranzaDetalle ADD EsHermanaConsolidada BIT NULL;

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PedidosCobranzaDetalle' AND COLUMN_NAME = 'EsHermanaConsolidada';
