-- ============================================================================
-- SHORTS (NIÑO): mover los talles de niño del vínculo WMS a su propia tarjeta.
--
-- El WMS tiene UN solo maestro SHORT (156) con talles de niño (6 a 16) y de
-- adulto (S a 3XL) mezclados, y el sync colgó las 72 variantes de la tarjeta
-- "Shorts (Adulto)". Este script pasa las 36 variantes de talle niño (6, 8,
-- 10, 12, 14 y 16, en 6 colores) a la tarjeta "Shorts (Niño)", que así cobra
-- su propio precio base y muestra su stock del depósito Ventas.
--
-- "Shorts (Adulto)" queda con los 36 talles de adulto (S a 3XL).
-- El botón Sincronizar NO deshace este cambio (solo actualiza sku/nombre).
--
-- Idempotente: se puede correr más de una vez. Los artículos se resuelven por
-- descripción, así el mismo script vale para local y producción.
-- ============================================================================

SET NOCOUNT ON;

DECLARE @Nino INT = (SELECT TOP 1 ProIdProducto FROM Articulos
                     WHERE LTRIM(RTRIM(Descripcion)) = 'Shorts (Niño)' AND ISNULL(borrar, 0) = 0);
IF @Nino IS NULL
BEGIN
    RAISERROR('No se encontró el artículo "Shorts (Niño)" — no se cambió nada.', 16, 1);
    RETURN;
END

-- 1) Vínculo del maestro para la tarjeta Niño (badge WMS + botón Precios)
IF NOT EXISTS (SELECT 1 FROM Articulos_Wms WHERE Idproid = @Nino)
    INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
    VALUES (@Nino, 156, 'SHORT', GETDATE());
ELSE
    UPDATE Articulos_Wms SET producto_maestro_id = 156, nombre_wms = 'SHORT', fecha_sync = GETDATE()
    WHERE Idproid = @Nino;

-- 2) Variantes de talle NIÑO del maestro SHORT (verificadas contra el WMS 12-ago-2026)
DECLARE @ninos TABLE (VarianteId INT, Nombre VARCHAR(100));
INSERT INTO @ninos VALUES
(364, 'Short 6 AZUL FRANCIA'),  (388, 'Short 6 AZUL MARINO'),  (376, 'Short 6 BLANCO'),
(400, 'Short 6 NEGRO'),         (352, 'Short 6 ROJO'),         (340, 'Short 6 VERDE'),
(365, 'Short 8 AZUL FRANCIA'),  (389, 'Short 8 AZUL MARINO'),  (377, 'Short 8 BLANCO'),
(401, 'Short 8 NEGRO'),         (353, 'Short 8 ROJO'),         (341, 'Short 8 VERDE'),
(366, 'Short 10 AZUL FRANCIA'), (390, 'Short 10 AZUL MARINO'), (378, 'Short 10 BLANCO'),
(402, 'Short 10 NEGRO'),        (354, 'Short 10 ROJO'),        (342, 'Short 10 VERDE'),
(367, 'Short 12 AZUL FRANCIA'), (391, 'Short 12 AZUL MARINO'), (379, 'Short 12 BLANCO'),
(403, 'Short 12 NEGRO'),        (355, 'Short 12 ROJO'),        (343, 'Short 12 VERDE'),
(368, 'Short 14 AZUL FRANCIA'), (392, 'Short 14 AZUL MARINO'), (380, 'Short 14 BLANCO'),
(404, 'Short 14 NEGRO'),        (356, 'Short 14 ROJO'),        (344, 'Short 14 VERDE'),
(369, 'Short 16 AZUL FRANCIA'), (393, 'Short 16 AZUL MARINO'), (381, 'Short 16 BLANCO'),
(405, 'Short 16 NEGRO'),        (357, 'Short 16 ROJO'),        (345, 'Short 16 VERDE');

-- 3) Mover esas variantes a la tarjeta Niño (estén donde estén hoy)
UPDATE v SET v.Idproid = @Nino
FROM Articulos_WMS_Variantes v
JOIN @ninos n ON n.VarianteId = v.wms_variante_id
WHERE v.Idproid <> @Nino;

-- Respaldo: si alguna variante de niño aún no estaba vinculada, se crea acá.
INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
SELECT @Nino, n.VarianteId, '', n.Nombre
FROM @ninos n
WHERE NOT EXISTS (SELECT 1 FROM Articulos_WMS_Variantes v WHERE v.wms_variante_id = n.VarianteId);

-- 4) Verificación: 36 variantes en cada tarjeta
SELECT LTRIM(RTRIM(a.Descripcion)) AS Tarjeta, COUNT(v.wms_variante_id) AS Variantes
FROM Articulos a
LEFT JOIN Articulos_WMS_Variantes v ON v.Idproid = a.ProIdProducto
WHERE LTRIM(RTRIM(a.Descripcion)) IN ('Shorts (Adulto)', 'Shorts (Niño)')
GROUP BY LTRIM(RTRIM(a.Descripcion));
