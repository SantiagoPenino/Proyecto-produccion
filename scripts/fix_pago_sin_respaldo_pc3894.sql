/* ============================================================================
   fix_pago_sin_respaldo_pc3894.sql
   ----------------------------------------------------------------------------
   PC-3894 (documento 9968, andrea silva CliIdCliente 2564, cuenta 53 US$):
   tiene un PAGO de US$8.271,01 con PagIdPago=61467, pero ese PagIdPago NO
   existe en dbo.Pagos — no hay ningun pago real detras. El documento ademas
   quedo en BORRADOR (nunca se facturo). No es plata que haya entrado.

   Revierte ese PAGO con un ajuste, dejando la aclaracion en el concepto.

   MODO DE USO: @Aplicar=0 primero, @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;
DECLARE @UsuarioAlta INT = 1;
DECLARE @CueIdCuenta INT = 53;
DECLARE @DocIdDocumento INT = 9968;
DECLARE @PagIdPago   INT = 61467;
DECLARE @Importe     DECIMAL(18,4) = 8271.01;

-- Guarda: confirmar que el PagIdPago sigue sin existir en dbo.Pagos y que
-- el movimiento original sigue tal cual (nadie lo toco mientras tanto)
IF EXISTS (SELECT 1 FROM dbo.Pagos WITH(NOLOCK) WHERE PagIdPago = @PagIdPago)
BEGIN
    PRINT 'Ahora SI existe el PagIdPago en dbo.Pagos. No se toca nada — revisar de nuevo a mano.';
    RETURN;
END

IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
    WHERE CueIdCuenta = @CueIdCuenta AND DocIdDocumento = @DocIdDocumento AND PagIdPago = @PagIdPago
      AND MovTipo = 'PAGO' AND MovImporte = @Importe AND (MovAnulado IS NULL OR MovAnulado = 0)
)
BEGIN
    PRINT 'El movimiento original no coincide con lo esperado. No se toca nada — revisar a mano.';
    RETURN;
END

SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar arriba antes de aplicar.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4), @ImporteNeg DECIMAL(18,4) = -@Importe;
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta = @CueIdCuenta, @MovTipo = 'AJUSTE_NEG',
     @MovConcepto = N'PC-3894 (doc 9968): PagIdPago 61467 no existe en dbo.Pagos, sin respaldo real, documento en BORRADOR (revision 10-sep-2026)',
     @MovImporte = @ImporteNeg, @MovUsuarioAlta = @UsuarioAlta, @DocIdDocumento = @DocIdDocumento,
     @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;
