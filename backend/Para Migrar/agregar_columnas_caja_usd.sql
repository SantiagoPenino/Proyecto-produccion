-- Script para agregar las columnas de dólares en la tabla de apertura de caja
BEGIN TRANSACTION;
BEGIN TRY
    -- Agregamos StuMontoInicialUSD si no existe
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SesionesTurno]') AND name = 'StuMontoInicialUSD')
    BEGIN
        ALTER TABLE [dbo].[SesionesTurno] ADD StuMontoInicialUSD DECIMAL(18,2) NOT NULL DEFAULT 0;
    END

    -- Agregamos StuMontoFinalUSD si no existe
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SesionesTurno]') AND name = 'StuMontoFinalUSD')
    BEGIN
        ALTER TABLE [dbo].[SesionesTurno] ADD StuMontoFinalUSD DECIMAL(18,2) NOT NULL DEFAULT 0;
    END

    COMMIT TRANSACTION;
    PRINT 'Éxito: Columnas StuMontoInicialUSD y StuMontoFinalUSD agregadas a SesionesTurno.';
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Ocurrió un error al agregar las columnas:';
    PRINT ERROR_MESSAGE();
END CATCH;
