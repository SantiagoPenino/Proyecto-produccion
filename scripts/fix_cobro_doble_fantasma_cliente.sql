/* ============================================================================
   fix_cobro_doble_fantasma_cliente.sql
   ----------------------------------------------------------------------------
   Corrige, para UN cliente puntual, el saldo a favor fantasma que deja el
   bug de "cobro doble" (billetera+caja): la cobertura interna (PAGO_CRUZADO,
   concepto "Cobertura desde..."/"Cruce automático", sin PagIdPago = nunca fue
   plata real) que además tuvo un pago real de caja (con PagIdPago) por el
   mismo trabajo.

   SOLO corrige los pares donde se confirma el doble cobro real (misma
   lógica que el panel /admin/cron "Cobro doble"). No toca ninguna otra cosa
   de la cuenta: notas de crédito, pagos sin pareja, deuda viva, etc. quedan
   intactos.

   Por cada par confirmado:
     - Revierte la cobertura fantasma en la cuenta que la recibió
       (AJUSTE_NEG, mismo importe).
     - Si esa cobertura vino de un cruce desde OTRA cuenta del mismo cliente
       (distinta moneda), también le devuelve a esa cuenta lo que le sacaron
       de más (AJUSTE_POS), porque esa plata tampoco era necesaria.

   MODO DE USO:
     1. Dejar @Aplicar = 0 y correr. Muestra la propuesta (qué movimientos
        haría) SIN escribir nada. Revisarla.
     2. Si la propuesta es correcta, cambiar @Aplicar = 1 y correr de nuevo.
        Ahí sí escribe los AJUSTE_NEG/AJUSTE_POS vía el mismo SP que usa la
        app (dbo.SP_RegistrarMovimiento), y muestra el saldo ANTES/DESPUÉS
        de cada cuenta tocada.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CliIdCliente INT = 795;      -- <<< editar por cliente
DECLARE @Aplicar      BIT = 0;        -- <<< 0 = solo mostrar, 1 = aplicar de verdad
DECLARE @UsuarioAlta  INT = 1;        -- <<< usuario que queda como autor del ajuste

IF OBJECT_ID('tempdb..#Propuesta') IS NOT NULL DROP TABLE #Propuesta;

;WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = o.CueIdCuenta
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
      AND cc.CliIdCliente = @CliIdCliente
), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta, Importe = SUM(p.MovImporte) FROM dbo.MovimientosCuenta p WITH(NOLOCK)
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0 AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND p.PagIdPago IS NULL    -- sin PagIdPago = nunca fue plata real de caja, es la cobertura interna
      AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta, Importe = SUM(d.MovImporte) FROM dbo.MovimientosCuenta d WITH(NOLOCK)
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0 AND d.DocIdDocumento IS NOT NULL
      AND d.PagIdPago IS NOT NULL   -- con PagIdPago = pago real de caja
      AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
)
SELECT
    od.OrdIdOrden, od.DocIdDocumento, CuentaDestino = od.CueIdCuenta,
    Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
    PagoOrdenImp = SUM(po.Importe), PagoDocImp = MAX(pd.Importe),
    Duplicado = CASE WHEN SUM(po.Importe) <= MAX(pd.Importe) THEN SUM(po.Importe) ELSE MAX(pd.Importe) END
INTO   #Propuesta
FROM OrdDoc od
JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
  -- no volver a proponer una orden que YA se corrigio antes (el movimiento
  -- original de cobertura queda en la base tal cual, solo se le agrega un
  -- ajuste al lado; sin este filtro se re-detectaria para siempre)
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta yac WITH(NOLOCK)
                  WHERE yac.OrdIdOrden = od.OrdIdOrden
                    AND yac.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
                    AND (yac.MovAnulado IS NULL OR yac.MovAnulado = 0))
GROUP BY od.OrdIdOrden, od.DocIdDocumento, od.CueIdCuenta, dc.DocSerie, dc.DocNumero;

-- Buscar, para cada duplicado, si la cobertura vino de un cruce desde OTRA
-- cuenta del mismo cliente (para devolverle también lo que le sacaron).
ALTER TABLE #Propuesta ADD CuentaFuente INT NULL, FuenteImporte DECIMAL(18,4) NULL;

UPDATE p
SET    CuentaFuente = f.CueIdCuenta, FuenteImporte = ABS(f.MovImporte)
FROM   #Propuesta p
CROSS APPLY (
    SELECT TOP 1 m.CueIdCuenta, m.MovImporte
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.OrdIdOrden = p.OrdIdOrden AND m.MovTipo = 'PAGO_CRUZADO' AND m.MovImporte < 0
      AND cc.CliIdCliente = @CliIdCliente AND m.CueIdCuenta <> p.CuentaDestino
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) f;

-- ── Propuesta (siempre se muestra, se aplique o no) ────────────────────────
SELECT
    p.OrdIdOrden, p.Doc, CuentaDestino = p.CuentaDestino,
    MonedaDestino = CASE WHEN ccD.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    RevierteEnDestino = CAST(-p.Duplicado AS DECIMAL(18,2)),
    CuentaFuente = p.CuentaFuente,
    MonedaFuente = CASE WHEN ccF.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    DevuelveEnFuente = CAST(ISNULL(p.FuenteImporte,0) AS DECIMAL(18,2))
FROM #Propuesta p
JOIN dbo.CuentasCliente ccD WITH(NOLOCK) ON ccD.CueIdCuenta = p.CuentaDestino
LEFT JOIN dbo.CuentasCliente ccF WITH(NOLOCK) ON ccF.CueIdCuenta = p.CuentaFuente
ORDER BY p.OrdIdOrden;

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar la propuesta de arriba.';
    DROP TABLE #Propuesta;
    RETURN;
END

-- ── Saldo de las cuentas afectadas, ANTES de aplicar ───────────────────────
SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT CuentaDestino FROM #Propuesta UNION SELECT CuentaFuente FROM #Propuesta WHERE CuentaFuente IS NOT NULL);

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

    FETCH NEXT FROM cur INTO @OrdIdOrden, @Doc, @CuentaDestino, @Duplicado, @CuentaFuente, @FuenteImporte;
END
CLOSE cur; DEALLOCATE cur;

-- ── Saldo de las cuentas afectadas, DESPUÉS de aplicar ─────────────────────
SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT CuentaDestino FROM #Propuesta UNION SELECT CuentaFuente FROM #Propuesta WHERE CuentaFuente IS NOT NULL);

DROP TABLE #Propuesta;
