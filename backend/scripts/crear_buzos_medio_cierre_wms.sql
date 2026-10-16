-- ============================================================================
-- BUZOS MEDIO CIERRE: crear la tarjeta en el catálogo y vincularla al WMS.
--
-- En el catálogo local no existe ningún artículo para el maestro del WMS
-- "Buzos Medio Cierre" (190), así que la pantalla de venta no puede mostrarlo.
-- Este script crea el artículo (mismo formato que el importador WMS del
-- sistema y que sus hermanos Shorts/Gorros), le carga el precio base y
-- vincula las 12 variantes (Negro y Azul, talles S a 3XL).
--
--   ⚠⚠  EDITAR ANTES DE CORRER: poné el precio de venta acá abajo.  ⚠⚠
--
-- Idempotente: se puede correr más de una vez (re-correr actualiza el precio).
-- ============================================================================

SET NOCOUNT ON;

DECLARE @Precio DECIMAL(18, 2) = NULL;   -- ⚠ PRECIO DE VENTA EN PESOS (ej: 590.00)

IF @Precio IS NULL OR @Precio <= 0
BEGIN
    RAISERROR('Falta el precio: editá @Precio al inicio del script y volvé a correrlo. No se creó nada.', 16, 1);
    RETURN;
END

-- 1) El artículo (si no existe). Calco del importador WMS del sistema
--    (productsIntegrationController.importWmsMaster) + CodStock/moneda de los
--    hermanos Shorts/Gorros: SupFlia 2, Grupo 2.1, en pesos.
DECLARE @Id INT = (SELECT TOP 1 ProIdProducto FROM Articulos
                   WHERE LTRIM(RTRIM(Descripcion)) = 'Buzos Medio Cierre' AND ISNULL(borrar, 0) = 0);
IF @Id IS NULL
BEGIN
    INSERT INTO Articulos (CodArticulo, Descripcion, CodStock, Grupo, SupFlia, Mostrar, MonIdMoneda, borrar)
    VALUES ('WMS-190', 'Buzos Medio Cierre', '2.2.1.2', '2.1', '2', 1, 1, 0);
    SET @Id = SCOPE_IDENTITY();
END

-- 2) Precio base (convención del fix de PreciosBase: UYU = MonIdMoneda 1)
IF EXISTS (SELECT 1 FROM PreciosBase WHERE ProIdProducto = @Id)
    UPDATE PreciosBase SET Precio = @Precio, Moneda = 'UYU', MonIdMoneda = 1, UltimaActualizacion = GETDATE()
    WHERE ProIdProducto = @Id;
ELSE
    INSERT INTO PreciosBase (CodArticulo, Precio, Moneda, MonIdMoneda, UltimaActualizacion, ProIdProducto)
    VALUES ('WMS-190', @Precio, 'UYU', 1, GETDATE(), @Id);

-- 3) Vínculo con el maestro del WMS
IF NOT EXISTS (SELECT 1 FROM Articulos_Wms WHERE Idproid = @Id)
    INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
    VALUES (@Id, 190, 'Buzos Medio Cierre', GETDATE());
ELSE
    UPDATE Articulos_Wms SET producto_maestro_id = 190, nombre_wms = 'Buzos Medio Cierre', fecha_sync = GETDATE()
    WHERE Idproid = @Id;

-- 4) Las 12 variantes (verificadas contra el WMS 12-ago-2026)
DECLARE @vars TABLE (VarianteId INT, Nombre VARCHAR(100));
INSERT INTO @vars VALUES
(483, 'Buzo Medio Cierre Negro Talle S'),  (484, 'Buzo Medio Cierre Negro Talle M'),
(485, 'Buzo Medio Cierre Negro Talle L'),  (486, 'Buzo Medio Cierre Negro Talle XL'),
(487, 'Buzo Medio Cierre Negro Talle 2XL'),(488, 'Buzo Medio Cierre Negro Talle 3XL'),
(489, 'Buzo Medio Cierre Azul Talle S'),   (490, 'Buzo Medio Cierre Azul Talle M'),
(491, 'Buzo Medio Cierre Azul Talle L'),   (492, 'Buzo Medio Cierre Azul Talle XL'),
(493, 'Buzo Medio Cierre Azul Talle 2XL'), (494, 'Buzo Medio Cierre Azul Talle 3XL');

INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
SELECT @Id, x.VarianteId, 'ART-BUZOS-1-BUZ', x.Nombre
FROM @vars x
WHERE NOT EXISTS (SELECT 1 FROM Articulos_WMS_Variantes v WHERE v.wms_variante_id = x.VarianteId);

UPDATE v SET v.Idproid = @Id, v.nombre_variante = x.Nombre
FROM Articulos_WMS_Variantes v
JOIN @vars x ON x.VarianteId = v.wms_variante_id
WHERE v.Idproid <> @Id;

-- 5) Verificación
SELECT LTRIM(RTRIM(a.Descripcion)) AS Tarjeta, pb.Precio, LTRIM(RTRIM(pb.Moneda)) AS Moneda,
       COUNT(v.wms_variante_id) AS Variantes
FROM Articulos a
LEFT JOIN PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
LEFT JOIN Articulos_WMS_Variantes v ON v.Idproid = a.ProIdProducto
WHERE a.ProIdProducto = @Id
GROUP BY LTRIM(RTRIM(a.Descripcion)), pb.Precio, pb.Moneda;
