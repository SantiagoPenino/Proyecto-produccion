-- ============================================================
-- REPARACIÓN: Recargos de urgencia s/rollo que NO se aplicaron
--             por el bug del chequeo de UrgenciaExcepciones
--             (corregido en commit c96647e).
-- Alcance: órdenes URGENTES ingresadas desde el 2026-08-03 que
--          consumieron metros de un plan (ENTREGA en cuenta de
--          recursos) y no tienen su movimiento RECARGO_URGENCIA.
--
-- USO:
--   PASO 1 — Correr solo la sección DETECCIÓN (SELECT, no toca nada)
--            y revisar la lista.
--   PASO 2 — Si la lista está OK, correr la sección APLICAR.
--            Es idempotente: si se corre dos veces no duplica
--            (salta toda orden que ya tenga RECARGO_URGENCIA).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PASO 1: DETECCIÓN (solo lectura)
-- ────────────────────────────────────────────────────────────
SELECT
    o.OrdenID,
    o.CodigoOrden,
    o.FechaIngreso,
    c.CliIdCliente,
    LTRIM(RTRIM(c.Nombre))                    AS Cliente,
    m.MovIdMovimiento                         AS MovEntrega,
    m.MovFecha                                AS FechaConsumo,
    ABS(m.MovImporte)                         AS MetrosConsumidos,
    ROUND(ABS(m.MovImporte) * (CAST((SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave='URGENCIA_DESCUENTO_ROLLO_PORCENTAJE') AS FLOAT) / 100.0), 4)
                                              AS RecargoAAplicar,
    m.MovObservaciones
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c        ON c.CliIdCliente = cc.CliIdCliente
JOIN dbo.Ordenes o         ON o.OrdenID = m.OrdIdOrden
WHERE m.MovTipo = 'ENTREGA'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND cc.CueTipo NOT IN ('USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU')
  AND o.Prioridad = 'Urgente'
  AND o.FechaIngreso >= '2026-08-03'
  -- Sin recargo ya registrado para la orden
  AND NOT EXISTS (
      SELECT 1 FROM dbo.MovimientosCuenta r
      WHERE r.OrdIdOrden = m.OrdIdOrden
        AND r.MovTipo = 'RECARGO_URGENCIA'
        AND (r.MovAnulado IS NULL OR r.MovAnulado = 0)
  )
  -- Respetar la lista de exclusión (modo TODOS)
  AND NOT EXISTS (
      SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones e
      WHERE e.CliIdCliente = c.CliIdCliente AND e.Activo = 1
  )
ORDER BY o.FechaIngreso, o.OrdenID;
GO

-- ────────────────────────────────────────────────────────────
-- PASO 2: APLICAR (descomentar el bloque para ejecutar)
--         Por cada ENTREGA detectada: registra el movimiento
--         RECARGO_URGENCIA vía SP_RegistrarMovimiento (actualiza
--         CueSaldoActual) y suma los metros a PlaCantidadUsada
--         del plan referenciado en la ENTREGA.
-- ────────────────────────────────────────────────────────────
/*
SET NOCOUNT ON;
DECLARE @Pct FLOAT = CAST((SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave='URGENCIA_DESCUENTO_ROLLO_PORCENTAJE') AS FLOAT);
IF (@Pct IS NULL OR @Pct <= 0 OR @Pct > 100) SET @Pct = 25;

DECLARE @MovId INT, @Cue INT, @Ord INT, @Metros DECIMAL(18,4), @Obs NVARCHAR(500), @Codigo VARCHAR(50);
DECLARE @Recargo DECIMAL(18,4), @ImpNeg DECIMAL(18,4), @PlaId INT, @PosPlan INT, @NumStr VARCHAR(20);
DECLARE @Concepto NVARCHAR(300), @ObsNueva NVARCHAR(500);
DECLARE @MovGen INT, @SaldoRes DECIMAL(18,4);

DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT m.MovIdMovimiento, m.CueIdCuenta, m.OrdIdOrden, ABS(m.MovImporte), m.MovObservaciones, o.CodigoOrden
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    JOIN dbo.Ordenes o         ON o.OrdenID = m.OrdIdOrden
    WHERE m.MovTipo = 'ENTREGA'
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND cc.CueTipo NOT IN ('USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU')
      AND o.Prioridad = 'Urgente'
      AND o.FechaIngreso >= '2026-08-03'
      AND NOT EXISTS (
          SELECT 1 FROM dbo.MovimientosCuenta r
          WHERE r.OrdIdOrden = m.OrdIdOrden AND r.MovTipo = 'RECARGO_URGENCIA'
            AND (r.MovAnulado IS NULL OR r.MovAnulado = 0))
      AND NOT EXISTS (
          SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones e
          WHERE e.CliIdCliente = cc.CliIdCliente AND e.Activo = 1);

OPEN cur;
FETCH NEXT FROM cur INTO @MovId, @Cue, @Ord, @Metros, @Obs, @Codigo;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Recargo = ROUND(@Metros * (@Pct / 100.0), 4);
    SET @ImpNeg  = -@Recargo;  -- consumo: importe NEGATIVO, igual que el service

    -- Plan referenciado en la ENTREGA ('Plan #123' / 'Exceso s/ Plan #123' / '... — Plan #123')
    SET @PlaId = NULL;
    SET @PosPlan = PATINDEX('%Plan #%', ISNULL(@Obs, ''));
    IF @PosPlan > 0
    BEGIN
        SET @NumStr = SUBSTRING(@Obs, @PosPlan + 6, 20);
        IF PATINDEX('%[^0-9]%', @NumStr) > 0 SET @NumStr = LEFT(@NumStr, PATINDEX('%[^0-9]%', @NumStr) - 1);
        IF LEN(@NumStr) > 0 SET @PlaId = CAST(@NumStr AS INT);
    END

    -- Mismos textos que genera urgenciaDescuentoRolloService.js
    SET @Concepto = CONCAT('Recargo urgencia ', CAST(@Pct AS INT), '% — ', @Codigo);
    SET @ObsNueva = CONCAT('Recargo de ', CAST(@Pct AS INT), '% en metros por urgencia no cobrada en $ (Plan #',
                           ISNULL(CAST(@PlaId AS VARCHAR), 's/d'), ') — ', @Codigo, ' [reparación retroactiva]');

    -- Movimiento visible en el estado de cuenta (SP actualiza CueSaldoActual)
    EXEC dbo.SP_RegistrarMovimiento
        @CueIdCuenta      = @Cue,
        @MovTipo          = 'RECARGO_URGENCIA',
        @MovConcepto      = @Concepto,
        @MovImporte       = @ImpNeg,
        @MovUsuarioAlta   = 1,
        @OrdIdOrden       = @Ord,
        @OReIdOrdenRetiro = NULL,
        @PagIdPago        = NULL,
        @DocIdDocumento   = NULL,
        @MovRefExterna    = NULL,
        @MovObservaciones = @ObsNueva,
        @CicIdCiclo       = NULL,
        @MovIdGenerado    = @MovGen OUTPUT,
        @SaldoResultante  = @SaldoRes OUTPUT;

    -- Consumir los metros extra del plan
    IF @PlaId IS NOT NULL
        UPDATE dbo.PlanesMetros
        SET PlaCantidadUsada = PlaCantidadUsada + @Recargo,
            PlaActivo = CASE WHEN PlaCantidadUsada + @Recargo >= PlaCantidadTotal THEN 0 ELSE 1 END
        WHERE PlaIdPlan = @PlaId;

    PRINT CONCAT('Orden ', @Codigo, ' (#', @Ord, '): recargo ', @Recargo, ' mts aplicado (Mov ', @MovGen, ', Plan #', ISNULL(CAST(@PlaId AS VARCHAR), 's/d'), ')');

    FETCH NEXT FROM cur INTO @MovId, @Cue, @Ord, @Metros, @Obs, @Codigo;
END
CLOSE cur; DEALLOCATE cur;
PRINT 'Reparación completada.';
*/
GO
