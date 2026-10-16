/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — ETIQUETA del producto (árbol de productos)
   ══════════════════════════════════════════════════════════════════════════
   Árbol del configurador:
       Familia (StockArt.CodStock)  →  Etiqueta  →  Producto (nombre completo)
   Ej.:  Camisetas  →  Básquet  →  Camiseta basket FP, Camiseta basket FP+B, …

   La etiqueta dice PARA QUÉ es el producto (Básquet, Fútbol, Vóley…). Lo que
   viene en el nombre (FP, +B, +DTF) es parte del nombre y no se toca.

   Qué hace (idempotente, no mueve ni borra artículos):
     0. Limpieza: si en esta base quedó la tabla ProductoBase de una versión
        anterior de este cambio (solo se corrió en LOCAL el 25-sep), la saca.
        En producción esa tabla no existe y este paso no hace nada.
     A. Tabla dbo.ProductoEtiqueta.
     B. Columna dbo.ProductoVentaConfig.EtiquetaID.
     C. Precarga: a los productos cuyo nombre dice futbol / basket / voley les
        asigna la etiqueta Fútbol / Básquet / Vóley (solo si no tienen una).
     D. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. (Igual el backend
   tolera que falte: sin la columna, el listado sale plano como hoy.)
   Correrlo dos veces no cambia nada la segunda vez.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* ── 0. Limpieza de la versión anterior (ProductoBase) ─────────────────── */
IF OBJECT_ID('dbo.FK_ProductoVentaConfig_ProductoBase', 'F') IS NOT NULL
    ALTER TABLE dbo.ProductoVentaConfig DROP CONSTRAINT FK_ProductoVentaConfig_ProductoBase;
IF COL_LENGTH('dbo.ProductoVentaConfig', 'ProductoBaseID') IS NOT NULL
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN ProductoBaseID;
IF OBJECT_ID('dbo.ProductoBase', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.ProductoBase;
    PRINT '0. Se quitó ProductoBase (versión anterior, solo local).';
END
ELSE PRINT '0. No había ProductoBase: nada que limpiar.';
GO

/* ── A. Tabla ProductoEtiqueta ─────────────────────────────────────────── */
IF OBJECT_ID('dbo.ProductoEtiqueta', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoEtiqueta (
        EtiquetaID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductoEtiqueta PRIMARY KEY,
        Nombre     NVARCHAR(100)     NOT NULL,
        Activo     BIT               NOT NULL CONSTRAINT DF_ProductoEtiqueta_Activo DEFAULT (1),
        FechaAlta  DATETIME          NOT NULL CONSTRAINT DF_ProductoEtiqueta_FechaAlta DEFAULT (GETDATE()),
        CONSTRAINT UQ_ProductoEtiqueta_Nombre UNIQUE (Nombre)
    );
    PRINT 'A. Tabla dbo.ProductoEtiqueta creada.';
END
ELSE PRINT 'A. dbo.ProductoEtiqueta ya existía.';
GO

/* ── B. Columna ProductoVentaConfig.EtiquetaID ─────────────────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'EtiquetaID') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD EtiquetaID INT NULL
        CONSTRAINT FK_ProductoVentaConfig_Etiqueta REFERENCES dbo.ProductoEtiqueta (EtiquetaID);
    PRINT 'B. Columna ProductoVentaConfig.EtiquetaID agregada.';
END
ELSE PRINT 'B. ProductoVentaConfig.EtiquetaID ya existía.';
GO

/* ── C. Precarga por el nombre del producto ────────────────────────────── */
BEGIN TRAN;

INSERT INTO dbo.ProductoEtiqueta (Nombre)
SELECT v.Nombre
FROM (VALUES (N'Fútbol'), (N'Básquet'), (N'Vóley')) v(Nombre)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ProductoEtiqueta e WHERE e.Nombre = v.Nombre);
PRINT CONCAT('C. Etiquetas creadas: ', @@ROWCOUNT);

UPDATE vc SET vc.EtiquetaID = e.EtiquetaID, vc.FechaModif = GETDATE()
FROM dbo.ProductoVentaConfig vc
INNER JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
CROSS APPLY (SELECT CASE
                 WHEN a.Descripcion LIKE N'%futbol%' OR a.Descripcion LIKE N'%fútbol%'   THEN N'Fútbol'
                 WHEN a.Descripcion LIKE N'%basket%' OR a.Descripcion LIKE N'%basquet%'
                   OR a.Descripcion LIKE N'%básquet%'                                    THEN N'Básquet'
                 WHEN a.Descripcion LIKE N'%voley%'  OR a.Descripcion LIKE N'%vóley%'    THEN N'Vóley'
             END AS Etiqueta) x
INNER JOIN dbo.ProductoEtiqueta e ON e.Nombre = x.Etiqueta
WHERE vc.EtiquetaID IS NULL
  AND ISNULL(vc.EsCombo, 0) = 0;
PRINT CONCAT('C. Productos etiquetados: ', @@ROWCOUNT);

COMMIT;
GO

/* ── D. Verificación ───────────────────────────────────────────────────── */
SELECT LTRIM(RTRIM(sa.Articulo)) AS Familia,
       ISNULL(e.Nombre, '(sin etiqueta)') AS Etiqueta,
       COUNT(*) AS Productos
FROM dbo.ProductoVentaConfig vc
INNER JOIN dbo.Articulos a  ON a.ProIdProducto = vc.ProIdProducto
LEFT  JOIN dbo.ProductoEtiqueta e ON e.EtiquetaID = vc.EtiquetaID
LEFT  JOIN dbo.StockArt sa  ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
GROUP BY sa.Articulo, e.Nombre
ORDER BY Familia, Etiqueta;
GO
