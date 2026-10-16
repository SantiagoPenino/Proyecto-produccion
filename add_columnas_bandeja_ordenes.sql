-- [BANDEJA] Columnas de la bandeja genérica (embBoardController) en Ordenes.
-- En la base LOCAL faltaban OperarioAsignadoID y CantidadControlada y el endpoint
-- /api/twc/orders (Bandeja de Corte) tiraba 500 → bandeja siempre vacía.
-- Ya aplicado en local el 6-ago-2026. Correr en PROD solo si allá también faltan
-- (verificar primero con el SELECT de abajo).
--
-- SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME IN ('OperarioAsignadoID','CantidadControlada');

IF COL_LENGTH('dbo.Ordenes', 'OperarioAsignadoID') IS NULL
    ALTER TABLE dbo.Ordenes ADD OperarioAsignadoID INT NULL;

IF COL_LENGTH('dbo.Ordenes', 'CantidadControlada') IS NULL
    ALTER TABLE dbo.Ordenes ADD CantidadControlada FLOAT NULL;
