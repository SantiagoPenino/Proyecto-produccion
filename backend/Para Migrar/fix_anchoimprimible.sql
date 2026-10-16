-- Script para corregir el tipo de dato del campo anchoimprimible
-- Cambia de REAL/FLOAT a DECIMAL(10,2) para evitar que aparezcan todos esos decimales inexactos (ej. 1.8300000429153442).

BEGIN TRANSACTION;
BEGIN TRY

    -- Modificamos el tipo de dato para que guarde el número exacto con 2 decimales
    ALTER TABLE Articulos ALTER COLUMN anchoimprimible DECIMAL(10, 2);

    COMMIT TRANSACTION;
    PRINT 'Éxito: El campo anchoimprimible ahora es DECIMAL(10, 2).';
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Ocurrió un error:';
    PRINT ERROR_MESSAGE();
END CATCH;
