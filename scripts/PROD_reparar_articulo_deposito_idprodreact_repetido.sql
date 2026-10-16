-- ============================================================================
-- PROD_reparar_articulo_deposito_idprodreact_repetido.sql  (v2)
-- ----------------------------------------------------------------------------
-- Problema: IDProdReact estaba repetido en Articulos:
--   121 -> 349 Cuadro canvas 25 x 25  y  567 mykonos new
--   213 -> 429 Colocacion de ojales   y  564 Adis Deportivo new
--    32 -> 226 Dry Exclusive (1,83)   y  565 special rib
-- Al ingresar a depósito por QR se tomaba el primero (TOP 1 sin ORDER BY), así que
-- 18 órdenes SUB quedaron en OrdenesDeposito con el artículo equivocado.
--
-- v2: el IDProdReact ya se corrigió en prod, así que no se puede detectar por
-- "mismo IDProdReact". Se usan los 3 pares fijos (depósito -> producción).
--
-- Qué hace: pone en OrdenesDeposito.ProIdProducto el artículo que la orden tiene
-- en producción (Ordenes.ProIdProducto). No toca importes ni moneda.
--
-- Uso: correr completo. Termina en ROLLBACK; si el ANTES/DESPUÉS está bien,
-- cambiar ROLLBACK por COMMIT y volver a correr.
-- ============================================================================
SET NOCOUNT ON;
BEGIN TRAN;

DECLARE @Pares TABLE (MalEnDeposito INT, Real INT);
INSERT INTO @Pares VALUES (349, 567), (429, 564), (226, 565);

-- ANTES (esperado: 18 filas)
SELECT od.OrdIdOrden, od.OrdCodigoOrden,
       od.ProIdProducto AS EnDeposito, RTRIM(ad.Descripcion) AS DescDeposito,
       o.ProIdProducto  AS EnProduccion, RTRIM(ap.Descripcion) AS DescReal
FROM OrdenesDeposito od
JOIN Ordenes o    ON o.CodigoOrden   = od.OrdCodigoOrden
JOIN @Pares p     ON p.MalEnDeposito = od.ProIdProducto AND p.Real = o.ProIdProducto
JOIN Articulos ad ON ad.ProIdProducto = od.ProIdProducto
JOIN Articulos ap ON ap.ProIdProducto = o.ProIdProducto
ORDER BY od.OrdIdOrden;

UPDATE od
SET od.ProIdProducto = o.ProIdProducto
FROM OrdenesDeposito od
JOIN Ordenes o ON o.CodigoOrden   = od.OrdCodigoOrden
JOIN @Pares p  ON p.MalEnDeposito = od.ProIdProducto AND p.Real = o.ProIdProducto;

PRINT CONCAT('Filas corregidas: ', @@ROWCOUNT, ' (esperado: 18 al 25-sep)');

-- DESPUÉS (debe dar 0 filas)
SELECT od.OrdCodigoOrden, od.ProIdProducto AS EnDeposito, o.ProIdProducto AS EnProduccion
FROM OrdenesDeposito od
JOIN Ordenes o ON o.CodigoOrden   = od.OrdCodigoOrden
JOIN @Pares p  ON p.MalEnDeposito = od.ProIdProducto AND p.Real = o.ProIdProducto;

ROLLBACK;   -- cambiar a COMMIT cuando el resultado esté bien
