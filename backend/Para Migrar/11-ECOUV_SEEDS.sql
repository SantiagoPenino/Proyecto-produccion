/* =====================================================================
   11 - ECOUV: SEEDS (datos de ejemplo — AJUSTAR antes de correr en prod)
   Base: SecureAppDB
   Requiere: correr primero 10-ECOUV_ESTRUCTURA.sql

   ⚠️  LOS VALORES DE ABAJO SON EJEMPLOS.
       Reemplazá nombres, precios, monedas y medidas por los reales
       antes de ejecutar. Idempotente por Nombre / CodArticulo.
   ===================================================================== */

USE [SecureAppDB];
GO

/* ---------------------------------------------------------------------
   1. Catálogo de TERMINACIONES  (argolla, ojal, soldadura, laminado...)
      MonIdMoneda: 1=UYU, 2=USD   |   UnidadCobro: 'u' | 'm' | 'm2'
      CodStock: dejar NULL si NO descuenta inventario (solo costo)
   --------------------------------------------------------------------- */
;WITH Seed(Nombre, PrecioUnitario, MonIdMoneda, UnidadCobro, CodStock) AS (
    SELECT N'Argolla',              12.00, 1, 'u',  NULL UNION ALL
    SELECT N'Ojal',                  8.00, 1, 'u',  NULL UNION ALL
    SELECT N'Soldadura perimetral', 45.00, 1, 'm',  NULL UNION ALL
    SELECT N'Laminado brillo',      30.00, 1, 'm2', NULL UNION ALL
    SELECT N'Corte de contorno',    25.00, 1, 'm',  NULL
)
INSERT INTO dbo.Terminaciones (Nombre, AreaID, PrecioUnitario, MonIdMoneda, UnidadCobro, CodStock, Activo)
SELECT s.Nombre, 'ECOUV', s.PrecioUnitario, s.MonIdMoneda, s.UnidadCobro, s.CodStock, 1
FROM Seed s
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Terminaciones t
    WHERE t.Nombre = s.Nombre AND ISNULL(t.AreaID,'') = 'ECOUV'
);
GO

/* ---------------------------------------------------------------------
   2. PRODUCTOS predefinidos (cuadro canvas) — Modo B
      Se cargan como Articulos con TipoArticulo='PRODUCTO' + medidas + margen.
      Ajustar CodArticulo/CodStock/Grupo/moneda/medidas a los reales.
      (anchoimprimible se deja en 0: para productos manda AnchoPredefinido)
   --------------------------------------------------------------------- */
-- Ejemplo: Cuadro Canvas 40x60  (0,40 x 0,60 m, margen 2 cm, precio en USD)
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = 'CANVAS4060')
INSERT INTO dbo.Articulos
    (CodArticulo, IDProdReact, SupFlia, Grupo, CodStock,
     Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda,
     ProCodigoOdooProducto, UniIdUnidad, borrar,
     TipoArticulo, AltoPredefinido, AnchoPredefinido, MargenImpresion)
VALUES
    ('CANVAS4060', NULL, '1', '1.3', NULL,
     N'Cuadro Canvas 40x60', 1, 0, 0, 2,
     NULL, NULL, 0,
     'PRODUCTO', 0.60, 0.40, 0.020);
GO

/* ---------------------------------------------------------------------
   3. TERMINACIONES FIJAS de cada producto  (ProductoTerminaciones)
      Vincula el producto canvas con sus terminaciones incluidas.
   --------------------------------------------------------------------- */
-- Ejemplo: el Cuadro Canvas 40x60 incluye "Bastidor" y "Grapado trasero"
--          (ambas terminaciones deben existir en dbo.Terminaciones)
DECLARE @ProId int = (SELECT ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo))='CANVAS4060');

IF @ProId IS NOT NULL
BEGIN
    INSERT INTO dbo.ProductoTerminaciones (ProIdProducto, TerminacionID, CantidadFija)
    SELECT @ProId, t.TerminacionID, 1
    FROM dbo.Terminaciones t
    WHERE t.Nombre IN (N'Bastidor', N'Grapado trasero')
      AND NOT EXISTS (
          SELECT 1 FROM dbo.ProductoTerminaciones pt
          WHERE pt.ProIdProducto = @ProId AND pt.TerminacionID = t.TerminacionID
      );
END
GO

/* ---------------------------------------------------------------------
   4. VERIFICACIÓN
   --------------------------------------------------------------------- */
SELECT TerminacionID, Nombre, PrecioUnitario, MonIdMoneda, UnidadCobro, CodStock
FROM dbo.Terminaciones WHERE AreaID='ECOUV' ORDER BY Nombre;

SELECT ProIdProducto, CodArticulo, Descripcion, TipoArticulo,
       AnchoPredefinido, AltoPredefinido, MargenImpresion, MonIdMoneda
FROM dbo.Articulos WHERE TipoArticulo='PRODUCTO';

SELECT pt.ProductoTerminacionID, a.Descripcion AS Producto, t.Nombre AS Terminacion, pt.CantidadFija
FROM dbo.ProductoTerminaciones pt
JOIN dbo.Articulos a     ON a.ProIdProducto = pt.ProIdProducto
JOIN dbo.Terminaciones t ON t.TerminacionID = pt.TerminacionID;
GO
