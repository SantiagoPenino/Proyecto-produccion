-- ============================================================================
-- add_MovFecha_SP_RegistrarMovimiento.sql
-- Agrega el parametro opcional @MovFecha a dbo.SP_RegistrarMovimiento para
-- permitir retrofechar el movimiento de cuenta corriente (submayor) cuando se
-- fija/edita la fecha de un documento en Facturacion Manual.
--
-- Backward-compatible: @MovFecha es OPCIONAL y default NULL -> ISNULL(GETDATE()).
-- Todas las llamadas existentes (que NO envian @MovFecha) siguen igual.
--
-- CORRER EN PRODUCCION (SSMS / sqlcmd) ANTES de habilitar el backdate en el
-- codigo. Idempotente: usa ALTER via DROP+CREATE.
-- ============================================================================

IF OBJECT_ID('dbo.SP_RegistrarMovimiento', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_RegistrarMovimiento;
GO
CREATE PROCEDURE dbo.SP_RegistrarMovimiento
    @CueIdCuenta INT,
    @MovTipo VARCHAR(30),
    @MovConcepto NVARCHAR(500),
    @MovImporte DECIMAL(18,4),
    @MovUsuarioAlta INT,
    @OrdIdOrden INT = NULL,
    @OReIdOrdenRetiro INT = NULL,
    @PagIdPago INT = NULL,
    @DocIdDocumento INT = NULL,
    @MovRefExterna VARCHAR(100) = NULL,
    @MovObservaciones NVARCHAR(500) = NULL,
    @CicIdCiclo INT = NULL,
    @MovFecha DATETIME = NULL,            -- NUEVO: fecha del movimiento (retrofecha). NULL => GETDATE()
    @MovIdGenerado INT = NULL OUTPUT,
    @SaldoResultante DECIMAL(18,4) = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON; DECLARE @NuevoSaldo DECIMAL(18,4);
    BEGIN TRY
        BEGIN TRANSACTION;
            UPDATE dbo.CuentasCliente WITH (UPDLOCK) SET CueSaldoActual = CueSaldoActual + @MovImporte WHERE CueIdCuenta = @CueIdCuenta;
            SELECT @NuevoSaldo = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta;
            INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, OrdIdOrden, OReIdOrdenRetiro, PagIdPago, DocIdDocumento, MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo)
            VALUES (@CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte, @NuevoSaldo, @OrdIdOrden, @OReIdOrdenRetiro, @PagIdPago, @DocIdDocumento, @MovRefExterna, ISNULL(@MovFecha, GETDATE()), @MovUsuarioAlta, @MovObservaciones, @CicIdCiclo);
            SET @MovIdGenerado = SCOPE_IDENTITY(); SET @SaldoResultante = @NuevoSaldo;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW;
    END CATCH;
END;
GO

PRINT 'SP_RegistrarMovimiento actualizado: parametro @MovFecha agregado.';
GO
