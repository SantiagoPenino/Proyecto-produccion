/* ============================================================================
   fix_zerar_residual_comun.sql
   ----------------------------------------------------------------------------
   Cliente Comun: no tiene que quedar con NINGUN saldo en sus cuentas
   principales (UYU y USD) despues de corregir el cobro doble y compensar
   entre monedas. Cualquier resto que quede es otra cosa (documento mal
   cargado, nota de credito sin relacionar, etc.) que hay que investigar por
   separado — pero mientras tanto, la cuenta no se lo tiene que "llevar"
   puesto: se ajusta a cero y queda documentado para retomar despues.

   Lleva a CERO las dos cuentas principales de dinero del cliente (la que
   tenga resto, sea a favor o en contra), con un AJUSTE_POS o AJUSTE_NEG
   segun corresponda.

   MODO DE USO:
     1. Dejar @Aplicar = 0 y correr. Muestra el estado actual y la
        propuesta, sin escribir nada.
     2. Si esta bien, cambiar @Aplicar = 1 y correr de nuevo.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CliIdCliente INT = 795;      -- <<< editar por cliente
DECLARE @Aplicar      BIT = 0;        -- <<< 0 = solo mostrar, 1 = aplicar de verdad
DECLARE @UsuarioAlta  INT = 1;        -- <<< usuario que queda como autor del ajuste
DECLARE @Motivo NVARCHAR(400) = N'Cliente Comun sin saldo - cierre pendiente de investigar origen (revision cobro doble 10-sep-2026)';

IF OBJECT_ID('tempdb..#Cuentas') IS NOT NULL DROP TABLE #Cuentas;

SELECT cc.CueIdCuenta, cc.MonIdMoneda,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
INTO #Cuentas
FROM dbo.CuentasCliente cc WITH(NOLOCK)
WHERE cc.CliIdCliente = @CliIdCliente AND cc.CueEsPrincipal = 1 AND cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1;

SELECT 'ACTUAL' AS etapa, CueIdCuenta, Moneda = CASE WHEN MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(SaldoLibro AS DECIMAL(18,2))
FROM #Cuentas
WHERE ABS(SaldoLibro) > 0.01;

IF NOT EXISTS (SELECT 1 FROM #Cuentas WHERE ABS(SaldoLibro) > 0.01)
BEGIN
    PRINT 'Ninguna cuenta principal tiene resto. No hay nada que ajustar.';
    DROP TABLE #Cuentas;
    RETURN;
END

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar arriba antes de aplicar.';
    DROP TABLE #Cuentas;
    RETURN;
END

DECLARE @CueId INT, @Saldo DECIMAL(18,4), @MovId INT, @SaldoRes DECIMAL(18,4), @SaldoNeg DECIMAL(18,4), @Tipo VARCHAR(20);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT CueIdCuenta, SaldoLibro FROM #Cuentas WHERE ABS(SaldoLibro) > 0.01;
OPEN cur;
FETCH NEXT FROM cur INTO @CueId, @Saldo;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @SaldoNeg = -@Saldo;
    SET @Tipo = CASE WHEN @Saldo > 0 THEN 'AJUSTE_NEG' ELSE 'AJUSTE_POS' END;
    EXEC dbo.SP_RegistrarMovimiento
         @CueIdCuenta = @CueId, @MovTipo = @Tipo, @MovConcepto = @Motivo,
         @MovImporte = @SaldoNeg, @MovUsuarioAlta = @UsuarioAlta,
         @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;

    FETCH NEXT FROM cur INTO @CueId, @Saldo;
END
CLOSE cur; DEALLOCATE cur;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM #Cuentas);

DROP TABLE #Cuentas;
