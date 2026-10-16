-- Script para crear el Vendedor 999 y evitar errores de Facturación Web
-- Al existir el vendedor 999, la base de datos aceptará las facturas sin necesidad de cambiar el código.

BEGIN TRANSACTION;
BEGIN TRY
    -- 1. Guardar el valor actual del identity para restaurarlo luego si es necesario
    DECLARE @CurrentIdent INT;
    SELECT @CurrentIdent = IDENT_CURRENT('Usuarios');

    -- 2. Habilitar la inserción manual de un ID específico
    SET IDENTITY_INSERT Usuarios ON;

    -- 3. Insertar un vendedor "fantasma" para el ecommerce con ID 999
    INSERT INTO Usuarios (IdUsuario, Usuario, ContrasenaHash, Email, IdRol, IdCargo, Activo, FechaCreacion, Nombre, AreaUsuario)
    VALUES (999, 'VendedorWeb', 'no-pass', 'web@ecommerce.com', 1, 1, 1, GETDATE(), 'Venta Online Automática', 'Ventas');

    -- 4. Volver a bloquear la inserción manual
    SET IDENTITY_INSERT Usuarios OFF;

    -- 5. Restaurar la secuencia original si era menor a 999
    -- Esto asegura que si el último usuario era el 15, el próximo que crees será el 16.
    IF @CurrentIdent < 999
    BEGIN
        DBCC CHECKIDENT ('Usuarios', RESEED, @CurrentIdent);
    END

    COMMIT TRANSACTION;
    PRINT 'Éxito: Vendedor 999 creado. Las facturas web ya no fallarán y tu secuencia de usuarios sigue intacta.';
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Ocurrió un error (es posible que ya exista el usuario 999):';
    PRINT ERROR_MESSAGE();
END CATCH;
