/* ============================================================================
   fix_revertir_cruce_andrea_silva.sql
   ----------------------------------------------------------------------------
   Revierte el cruce del 27-jul-2026 (andrea silva, CliIdCliente 2564): se
   sacaron US$1.368,45 de la cuenta 53 (dolares) para tapar un "deuda" de
   $55.778,09 en la cuenta 1526 (pesos) que en realidad eran dos pagos de
   caja que nunca se habian escrito (PC-2279 y ET-2433, ya repuestos). Con
   esos dos pagos ya agregados, el cruce quedo de mas: ahora hay que
   devolverle a la cuenta en dolares exactamente lo que le sacaron ese dia.

   MODO DE USO: @Aplicar=0 primero, @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;
DECLARE @UsuarioAlta INT = 1;
DECLARE @CueUYU INT = 1526, @CueUSD INT = 53;
DECLARE @MontoUYU DECIMAL(18,4) = 55778.09;
DECLARE @MontoUSD DECIMAL(18,4) = 1368.45;

-- Guarda: confirmar que el cruce original sigue ahi tal cual (no se reviritio antes)
IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
    WHERE CueIdCuenta = @CueUYU AND MovTipo = 'PAGO_CRUZADO' AND MovImporte = @MontoUYU
      AND MovConcepto LIKE N'Cobertura desde DINERO_USD (cruce de saldo a favor%'
      AND (MovAnulado IS NULL OR MovAnulado = 0)
)
BEGIN
    PRINT 'No se encontro el cruce original tal cual se esperaba. No se toca nada — revisar a mano.';
    RETURN;
END

SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@CueUYU, @CueUSD);

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar arriba antes de aplicar.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4), @Concepto NVARCHAR(500), @MontoUYUNeg DECIMAL(18,4);
SET @Concepto = N'Reversion del cruce del 27-jul-2026: tapaba PC-2279/ET-2433, ya repuestos como pago real (revision 10-sep-2026)';
SET @MontoUYUNeg = -@MontoUYU;

EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CueUYU, @MovTipo='AJUSTE_NEG', @MovConcepto=@Concepto,
     @MovImporte=@MontoUYUNeg, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_POS', @MovConcepto=@Concepto,
     @MovImporte=@MontoUSD, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@CueUYU, @CueUSD);
