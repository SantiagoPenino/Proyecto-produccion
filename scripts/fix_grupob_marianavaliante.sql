/* ============================================================================
   REGULARIZACIÓN — Grupo B: Mariana Valiante (CliIdCliente 8611, cuenta
   1645, DTF textil Común, plan #94).

   Diagnosticado 09-sep-2026: la cuenta tenía 200 metros guardados sin
   NINGÚN movimiento que los respalde (0 en MovimientosCuenta), exactamente
   el doble del plan (#94, total 100). La única venta de recurso asociada
   (PC-2012, $810, 10/7) nunca generó ningún documento (ni PC, ni FA, ni
   ET) y trae la observación "Precio manual: -63,2% vs precio de lista" —
   mismo patrón de MAXIC.

   CONFIRMADO por el usuario (09-sep-2026): a Mariana Valiante NO le
   corresponde el rollo — hay que cerrarlo. Mismo criterio que MAXIC: no
   se usa la regla "el libro manda" (acá también daría 0 y coincide), se
   vacía directamente cuenta y plan.

   Qué hace:
     - CueSaldoActual de la cuenta 1645 → 0.
     - Plan #94 → PlaActivo = 0 (se cierra, no se borra, queda el
       historial con la observación de por qué).
   NO toca MovimientosCuenta (no hay ninguno) ni la venta PC-2012 ($810)
   ni la secuencia de PC-2918 (anulado) / PC-2919 / NC-000016 alrededor de
   ese mismo monto — eso es un tema de plata aparte, sin resolver todavía.

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES ──────────────────────────────────────────────────────────
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CueIdCuenta = 1645 AND p.PlaIdPlan = 94;

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE CuentasCliente
SET CueSaldoActual = 0
WHERE CueIdCuenta = 1645;

UPDATE PlanesMetros
SET PlaActivo = 0,
    PlaObservaciones = LEFT(ISNULL(PlaObservaciones + ' | ', '')
        + 'Cerrado 09-sep-2026: no corresponde rollo — saldo llevado a 0 '
        + '(Grupo B).', 500)
WHERE PlaIdPlan = 94;

/* Revisar el PASO 3. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS ─────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaObservaciones
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CueIdCuenta = 1645 AND p.PlaIdPlan = 94;
