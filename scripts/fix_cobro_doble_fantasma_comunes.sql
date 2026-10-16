/* ============================================================================
   fix_cobro_doble_fantasma_comunes.sql
   ----------------------------------------------------------------------------
   Igual que fix_cobro_doble_fantasma_cliente.sql, pero para TODOS los
   clientes Comunes de una sola vez (no toca Semanal/Rollo/Deudor: esos
   pueden tener deuda legitima y hay que mirarlos uno por uno aparte).

   SOLO corrige los pares donde se confirma el doble cobro real: la
   cobertura interna (sin PagIdPago) + el pago real (con PagIdPago) juntos
   superan el total del documento. Por cada par:
     - Revierte la cobertura fantasma en la cuenta que la recibio (AJUSTE_NEG).
     - Si vino de un cruce desde otra cuenta del mismo cliente (otra
       moneda), le devuelve a esa cuenta lo que le sacaron de mas (AJUSTE_POS).

   MODO DE USO:
     1. Dejar @Aplicar = 0 y correr. Muestra la propuesta COMPLETA (todos
        los clientes, todos los casos) sin escribir nada. Revisarla.
     2. Si esta bien, @Aplicar = 1 y correr de nuevo: aplica todo via el
        mismo SP que usa la app, y muestra el saldo ANTES/DESPUES de cada
        cuenta tocada.

   Despues de correr esto, cada cliente puede quedar con una moneda a favor
   y otra en contra (normal, se compensan aparte con
   fix_compensar_moneda_cliente.sql) — o con algun resto sin relacion con
   este bug (como paso con Iqui/ET-3523): eso NO se toca automaticamente,
   se revisa caso por caso.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;   -- <<< 0 = solo mostrar, 1 = aplicar de verdad
DECLARE @UsuarioAlta INT = 1;   -- <<< usuario que queda como autor del ajuste

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
    PagoOrdenImp = SUM(po.Importe), PagoDocImp = MAX(pd.Importe),
    Duplicado = CASE WHEN SUM(po.Importe) <= MAX(pd.Importe) THEN SUM(po.Importe) ELSE MAX(pd.Importe) END
INTO   #Propuesta
FROM OrdDoc od
JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = od.CueIdCuenta
JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
  AND cli.TClIdTipoCliente = 1   -- SOLO Comunes
  -- no volver a proponer una orden que YA se corrigio antes (el movimiento
  -- original de cobertura queda en la base tal cual, solo se le agrega un
  -- ajuste al lado; sin este filtro se re-detectaria para siempre)
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta yac WITH(NOLOCK)
                  WHERE yac.OrdIdOrden = od.OrdIdOrden
                    AND yac.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
                    AND (yac.MovAnulado IS NULL OR yac.MovAnulado = 0))
GROUP BY od.OrdIdOrden, od.DocIdDocumento, od.CueIdCuenta, cc.CliIdCliente, dc.DocSerie, dc.DocNumero
HAVING SUM(po.Importe) + MAX(pd.Importe) > MAX(dc.DocTotal) + 1;   -- solo los que de verdad se pasan del total

ALTER TABLE #Propuesta ADD CuentaFuente INT NULL, FuenteImporte DECIMAL(18,4) NULL;

UPDATE p
SET    CuentaFuente = f.CueIdCuenta, FuenteImporte = ABS(f.MovImporte)
FROM   #Propuesta p
CROSS APPLY (
    SELECT TOP 1 m.CueIdCuenta, m.MovImporte
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.OrdIdOrden = p.OrdIdOrden AND m.MovTipo = 'PAGO_CRUZADO' AND m.MovImporte < 0
      AND cc.CliIdCliente = p.CliIdCliente AND m.CueIdCuenta <> p.CuentaDestino
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) f;

-- ── Propuesta completa (siempre se muestra) ────────────────────────────────
SELECT
    RTRIM(cli.Nombre) AS Cliente, p.CliIdCliente, p.OrdIdOrden, p.Doc,
    CuentaDestino = p.CuentaDestino, MonedaDestino = CASE WHEN ccD.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    RevierteEnDestino = CAST(-p.Duplicado AS DECIMAL(18,2)),
    CuentaFuente = p.CuentaFuente, MonedaFuente = CASE WHEN ccF.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    DevuelveEnFuente = CAST(ISNULL(p.FuenteImporte,0) AS DECIMAL(18,2))
FROM #Propuesta p
JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = p.CliIdCliente
JOIN dbo.CuentasCliente ccD WITH(NOLOCK) ON ccD.CueIdCuenta = p.CuentaDestino
LEFT JOIN dbo.CuentasCliente ccF WITH(NOLOCK) ON ccF.CueIdCuenta = p.CuentaFuente
ORDER BY p.Duplicado DESC;

-- ── Totales por moneda, para chequear contra el resumen ────────────────────
SELECT MonedaDestino = CASE WHEN ccD.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       Clientes = COUNT(DISTINCT p.CliIdCliente), Casos = COUNT(*), Total = CAST(SUM(p.Duplicado) AS DECIMAL(18,2))
FROM #Propuesta p JOIN dbo.CuentasCliente ccD WITH(NOLOCK) ON ccD.CueIdCuenta = p.CuentaDestino
GROUP BY ccD.MonIdMoneda;

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar la propuesta de arriba.';
    DROP TABLE #Propuesta;
    RETURN;
END

-- ── Aplicar: un AJUSTE por fila, vía el mismo SP que usa la app ────────────
DECLARE @OrdIdOrden INT, @Doc VARCHAR(30), @CuentaDestino INT, @Duplicado DECIMAL(18,4),
        @CuentaFuente INT, @FuenteImporte DECIMAL(18,4);

DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT OrdIdOrden, Doc, CuentaDestino, Duplicado, CuentaFuente, FuenteImporte FROM #Propuesta;
OPEN cur;
FETCH NEXT FROM cur INTO @OrdIdOrden, @Doc, @CuentaDestino, @Duplicado, @CuentaFuente, @FuenteImporte;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @MovId INT, @SaldoRes DECIMAL(18,4), @ConceptoDestino NVARCHAR(500), @ConceptoFuente NVARCHAR(500), @DuplicadoNeg DECIMAL(18,4);
    BEGIN TRY
        SET @ConceptoDestino = N'Correccion cobro doble billetera+caja - orden ' + CAST(@OrdIdOrden AS VARCHAR) + N', doc ' + @Doc + N' (revision 10-sep-2026)';
        SET @DuplicadoNeg = -@Duplicado;
        EXEC dbo.SP_RegistrarMovimiento
             @CueIdCuenta = @CuentaDestino, @MovTipo = 'AJUSTE_NEG',
             @MovConcepto = @ConceptoDestino,
             @MovImporte = @DuplicadoNeg, @MovUsuarioAlta = @UsuarioAlta, @OrdIdOrden = @OrdIdOrden,
             @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;

        IF @CuentaFuente IS NOT NULL AND @FuenteImporte > 0.01
        BEGIN
            SET @ConceptoFuente = N'Correccion cobro doble billetera+caja - devuelve cruce de la orden ' + CAST(@OrdIdOrden AS VARCHAR) + N' (revision 10-sep-2026)';
            EXEC dbo.SP_RegistrarMovimiento
                 @CueIdCuenta = @CuentaFuente, @MovTipo = 'AJUSTE_POS',
                 @MovConcepto = @ConceptoFuente,
                 @MovImporte = @FuenteImporte, @MovUsuarioAlta = @UsuarioAlta, @OrdIdOrden = @OrdIdOrden,
                 @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;
        END
    END TRY
    BEGIN CATCH
        -- Si algo falla a mitad del lote: cerrar el cursor prolijo (SP_RegistrarMovimiento
        -- ya hizo su propio ROLLBACK internamente, no queda ninguna transaccion abierta)
        -- y avisar en que fila quedo, en vez de cortar sin decir nada.
        CLOSE cur; DEALLOCATE cur;
        PRINT 'FALLO en orden ' + CAST(@OrdIdOrden AS VARCHAR) + ' (' + @Doc + '): ' + ERROR_MESSAGE();
        PRINT 'Las filas anteriores a esta YA quedaron aplicadas (cada una es su propia transaccion). Revisar y volver a correr solo desde aca si hace falta.';
        THROW;
    END CATCH

    FETCH NEXT FROM cur INTO @OrdIdOrden, @Doc, @CuentaDestino, @Duplicado, @CuentaFuente, @FuenteImporte;
END
CLOSE cur; DEALLOCATE cur;

-- ── Saldo de todas las cuentas tocadas, DESPUÉS de aplicar ─────────────────
SELECT 'DESPUES' AS etapa, RTRIM(cli.Nombre) AS Cliente, cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT CuentaDestino FROM #Propuesta UNION SELECT CuentaFuente FROM #Propuesta WHERE CuentaFuente IS NOT NULL)
ORDER BY cli.Nombre;

DROP TABLE #Propuesta;
