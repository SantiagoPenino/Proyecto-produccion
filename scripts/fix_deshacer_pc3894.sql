/* ============================================================================
   fix_deshacer_pc3894.sql
   ----------------------------------------------------------------------------
   Deshace fix_pago_sin_respaldo_pc3894.sql: la señal usada (PagIdPago no
   existe en dbo.Pagos) resulto no ser confiable — se confirmo que le pasa
   a CASI TODOS los pagos viejos de esta clienta, incluidos otros ya
   verificados como reales (ET-3182). Probablemente dbo.Pagos se depura con
   el tiempo. PC-3894 vuelve a quedar como estaba: sin evidencia de que sea
   un error, compatible con un anticipo real.

   MODO DE USO: @Aplicar=0 primero, @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;
DECLARE @UsuarioAlta INT = 1;
DECLARE @CueIdCuenta INT = 53;
DECLARE @DocIdDocumento INT = 9968;
DECLARE @Importe DECIMAL(18,4) = 8271.01;

-- Guarda: confirmar que el ajuste que se va a deshacer sigue ahi tal cual
IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
    WHERE CueIdCuenta = @CueIdCuenta AND DocIdDocumento = @DocIdDocumento
      AND MovTipo = 'AJUSTE_NEG' AND MovImporte = -@Importe
      AND MovConcepto LIKE N'PC-3894%sin respaldo real%'
      AND (MovAnulado IS NULL OR MovAnulado = 0)
)
BEGIN
    PRINT 'No se encontro el ajuste a deshacer tal cual se esperaba. No se toca nada — revisar a mano.';
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

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4);
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta = @CueIdCuenta, @MovTipo = 'AJUSTE_POS',
     @MovConcepto = N'Deshace ajuste de PC-3894: la senal usada (PagIdPago ausente en dbo.Pagos) no es confiable, le pasa a casi todos los pagos viejos (revision 10-sep-2026)',
     @MovImporte = @Importe, @MovUsuarioAlta = @UsuarioAlta, @DocIdDocumento = @DocIdDocumento,
     @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;
