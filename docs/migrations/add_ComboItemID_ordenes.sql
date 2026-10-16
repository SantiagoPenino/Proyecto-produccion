-- =====================================================================
-- Ordenes.ComboItemID
-- =====================================================================
-- Contexto: combos con servicio de decoración distinto por componente
-- (ej. "Gorro y short": el Gorro borda, el Short estampa — Fabricar a
-- Medida). Cada componente genera su propia orden de retiro WMS (con su
-- wms_variante_id real) y sus propios servicios (EMB/DF/EST) — todas
-- ligadas al mismo ProductoComboItems.ID para que:
--   1. El ruteo (ProximoServicio) no cruce el Bordado del Gorro con el
--      DTF del Short cuando conviven en el mismo pedido.
--   2. Confirmar el retiro de UN componente no libere al otro (que
--      todavía no se retiró) — confirmarRetiroWms escopa las "hermanas"
--      a liberar por este campo.
--   3. erpSyncService reconozca cuál orden PRO es la de PRECIO del combo
--      (ComboItemID NULL) y cuáles son las de retiro sin cobro propio
--      (ComboItemID seteado) al consolidar personalizaciones.
-- NULL = comportamiento de siempre (producto simple, o "Comprar y
-- Personalizar") — columna aditiva, no rompe nada existente.

ALTER TABLE dbo.Ordenes ADD ComboItemID INT NULL;

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'ComboItemID';
