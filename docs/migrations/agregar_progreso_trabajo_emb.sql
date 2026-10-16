-- [BORDADO] Inicio/Pausa/Fin + progreso (cuántas prendas ya bordadas) por orden.
-- Columnas nuevas, nullable, aditivas — sin riesgo para el resto del sistema.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='EstadoTrabajoEmb' AND Object_ID = Object_ID('dbo.Ordenes'))
BEGIN
    ALTER TABLE dbo.Ordenes ADD EstadoTrabajoEmb VARCHAR(20) NULL; -- 'EN_PROCESO' | 'PAUSADO' | NULL (sin iniciar)
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='CantidadTerminada' AND Object_ID = Object_ID('dbo.Ordenes'))
BEGIN
    ALTER TABLE dbo.Ordenes ADD CantidadTerminada FLOAT NULL; -- prendas ya bordadas, para el % de avance
END
