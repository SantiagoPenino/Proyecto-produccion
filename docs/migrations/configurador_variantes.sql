/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — PRODUCTO PADRE Y VARIANTES (12-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Árbol:  Familia → Etiqueta → PRODUCTO PADRE → VARIANTES
   Ej.:    Camisetas → Básquet → Camiseta Basket (CAM-BAS-01)
                                   ├ Cuello Redondo Costadillo Grueso (CAM-BAS-01-01)
                                   └ Cuello V Común Costadillo Fino    (CAM-BAS-01-02)

   - El PADRE es un producto común: molde de TizadaPro, telas, técnicas, apliques,
     accesorios, ficha, avíos, costuras y precio base.
   - Cada VARIANTE es un ARTÍCULO más (su código, su nombre, su foto, su estado),
     que apunta a su padre y a UN modelo del molde del padre. Nace como COPIA del
     padre (técnicas, telas, apliques, accesorios, ficha, avíos, costuras, precio)
     y después se edita como cualquier artículo. El molde, el modelo y la
     producción principal son los del padre y no se cambian. Las técnicas, sus
     opciones, las telas y los accesorios solo pueden ser de los que tiene el padre.

   Qué hace (idempotente, no borra datos de producción):
     A. ProductoVentaConfig.PadreProIdProducto  (NULL = no es variante)
     B. ProductoVentaConfig.ModeloClave         (modelo del molde del padre)
     C. Limpieza de columnas de versiones anteriores (solo existían en LOCAL).
     D. Índice único: un modelo del padre = una sola variante.
     E. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. El backend tolera que
   falte: sin las columnas no muestra el paso "Variantes".
   Correrlo dos veces no cambia nada la segunda vez.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* ── A. Padre de la variante ───────────────────────────────────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'PadreProIdProducto') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD PadreProIdProducto INT NULL;
    PRINT 'A. Columna ProductoVentaConfig.PadreProIdProducto agregada.';
END
ELSE PRINT 'A. ProductoVentaConfig.PadreProIdProducto ya existía.';
GO

/* ── B. Modelo del molde que es esta variante ──────────────────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'ModeloClave') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD ModeloClave NVARCHAR(96) NULL;
    PRINT 'B. Columna ProductoVentaConfig.ModeloClave agregada.';
END
ELSE PRINT 'B. ProductoVentaConfig.ModeloClave ya existía.';
GO

/* ── C. Limpieza de versiones anteriores (solo se corrieron en LOCAL el 12-oct) ── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicasPropias') IS NOT NULL
BEGIN
    IF OBJECT_ID('dbo.DF_ProductoVentaConfig_TecnicasPropias', 'D') IS NOT NULL
        ALTER TABLE dbo.ProductoVentaConfig DROP CONSTRAINT DF_ProductoVentaConfig_TecnicasPropias;
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN TecnicasPropias;
    PRINT 'C. Se quitó TecnicasPropias (versión anterior).';
END
IF COL_LENGTH('dbo.ProductoVentaConfig', 'SeccionesPropias') IS NOT NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN SeccionesPropias;
    PRINT 'C. Se quitó SeccionesPropias (versión anterior).';
END
GO

/* ── D. Un modelo del padre = una sola variante ────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ProductoVentaConfig_PadreModelo' AND object_id = OBJECT_ID('dbo.ProductoVentaConfig'))
BEGIN
    CREATE UNIQUE INDEX UQ_ProductoVentaConfig_PadreModelo
        ON dbo.ProductoVentaConfig (PadreProIdProducto, ModeloClave)
        WHERE PadreProIdProducto IS NOT NULL;
    PRINT 'D. Índice único UQ_ProductoVentaConfig_PadreModelo creado.';
END
ELSE PRINT 'D. UQ_ProductoVentaConfig_PadreModelo ya existía.';
GO

/* ── E. Verificación ───────────────────────────────────────────────────── */
SELECT
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'PadreProIdProducto') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS PadreProIdProducto,
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'ModeloClave')        IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS ModeloClave,
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ProductoVentaConfig_PadreModelo') THEN 'OK' ELSE 'FALTA' END AS IndiceUnico;
GO
