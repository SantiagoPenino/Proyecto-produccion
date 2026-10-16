/* ============================================================================
   fix_compensar_moneda_cliente.sql
   ----------------------------------------------------------------------------
   Un cliente no puede tener plata a favor en una moneda y en contra en la
   otra al mismo tiempo: hay que compensarlas. Este script hace, a mano, lo
   mismo que el sistema ya hace solo cuando una orden nace y la cuenta de esa
   moneda no alcanza (ver contabilidadService.js linea ~620, "Intentar
   cruzar desde otra cuenta si tiene dinero") — pero acá compensando el
   saldo GENERAL de las dos cuentas principales del cliente, no una orden
   puntual.

   Convierte con la cotizacion del dia (dbo.Cotizaciones, la mas reciente).
   Mueve SOLO lo necesario para dejar en cero la cuenta que esta en contra
   (o lo maximo que alcance si la otra no tiene suficiente).

   MODO DE USO:
     1. Dejar @Aplicar = 0 y correr. Muestra el estado actual de las dos
        cuentas principales y la propuesta de compensacion, sin escribir
        nada.
     2. Si esta bien, cambiar @Aplicar = 1 y correr de nuevo: aplica la
        compensacion (AJUSTE_NEG en la que tiene a favor, AJUSTE_POS en la
        que esta en contra) via el mismo SP que usa la app, y muestra el
        saldo ANTES/DESPUES.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CliIdCliente INT = 795;      -- <<< editar por cliente
DECLARE @Aplicar      BIT = 0;        -- <<< 0 = solo mostrar, 1 = aplicar de verdad
DECLARE @UsuarioAlta  INT = 1;        -- <<< usuario que queda como autor del ajuste

DECLARE @CueUYU INT, @CueUSD INT, @SaldoUYU DECIMAL(18,4), @SaldoUSD DECIMAL(18,4), @Coti DECIMAL(18,4);

SELECT @CueUYU = MAX(CASE WHEN MonIdMoneda = 1 THEN CueIdCuenta END),
       @CueUSD = MAX(CASE WHEN MonIdMoneda = 2 THEN CueIdCuenta END)
FROM dbo.CuentasCliente WITH(NOLOCK)
WHERE CliIdCliente = @CliIdCliente AND CueEsPrincipal = 1 AND CueTipo LIKE 'DINERO%' AND CueActiva = 1;

IF @CueUYU IS NULL OR @CueUSD IS NULL
BEGIN
    PRINT 'El cliente no tiene las dos cuentas principales (UYU y USD) activas. No se hace nada.';
    RETURN;
END

SELECT @SaldoUYU = ISNULL(SUM(MovImporte), 0) FROM dbo.MovimientosCuenta WITH(NOLOCK)
WHERE CueIdCuenta = @CueUYU AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

SELECT @SaldoUSD = ISNULL(SUM(MovImporte), 0) FROM dbo.MovimientosCuenta WITH(NOLOCK)
WHERE CueIdCuenta = @CueUSD AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

SELECT TOP 1 @Coti = CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC;
IF @Coti IS NULL OR @Coti <= 0
BEGIN
    PRINT 'No hay cotizacion cargada. No se puede convertir, no se hace nada.';
    RETURN;
END

-- ── Estado actual ───────────────────────────────────────────────────────
SELECT 'ACTUAL' AS etapa, CueUYU = @CueUYU, SaldoUYU = CAST(@SaldoUYU AS DECIMAL(18,2)),
       CueUSD = @CueUSD, SaldoUSD = CAST(@SaldoUSD AS DECIMAL(18,2)), Cotizacion = @Coti;

DECLARE @MontoUYU DECIMAL(18,4) = 0, @MontoUSD DECIMAL(18,4) = 0, @Direccion VARCHAR(20) = 'nada que compensar';

IF @SaldoUYU < -0.01 AND @SaldoUSD > 0.01
BEGIN
    -- Debe en pesos, tiene a favor en dolares: convertir dolares a pesos y cubrir
    SET @MontoUYU = -@SaldoUYU;                        -- lo que falta en pesos
    SET @MontoUSD = @MontoUYU / @Coti;                 -- equivalente en dolares
    IF @MontoUSD > @SaldoUSD                           -- no alcanza del todo
    BEGIN
        SET @MontoUSD = @SaldoUSD;
        SET @MontoUYU = @MontoUSD * @Coti;
    END
    SET @Direccion = 'USD -> UYU';
END
ELSE IF @SaldoUSD < -0.01 AND @SaldoUYU > 0.01
BEGIN
    -- Debe en dolares, tiene a favor en pesos: convertir pesos a dolares y cubrir
    SET @MontoUSD = -@SaldoUSD;
    SET @MontoUYU = @MontoUSD * @Coti;
    IF @MontoUYU > @SaldoUYU
    BEGIN
        SET @MontoUYU = @SaldoUYU;
        SET @MontoUSD = @MontoUYU / @Coti;
    END
    SET @Direccion = 'UYU -> USD';
END

SELECT Propuesta = @Direccion, MontoUYU = CAST(@MontoUYU AS DECIMAL(18,2)), MontoUSD = CAST(@MontoUSD AS DECIMAL(18,4));

IF @Direccion = 'nada que compensar' OR @Aplicar = 0
BEGIN
    IF @Direccion = 'nada que compensar'
        PRINT 'Las dos cuentas ya estan del mismo lado (o en cero). No hay nada que compensar.';
    ELSE
        PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar la propuesta de arriba.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4), @Concepto NVARCHAR(500),
        @MontoUYUNeg DECIMAL(18,4) = -@MontoUYU, @MontoUSDNeg DECIMAL(18,4) = -@MontoUSD;

SET @Concepto = N'Compensacion entre monedas del mismo cliente (cotizacion ' + CAST(@Coti AS VARCHAR) + N', revision cobro doble 10-sep-2026)';

IF @Direccion = 'USD -> UYU'
BEGIN
    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_NEG', @MovConcepto=@Concepto,
         @MovImporte=@MontoUSDNeg, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CueUYU, @MovTipo='AJUSTE_POS', @MovConcepto=@Concepto,
         @MovImporte=@MontoUYU, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
END
ELSE
BEGIN
    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CueUYU, @MovTipo='AJUSTE_NEG', @MovConcepto=@Concepto,
         @MovImporte=@MontoUYUNeg, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CueUSD, @MovTipo='AJUSTE_POS', @MovConcepto=@Concepto,
         @MovImporte=@MontoUSD, @MovUsuarioAlta=@UsuarioAlta, @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
END

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (@CueUYU, @CueUSD);
