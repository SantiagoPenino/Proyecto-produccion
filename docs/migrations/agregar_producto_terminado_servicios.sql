-- [PRENDAS] Servicios de decoración incluidos por defecto en un Producto Terminado
-- (Bordado/DTF/TPU) — mismo espíritu que ProductoTerminadoTerminaciones (ECOUV), pero para
-- las prendas confeccionadas: al elegir el producto en "Fabricar a Medida", los servicios
-- marcados acá se activan solos y quedan obligatorios (no se pueden apagar).
--
-- Se referencia por ProIdProducto (Articulos.ProIdProducto), NO por ProductosTerminados.ID:
-- una prenda confeccionada no necesita ficha de impresión (Ancho/Alto/Tinta/Material), así
-- que no hace falta una fila en ProductosTerminados para tener sus servicios por defecto.

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoTerminadoServicios')
BEGIN
    CREATE TABLE dbo.ProductoTerminadoServicios (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,
        AreaID          VARCHAR(10) NOT NULL,   -- 'EMB' | 'DF' | 'TPU'
        Obligatorio     BIT NOT NULL DEFAULT 1, -- 1 = viene incluido y no se puede apagar
        CONSTRAINT UQ_ProductoTerminadoServicios UNIQUE (ProIdProducto, AreaID)
    );
END
