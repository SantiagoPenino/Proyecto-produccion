-- Locales y el local de cada solicitud de Servicio Técnico (30/09).
-- · dbo.Locales (Id, Nombre): inca, arenal grande, vilardebo, paullier y otro. Se guardan en
--   minúscula; el formulario los muestra con mayúscula inicial.
-- · ST_Solicitudes.LocalId (el local elegido) y LocalOtro (lo que se escribe en "Especifique"
--   cuando se elige "otro").
-- Va DESPUÉS de st-etapa1.sql, que crea ST_Solicitudes. Se puede correr más de una vez.
-- Sin este script el formulario funciona igual, sin el campo Local.

USE SecureAppDB;
GO

IF OBJECT_ID('dbo.ST_Solicitudes') IS NULL
    THROW 50001, 'Falta ST_Solicitudes: correr antes docs/servicio-tecnico/st-etapa1.sql.', 1;
GO

SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.Locales') IS NULL
        CREATE TABLE dbo.Locales (
            Id     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Locales PRIMARY KEY,
            Nombre NVARCHAR(100) NOT NULL
        );

    -- De a uno, para que los Id sigan este orden en una tabla nueva
    IF NOT EXISTS (SELECT 1 FROM dbo.Locales WHERE Nombre = N'inca')          INSERT INTO dbo.Locales (Nombre) VALUES (N'inca');
    IF NOT EXISTS (SELECT 1 FROM dbo.Locales WHERE Nombre = N'arenal grande') INSERT INTO dbo.Locales (Nombre) VALUES (N'arenal grande');
    IF NOT EXISTS (SELECT 1 FROM dbo.Locales WHERE Nombre = N'vilardebo')     INSERT INTO dbo.Locales (Nombre) VALUES (N'vilardebo');
    IF NOT EXISTS (SELECT 1 FROM dbo.Locales WHERE Nombre = N'paullier')      INSERT INTO dbo.Locales (Nombre) VALUES (N'paullier');
    IF NOT EXISTS (SELECT 1 FROM dbo.Locales WHERE Nombre = N'otro')          INSERT INTO dbo.Locales (Nombre) VALUES (N'otro');

    IF COL_LENGTH('dbo.ST_Solicitudes', 'LocalId') IS NULL
        ALTER TABLE dbo.ST_Solicitudes ADD LocalId INT NULL
            CONSTRAINT FK_ST_Solicitudes_Locales REFERENCES dbo.Locales (Id);
    IF COL_LENGTH('dbo.ST_Solicitudes', 'LocalOtro') IS NULL
        ALTER TABLE dbo.ST_Solicitudes ADD LocalOtro NVARCHAR(150) NULL;

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
GO

SELECT Id, Nombre FROM dbo.Locales ORDER BY Id;
SELECT COL_LENGTH('dbo.ST_Solicitudes', 'LocalId') AS LocalId, COL_LENGTH('dbo.ST_Solicitudes', 'LocalOtro') AS LocalOtro;
GO
