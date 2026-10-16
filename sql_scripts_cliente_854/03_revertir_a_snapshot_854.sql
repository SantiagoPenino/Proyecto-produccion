-- ==============================================================================
-- SCRIPT 03: REVERTIR CAMBIOS AL SNAPSHOT PREVIO (CLIENTE 854)
-- ==============================================================================
-- EJECUTAR ESTE SCRIPT SI HICISTE UNA PRUEBA EN EL SISTEMA Y QUIERES ANULARLA
-- Y DEJAR AL CLIENTE EXACTAMENTE COMO ESTABA CUANDO CORRISTE EL SCRIPT 02.
--
-- Acciones que realiza (DENTRO DE UNA TRANSACCIÓN PROTEGIDA):
--   1. Elimina movimientos en cuenta corriente creados después del snapshot.
--   2. Elimina imputaciones y recibos/pagos creados en la prueba.
--   3. Restaura los saldos exactos en dbo.CuentasCliente.
--   4. Restaura los importes pendientes y estados de dbo.DeudaDocumento.
-- ==============================================================================

SET NOCOUNT ON;

DECLARE @CliIdCliente INT = 854;

-- 1. Validar que existan las tablas de snapshot
IF OBJECT_ID('dbo._BK_Capa854_PuntoControl', 'U') IS NULL OR
   OBJECT_ID('dbo._BK_Capa854_Cuentas', 'U') IS NULL OR
   OBJECT_ID('dbo._BK_Capa854_Deudas', 'U') IS NULL
BEGIN
    RAISERROR('ERROR: No se encontraron las tablas de snapshot (_BK_Capa854_*). Ejecute primero el Script 02.', 16, 1);
    RETURN;
END;

DECLARE @MaxMovId INT, @MaxPagId INT, @MaxImpId INT, @MaxDocId INT, @MaxDdeId INT, @FechaSnap DATETIME;
SELECT TOP 1
    @MaxMovId   = MaxMovId,
    @MaxPagId   = MaxPagId,
    @MaxImpId   = MaxImpId,
    @MaxDocId   = MaxDocId,
    @MaxDdeId   = MaxDdeId,
    @FechaSnap  = FechaSnapshot
FROM dbo._BK_Capa854_PuntoControl;

PRINT '==============================================================================';
PRINT '  INICIANDO REVERSIÓN A SNAPSHOT TOMADO EL: ' + CONVERT(VARCHAR, @FechaSnap, 120);
PRINT '==============================================================================';

BEGIN TRANSACTION;

BEGIN TRY
    -- A. Eliminar movimientos creados después del snapshot en las cuentas del cliente
    DELETE m
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM dbo._BK_Capa854_Cuentas)
      AND m.MovIdMovimiento > @MaxMovId;
    PRINT '✓ Movimientos posteriores eliminados: ' + CAST(@@ROWCOUNT AS VARCHAR);

    -- B. Eliminar imputaciones de pago creadas después del snapshot
    DELETE ip
    FROM dbo.ImputacionPago ip
    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
    WHERE dd.CueIdCuenta IN (SELECT CueIdCuenta FROM dbo._BK_Capa854_Cuentas)
      AND ip.ImpIdImputacion > @MaxImpId;
    PRINT '✓ Imputaciones posteriores eliminadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

    -- C. Eliminar pagos creados para este cliente después del snapshot
    DELETE FROM dbo.Pagos
    WHERE CliIdCliente = @CliIdCliente
      AND PagIdPago > @MaxPagId;
    PRINT '✓ Pagos posteriores eliminados: ' + CAST(@@ROWCOUNT AS VARCHAR);

    -- D. Eliminar documentos contables creados en la prueba (ej: recibos automáticos)
    DELETE FROM dbo.DocumentosContables
    WHERE CliIdCliente = @CliIdCliente
      AND DocIdDocumento > @MaxDocId;
    PRINT '✓ Documentos contables generados en prueba eliminados: ' + CAST(@@ROWCOUNT AS VARCHAR);

    -- E. Eliminar deudas nuevas si se crearon durante la prueba
    DELETE dd
    FROM dbo.DeudaDocumento dd
    WHERE dd.CueIdCuenta IN (SELECT CueIdCuenta FROM dbo._BK_Capa854_Cuentas)
      AND dd.DDeIdDocumento > @MaxDdeId;
    PRINT '✓ Deudas nuevas generadas en prueba eliminadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

    -- F. Restaurar saldos exactos en CuentasCliente
    UPDATE cc
    SET cc.CueSaldoActual = bk.CueSaldoActual
    FROM dbo.CuentasCliente cc
    JOIN dbo._BK_Capa854_Cuentas bk ON bk.CueIdCuenta = cc.CueIdCuenta;
    PRINT '✓ Saldos de cuentas restaurados a su valor previo: ' + CAST(@@ROWCOUNT AS VARCHAR);

    -- G. Restaurar pendientes y estados de DeudaDocumento
    UPDATE dd
    SET dd.DDeImportePendiente = bk.DDeImportePendiente,
        dd.DDeEstado = bk.DDeEstado
    FROM dbo.DeudaDocumento dd
    JOIN dbo._BK_Capa854_Deudas bk ON bk.DDeIdDocumento = dd.DDeIdDocumento;
    PRINT '✓ Deudas vivas restauradas a su estado y pendiente previo: ' + CAST(@@ROWCOUNT AS VARCHAR);

    COMMIT TRANSACTION;
    PRINT '';
    PRINT '==============================================================================';
    PRINT '  REVERSIÓN COMPLETADA EXITOSAMENTE (COMMIT)';
    PRINT '  El cliente 854 volvió al estado exacto previo a la prueba.';
    PRINT '==============================================================================';

    -- Mostrar estado resultante verificado
    SELECT 
        cc.CueIdCuenta,
        cc.CueTipo,
        cc.CueSaldoActual AS SaldoRestaurado
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @CliIdCliente;

    SELECT 
        dd.DDeIdDocumento,
        dd.DDeImporteOriginal,
        dd.DDeImportePendiente AS PendienteRestaurado,
        dd.DDeEstado AS EstadoRestaurado
    FROM dbo.DeudaDocumento dd
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    WHERE cc.CliIdCliente = @CliIdCliente;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT '❌ ERROR DURANTE LA REVERSIÓN. Se ejecutó ROLLBACK.';
    PRINT 'Mensaje de error: ' + ERROR_MESSAGE();
END CATCH;
