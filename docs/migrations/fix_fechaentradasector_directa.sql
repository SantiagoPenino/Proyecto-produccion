-- =====================================================================
-- BACKFILL FechaEntradaSector PARA ÓRDENES DE IMPRESIÓN DIRECTA
-- =====================================================================
-- Contexto: createWebOrder solo estampa FechaEntradaSector al crear si el
-- área matchea el regex de "áreas de impresión" (webOrdersController.js:780),
-- que no incluía DIRECTA. El código ya se corrigió (se agregó DIRECTA al
-- regex, va con el deploy); este script arregla las órdenes DIR creadas
-- ANTES del deploy, que quedaron con la fecha en NULL.
--
-- Es idempotente: correrlo dos veces no cambia nada.

-- ANTES (revisar cuántas están en NULL)
SELECT OrdenID, CodigoOrden, FechaIngreso, FechaEntradaSector
FROM Ordenes
WHERE AreaID = 'DIRECTA' AND FechaEntradaSector IS NULL;

-- FIX
UPDATE Ordenes
SET FechaEntradaSector = FechaIngreso
WHERE AreaID = 'DIRECTA' AND FechaEntradaSector IS NULL;

-- DESPUÉS (debe devolver 0 filas)
SELECT OrdenID, CodigoOrden, FechaIngreso, FechaEntradaSector
FROM Ordenes
WHERE AreaID = 'DIRECTA' AND FechaEntradaSector IS NULL;
