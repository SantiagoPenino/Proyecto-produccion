-- =====================================================================
-- Ordenes.OperarioAsignadoID
-- =====================================================================
-- Contexto: la Bandeja genérica (EMB/EST/TWC/TWT, embBoardController.js)
-- lee y escribe Ordenes.OperarioAsignadoID (asignar operario a una orden,
-- mostrar OperarioNombre en la tarjeta) pero la columna nunca se creó en
-- la base — hoy tira "Invalid column name 'OperarioAsignadoID'" y ROMPE
-- getEmbOrders entero (la Bandeja queda vacía en las 4 áreas, sin ningún
-- aviso visible: el error se traga en el catch del frontend).

ALTER TABLE dbo.Ordenes ADD OperarioAsignadoID INT NULL;

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'OperarioAsignadoID';
