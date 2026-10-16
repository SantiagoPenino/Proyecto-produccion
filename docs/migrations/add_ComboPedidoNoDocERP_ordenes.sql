-- =====================================================================
-- Ordenes.ComboPedidoNoDocERP
-- =====================================================================
-- Contexto: el retiro de stock de un combo (Fabricar a Medida) ahora vive en
-- su propia venta VEN- (PedidosCobranza), separada del pedido real que factura
-- el combo (Ordenes.NoDocERP, ej. "12298") — ver Ordenes.ComboItemID
-- (add_ComboItemID_ordenes.sql) y docs/ecommerce-portal-plan.md /
-- FASE 3 del plan de servicios de combo por componente.
--
-- Esta columna vive SOLO en la orden ancla (EstadoDependencia='VENTA_DIRECTA')
-- de esa VEN- nueva, y guarda el NoDocERP del pedido REAL (12298) — es lo que
-- permite, al confirmar la preparación de la VEN- (logisticaWmsController.
-- confirmPreparation), encontrar y liberar las hermanas de decoración
-- (Bordado/DTF de ESE mismo componente, vía ComboItemID) en el pedido real.
-- NULL = comportamiento de siempre (cualquier venta normal de la Tienda/WMS,
-- que no tiene ningún pedido "real" aparte que liberar).

ALTER TABLE dbo.Ordenes ADD ComboPedidoNoDocERP NVARCHAR(50) NULL;

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'ComboPedidoNoDocERP';
