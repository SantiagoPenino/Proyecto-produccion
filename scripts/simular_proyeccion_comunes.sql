/* ============================================================================
   simular_proyeccion_comunes.sql          SIMULACION — al final SIEMPRE
                                            deshace todo con ROLLBACK
   ----------------------------------------------------------------------------
   Responde "en cuanto quedan los clientes Comunes despues del arreglo" SIN
   arriesgar un calculo hecho a mano aparte: corre el MISMO codigo ya
   probado de fix_cobro_doble_fantasma_comunes.sql y despues
   fix_compensar_moneda_comunes.sql, uno atras del otro, DE VERDAD (llama al
   mismo SP_RegistrarMovimiento que usa la app) — pero todo adentro de una
   sola transaccion que al final siempre hace ROLLBACK, pase lo que pase.
   No se guarda nada. Es la forma confiable de previsualizar el resultado
   final sin duplicar la logica en una formula aparte que podria tener otro
   error.

   Corre rapido (VARIOS clientes, cada movimiento es una fila chica): la
   transaccion queda abierta solo mientras dura el script, no es la misma
   situacion del incidente del 7-sep (ahi quedo UNA transaccion trabada
   HORAS por una anulacion que no terminaba). Igual, si por algun motivo
   tarda mas de unos segundos o la conexion se corta a mitad de camino,
   SSMS puede dejar la transaccion abierta hasta que se cierre la pestaña:
   si eso pasa, cerrar la pestaña de SSMS alcanza para que se deshaga sola.

   No hace falta ningun parametro: SIEMPRE simula, nunca aplica de verdad.
   Para aplicar de verdad hay que correr los 2 scripts reales, cada uno con
   @Aplicar = 1.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @UsuarioAlta INT = 1;
DECLARE @Coti DECIMAL(18,4);
SELECT TOP 1 @Coti = CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC;

BEGIN TRAN;

-- ══ PASO 1 (simulado): corregir cobro doble en todos los Comun ═══════════
IF OBJECT_ID('tempdb..#Propuesta') IS NOT NULL DROP TABLE #Propuesta;

;WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta, Importe = SUM(p.MovImporte) FROM dbo.MovimientosCuenta p WITH(NOLOCK)
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0 AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND p.PagIdPago IS NULL AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta, Importe = SUM(d.MovImporte) FROM dbo.MovimientosCuenta d WITH(NOLOCK)
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0 AND d.DocIdDocumento IS NOT NULL
      AND d.PagIdPago IS NOT NULL AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
)
SELECT
    od.OrdIdOrden, od.DocIdDocumento, CuentaDestino = od.CueIdCuenta, cc.CliIdCliente,
    Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
    Duplicado = CASE WHEN SUM(po.Importe) <= MAX(pd.Importe) THEN SUM(po.Importe) ELSE MAX(pd.Importe) END
INTO   #Propuesta
FROM OrdDoc od
JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = od.CueIdCuenta
JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
  AND cli.TClIdTipoCliente = 1
  -- no volver a proponer una orden que YA se corrigio antes (el movimiento
  -- original de cobertura queda en la base tal cual, solo se le agrega un
  -- ajuste al lado; sin este filtro se re-detectaria para siempre)
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta yac WITH(NOLOCK)
                  WHERE yac.OrdIdOrden = od.OrdIdOrden
                    AND yac.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
                    AND (yac.MovAnulado IS NULL OR yac.MovAnulado = 0))
GROUP BY od.OrdIdOrden, od.DocIdDocumento, od.CueIdCuenta, cc.CliIdCliente, dc.DocSerie, dc.DocNumero
HAVING SUM(po.Importe) + MAX(pd.Importe) > MAX(dc.DocTotal) + 1;

ALTER TABLE #Propuesta ADD CuentaFuente INT NULL, FuenteImporte DECIMAL(18,4) NULL;
UPDATE p SET CuentaFuente = f.CueIdCuenta, FuenteImporte = ABS(f.MovImporte)
FROM #Propuesta p
CROSS APPLY (
    SELECT TOP 1 m.CueIdCuenta, m.MovImporte FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.OrdIdOrden = p.OrdIdOrden AND m.MovTipo = 'PAGO_CRUZADO' AND m.MovImporte < 0
      AND cc.CliIdCliente = p.CliIdCliente AND m.CueIdCuenta <> p.CuentaDestino
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) f;

DECLARE @OrdIdOrden INT, @Doc VARCHAR(30), @CuentaDestino INT, @Duplicado DECIMAL(18,4),
        @CuentaFuente INT, @FuenteImporte DECIMAL(18,4), @MovId INT, @SaldoRes DECIMAL(18,4),
        @Concepto NVARCHAR(500), @DuplicadoNeg DECIMAL(18,4);

DECLARE cur1 CURSOR LOCAL FAST_FORWARD FOR
    SELECT OrdIdOrden, Doc, CuentaDestino, Duplicado, CuentaFuente, FuenteImporte FROM #Propuesta;
OPEN cur1;
FETCH NEXT FROM cur1 INTO @OrdIdOrden, @Doc, @CuentaDestino, @Duplicado, @CuentaFuente, @FuenteImporte;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Concepto = N'[SIMULACION] orden ' + CAST(@OrdIdOrden AS VARCHAR);
    SET @DuplicadoNeg = -@Duplicado;
    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CuentaDestino, @MovTipo='AJUSTE_NEG', @MovConcepto=@Concepto,
         @MovImporte=@DuplicadoNeg, @MovUsuarioAlta=@UsuarioAlta, @OrdIdOrden=@OrdIdOrden,
         @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
    IF @CuentaFuente IS NOT NULL AND @FuenteImporte > 0.01
        EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CuentaFuente, @MovTipo='AJUSTE_POS', @MovConcepto=@Concepto,
             @MovImporte=@FuenteImporte, @MovUsuarioAlta=@UsuarioAlta, @OrdIdOrden=@OrdIdOrden,
             @MovIdGenerado=@MovId OUTPUT, @SaldoResultante=@SaldoRes OUTPUT;
    FETCH NEXT FROM cur1 INTO @OrdIdOrden, @Doc, @CuentaDestino, @Duplicado, @CuentaFuente, @FuenteImporte;
END
CLOSE cur1; DEALLOCATE cur1;

-- ══ PASO 2 (simulado): compensar monedas de los clientes recien tocados ══
IF OBJECT_ID('tempdb..#Cuentas') IS NOT NULL DROP TABLE #Cuentas;
SELECT cli.CliIdCliente, CueUYU = MAX(CASE WHEN cc.MonIdMoneda=1 THEN cc.CueIdCuenta END),
       CueUSD = MAX(CASE WHEN cc.MonIdMoneda=2 THEN cc.CueIdCuenta END)
INTO #Cuentas
FROM dbo.Clientes cli WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CliIdCliente = cli.CliIdCliente
WHERE cli.TClIdTipoCliente = 1 AND cc.CueEsPrincipal = 1 AND cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
  AND cli.CliIdCliente IN (SELECT DISTINCT CliIdCliente FROM #Propuesta)
GROUP BY cli.CliIdCliente
HAVING COUNT(DISTINCT cc.MonIdMoneda) = 2;

ALTER TABLE #Cuentas ADD SaldoUYU DECIMAL(18,4), SaldoUSD DECIMAL(18,4),
      MontoUYU DECIMAL(18,4), MontoUSD DECIMAL(18,4), Direccion VARCHAR(20);

UPDATE t SET SaldoUYU = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                WHERE m.CueIdCuenta = t.CueUYU AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
           SaldoUSD = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                WHERE m.CueIdCuenta = t.CueUSD AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM #Cuentas t;

UPDATE #Cuentas
SET Direccion = CASE
        WHEN SaldoUYU < -0.01 AND SaldoUSD > 0.01 AND @Coti > 0 THEN 'USD -> UYU'
        WHEN SaldoUSD < -0.01 AND SaldoUYU > 0.01 AND @Coti > 0 THEN 'UYU -> USD'
        ELSE 'nada' END,
    MontoUYU = CASE
        WHEN SaldoUYU < -0.01 AND SaldoUSD > 0.01 AND @Coti > 0 THEN CASE WHEN -SaldoUYU <= SaldoUSD*@Coti THEN -SaldoUYU ELSE SaldoUSD*@Coti END
        WHEN SaldoUSD < -0.01 AND SaldoUYU > 0.01 AND @Coti > 0 THEN CASE WHEN SaldoUYU <= (-SaldoUSD)*@Coti THEN SaldoUYU ELSE (-SaldoUSD)*@Coti END
        ELSE 0 END,
    MontoUSD = CASE
        WHEN SaldoUYU < -0.01 AND SaldoUSD > 0.01 AND @Coti > 0 THEN CASE WHEN (-SaldoUYU)/@Coti <= SaldoUSD THEN (-SaldoUYU)/@Coti ELSE SaldoUSD END
        WHEN SaldoUSD < -0.01 AND SaldoUYU > 0.01 AND @Coti > 0 THEN CASE WHEN -SaldoUSD <= SaldoUYU/@Coti THEN -SaldoUSD ELSE SaldoUYU/@Coti END
        ELSE 0 END;

DECLARE @CliIdCliente INT, @CueUYU INT, @CueUSD INT, @MontoUYU DECIMAL(18,4), @MontoUSD DECIMAL(18,4),
        @Direccion VARCHAR(20), @MontoUYUNeg DECIMAL(18,4), @MontoUSDNeg DECIMAL(18,4);
DECLARE cur2 CURSOR LOCAL FAST_FORWARD FOR
    SELECT CliIdCliente, CueUYU, CueUSD, MontoUYU, MontoUSD, Direccion FROM #Cuentas WHERE Direccion <> 'nada';
OPEN cur2;
FETCH NEXT FROM cur2 INTO @CliIdCliente, @CueUYU, @CueUSD, @MontoUYU, @MontoUSD, @Direccion;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Concepto = N'[SIMULACION] compensacion cliente ' + CAST(@CliIdCliente AS VARCHAR);
    SET @MontoUYUNeg = -@MontoUYU; SET @MontoUSDNeg = -@MontoUSD;
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
    FETCH NEXT FROM cur2 INTO @CliIdCliente, @CueUYU, @CueUSD, @MontoUYU, @MontoUSD, @Direccion;
END
CLOSE cur2; DEALLOCATE cur2;

-- ══ Resultado proyectado (todavia adentro de la transaccion) ══════════════
SELECT 'PROYECCION FINAL (nada de esto se guarda)' AS aviso;

SELECT RTRIM(cli.Nombre) AS Cliente, cli.CliIdCliente, cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoProyectado = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                          WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                            AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CliIdCliente IN (SELECT DISTINCT CliIdCliente FROM #Propuesta)
  AND cc.CueEsPrincipal = 1 AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cli.Nombre, Moneda;

DROP TABLE #Propuesta;
DROP TABLE #Cuentas;

-- ══ SIEMPRE deshacer: esto es solo una previsualizacion ═══════════════════
ROLLBACK TRAN;
PRINT 'ROLLBACK hecho. No se guardo nada, esto fue solo una simulacion.';
