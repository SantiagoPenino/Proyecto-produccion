/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR — FICHA TÉCNICA: MEDIDAS DE LA PRENDA (15-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   En la Ficha de diseño, antes de los avíos: el dibujo con las letras (A, B, C…), la tabla de
   medidas por talle (en cm) y "Cómo medir". Las medidas salen de un NOMENCLADOR (una vez para
   todos los productos); cada producto elige cuáles lleva, con qué letra y si es principal
   (las principales salen arriba, grandes, en la ficha impresa).

   Qué hace (idempotente, no borra nada):
     A. dbo.CatalogoMedidas        el nomenclador (Largo total, Ancho de pecho…), con su "cómo medir"
     B. dbo.ProductoMedidas        las medidas de cada producto: letra, principal, cómo medir propio
     C. dbo.ProductoMedidasTalle   el valor en cm de cada talle
     D. ProductoFichaDiseno + MedidasImagenUrl (el dibujo con letras; la leyenda es el "cómo medir" de cada medida)
     E. Nomenclador inicial: las 8 medidas de la camiseta de básquetbol (A–H)
     F. Verificación.

   Igual que los avíos: las filas del producto se borran y se vuelven a crear en cada Guardar
   (el Orden de la línea no cambia); ProductoMedidasTalle cuelga del producto + ese Orden.
   Las variantes las copian solas al crearse (están en la lista de tablas que se copian).

   Orden de deploy: correr ESTE script ANTES del backend. Sin las tablas el configurador no
   muestra el bloque de medidas.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* A. Nomenclador */
IF OBJECT_ID('dbo.CatalogoMedidas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatalogoMedidas (
        MedidaID   INT IDENTITY(1,1) PRIMARY KEY,
        Nombre     NVARCHAR(120) NOT NULL,          -- Largo total
        Referencia NVARCHAR(120) NULL,              -- HPS a ruedo
        ComoMedir  NVARCHAR(400) NULL,              -- del punto alto del hombro (HPS) al borde del ruedo, en recta
        Activo     BIT NOT NULL CONSTRAINT DF_CatalogoMedidas_Activo DEFAULT 1,
        Orden      INT NULL,
        FechaAlta  DATETIME NOT NULL CONSTRAINT DF_CatalogoMedidas_Fecha DEFAULT GETDATE(),
        CONSTRAINT UQ_CatalogoMedidas_Nombre UNIQUE (Nombre)
    );
    PRINT 'A. CatalogoMedidas creada.';
END
ELSE PRINT 'A. CatalogoMedidas ya existía.';
GO

/* B. Medidas de cada producto */
IF OBJECT_ID('dbo.ProductoMedidas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoMedidas (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT NOT NULL,
        Orden         INT NOT NULL,                 -- la línea (ProductoMedidasTalle cuelga de esto)
        MedidaID      INT NULL,                     -- del nomenclador
        Letra         NVARCHAR(4) NULL,             -- la del dibujo: A, B, C…
        Nombre        NVARCHAR(120) NOT NULL,       -- copia del nomenclador (la ficha no cambia si después lo renombran)
        ComoMedir     NVARCHAR(400) NULL,           -- propio de este producto; NULL = el del nomenclador
        Principal     BIT NOT NULL CONSTRAINT DF_ProductoMedidas_Principal DEFAULT 0,
        CONSTRAINT UQ_ProductoMedidas UNIQUE (ProIdProducto, Orden),
        INDEX IX_ProductoMedidas_Producto (ProIdProducto)
    );
    ALTER TABLE dbo.ProductoMedidas ADD CONSTRAINT FK_ProductoMedidas_Medida FOREIGN KEY (MedidaID) REFERENCES dbo.CatalogoMedidas (MedidaID);
    PRINT 'B. ProductoMedidas creada.';
END
ELSE PRINT 'B. ProductoMedidas ya existía.';
GO

/* C. Valor de cada talle (cm) */
IF OBJECT_ID('dbo.ProductoMedidasTalle', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoMedidasTalle (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT NOT NULL,
        MedidaOrden   INT NOT NULL,                 -- ProductoMedidas.Orden de la línea
        Talle         NVARCHAR(96) NOT NULL,        -- como viene del molde de TIZADA PRO
        Valor         DECIMAL(10, 2) NULL,          -- en cm
        Orden         INT NULL,                     -- posición del talle en el molde
        CONSTRAINT UQ_ProductoMedidasTalle UNIQUE (ProIdProducto, MedidaOrden, Talle),
        INDEX IX_ProductoMedidasTalle_Producto (ProIdProducto)
    );
    PRINT 'C. ProductoMedidasTalle creada.';
END
ELSE PRINT 'C. ProductoMedidasTalle ya existía.';
GO

/* D. El dibujo con las letras */
IF COL_LENGTH('dbo.ProductoFichaDiseno', 'MedidasImagenUrl') IS NULL
    ALTER TABLE dbo.ProductoFichaDiseno ADD MedidasImagenUrl NVARCHAR(500) NULL;
PRINT 'D. ProductoFichaDiseno: MedidasImagenUrl.';
GO

/* E. Nomenclador inicial (solo las que falten) */
DECLARE @Ini TABLE (Nombre NVARCHAR(120), Referencia NVARCHAR(120), ComoMedir NVARCHAR(400), Orden INT);
INSERT INTO @Ini VALUES
 (N'Largo total',            N'HPS a ruedo',     N'del punto alto del hombro (HPS) al borde del ruedo, en recta', 1),
 (N'Ancho de pecho',         N'1 cm bajo sisa',  N'de costado a costado, 1 cm bajo la sisa', 2),
 (N'Ancho de ruedo',         NULL,               N'de costado a costado sobre el ruedo', 3),
 (N'Ancho de hombro a hombro', NULL,             N'de costura de hombro a costura de hombro, por la espalda', 4),
 (N'Profundidad de escote',  NULL,               N'de la línea HPS–HPS al punto más bajo del escote delantero', 5),
 (N'Ancho de escote',        NULL,               N'de borde a borde del escote, en recta', 6),
 (N'Alto de sisa',           NULL,               N'de la costura de hombro al punto más bajo de la sisa', 7),
 (N'Ancho de costadillo',    NULL,               N'ancho del panel lateral a la altura de la sisa', 8);
INSERT INTO dbo.CatalogoMedidas (Nombre, Referencia, ComoMedir, Orden)
SELECT i.Nombre, i.Referencia, i.ComoMedir, i.Orden FROM @Ini i
WHERE NOT EXISTS (SELECT 1 FROM dbo.CatalogoMedidas c WHERE c.Nombre = i.Nombre);
PRINT CONCAT('E. Nomenclador: ', @@ROWCOUNT, ' medida(s) nueva(s).');
GO

/* F. Verificación */
SELECT OBJECT_ID('dbo.CatalogoMedidas', 'U') AS CatalogoMedidas, OBJECT_ID('dbo.ProductoMedidas', 'U') AS ProductoMedidas,
       OBJECT_ID('dbo.ProductoMedidasTalle', 'U') AS ProductoMedidasTalle, COL_LENGTH('dbo.ProductoFichaDiseno', 'MedidasImagenUrl') AS MedidasImagenUrl,
       (SELECT COUNT(*) FROM dbo.CatalogoMedidas) AS MedidasEnNomenclador;
GO
