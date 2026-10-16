/* ============================================================================
   REGULARIZACIÓN — Grupo B: MAXIC / Maximiliano Castro (CliIdCliente 5534,
   cuenta 1483, Papel de Sublimación 1,60, plan #85).

   Diagnosticado 09-sep-2026: la cuenta tenía 1.000 metros guardados sin
   NINGÚN movimiento que los respalde (0 en MovimientosCuenta), exactamente
   el doble del plan (#85, total 500). La única venta de recurso asociada
   (PC-1943, $1.500, 7/7) parecía una compra real sin acreditar.

   CONFIRMADO por el usuario (09-sep-2026): el cliente tenía DOS fichas
   (hubo un error de duplicado) y en realidad NO tiene rollo — el saldo
   correcto es CERO, no 500. Hay que sacarle el recurso, no agregárselo.
   A diferencia de todos los demás casos del Grupo B, acá NO se usa la
   regla "el libro manda" (el libro también decía 0, y coincide) ni se
   agrega nada — se vacía directamente cuenta y plan.

   Qué hace:
     - CueSaldoActual de la cuenta 1483 → 0.
     - Plan #85 → PlaActivo = 0 (se cierra, no se borra, queda el historial
       con la observación de por qué).
   NO toca MovimientosCuenta (no hay ninguno) ni la venta PC-1943 ($1.500) —
   eso es un tema de plata/duplicado de ficha, aparte, sin resolver todavía.

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES ──────────────────────────────────────────────────────────
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CueIdCuenta = 1483 AND p.PlaIdPlan = 85;

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE CuentasCliente
SET CueSaldoActual = 0
WHERE CueIdCuenta = 1483;

UPDATE PlanesMetros
SET PlaActivo = 0,
    PlaObservaciones = LEFT(ISNULL(PlaObservaciones + ' | ', '')
        + 'Cerrado 09-sep-2026: cliente con ficha duplicada, no corresponde '
        + 'rollo — saldo llevado a 0 (Grupo B).', 500)
WHERE PlaIdPlan = 85;

/* Revisar el PASO 3. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS ─────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaObservaciones
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CueIdCuenta = 1483 AND p.PlaIdPlan = 85;
