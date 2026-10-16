-- =====================================================================
-- BORDADO (EMB): VARIANTES Y ARTÍCULOS
-- =====================================================================
-- Cómo lee el form (ver nomenclatorsRoutes.js):
--   · "Tipo / Variante"  → StockArt, unido por ConfigMapeoERP.CodigoERP = StockArt.Grupo
--                          (bordado = grupo '1.4'), filtrando StockArt.Mostrar = 1
--   · Lo que se cotiza   → Articulos, colgados del CodStock de la variante elegida
--
-- Hoy bordado tiene UNA sola variante ('1.1.4.1 Bordado') con los 9 artículos
-- colgados de ella — por eso en el form aparecían los combos de gorros donde
-- va la prenda.
--
-- ---------------------------------------------------------------------
-- LOS DOS EJES DEL BORDADO
-- ---------------------------------------------------------------------
-- El catálogo viejo ya tenía bien modelado el cruce, solo que los nombres
-- confundían. Son dos preguntas independientes:
--
--   DÓNDE va          →  sobre la prenda   |  parche adhesivo (pieza aparte)
--   DE QUÉ está hecho →  con tafeta        |  100% hilo
--                        (aplique de tela,    (todo bordado, muchas
--                         menos puntadas)      más puntadas)
--
--                       | con tafeta | 100% hilo |
--     sobre la prenda   |    107     |    108    |
--     parche adhesivo   |    109     |   1630    |
--
-- El "DÓNDE" es la VARIANTE (cambia el flujo: el parche no consume prendas
-- del cliente). El "DE QUÉ" es el ARTÍCULO dentro de esa variante (cambia el
-- precio, porque la tafeta lleva bastantes menos puntadas).
--
-- El relieve 3D es un TERCER eje que se cruza con los cuatro, así que va como
-- CARGO y no como artículo: si fuera artículo habría que duplicar los 4.
--
-- Queda así:
--   VARIANTES (elegibles en el form)
--     1.1.4.1  Bordado sobre la prenda → art 107 (tafeta) · 108 (100% hilo)
--     1.1.4.2  Parche adhesivo         → art 109 (tafeta) · 1630 (100% hilo)
--   NO ELEGIBLES (Mostrar = 0: existen y se cotizan, pero no salen en el form)
--     1.1.4.9  Cargos de bordado       → 1568 matriz, 1631 relieve 3D, 1632 aplicación
--     1.1.4.10 Combos de bordado       → 147, 148, 163

SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

-- ---------------------------------------------------------------------
-- 1. VARIANTES (StockArt, grupo 1.4)
-- ---------------------------------------------------------------------

-- 1.1.4.1 ya existe: se le aclara el nombre ("Bordado" a secas era ambiguo).
UPDATE StockArt
SET Articulo  = 'Bordado sobre la prenda',
    TipoStock = 'MATERIAL'
WHERE LTRIM(RTRIM(CodStock)) = '1.1.4.1';

-- El parche es variante aparte porque cambia el FLUJO, no solo el precio:
-- no se borda sobre prendas del cliente, se fabrica la pieza de cero.
IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.4.2')
    INSERT INTO StockArt (CodStock, SupFlia, Grupo, Ref, Articulo, UM, Mostrar, TipoStock)
    VALUES ('1.1.4.2', '1', '1.4', '2', 'Parche adhesivo', 'PUNT', 1, 'MATERIAL');

-- Bolsas NO elegibles (Mostrar = 0): sus artículos se siguen pudiendo cotizar
-- a mano, pero no aparecen como variante en el form del cliente.
IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.4.9')
    INSERT INTO StockArt (CodStock, SupFlia, Grupo, Ref, Articulo, UM, Mostrar, TipoStock)
    VALUES ('1.1.4.9', '1', '1.4', '9', 'Cargos de bordado', 'U', 0, 'TERMINACION');

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.4.10')
    INSERT INTO StockArt (CodStock, SupFlia, Grupo, Ref, Articulo, UM, Mostrar, TipoStock)
    VALUES ('1.1.4.10', '1', '1.4', '10', 'Combos de bordado', 'U', 0, 'PRODUCTO_TERMINADO');
GO

-- ---------------------------------------------------------------------
-- 2. LOS 4 ARTÍCULOS DEL CRUCE: solo se aclaran los nombres y se reubican
-- ---------------------------------------------------------------------
-- Los nombres viejos decían "Parche bordado sobre prenda con tafeta", que se
-- lee como si fuera parche Y sobre prenda a la vez. Se separan los dos ejes.

UPDATE Articulos
SET Descripcion = 'Bordado sobre prenda con tafeta', CodStock = '1.1.4.1', Grupo = '1.4', Mostrar = 1
WHERE LTRIM(RTRIM(CodArticulo)) = '107';

UPDATE Articulos
SET Descripcion = 'Bordado sobre prenda 100% hilo', CodStock = '1.1.4.1', Grupo = '1.4', Mostrar = 1
WHERE LTRIM(RTRIM(CodArticulo)) = '108';

UPDATE Articulos
SET Descripcion = 'Parche adhesivo con tafeta', CodStock = '1.1.4.2', Grupo = '1.4', Mostrar = 1
WHERE LTRIM(RTRIM(CodArticulo)) = '109';

UPDATE Articulos
SET Descripcion = 'Parche adhesivo 100% hilo', CodStock = '1.1.4.2', Grupo = '1.4', Mostrar = 1
WHERE LTRIM(RTRIM(CodArticulo)) = '1630';
GO

-- ---------------------------------------------------------------------
-- 3. CARGOS Y RESTO
-- ---------------------------------------------------------------------

-- Matriz: cargo por diseño nuevo, igual que el art. 156 en TPU. Pasa a la
-- bolsa de cargos para que deje de aparecer como si fuera un tipo de bordado.
UPDATE Articulos
SET Descripcion = 'Matriz de bordado', CodStock = '1.1.4.9', Grupo = '1.4', Mostrar = 1
WHERE LTRIM(RTRIM(CodArticulo)) = '1568';

-- 1567 'Bordado' genérico: queda tapado por los 4 del cruce, que dicen lo
-- mismo pero con precio propio. Se saca del form (Mostrar = 0) y NO se borra,
-- para no romper documentos viejos que lo referencien.
-- >>> Si preferís conservarlo como opción genérica, comentá este UPDATE. <<<
UPDATE Articulos
SET CodStock = '1.1.4.9', Grupo = '1.4', Mostrar = 0
WHERE LTRIM(RTRIM(CodArticulo)) = '1567';

-- Combos (6/12 gorros con bordado incluido, sublimación+bordado): NO son un
-- bordado sobre prendas del cliente, son venta de mercadería. Se mueven fuera
-- de las variantes elegibles pero quedan visibles y vendibles a mano.
UPDATE Articulos
SET CodStock = '1.1.4.10', Grupo = '1.4', Mostrar = 1
WHERE LTRIM(RTRIM(CodArticulo)) IN ('147', '148', '163');
GO

-- ---------------------------------------------------------------------
-- 4. ARTÍCULOS NUEVOS (cargos)
-- ---------------------------------------------------------------------
-- ProIdProducto es IDENTITY → no se setea. IDProdReact se calcula sobre el
-- máximo actual para no pisar ninguno. Moneda y unidad se copian del 107 para
-- quedar consistentes con el resto del grupo.
DECLARE @NextReact INT = (SELECT ISNULL(MAX(IDProdReact), 0) FROM Articulos);
DECLARE @Mon INT = (SELECT TOP 1 MonIdMoneda FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) = '107');
DECLARE @Uni INT = (SELECT TOP 1 UniIdUnidad FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) = '107');

-- Relieve 3D (goma espuma). Tercer eje: se cruza con los 4 artículos, por eso
-- es cargo. Como artículo obligaría a tener 8.
IF NOT EXISTS (SELECT 1 FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) = '1631')
BEGIN
    SET @NextReact = @NextReact + 1;
    INSERT INTO Articulos (CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, Descripcion,
                           Mostrar, MonIdMoneda, UniIdUnidad, borrar)
    VALUES ('1631', @NextReact, '1', '1.4', '1.1.4.9', 'Recargo bordado 3D en relieve',
            1, @Mon, @Uni, 0);
END

-- Aplicación del parche sobre la prenda. QUEDA DEFINIDO PERO APAGADO por
-- decisión del negocio: no se ofrece ni se cotiza todavía. Para prenderlo
-- alcanza con poner Mostrar = 1 y mostrar el tilde en el form.
IF NOT EXISTS (SELECT 1 FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) = '1632')
BEGIN
    SET @NextReact = @NextReact + 1;
    INSERT INTO Articulos (CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, Descripcion,
                           Mostrar, MonIdMoneda, UniIdUnidad, borrar)
    VALUES ('1632', @NextReact, '1', '1.4', '1.1.4.9', 'Aplicación de parche',
            0, @Mon, @Uni, 0);
END
GO

COMMIT TRANSACTION;
GO

-- ---------------------------------------------------------------------
-- 5. UNIDAD DE MEDIDA: unidades, no puntadas
-- ---------------------------------------------------------------------
-- La UM de bordado estaba en 'PUNT'. Eso hace que TODO el sistema crea que la
-- Magnitud de la orden son puntadas, y la ficha del área mostraba cosas como
-- "1.00 punt" donde tenía que decir la cantidad de prendas.
--
-- La magnitud de un bordado son las PRENDAS. Las puntadas no son la cantidad:
-- son el dato técnico que mueve el precio unitario (ver pricingService, regla
-- de puntadas) y viajan aparte, en ArchivosOrden.PuntadasEstimadas y en
-- PedidosCobranzaDetalle.DatoTecnico.
UPDATE StockArt
SET UM = 'U'
WHERE LTRIM(RTRIM(Grupo)) = '1.4' AND LTRIM(RTRIM(UM)) = 'PUNT';
GO

-- Las órdenes de bordado ya creadas quedaron con UM 'punt' copiada del artículo.
UPDATE Ordenes
SET UM = 'u'
WHERE AreaID = 'EMB' AND LTRIM(RTRIM(UM)) = 'punt';
GO

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
SELECT LTRIM(RTRIM(CodStock)) AS CodStock, LTRIM(RTRIM(Articulo)) AS Variante,
       LTRIM(RTRIM(UM)) AS UM, Mostrar, TipoStock
FROM StockArt WHERE LTRIM(RTRIM(Grupo)) = '1.4'
ORDER BY CodStock;

SELECT LTRIM(RTRIM(a.CodArticulo)) AS CodArt,
       LTRIM(RTRIM(a.CodStock))    AS CodStock,
       LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       a.Mostrar,
       CASE WHEN ISNULL(s.Mostrar, 0) = 1 AND a.Mostrar = 1 THEN 'SI' ELSE 'no' END AS SaleEnElForm
FROM Articulos a
LEFT JOIN StockArt s ON LTRIM(RTRIM(s.CodStock)) = LTRIM(RTRIM(a.CodStock))
WHERE LTRIM(RTRIM(a.Grupo)) = '1.4'
ORDER BY a.CodStock, a.CodArticulo;
GO

-- ---------------------------------------------------------------------
-- PENDIENTE APARTE (no es SQL): pricingService.js:180 tiene HARDCODEADO el
-- artículo '109' como "bordado por puntadas". Con este esquema el 109 es un
-- parche adhesivo válido, pero la regla no debería depender de UN código: los
-- cuatro (107/108/109/1630) se cobran por puntadas. Conviene que salga por
-- área (EMB) y no por artículo.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ROLLBACK MANUAL (por si hay que volver atrás):
--   UPDATE Articulos SET CodStock = '1.1.4.1', Mostrar = 1
--     WHERE LTRIM(RTRIM(CodArticulo)) IN ('107','108','109','1630','147','148','1567','1568');
--   UPDATE StockArt SET Articulo = 'Bordado' WHERE LTRIM(RTRIM(CodStock)) = '1.1.4.1';
--   DELETE FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) IN ('1631','1632');
--   DELETE FROM StockArt  WHERE LTRIM(RTRIM(CodStock)) IN ('1.1.4.2','1.1.4.9','1.1.4.10');
-- ---------------------------------------------------------------------
