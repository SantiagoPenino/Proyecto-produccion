-- ════════════════════════════════════════════════════════════════════
--  CONFIGURADOR — Ficha técnica: avíos por talle y avío de cada paso (09-oct-2026)
-- ════════════════════════════════════════════════════════════════════
--  Primera parte de la propuesta "Mejoras para las fichas técnicas del ERP" (07-oct).
--
--  Antes: la medida de un avío era texto libre ("S–M 55 cm · L–XXL 60 cm") y cada
--  paso de costura no decía qué avío usa.
--  Ahora:
--    A. dbo.ProductoAvios + VariaPorTalle: el avío es "medida única" (como hasta
--       ahora: Cantidad + Medida) o varía por talle.
--    B. dbo.ProductoAviosTalle (NUEVA): el valor de cada talle. Según la unidad
--       del avío en el catálogo (dbo.CatalogoAvios.Unidad), el valor es la medida
--       (m, cm) o la cantidad (u, par). AvioID, si viene, es el artículo de ese
--       talle cuando cambia (cierre de 15 cm en S–M, de 18 cm en L–XXL).
--       Cuelga del producto + el Orden de la línea en ProductoAvios: las filas de
--       ProductoAvios se borran y se vuelven a crear en cada Guardar (cambian de
--       ID, el Orden no). Orden = posición del talle en el molde, para imprimir.
--    C. dbo.ProductoFichaDisenoCosturas + AvioID: el avío que usa el paso (al
--       catálogo, no a la línea del producto, por lo mismo de arriba).
--
--  Los talles se guardan por nombre, tal como vienen del molde de TizadaPro.
--  Los avíos son informativos (ficha, PDF, bandeja de Costura): no mueven stock.
--
--  Idempotente: se puede correr más de una vez. El backend funciona ANTES y
--  DESPUÉS de correrlo (detecta las columnas y la tabla nuevas).
-- ════════════════════════════════════════════════════════════════════

-- ── A. Avío por talle o medida única ───────────────────────────────
IF COL_LENGTH('dbo.ProductoAvios', 'VariaPorTalle') IS NULL
    ALTER TABLE dbo.ProductoAvios
        ADD VariaPorTalle BIT NOT NULL CONSTRAINT DF_ProductoAvios_VariaPorTalle DEFAULT 0;
GO

-- ── B. Valor de cada talle ─────────────────────────────────────────
IF OBJECT_ID('dbo.ProductoAviosTalle', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoAviosTalle (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT            NOT NULL,
        AvioOrden     INT            NOT NULL,   -- ProductoAvios.Orden de la línea
        Talle         NVARCHAR(96)   NOT NULL,   -- como en TizadaProMoldePiezas.Talle
        Valor         DECIMAL(10, 2) NULL,       -- medida (m, cm) o cantidad (u, par), según CatalogoAvios.Unidad
        AvioID        INT            NULL,       -- artículo de ese talle si cambia (NULL = el de la línea)
        Orden         INT            NULL,       -- posición del talle en el molde
        CONSTRAINT UQ_ProductoAviosTalle UNIQUE (ProIdProducto, AvioOrden, Talle),
        INDEX IX_ProductoAviosTalle_Producto (ProIdProducto)
    );
    PRINT 'Tabla ProductoAviosTalle creada.';
END
GO

-- ── C. Avío que usa cada paso de costura ───────────────────────────
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'AvioID') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD AvioID INT NULL;
GO

IF OBJECT_ID('dbo.CatalogoAvios', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.FK_ProdFDCosturas_Avio', 'F') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas
        ADD CONSTRAINT FK_ProdFDCosturas_Avio FOREIGN KEY (AvioID) REFERENCES dbo.CatalogoAvios (AvioID);
GO

IF OBJECT_ID('dbo.CatalogoAvios', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.FK_ProdAviosTalle_Avio', 'F') IS NULL
    ALTER TABLE dbo.ProductoAviosTalle
        ADD CONSTRAINT FK_ProdAviosTalle_Avio FOREIGN KEY (AvioID) REFERENCES dbo.CatalogoAvios (AvioID);
GO

-- Verificación
SELECT COL_LENGTH('dbo.ProductoAvios', 'VariaPorTalle')             AS ProductoAvios_VariaPorTalle,
       OBJECT_ID('dbo.ProductoAviosTalle', 'U')                       AS ProductoAviosTalle,
       COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'AvioID')        AS Costuras_AvioID;
