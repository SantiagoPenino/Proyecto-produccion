USE [importa];
GO

-- ============================================================================
-- TABLAS TEMPORALES FALTANTES (COMPLEMENTO A 01 y 07)
-- ============================================================================

CREATE TABLE [dbo].[Temp_Articulos_Maestros] (
    [ProIdProducto] int NOT NULL,
    [CodArticulo] char(20) NOT NULL,
    [IDProdReact] smallint NULL,
    [SupFlia] char(2) NULL,
    [Grupo] char(5) NULL,
    [CodStock] char(20) NULL,
    [Descripcion] char(200) NULL,
    [Mostrar] bit NULL,
    [anchoimprimible] real NULL,
    [LLEVAPAPEL] bit NULL,
    [MonIdMoneda] int NULL,
    [ProCodigoOdooProducto] varchar(50) NULL,
    [UniIdUnidad] int NULL,
    [borrar] int NULL
);
GO

CREATE TABLE [dbo].[Temp_WMS_Maestros] (
    [id] int NOT NULL,
    [nombre] nvarchar(255) NULL
);
GO
