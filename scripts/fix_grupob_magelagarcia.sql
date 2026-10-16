/* ============================================================================
   REGULARIZACIÓN — Grupo B: Magela García (CliIdCliente 6629, cuenta 812,
   DTF textil Común, plan #5).

   Diagnosticado 09-sep-2026: la cuenta tenía 9,38 metros guardados sin
   NINGÚN movimiento que los respalde (0 en MovimientosCuenta), exactamente
   el doble del plan (#5, total 4,69). La única venta de recurso asociada
   (PC-589, $92,86, 18/6, Completada, Pagada, precio normal ~$19,8/m, sin
   descuentos manuales raros) parecía una compra legítima sin acreditar.

   CONFIRMADO por el usuario (09-sep-2026): esos metros NO van — hay que
   cerrarlo. Mismo criterio que MAXIC y Mariana Valiante: no se usa la
   regla "el libro manda" (acá también daría 0 y coincide), se vacía
   directamente cuenta y plan.

   Qué hace:
     - CueSaldoActual de la cuenta 812 → 0.
     - Plan #5 → PlaActivo = 0 (se cierra, no se borra, queda el historial
       con la observación de por qué).
   NO toca MovimientosCuenta (no hay ninguno) ni la venta PC-589 ($92,86) —
   eso es un tema de plata aparte, sin resolver todavía.

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES ──────────────────────────────────────────────────────────
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CueIdCuenta = 812 AND p.PlaIdPlan = 5;

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE CuentasCliente
SET CueSaldoActual = 0
WHERE CueIdCuenta = 812;

UPDATE PlanesMetros
SET PlaActivo = 0,
    PlaObservaciones = LEFT(ISNULL(PlaObservaciones + ' | ', '')
        + 'Cerrado 09-sep-2026: no corresponde rollo — saldo llevado a 0 '
        + '(Grupo B).', 500)
WHERE PlaIdPlan = 5;

/* Revisar el PASO 3. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS ─────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaObservaciones
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CueIdCuenta = 812 AND p.PlaIdPlan = 5;
