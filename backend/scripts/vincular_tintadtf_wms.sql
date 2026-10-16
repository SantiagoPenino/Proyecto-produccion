-- ============================================================================
-- VINCULAR las tarjetas locales de tinta DTF con el WMS (almacén de ventas)
-- para que la pantalla de venta muestre su stock del depósito Ventas.
--
-- El sync automático empareja POR NOMBRE y estas tarjetas se llaman distinto
-- ("Tinta Blanca 1L" vs "TINTA DTF - BLANCO"), así que el vínculo va a mano:
--   Articulos_Wms           artículo local -> producto maestro del WMS
--   Articulos_WMS_Variantes variante del WMS -> artículo local (de acá sale el stock)
--
-- Mapeo (verificado contra el WMS el 12-ago-2026, maestro TINTA DTF = 49):
--   Tinta Blanca 1L   -> variante 85  "TINTA DTF - BLANCO"
--   Tinta de Color 1L -> variantes 150 CIAN, 182 MAGENTA, 97 YELLOW, 79 BLACK
--                        (el color se elige como variante de la tarjeta; todas
--                         cobran el precio base del artículo)
--
-- Idempotente: se puede correr más de una vez. Los IDs locales se resuelven por
-- descripción, así el mismo script vale para local y producción.
-- ============================================================================

SET NOCOUNT ON;

DECLARE @map TABLE (
    DescripcionLocal NVARCHAR(200),
    MasterId         INT,
    NombreWms        VARCHAR(200),
    VarianteId       INT,
    Sku              VARCHAR(100),
    NombreVariante   VARCHAR(200)
);

INSERT INTO @map VALUES
('Tinta Blanca 1L',   49, 'TINTA DTF',  85, 'TIN-TINTA-8-VAR-TINT-BLAN-16', 'TINTA DTF - BLANCO'),
('Tinta de Color 1L', 49, 'TINTA DTF', 150, 'TIN-TINTA-8-VAR-TINT-CIAN-17', 'TINTA DTF - CIAN'),
('Tinta de Color 1L', 49, 'TINTA DTF', 182, 'TIN-TINTA-8-VAR-TINT-MAGE-18', 'TINTA DTF - MAGENTA'),
('Tinta de Color 1L', 49, 'TINTA DTF',  97, 'TIN-TINTA-8-VAR-TINT-YELL-19', 'TINTA DTF - YELLOW'),
('Tinta de Color 1L', 49, 'TINTA DTF',  79, 'TIN-TINTA-8-VAR-TINT-BLAC-20', 'TINTA DTF - BLACK');

-- 1) Vínculo del maestro (artículo local -> producto maestro WMS)
INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
SELECT DISTINCT a.ProIdProducto, m.MasterId, m.NombreWms, GETDATE()
FROM @map m
JOIN Articulos a ON LTRIM(RTRIM(a.Descripcion)) = m.DescripcionLocal AND ISNULL(a.borrar, 0) = 0
WHERE NOT EXISTS (SELECT 1 FROM Articulos_Wms aw WHERE aw.Idproid = a.ProIdProducto);

UPDATE aw SET aw.producto_maestro_id = m.MasterId, aw.nombre_wms = m.NombreWms, aw.fecha_sync = GETDATE()
FROM Articulos_Wms aw
JOIN Articulos a ON a.ProIdProducto = aw.Idproid
JOIN (SELECT DISTINCT DescripcionLocal, MasterId, NombreWms FROM @map) m
  ON LTRIM(RTRIM(a.Descripcion)) = m.DescripcionLocal;

-- 2) Vínculo de las variantes (de acá cuelga el stock del depósito Ventas)
INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
SELECT a.ProIdProducto, m.VarianteId, m.Sku, m.NombreVariante
FROM @map m
JOIN Articulos a ON LTRIM(RTRIM(a.Descripcion)) = m.DescripcionLocal AND ISNULL(a.borrar, 0) = 0
WHERE NOT EXISTS (SELECT 1 FROM Articulos_WMS_Variantes v WHERE v.wms_variante_id = m.VarianteId);

-- Si la variante ya existía apuntando a otro artículo, la corrige hacia este.
UPDATE v SET v.Idproid = a.ProIdProducto, v.sku = m.Sku, v.nombre_variante = m.NombreVariante
FROM Articulos_WMS_Variantes v
JOIN @map m ON m.VarianteId = v.wms_variante_id
JOIN Articulos a ON LTRIM(RTRIM(a.Descripcion)) = m.DescripcionLocal AND ISNULL(a.borrar, 0) = 0;

-- 3) Verificación: cómo quedaron los vínculos
SELECT LTRIM(RTRIM(a.Descripcion)) AS ArticuloLocal,
       aw.producto_maestro_id      AS MasterWms,
       v.wms_variante_id           AS VarianteWms,
       v.nombre_variante           AS NombreVariante
FROM Articulos a
LEFT JOIN Articulos_Wms aw ON aw.Idproid = a.ProIdProducto
LEFT JOIN Articulos_WMS_Variantes v ON v.Idproid = a.ProIdProducto
WHERE LTRIM(RTRIM(a.Descripcion)) IN ('Tinta Blanca 1L', 'Tinta de Color 1L')
ORDER BY ArticuloLocal, VarianteWms;
