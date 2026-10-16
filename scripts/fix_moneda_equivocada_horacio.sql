/* ============================================================================
   fix_moneda_equivocada_horacio.sql
   ----------------------------------------------------------------------------
   Horacio Vaiz (CliIdCliente 5205): dos documentos con el 4to tipo de error
   (pago escrito en la moneda equivocada, mismo patron confirmado con
   GSPORT ET-7128):

   1. ET-7367 (doc 10727): total $949 (pesos). El pago de 949 quedo escrito
      completo en la cuenta USD (383), sin convertir, y ademas el documento
      tiene DOS cargos reales (VTA_CAJA -590 en pesos, -8.80 en USD) que se
      deberian haber pagado por separado, cada uno en su moneda.
      Correccion: sacar los 949 mal puestos de USD, poner 590 en pesos y
      8.80 en USD (lo que realmente corresponde a cada cargo).

   2. PC-3890 (doc 10462): total $10.712 (pesos) = el mismo US$262,29 de su
      unica orden, convertido a pesos (262,29 x cotizacion ~= 10.712), no
      un cargo aparte. El pago de 10.712 quedo escrito tal cual en USD.
      Correccion: sacar los 10.712 mal puestos, poner los US$262,29 reales
      (lo que coincide exacto con el VTA_CAJA de esa orden).

   MODO DE USO: @Aplicar=0 primero, @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;
DECLARE @UsuarioAlta INT = 1;
DECLARE @CuePesos INT = 525, @CueUSD INT = 383;

-- Guardas: confirmar que los movimientos originales siguen tal cual
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
               WHERE CueIdCuenta=@CueUSD AND DocIdDocumento=10727 AND MovTipo='PAGO' AND MovImporte=949.00
                 AND (MovAnulado IS NULL OR MovAnulado=0))
   OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
               WHERE CueIdCuenta=@CueUSD AND DocIdDocumento=10462 AND MovTipo='PAGO' AND MovImporte=10712.00
                 AND (MovAnulado IS NULL OR MovAnulado=0))
BEGIN
    PRINT 'No se encontraron los movimientos originales tal cual se esperaba. No se toca nada — revisar a mano.';
    RETURN;
END

SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@CuePesos, @CueUSD);

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar arriba antes de aplicar.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4);

-- ET-7367 (doc 10727): sacar los 949 mal puestos de USD, repartir correcto
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_NEG',
     @MovConcepto=N'ET-7367 (doc 10727): pago de $949 estaba escrito en USD sin convertir (revision 10-sep-2026)',
     @MovImporte=-949.00, @MovUsuarioAlta=@UsuarioAlta, @DocIdDocumento=10727,
     @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta=@CuePesos, @MovTipo='AJUSTE_POS',
     @MovConcepto=N'ET-7367 (doc 10727): pago real en pesos, repuesto de la moneda equivocada (revision 10-sep-2026)',
     @MovImporte=590.00, @MovUsuarioAlta=@UsuarioAlta, @DocIdDocumento=10727,
     @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_POS',
     @MovConcepto=N'ET-7367 (doc 10727): pago real en USD, repuesto de la moneda equivocada (revision 10-sep-2026)',
     @MovImporte=8.80, @MovUsuarioAlta=@UsuarioAlta, @DocIdDocumento=10727,
     @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;

-- PC-3890 (doc 10462): sacar los 10.712 mal puestos, poner los US$262,29 reales
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_NEG',
     @MovConcepto=N'PC-3890 (doc 10462): pago de $10.712 estaba escrito en USD sin convertir, es el mismo US$262,29 de la orden (revision 10-sep-2026)',
     @MovImporte=-10712.00, @MovUsuarioAlta=@UsuarioAlta, @DocIdDocumento=10462,
     @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_POS',
     @MovConcepto=N'PC-3890 (doc 10462): pago real en USD, repuesto de la moneda equivocada (revision 10-sep-2026)',
     @MovImporte=262.29, @MovUsuarioAlta=@UsuarioAlta, @DocIdDocumento=10462,
     @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@CuePesos, @CueUSD);
