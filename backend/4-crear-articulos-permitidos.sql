-- Asegurar que Articulos tenga primary key
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_TYPE = 'PRIMARY KEY' AND TABLE_NAME = 'Articulos')
BEGIN
    ALTER TABLE dbo.Articulos ADD CONSTRAINT PK_Articulos PRIMARY KEY (ProIdProducto);
    PRINT 'Primary key added to Articulos.';
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlanesMetrosArticulosPermitidos')
BEGIN
    CREATE TABLE dbo.PlanesMetrosArticulosPermitidos (
        PlaIdPlan INT NOT NULL,
        ProIdProducto INT NOT NULL,
        PRIMARY KEY (PlaIdPlan, ProIdProducto),
        CONSTRAINT FK_ArticulosPermitidos_Plan FOREIGN KEY (PlaIdPlan) REFERENCES dbo.PlanesMetros(PlaIdPlan) ON DELETE CASCADE,
        CONSTRAINT FK_ArticulosPermitidos_Articulo FOREIGN KEY (ProIdProducto) REFERENCES dbo.Articulos(ProIdProducto)
    );
    PRINT 'Tabla PlanesMetrosArticulosPermitidos creada.';
END
ELSE
BEGIN
    PRINT 'La tabla PlanesMetrosArticulosPermitidos ya existe.';
END
