-- Script para agregar la columna DocVendedorId a la tabla DocumentosContables
-- Esto soluciona el error "Invalid column name 'DocVendedorId'" al emitir comprobantes.

BEGIN TRANSACTION;
BEGIN TRY
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[DocumentosContables]') AND name = 'DocVendedorId')
    BEGIN
        ALTER TABLE [dbo].[DocumentosContables] ADD DocVendedorId INT NULL;
        ALTER TABLE [dbo].[DocumentosContables] ADD CONSTRAINT FK_DocumentosContables_Vendedor FOREIGN KEY (DocVendedorId) REFERENCES Usuarios(IdUsuario);
    END

    COMMIT TRANSACTION;
    PRINT 'Éxito: Columna DocVendedorId agregada a DocumentosContables de forma segura.';
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Ocurrió un error al intentar modificar la tabla:';
    PRINT ERROR_MESSAGE();
END CATCH;
