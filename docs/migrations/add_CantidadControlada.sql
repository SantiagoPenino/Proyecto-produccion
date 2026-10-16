-- =====================================================================
-- Ordenes.CantidadControlada
-- =====================================================================
-- Contexto: la Bandeja genérica (EMB/EST/TWC/TWT, embBoardController.js)
-- fase "control" (Control y Calidad) usa un contador PROPIO de unidades
-- controladas (CantidadControlada), aparte del contador de trabajo
-- (CantidadTerminada) — pero la columna nunca se creó. Sin ella,
-- getEmbOrders(fase=control) tira "Invalid column name 'CantidadControlada'"
-- y la Bandeja de Control y Calidad queda vacía sin ningún aviso visible.

ALTER TABLE dbo.Ordenes ADD CantidadControlada FLOAT NULL;

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'CantidadControlada';
