-- Sector del stock de cada área (29/09/2026). El botón de insumos de cada área pide con el sector
-- que tiene acá, igual que "Pedir insumos" de Mi Sector: el pedido llega a Órdenes solicitadas y se
-- despacha con remito. Antes ese botón guardaba en dbo.Solicitudes, una tabla que no existía.
--
-- Las áreas sin sector (Bordado, Estampado, Corte Láser, Taller Costura…) quedan sin asignar; si
-- después tienen, lo asigna un admin desde el botón de insumos del área.
-- Se puede correr más de una vez: no pisa lo que ya esté asignado.

USE SecureAppDB;
GO

IF COL_LENGTH('dbo.Areas', 'WmsDepId') IS NULL
    ALTER TABLE dbo.Areas ADD WmsDepId INT NULL;
GO

-- Asignación confirmada por Santiago el 29/09. Por nombre del sector, así no depende de los ids.
UPDATE a SET a.WmsDepId = d.DepId
FROM dbo.Areas a
JOIN (VALUES
    ('DF',              N'DTF'),
    ('ECOUV',           N'ECOUV'),
    ('TERMINAC',        N'ECOUV'),
    ('TPU',             N'TPU'),
    ('DIRECTA',         N'Impresión Directa'),
    ('DIRECTA-ALGODON', N'Impresión Directa'),
    ('Recepcion',       N'Ventas'),
    ('SB',              N'Impritex')
) m (AreaID, Sector) ON m.AreaID = a.AreaID
JOIN dbo.Wms_Depositos d ON d.Nombre = m.Sector
WHERE a.WmsDepId IS NULL;

-- Resultado: primero las áreas con sector. Si alguna de las 8 quedó sin sector, el nombre del
-- depósito no coincide: pasame el resultado.
SELECT a.AreaID, a.Nombre AS Area, a.WmsDepId, d.Nombre AS Sector
FROM dbo.Areas a
LEFT JOIN dbo.Wms_Depositos d ON d.DepId = a.WmsDepId
ORDER BY CASE WHEN a.WmsDepId IS NULL THEN 1 ELSE 0 END, a.AreaID;
