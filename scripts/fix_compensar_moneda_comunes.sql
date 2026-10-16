/* ============================================================================
   fix_compensar_moneda_comunes.sql
   ----------------------------------------------------------------------------
   Igual que fix_compensar_moneda_cliente.sql, pero para los clientes que
   fix_cobro_doble_fantasma_comunes.sql ACABA de corregir (se identifican
   por el concepto "Correccion cobro doble billetera+caja" que dejo ese
   script) y quedaron con una moneda a favor y la otra en contra. Compensa
   cada uno con la cotizacion del dia, moviendo SOLO lo necesario para dejar
   en cero la cuenta que esta en contra (o lo maximo que alcance).

   OJO: a proposito NO toca clientes Comunes con descuadre de moneda que no
   pasaron por esa correccion — hay varios (Ventas local USER, Mathias
   Arenas, VALENTINA FORTTI, del amor al arte, etc.) con diferencias grandes
   sin relacion con este bug, y esos hay que investigarlos aparte antes de
   tocarles nada.

   MODO DE USO:
     1. @Aplicar = 0: muestra, para cada cliente Comun con las dos cuentas
        principales activas y una en contra, el estado actual y la
        propuesta. No escribe nada.
     2. @Aplicar = 1: aplica todas las compensaciones y muestra el saldo
        DESPUES de cada cliente tocado.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;   -- <<< 0 = solo mostrar, 1 = aplicar de verdad
DECLARE @UsuarioAlta INT = 1;
DECLARE @Coti DECIMAL(18,4);

SELECT TOP 1 @Coti = CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC;
IF @Coti IS NULL OR @Coti <= 0
BEGIN
    PRINT 'No hay cotizacion cargada. No se puede convertir, no se hace nada.';
    RETURN;
END

IF OBJECT_ID('tempdb..#Cuentas') IS NOT NULL DROP TABLE #Cuentas;
SELECT cli.CliIdCliente, RTRIM(cli.Nombre) AS Cliente,
       CueUYU = MAX(CASE WHEN cc.MonIdMoneda = 1 THEN cc.CueIdCuenta END),
       CueUSD = MAX(CASE WHEN cc.MonIdMoneda = 2 THEN cc.CueIdCuenta END)
INTO #Cuentas
FROM dbo.Clientes cli WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CliIdCliente = cli.CliIdCliente
WHERE cli.TClIdTipoCliente = 1 AND cc.CueEsPrincipal = 1 AND cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
  AND cli.CliIdCliente IN (
      SELECT DISTINCT cc2.CliIdCliente FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
      WHERE m.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  )
GROUP BY cli.CliIdCliente, cli.Nombre
HAVING COUNT(DISTINCT cc.MonIdMoneda) = 2;   -- solo los que tienen las dos monedas

ALTER TABLE #Cuentas ADD SaldoUYU DECIMAL(18,4), SaldoUSD DECIMAL(18,4),
      MontoUYU DECIMAL(18,4), MontoUSD DECIMAL(18,4), Direccion VARCHAR(20);

UPDATE t SET SaldoUYU = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                WHERE m.CueIdCuenta = t.CueUYU AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
           SaldoUSD = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                WHERE m.CueIdCuenta = t.CueUSD AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM #Cuentas t;

-- Direccion + montos: para cada caso se calculan los DOS, cada uno
-- directamente de SaldoUYU/SaldoUSD/@Coti (nunca uno a partir del otro ya
-- actualizado), tomando siempre el menor entre "lo que falta" y "lo que hay".
UPDATE #Cuentas
SET
    Direccion = CASE
        WHEN SaldoUYU < -0.01 AND SaldoUSD > 0.01 THEN 'USD -> UYU'
        WHEN SaldoUSD < -0.01 AND SaldoUYU > 0.01 THEN 'UYU -> USD'
        ELSE 'nada que compensar' END,
    MontoUYU = CASE
        WHEN SaldoUYU < -0.01 AND SaldoUSD > 0.01 THEN
            CASE WHEN -SaldoUYU <= SaldoUSD * @Coti THEN -SaldoUYU ELSE SaldoUSD * @Coti END
        WHEN SaldoUSD < -0.01 AND SaldoUYU > 0.01 THEN
            CASE WHEN SaldoUYU <= (-SaldoUSD) * @Coti THEN SaldoUYU ELSE (-SaldoUSD) * @Coti END
        ELSE 0 END,
    MontoUSD = CASE
        WHEN SaldoUYU < -0.01 AND SaldoUSD > 0.01 THEN
            CASE WHEN (-SaldoUYU) / @Coti <= SaldoUSD THEN (-SaldoUYU) / @Coti ELSE SaldoUSD END
        WHEN SaldoUSD < -0.01 AND SaldoUYU > 0.01 THEN
            CASE WHEN -SaldoUSD <= SaldoUYU / @Coti THEN -SaldoUSD ELSE SaldoUYU / @Coti END
        ELSE 0 END;

SELECT 'ACTUAL' AS etapa, Cliente, CliIdCliente, CueUYU, SaldoUYU = CAST(SaldoUYU AS DECIMAL(18,2)),
       CueUSD, SaldoUSD = CAST(SaldoUSD AS DECIMAL(18,2))
FROM #Cuentas WHERE Direccion <> 'nada que compensar'
ORDER BY Cliente;

SELECT Propuesta = Direccion, Cliente, MontoUYU = CAST(MontoUYU AS DECIMAL(18,2)), MontoUSD = CAST(MontoUSD AS DECIMAL(18,4))
FROM #Cuentas WHERE Direccion <> 'nada que compensar'
ORDER BY Cliente;

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar la propuesta de arriba. Cotizacion usada: ' + CAST(@Coti AS VARCHAR);
    DROP TABLE #Cuentas;
    RETURN;
END

DECLARE @CliIdCliente INT, @CueUYU INT, @CueUSD INT, @MontoUYU DECIMAL(18,4), @MontoUSD DECIMAL(18,4), @Direccion VARCHAR(20);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT CliIdCliente, CueUYU, CueUSD, MontoUYU, MontoUSD, Direccion FROM #Cuentas WHERE Direccion <> 'nada que compensar';
OPEN cur;
FETCH NEXT FROM cur INTO @CliIdCliente, @CueUYU, @CueUSD, @MontoUYU, @MontoUSD, @Direccion;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @MovId INT, @SaldoRes DECIMAL(18,4), @Concepto NVARCHAR(500), @MontoUYUNeg DECIMAL(18,4), @MontoUSDNeg DECIMAL(18,4);
    BEGIN TRY
        SET @Concepto = N'Compensacion entre monedas del mismo cliente (cotizacion ' + CAST(@Coti AS VARCHAR) + N', revision cobro doble 10-sep-2026)';
        SET @MontoUYUNeg = -@MontoUYU;
        SET @MontoUSDNeg = -@MontoUSD;

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
    END TRY
    BEGIN CATCH
        CLOSE cur; DEALLOCATE cur;
        PRINT 'FALLO en cliente ' + CAST(@CliIdCliente AS VARCHAR) + ': ' + ERROR_MESSAGE();
        PRINT 'Los clientes anteriores a este YA quedaron aplicados (cada uno es su propia transaccion). Revisar y volver a correr solo desde aca si hace falta.';
        THROW;
    END CATCH

    FETCH NEXT FROM cur INTO @CliIdCliente, @CueUYU, @CueUSD, @MontoUYU, @MontoUSD, @Direccion;
END
CLOSE cur; DEALLOCATE cur;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT CueUYU FROM #Cuentas WHERE Direccion <> 'nada que compensar'
                         UNION SELECT CueUSD FROM #Cuentas WHERE Direccion <> 'nada que compensar')
ORDER BY Cliente;

DROP TABLE #Cuentas;
