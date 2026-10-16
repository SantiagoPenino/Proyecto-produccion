-- [BORDADO] Asignación de operario por orden desde la Bandeja de Bordado.
-- Columna nueva, nullable, aditiva — sin riesgo para el resto del sistema.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='OperarioAsignadoID' AND Object_ID = Object_ID('dbo.Ordenes'))
BEGIN
    ALTER TABLE dbo.Ordenes ADD OperarioAsignadoID INT NULL;
END
