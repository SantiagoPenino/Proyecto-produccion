-- ============================================================================
-- VINCULAR los artículos locales "Pet Film..." con el WMS (almacén de ventas)
-- para que la pantalla de venta muestre su stock del depósito Ventas.
--
-- El sync automático empareja POR NOMBRE y estos artículos se llaman distinto
-- ("Pet Film 0,3 X100 m" vs "FILM COMUN 0,3X100 m"), así que el vínculo se
-- carga a mano en las tablas puente:
--   Articulos_Wms           artículo local -> producto maestro del WMS
--   Articulos_WMS_Variantes variante del WMS -> artículo local (de acá sale el stock)
--
-- Mapeo (verificado contra el WMS el 12-ago-2026):
--   Pet Film 0,3 X100 m                                -> FILM COMUN (70), variante 283
--   Pet Film 0,6 X100 m                                -> FILM COMUN (70), variante 177
--   Pet Film Uv (A-Blanco y A-Transparente)0,3 X100 m  -> Film UV Transparente (83), variante 28
--   Pet Film Uv (A-Blanco y A-Transparente)0,6 X100 m  -> Film UV Transparente (83), variante 87
--   Pet Film 1,2 X100 m: SIN variante en el WMS -> queda sin vincular (no hay de dónde sacar stock)
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
('Pet Film 0,3 X100 m',                               70, 'FILM COMUN',           283, 'PET-FILM-4-30C',              'FILM COMUN 0,3X100 m'),
('Pet Film 0,6 X100 m',                               70, 'FILM COMUN',           177, 'PET-FILM-4-VAR-FILM-BASE-68', 'FILM COMUN 0,6x100 m'),
('Pet Film Uv (A-Blanco y A-Transparente)0,3 X100 m', 83, 'Film UV Transparente',  28, 'PET-FILM-17-VAR-FILM-30CM-83','Film Uv Transparente - 30cm'),
('Pet Film Uv (A-Blanco y A-Transparente)0,6 X100 m', 83, 'Film UV Transparente',  87, 'PET-FILM-17-VAR-FILM-60CM-82','Film Uv Transparente - 60cm');

-- 1) Vínculo del maestro (artículo local -> producto maestro WMS)
INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
SELECT a.ProIdProducto, m.MasterId, m.NombreWms, GETDATE()
FROM @map m
JOIN Articulos a ON LTRIM(RTRIM(a.Descripcion)) = m.DescripcionLocal AND ISNULL(a.borrar, 0) = 0
WHERE NOT EXISTS (SELECT 1 FROM Articulos_Wms aw WHERE aw.Idproid = a.ProIdProducto);

UPDATE aw SET aw.producto_maestro_id = m.MasterId, aw.nombre_wms = m.NombreWms, aw.fecha_sync = GETDATE()
FROM Articulos_Wms aw
JOIN Articulos a ON a.ProIdProducto = aw.Idproid
JOIN @map m ON LTRIM(RTRIM(a.Descripcion)) = m.DescripcionLocal;

-- 2) Vínculo de la variante (de acá cuelga el stock del depósito Ventas)
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
       aw.nombre_wms               AS NombreWms,
       v.wms_variante_id           AS VarianteWms,
       v.nombre_variante           AS NombreVariante
FROM Articulos a
LEFT JOIN Articulos_Wms aw ON aw.Idproid = a.ProIdProducto
LEFT JOIN Articulos_WMS_Variantes v ON v.Idproid = a.ProIdProducto
WHERE LTRIM(RTRIM(a.Descripcion)) LIKE 'Pet Film%'
ORDER BY ArticuloLocal;
