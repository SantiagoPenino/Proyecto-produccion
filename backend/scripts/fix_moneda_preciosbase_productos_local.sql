/* ============================================================================
   FIX: PreciosBase con MonIdMoneda=2 (USD) en artículos que están en PESOS
   ----------------------------------------------------------------------------
   SÍNTOMA
     En Caja (POS Express) el artículo PT-023-9595 "Shorts (Adulto)" aparecía a
     US$ 160,00 (= $ 6.539,20 a TC 40,87) cuando el precio real son $ 160 pesos.

   CAUSA
     dbo.PreciosBase tiene DOS columnas de moneda: Moneda (texto) y MonIdMoneda
     (1=UYU, 2=USD). En estas filas quedaron contradictorias: Moneda='UYU' pero
     MonIdMoneda=2. El endpoint /contabilidad/caja/productos-venta
     (backend/services/cajaService.js) toma MonIdMoneda como autoritativa, por lo
     que devuelve MonedaBase='USD' y el front carga el precio como dólares.

   ALCANCE
     Sólo los artículos de "Productos en el local" (CodStock = '2.2.1.2'), que se
     venden en pesos. NO se tocan las telas/lonas (CodStock 1.1.*, 1.2.*, 1.3.*)
     que también tienen el texto 'UYU' desactualizado pero cuyo precio SÍ está en
     dólares por metro (Adis, Deportiva Parisien, Microfibra, Modal, Mykonos, Rib
     New, Tela Cliente, UV Rígidos, Lona Mesh) -> ahí lo correcto es MonIdMoneda=2.

   NO INCLUIDO / A DECIDIR
     PT-020-9589 "Backing Pop Up (Soporte para Tela o Lona)" = 100. Es el único
     del grupo donde US$ 100 es un precio verosímil. Si son $ 100 pesos,
     descomentar el bloque del final.
   ========================================================================== */

SET NOCOUNT ON;
USE SecureAppDB;   -- ajustar si el nombre difiere
GO

-- ── 1) ANTES: ver qué se va a tocar ──────────────────────────────────────────
PRINT '--- ANTES ---';
SELECT pb.ID, LTRIM(RTRIM(pb.CodArticulo)) AS CodArticulo,
       LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       pb.Precio, pb.Moneda AS MonedaTexto, pb.MonIdMoneda
FROM dbo.PreciosBase pb
JOIN dbo.Articulos   a ON a.ProIdProducto = pb.ProIdProducto
WHERE pb.MonIdMoneda = 2
  AND LTRIM(RTRIM(pb.Moneda)) = 'UYU'
  AND LTRIM(RTRIM(a.CodStock)) = '2.2.1.2'
  AND LTRIM(RTRIM(pb.CodArticulo)) <> 'PT-020-9589'
ORDER BY a.Descripcion;
GO

-- ── 2) FIX ───────────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE pb
   SET pb.MonIdMoneda        = 1,
       pb.Moneda             = 'UYU',
       pb.UltimaActualizacion = GETDATE()
FROM dbo.PreciosBase pb
JOIN dbo.Articulos   a ON a.ProIdProducto = pb.ProIdProducto
WHERE pb.MonIdMoneda = 2
  AND LTRIM(RTRIM(pb.Moneda)) = 'UYU'
  AND LTRIM(RTRIM(a.CodStock)) = '2.2.1.2'
  AND LTRIM(RTRIM(pb.CodArticulo)) <> 'PT-020-9589';

PRINT 'Filas corregidas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));   -- esperado: 11

-- Revisar el PRINT y el SELECT de abajo antes de confirmar.
SELECT pb.ID, LTRIM(RTRIM(pb.CodArticulo)) AS CodArticulo,
       LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       pb.Precio, pb.Moneda AS MonedaTexto, pb.MonIdMoneda
FROM dbo.PreciosBase pb
JOIN dbo.Articulos   a ON a.ProIdProducto = pb.ProIdProducto
WHERE LTRIM(RTRIM(a.CodStock)) = '2.2.1.2'
ORDER BY a.Descripcion;

-- COMMIT TRANSACTION;
-- ROLLBACK TRANSACTION;
GO

/* ── 3) OPCIONAL: Backing Pop Up, sólo si su precio son $ 100 pesos ──────────
BEGIN TRANSACTION;
UPDATE dbo.PreciosBase
   SET MonIdMoneda = 1, Moneda = 'UYU', UltimaActualizacion = GETDATE()
WHERE ID = 269;   -- PT-020-9589 Backing Pop Up, Precio 100
PRINT 'Backing Pop Up corregido: ' + CAST(@@ROWCOUNT AS VARCHAR(10));
-- COMMIT TRANSACTION;
GO
*/

/* ── 4) CONTROL POSTERIOR: no debería quedar ninguna fila de 2.2.1.2 en USD ──
SELECT COUNT(*) AS QuedanEnUSD
FROM dbo.PreciosBase pb
JOIN dbo.Articulos   a ON a.ProIdProducto = pb.ProIdProducto
WHERE pb.MonIdMoneda = 2 AND LTRIM(RTRIM(a.CodStock)) = '2.2.1.2';
*/
