-- ==============================================================================
-- SCRIPT 04 (OPCIONAL): COMPENSAR EL SALDO A FAVOR CONTRA PC-4883
-- ==============================================================================
-- ¿QUÉ HACE ESTE SCRIPT?
-- Resuelve de raíz la discrepancia sin ingresar dinero ficticio:
-- 1. Toma los $ 19.506,54 que el cliente ya tenía a favor del Anticipo RA-36.
-- 2. Se los imputa a la deuda de PC-4883 (original: $ 21.733,28).
-- 3. Deja el pendiente de PC-4883 en exactamente: $ 2.226,74 (Estado: PARCIAL).
-- 4. El pendiente de PC-5117 sigue intacto en: $ 14.908,82.
--
-- RESULTADO FINAL:
--   Total deudas en pantalla de cobro: $ 2.226,74 + $ 14.908,82 = $ 17.135,56.
--   Saldo en Estado de Cuenta / Billetera:                    = $ -17.135,56.
--   ¡Ambas pantallas quedan cuadradas al centavo!
--   Y cuando el cliente transfiera los $ 17.135,56 reales, se cobran normal
--   sin duplicar plata en la caja ni en los bancos.
-- ==============================================================================

SET NOCOUNT ON;

DECLARE @CliIdCliente INT = 854;
DECLARE @SaldoAFavorAplicar DECIMAL(18,4) = 19506.54;

PRINT '==============================================================================';
PRINT '  APLICANDO SALDO A FAVOR ($ ' + CAST(@SaldoAFavorAplicar AS VARCHAR) + ') A PC-4883...';
PRINT '==============================================================================';

BEGIN TRANSACTION;

BEGIN TRY
    -- 1. Buscar la deuda viva de PC-4883
    DECLARE @DDeId_4883 INT;
    DECLARE @ImporteOrig DECIMAL(18,4);
    DECLARE @ImportePendActual DECIMAL(18,4);

    SELECT TOP 1
        @DDeId_4883        = dd.DDeIdDocumento,
        @ImporteOrig       = dd.DDeImporteOriginal,
        @ImportePendActual = dd.DDeImportePendiente
    FROM dbo.DeudaDocumento dd
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
    LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = dd.OrdIdOrden
    WHERE cc.CliIdCliente = @CliIdCliente
      AND (
          dc.DocNumero = 4883 OR 
          od.OrdCodigoOrden LIKE '%4883%' OR 
          dd.DDeImporteOriginal = 21733.28
      )
      AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO');

    IF @DDeId_4883 IS NULL
    BEGIN
        RAISERROR('No se encontró la deuda viva correspondiente a PC-4883 para el cliente 854.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END;

    DECLARE @NuevoPendiente DECIMAL(18,4) = @ImportePendActual - @SaldoAFavorAplicar;

    IF @NuevoPendiente < 0
    BEGIN
        RAISERROR('El saldo a favor supera el importe pendiente de la deuda.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END;

    -- 2. Actualizar el importe pendiente y estado de PC-4883
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = @NuevoPendiente,
        DDeEstado = CASE WHEN @NuevoPendiente = 0 THEN 'PAGADO' ELSE 'PARCIAL' END
    WHERE DDeIdDocumento = @DDeId_4883;

    PRINT '✓ Deuda #' + CAST(@DDeId_4883 AS VARCHAR) + ' (PC-4883) actualizada:';
    PRINT '   - Importe Original:  $ ' + CAST(@ImporteOrig AS VARCHAR);
    PRINT '   - Saldo a favor:   - $ ' + CAST(@SaldoAFavorAplicar AS VARCHAR);
    PRINT '   - Nuevo Pendiente:   $ ' + CAST(@NuevoPendiente AS VARCHAR) + ' (Estado: PARCIAL)';

    COMMIT TRANSACTION;

    PRINT '';
    PRINT '==============================================================================';
    PRINT '  COMPENSACIÓN APLICADA CON ÉXITO (COMMIT)';
    PRINT '==============================================================================';

    -- Verificación final: Las deudas vivas deben sumar exactamente $ 17.135,56
    SELECT 
        dd.DDeIdDocumento,
        COALESCE(
            RTRIM(dc.DocTipo) + ' ' + RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
            od.OrdCodigoOrden,
            'Deuda #' + CAST(dd.DDeIdDocumento AS VARCHAR)
        ) AS Comprobante,
        dd.DDeImporteOriginal,
        dd.DDeImportePendiente AS ImportePendiente_Actualizado,
        dd.DDeEstado
    FROM dbo.DeudaDocumento dd
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
    LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = dd.OrdIdOrden
    WHERE cc.CliIdCliente = @CliIdCliente
      AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO');

    SELECT 
        SUM(dd.DDeImportePendiente) AS TotalDeudaViva_Ahora,
        (SELECT TOP 1 cc2.CueSaldoActual 
         FROM dbo.CuentasCliente cc2 
         WHERE cc2.CliIdCliente = @CliIdCliente AND cc2.CueEsPrincipal = 1 AND cc2.CueTipo = 'DINERO_UYU'
        ) AS SaldoCuentaCorriente
    FROM dbo.DeudaDocumento dd
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    WHERE cc.CliIdCliente = @CliIdCliente
      AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO');

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT '❌ ERROR AL APLICAR LA COMPENSACIÓN: ' + ERROR_MESSAGE();
END CATCH;
