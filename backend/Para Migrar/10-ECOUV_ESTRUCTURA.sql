/* =====================================================================
   10 - ECOUV: ESTRUCTURA (Terminaciones por archivo + cotización m²)
   Base: SecureAppDB

   Agrega:
     1. Tabla  Terminaciones            (catálogo tipificado con costo)
     2. Tabla  ProductoTerminaciones    (terminaciones fijas del producto canvas)
     3. ServiciosExtraOrden  + ArchivoID, TerminacionID   (enganche por archivo)
     4. Articulos            + TipoArticulo, AltoPredefinido,
                               AnchoPredefinido, MargenImpresion
     5. Areas   UM = 'm2'  para ECOUV   (cotización por metro cuadrado)
     6. EstadosOrdenes  → estado 14 = "En Terminaciones"

   IDEMPOTENTE: se puede correr más de una vez sin romper nada.
   BAJO RIESGO: las columnas nuevas son NULL (metadata-only, no reescribe tabla).
   NO cambia ninguna lógica todavía — solo prepara la estructura.
   FK lógicas (sin CONSTRAINT físico), igual que el resto del modelo.
   ===================================================================== */

USE [SecureAppDB];
GO

/* ---------------------------------------------------------------------
   1. Tabla Terminaciones  (catálogo: argolla, ojal, soldadura, etc.)
   --------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Terminaciones')
CREATE TABLE dbo.Terminaciones (
    TerminacionID   int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Nombre          nvarchar(100) NOT NULL,             -- 'Argolla', 'Soldadura perimetral', 'Ojal'
    AreaID          varchar(20)  NULL,                  -- 'ECOUV' (permite reusar en otras áreas)
    PrecioUnitario  decimal(18,2) NOT NULL DEFAULT(0),
    MonIdMoneda     int          NOT NULL DEFAULT(1),   -- 1=UYU, 2=USD
    UnidadCobro     varchar(10)  NOT NULL DEFAULT('u'), -- 'u' (unidad), 'm' (lineal), 'm2'
    CodStock        varchar(50)  NULL,                  -- enganche OPCIONAL a inventario
    Activo          bit          NOT NULL DEFAULT(1),
    FechaRegistro   datetime     NOT NULL DEFAULT(GETDATE())
);
GO

/* ---------------------------------------------------------------------
   2. Tabla ProductoTerminaciones  (terminaciones fijas del canvas - Modo B)
   --------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoTerminaciones')
CREATE TABLE dbo.ProductoTerminaciones (
    ProductoTerminacionID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ProIdProducto   int NOT NULL,                       -- FK lógica -> Articulos (producto canvas)
    TerminacionID   int NOT NULL,                       -- FK lógica -> Terminaciones
    CantidadFija    decimal(18,2) NOT NULL DEFAULT(1)
);
GO

/* ---------------------------------------------------------------------
   3. ServiciosExtraOrden  + enganche por archivo
      (la tabla ya tiene PrecioUnitario, TotalLinea, CodArt, CodStock,
       Cantidad y Estado; solo faltan estas dos columnas)
   --------------------------------------------------------------------- */
IF COL_LENGTH('dbo.ServiciosExtraOrden','ArchivoID') IS NULL
    ALTER TABLE dbo.ServiciosExtraOrden ADD ArchivoID int NULL;      -- -> ArchivosOrden.ArchivoID
GO

IF COL_LENGTH('dbo.ServiciosExtraOrden','TerminacionID') IS NULL
    ALTER TABLE dbo.ServiciosExtraOrden ADD TerminacionID int NULL;  -- -> Terminaciones.TerminacionID
GO

/* ---------------------------------------------------------------------
   4. Articulos  + tipo, dimensiones y margen (elimina el 0.03 hardcodeado)
   --------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Articulos','TipoArticulo') IS NULL
    ALTER TABLE dbo.Articulos ADD TipoArticulo varchar(20) NULL;        -- 'MATERIAL' | 'PRODUCTO'
GO

IF COL_LENGTH('dbo.Articulos','AltoPredefinido') IS NULL
    ALTER TABLE dbo.Articulos ADD AltoPredefinido decimal(10,2) NULL;   -- Modo B (m)
GO

IF COL_LENGTH('dbo.Articulos','AnchoPredefinido') IS NULL
    ALTER TABLE dbo.Articulos ADD AnchoPredefinido decimal(10,2) NULL;  -- Modo B (m)
GO

IF COL_LENGTH('dbo.Articulos','MargenImpresion') IS NULL
    ALTER TABLE dbo.Articulos ADD MargenImpresion decimal(10,3) NULL;   -- reemplaza el 0.03 fijo
GO

-- Clasifica el catálogo existente como MATERIAL (los productos canvas se marcan en los seeds)
UPDATE dbo.Articulos SET TipoArticulo='MATERIAL' WHERE TipoArticulo IS NULL;
GO

/* ---------------------------------------------------------------------
   5. Areas  UM = 'm2' para ECOUV  (cotización por metro cuadrado)
      El motor ya calcula Magnitud = SUM(ancho * alto * copias) cuando UM='m2'
   --------------------------------------------------------------------- */
UPDATE dbo.Areas SET UM='m2' WHERE AreaID='ECOUV' AND ISNULL(UM,'') <> 'm2';
GO

/* ---------------------------------------------------------------------
   6. EstadosOrdenes  → 14 = "En Terminaciones"
      (orden impresa pero con terminaciones pendientes; NO es "Pronto")
   --------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM dbo.EstadosOrdenes WHERE EOrNombreEstado = 'En Terminaciones')
BEGIN
    IF OBJECTPROPERTY(OBJECT_ID('dbo.EstadosOrdenes'), 'TableHasIdentity') = 1
    BEGIN
        SET IDENTITY_INSERT dbo.EstadosOrdenes ON;
        INSERT INTO dbo.EstadosOrdenes (EOrIdEstadoOrden, EOrNombreEstado) VALUES (14, 'En Terminaciones');
        SET IDENTITY_INSERT dbo.EstadosOrdenes OFF;
    END
    ELSE
        INSERT INTO dbo.EstadosOrdenes (EOrIdEstadoOrden, EOrNombreEstado) VALUES (14, 'En Terminaciones');
END
GO

/* ---------------------------------------------------------------------
   7. VERIFICACIÓN  (debería devolver todo OK)
   --------------------------------------------------------------------- */
SELECT 'Terminaciones'            AS Objeto, IIF(OBJECT_ID('dbo.Terminaciones')         IS NOT NULL,'OK','FALTA') AS Estado
UNION ALL SELECT 'ProductoTerminaciones', IIF(OBJECT_ID('dbo.ProductoTerminaciones')   IS NOT NULL,'OK','FALTA')
UNION ALL SELECT 'ServiciosExtraOrden.ArchivoID',     IIF(COL_LENGTH('dbo.ServiciosExtraOrden','ArchivoID')     IS NOT NULL,'OK','FALTA')
UNION ALL SELECT 'ServiciosExtraOrden.TerminacionID', IIF(COL_LENGTH('dbo.ServiciosExtraOrden','TerminacionID') IS NOT NULL,'OK','FALTA')
UNION ALL SELECT 'Articulos.TipoArticulo',     IIF(COL_LENGTH('dbo.Articulos','TipoArticulo')     IS NOT NULL,'OK','FALTA')
UNION ALL SELECT 'Articulos.AltoPredefinido',  IIF(COL_LENGTH('dbo.Articulos','AltoPredefinido')  IS NOT NULL,'OK','FALTA')
UNION ALL SELECT 'Articulos.AnchoPredefinido', IIF(COL_LENGTH('dbo.Articulos','AnchoPredefinido') IS NOT NULL,'OK','FALTA')
UNION ALL SELECT 'Articulos.MargenImpresion',  IIF(COL_LENGTH('dbo.Articulos','MargenImpresion')  IS NOT NULL,'OK','FALTA');

SELECT AreaID, UM FROM dbo.Areas WHERE AreaID='ECOUV';                          -- UM debe ser 'm2'
SELECT EOrIdEstadoOrden, EOrNombreEstado FROM dbo.EstadosOrdenes WHERE EOrNombreEstado='En Terminaciones';
GO
