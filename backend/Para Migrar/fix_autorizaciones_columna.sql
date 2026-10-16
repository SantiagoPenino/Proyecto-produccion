-- Script para corregir el error de la columna ORetIdOrdenRetiro en AutorizacionesSinPago
BEGIN TRANSACTION;
BEGIN TRY

    -- Caso 1: Existen AMBAS columnas en producción (el código inserta en una y la otra queda NULL)
    IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AutorizacionesSinPago]') AND name = 'ORetIdOrdenRetiro')
       AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AutorizacionesSinPago]') AND name = 'OReIdOrdenRetiro')
    BEGIN
        -- Hacemos que la columna vieja permita NULLs para que no bloquee el INSERT
        ALTER TABLE [dbo].[AutorizacionesSinPago] ALTER COLUMN ORetIdOrdenRetiro INT NULL;
        PRINT 'Columna ORetIdOrdenRetiro modificada para permitir NULLs (había dos columnas duplicadas).';
    END

    -- Caso 2: Sólo existe la columna vieja (ORetIdOrdenRetiro con la 't' de más) y falta la nueva
    ELSE IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AutorizacionesSinPago]') AND name = 'ORetIdOrdenRetiro')
       AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AutorizacionesSinPago]') AND name = 'OReIdOrdenRetiro')
    BEGIN
        -- Renombramos la columna vieja al nombre correcto que espera el código
        EXEC sp_rename 'dbo.AutorizacionesSinPago.ORetIdOrdenRetiro', 'OReIdOrdenRetiro', 'COLUMN';
        PRINT 'Columna ORetIdOrdenRetiro renombrada a OReIdOrdenRetiro correctamente.';
    END
    ELSE
    BEGIN
        PRINT 'No se encontraron problemas o la tabla ya está correcta.';
    END

    COMMIT TRANSACTION;
    PRINT 'Éxito: Error solucionado.';
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Ocurrió un error:';
    PRINT ERROR_MESSAGE();
END CATCH;
