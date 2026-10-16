/* ============================================================================
   fix_revertir_duplicado_iqui.sql
   ----------------------------------------------------------------------------
   Revierte la aplicacion duplicada del 10-sep-2026 16:20 sobre Iqui ferreri
   (CliIdCliente 795): el bug de re-deteccion (ya corregido en los scripts)
   encontro sus 2 ordenes YA corregidas a las 15:24 y les volvio a aplicar
   la misma correccion. Ver diag_verificar_aplicacion_comunes.sql para el
   detalle completo verificado.

   Antes de esto (15:47) la cuenta estaba correctamente en 0,00 en las dos
   monedas. El duplicado de las 16:20 le sumo exactamente:
     cuenta 896 ($):   -882,00
     cuenta 147 (US$): +21,58
   Este script hace el movimiento contrario exacto, dejando la cuenta otra
   vez en 0,00 / 0,00.

   MODO DE USO: dejar @Aplicar=0 primero para confirmar el estado actual,
   despues @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;
DECLARE @UsuarioAlta INT = 1;
DECLARE @Cue896 INT = 896, @Cue147 INT = 147;

SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@Cue896, @Cue147);

-- Guarda: si el saldo NO es exactamente el esperado (-882,00 y 21,58), no tocar nada.
IF NOT EXISTS (
    SELECT 1 WHERE
      (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
       WHERE m.CueIdCuenta = 896 AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) BETWEEN -883 AND -881
      AND
      (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
       WHERE m.CueIdCuenta = 147 AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) BETWEEN 21 AND 22
)
BEGIN
    PRINT 'El saldo actual no es el esperado (-882,00 / 21,58). No se toca nada — revisar a mano.';
    RETURN;
END

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): coincide con lo esperado. Cambiar a @Aplicar=1 para aplicar.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4);
DECLARE @Concepto NVARCHAR(500) = N'Reversion de aplicacion duplicada del lote (10-sep-2026 16:20) — bug de re-deteccion ya corregido, ver diag_verificar_aplicacion_comunes.sql';

EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@Cue896, @MovTipo='AJUSTE_POS', @MovConcepto=@Concepto,
     @MovImporte=882.00, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;

DECLARE @MenosVeintiunoCincuentayOcho DECIMAL(18,4) = -21.58;
EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@Cue147, @MovTipo='AJUSTE_NEG', @MovConcepto=@Concepto,
     @MovImporte=@MenosVeintiunoCincuentayOcho, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@Cue896, @Cue147);
