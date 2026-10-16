/*
  Fix histórico GENERAL: traspaso de excedente entre planes de recursos cerrados
  (PlanesMetros) y el plan activo actual, para TODOS los clientes afectados.

  Mismo bug que el fix puntual de Posse Gutierrez Santiago (Plan #60 → #82):
  PlaCantidadUsada nunca puede superar PlaCantidadTotal (capado en el código),
  así que cuando un cliente consumía más de lo que le quedaba en un plan, el
  excedente se registraba SOLO como movimiento negativo en MovimientosCuenta
  ("Exceso s/ Plan #X" / "Negativo retroactivo ... Plan #X"), sin reflejarse
  nunca en PlanesMetros de ningún plan (ni el viejo, capado en 100%, ni el
  nuevo, que arranca en PlaCantidadUsada = 0).

  El código ya está corregido (crearPlan en contabilidadController.js) para que
  los planes creados DE ACÁ EN ADELANTE hereden automáticamente el excedente
  pendiente al momento de crearse. Este script corrige el HISTÓRICO: los planes
  que ya estaban activos antes del fix y nunca heredaron el excedente que les
  correspondía.

  No modifica CueSaldoActual (cuenta corriente de metros) — ya está correcta.

  Cómo usar:
    1) Correr el PASO 1 (solo SELECT) y revisar la lista de clientes/montos
       antes de tocar nada.
    2) Si todo se ve razonable, correr el PASO 2 (dentro de una transacción).
       Revisa el resultado y recién ahí hacé COMMIT o ROLLBACK.
*/

-- ============================================================
-- PASO 1 — Detección (solo lectura, correr primero)
-- ============================================================

-- 1a) Excedente sin absorber, agrupado por cliente + producto
;WITH ExcesoPorCuenta AS (
    SELECT
        cc.CliIdCliente,
        cc.ProIdProducto,
        SUM(ABS(mc.MovImporte)) AS ExcedenteTotal,
        COUNT(*)                AS CantMovimientos,
        MIN(mc.MovFecha)        AS PrimerMovimiento,
        MAX(mc.MovFecha)        AS UltimoMovimiento
    FROM dbo.MovimientosCuenta mc WITH (NOLOCK)
    JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
    WHERE mc.MovImporte < 0
      AND (
            mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
         OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
          )
      AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%'
    GROUP BY cc.CliIdCliente, cc.ProIdProducto
)
SELECT
    e.CliIdCliente,
    RTRIM(LTRIM(c.Nombre)) AS Cliente,
    e.ProIdProducto,
    art.Descripcion        AS Producto,
    e.ExcedenteTotal,
    e.CantMovimientos,
    e.PrimerMovimiento,
    e.UltimoMovimiento,
    plan_activo.PlaIdPlan       AS PlanActivoDestino,
    plan_activo.PlaCantidadTotal,
    plan_activo.PlaCantidadUsada AS PlaCantidadUsadaActual,
    CASE WHEN plan_activo.PlaIdPlan IS NULL THEN 'SIN PLAN ACTIVO — revisar manualmente' ELSE 'OK' END AS Estado
FROM ExcesoPorCuenta e
JOIN dbo.Clientes  c   WITH (NOLOCK) ON c.CliIdCliente = e.CliIdCliente
LEFT JOIN dbo.Articulos art WITH (NOLOCK) ON art.ProIdProducto = e.ProIdProducto
OUTER APPLY (
    SELECT TOP 1 pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada
    FROM dbo.PlanesMetros pm WITH (NOLOCK)
    WHERE pm.CliIdCliente = e.CliIdCliente
      AND pm.ProIdProducto = e.ProIdProducto
      AND pm.PlaActivo = 1
    ORDER BY pm.PlaFechaAlta ASC
) plan_activo
ORDER BY e.ExcedenteTotal DESC;

-- 1b) Detalle de movimientos (para auditoría fila por fila si hace falta)
SELECT
    mc.MovIdMovimiento, cc.CliIdCliente, cc.ProIdProducto,
    mc.MovImporte, mc.MovConcepto, mc.MovObservaciones, mc.MovFecha
FROM dbo.MovimientosCuenta mc WITH (NOLOCK)
JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
WHERE mc.MovImporte < 0
  AND (
        mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
     OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
      )
  AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%'
ORDER BY cc.CliIdCliente, mc.MovFecha;


-- ============================================================
-- PASO 2 — Aplicar el traspaso a TODOS los clientes detectados
--          (correr solo después de validar el PASO 1)
-- ============================================================
BEGIN TRAN;

DECLARE @CliIdCliente  INT, @ProIdProducto INT;
DECLARE @Exceso        DECIMAL(18,4);
DECLARE @PlanId        INT, @Total DECIMAL(18,4), @UsadaActual DECIMAL(18,4), @UsadaNva DECIMAL(18,4);

DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT cc.CliIdCliente, cc.ProIdProducto
    FROM dbo.MovimientosCuenta mc WITH (NOLOCK)
    JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
    WHERE mc.MovImporte < 0
      AND (
            mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
         OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
          )
      AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%'
    GROUP BY cc.CliIdCliente, cc.ProIdProducto;

OPEN cur;
FETCH NEXT FROM cur INTO @CliIdCliente, @ProIdProducto;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- Excedente sin absorber para este cliente+producto
    SELECT @Exceso = ISNULL(SUM(ABS(mc.MovImporte)), 0)
    FROM dbo.MovimientosCuenta mc WITH (UPDLOCK)
    JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
    WHERE cc.CliIdCliente = @CliIdCliente
      AND cc.ProIdProducto = @ProIdProducto
      AND mc.MovImporte < 0
      AND (
            mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
         OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
          )
      AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%';

    -- Plan activo destino (mismo criterio que usa el código: el activo más antiguo)
    SELECT TOP 1 @PlanId = PlaIdPlan, @Total = PlaCantidadTotal, @UsadaActual = PlaCantidadUsada
    FROM dbo.PlanesMetros WITH (UPDLOCK)
    WHERE CliIdCliente = @CliIdCliente AND ProIdProducto = @ProIdProducto AND PlaActivo = 1
    ORDER BY PlaFechaAlta ASC;

    IF @PlanId IS NOT NULL AND @Exceso > 0
    BEGIN
        SET @UsadaNva = CASE WHEN (@UsadaActual + @Exceso) > @Total THEN @Total ELSE (@UsadaActual + @Exceso) END;

        UPDATE dbo.PlanesMetros
        SET PlaCantidadUsada = @UsadaNva,
            PlaActivo         = CASE WHEN @UsadaNva >= @Total THEN 0 ELSE 1 END
        WHERE PlaIdPlan = @PlanId;

        UPDATE mc
        SET mc.MovObservaciones = CONCAT(mc.MovObservaciones, '_ABSORBIDO_PLAN_', @PlanId)
        FROM dbo.MovimientosCuenta mc
        JOIN dbo.CuentasCliente    cc ON cc.CueIdCuenta = mc.CueIdCuenta
        WHERE cc.CliIdCliente = @CliIdCliente
          AND cc.ProIdProducto = @ProIdProducto
          AND mc.MovImporte < 0
          AND (
                mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
             OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
              )
          AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%';

        PRINT CONCAT('CliId=', @CliIdCliente, ' Prod=', @ProIdProducto, ' -> Plan #', @PlanId,
                      ' actualizado. Excedente=', @Exceso, ' UsadaNueva=', @UsadaNva);
    END
    ELSE
    BEGIN
        PRINT CONCAT('CliId=', @CliIdCliente, ' Prod=', @ProIdProducto,
                      ' -> SIN PLAN ACTIVO. Excedente=', @Exceso, ' — revisar manualmente, no se tocó nada.');
    END

    FETCH NEXT FROM cur INTO @CliIdCliente, @ProIdProducto;
END

CLOSE cur;
DEALLOCATE cur;

-- Verificar el resultado antes de confirmar
SELECT PlaIdPlan, CliIdCliente, ProIdProducto, PlaCantidadTotal, PlaCantidadUsada, PlaActivo
FROM dbo.PlanesMetros
WHERE PlaIdPlan IN (
    SELECT DISTINCT pm.PlaIdPlan
    FROM dbo.PlanesMetros pm
    JOIN dbo.CuentasCliente cc ON cc.CliIdCliente = pm.CliIdCliente AND cc.ProIdProducto = pm.ProIdProducto
    JOIN dbo.MovimientosCuenta mc ON mc.CueIdCuenta = cc.CueIdCuenta
    WHERE mc.MovObservaciones LIKE CONCAT('%_ABSORBIDO_PLAN_', pm.PlaIdPlan)
);

-- Revisá los PRINT y el SELECT de arriba. Si todo se ve correcto:
-- COMMIT TRAN;
-- Si algo no cuadra (por ejemplo, casos "SIN PLAN ACTIVO" que necesitan revisión manual primero):
-- ROLLBACK TRAN;
