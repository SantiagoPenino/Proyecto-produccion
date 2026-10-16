USE [SecureAppDB2205];
GO

-- ============================================================================
-- SCRIPT: TABLAS DE INTEGRACIÓN WMS
-- ============================================================================

PRINT '=== CREANDO TABLAS DE INTEGRACIÓN WMS ===';

-- ----------------------------------------------------------------------------
-- 1. Tabla Articulos_Wms (Mapeo Padre: Articulo local <-> Producto Maestro WMS)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Articulos_Wms')
BEGIN
    CREATE TABLE dbo.Articulos_Wms (
        Idproid         INT NOT NULL PRIMARY KEY,       -- FK a dbo.Articulos.ProIdProducto
        producto_maestro_id INT NULL,                   -- ID del Producto Maestro en el WMS (NULL si no está en WMS)
        nombre_wms      VARCHAR(150) NULL,              -- Nombre del producto en el WMS (para referencia visual)
        fecha_sync      DATETIME DEFAULT GETDATE()      -- Última fecha de sincronización
    );
    PRINT '   [OK] Tabla Articulos_Wms creada.';
END
ELSE
    PRINT '   [INFO] Tabla Articulos_Wms ya existe.';
GO

-- ----------------------------------------------------------------------------
-- 2. Tabla Articulos_WMS_Variantes (Hijos: Talles, Colores, SKUs)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Articulos_WMS_Variantes')
BEGIN
    CREATE TABLE dbo.Articulos_WMS_Variantes (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        Idproid         INT NOT NULL,                   -- FK a dbo.Articulos_Wms.Idproid
        wms_variante_id INT NOT NULL,                   -- ID de la variante en el WMS (406, 407...)
        sku             VARCHAR(100) NULL,               -- Código SKU del WMS
        nombre_variante VARCHAR(150) NULL                -- Ej: "Short M NEGRO"
    );
    PRINT '   [OK] Tabla Articulos_WMS_Variantes creada.';
END
ELSE
    PRINT '   [INFO] Tabla Articulos_WMS_Variantes ya existe.';
GO

-- ----------------------------------------------------------------------------
-- 3. Tabla Articulos_Imagenes (Fotos de los productos, genéricas o subidas)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Articulos_Imagenes')
BEGIN
    CREATE TABLE dbo.Articulos_Imagenes (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        Idproid         INT NOT NULL,                   -- FK a dbo.Articulos.ProIdProducto
        url_imagen      VARCHAR(500) NOT NULL,           -- Ruta o URL de la imagen
        es_generica     BIT DEFAULT 1,                   -- 1 = placeholder genérico, 0 = foto real subida
        orden           INT DEFAULT 1,                   -- Para ordenar múltiples fotos del mismo artículo
        fecha_creacion  DATETIME DEFAULT GETDATE()
    );
    PRINT '   [OK] Tabla Articulos_Imagenes creada.';
END
ELSE
    PRINT '   [INFO] Tabla Articulos_Imagenes ya existe.';
GO

-- ----------------------------------------------------------------------------
-- 4. Tabla Articulos_UbicacionLocal (Dónde buscar físicamente en el depósito)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Articulos_UbicacionLocal')
BEGIN
    CREATE TABLE dbo.Articulos_UbicacionLocal (
        Idproid                 INT NOT NULL PRIMARY KEY,  -- FK a dbo.Articulos.ProIdProducto
        pasillo                 VARCHAR(50) NULL,
        estante                 VARCHAR(50) NULL,
        observaciones_ubicacion VARCHAR(255) NULL
    );
    PRINT '   [OK] Tabla Articulos_UbicacionLocal creada.';
END
ELSE
    PRINT '   [INFO] Tabla Articulos_UbicacionLocal ya existe.';
GO

PRINT '=== TABLAS DE INTEGRACIÓN WMS CREADAS EXITOSAMENTE ===';
GO
