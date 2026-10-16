-- Script para corregir el usuario 999 hardcodeado en facturas y transacciones online
-- Este script cambia el ID de usuario 999 por el 1 (Admin/Principal) 
-- para que las facturas y cajas no queden "huérfanas" o den error.

BEGIN TRANSACTION;
BEGIN TRY

    -- 1. Actualizar Documentos Contables (Facturas)
    UPDATE dbo.DocumentosContables 
    SET DocUsuarioAlta = 1, DocVendedorId = 1 
    WHERE DocUsuarioAlta = 999 OR DocVendedorId = 999;

    -- 2. Actualizar Transacciones de Caja
    UPDATE dbo.TransaccionesCaja 
    SET TcaUsuarioId = 1 
    WHERE TcaUsuarioId = 999;

    -- 3. Actualizar Pagos
    UPDATE dbo.Pagos 
    SET PagUsuarioAlta = 1 
    WHERE PagUsuarioAlta = 999;

    -- 4. Actualizar Asientos Contables
    UPDATE dbo.Cont_AsientosCabecera 
    SET UsuarioId = 1 
    WHERE UsuarioId = 999;

    -- 5. Actualizar Movimientos de Cuenta
    UPDATE dbo.MovimientosCuenta
    SET MovUsuarioAlta = 1
    WHERE MovUsuarioAlta = 999;

    -- 6. Actualizar Histórico de Estados de Órdenes
    UPDATE dbo.HistoricoEstadosOrdenes
    SET HEOUsuarioAlta = 1
    WHERE HEOUsuarioAlta = 999;

    UPDATE dbo.HistoricoEstadosOrdenesRetiro
    SET HEOUsuarioAlta = 1
    WHERE HEOUsuarioAlta = 999;

    COMMIT TRANSACTION;
    PRINT 'Éxito: Todas las operaciones con Vendedor 999 han sido asignadas al Vendedor 1.';
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Ocurrió un error al actualizar:';
    PRINT ERROR_MESSAGE();
END CATCH;
