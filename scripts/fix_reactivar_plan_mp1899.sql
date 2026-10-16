/* ============================================================================
   REACTIVAR plan #149 de Martín Ponti (MP-1899) — corrige un efecto colateral
   del script fix_sobregiro_grupo_a_todos.sql (09-sep-2026).

   Qué pasó: MP-1899 es cliente SEMANAL. Para Semanal y Rollo por adelantado
   rige la regla "el plan nunca se cierra" (deployada 1-8/set). El script del
   Grupo A es genérico y no la conoce: al absorberle el sobregiro, el consumo
   llegó justo al total del plan (134,00 = 134,00) y el script lo cerró como
   haría con cualquier cliente Común. Resultado: MP-1899 quedó sin plan activo
   y con la cuenta en negativo real (verificar el número actual abajo, en el
   PASO 1) — mientras no tenga plan activo, sus pedidos nuevos se le van a
   cobrar en plata como si no fuera Semanal.

   Qué hace este script: reactiva el plan #149 y ajusta PlaCantidadUsada para
   que el restante del plan quede IGUAL al saldo negativo real de la cuenta —
   así el plan vuelve a reflejar la verdad y, al estar activo, la regla
   "nunca se cierra" vuelve a regir para sus próximos pedidos. NO toca
   CueSaldoActual ni MovimientosCuenta.

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3 antes de dar
   por bueno el COMMIT — si algo no cuadra, ROLLBACK TRANSACTION.
   ============================================================================ */

SET NOCOUNT ON;

/* ── PASO 1 · Estado actual (revisar antes de aplicar) ─────────────────── */
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0)   AS SumaLibro,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada
FROM CuentasCliente cc
JOIN PlanesMetros p ON p.PlaIdPlan = 149
WHERE cc.CueIdCuenta = p.CueIdCuenta;
-- Si SumaLibro no coincide con CueSaldoActual, FRENAR y avisar — significaría
-- que esta cuenta también tiene un problema de saldo sin respaldo (no debería,
-- MP-1899 no estaba en la lista de Grupo B, pero mejor confirmarlo).

/* ── PASO 2 · APLICAR ──────────────────────────────────────────────────── */
BEGIN TRANSACTION;

UPDATE p
SET p.PlaActivo = 1,
    p.PlaCantidadUsada = p.PlaCantidadTotal - cc.CueSaldoActual,
    p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
        + 'Reactivado 09-sep-2026: es cliente Semanal, el plan no debe cerrarse '
        + '— el lote del Grupo A lo cerro por error al no conocer esa regla. '
        + 'PlaCantidadUsada ajustada para reflejar el saldo negativo real de la cuenta.', 500)
FROM PlanesMetros p
JOIN CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
WHERE p.PlaIdPlan = 149;

/* Revisar el PASO 3 antes de decidir. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

/* ── PASO 3 · DESPUÉS (la verificación que importa) ────────────────────── */
SELECT 'DESPUES' AS Paso,
       p.PlaIdPlan, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante,
       cc.CueSaldoActual,
       ROUND((p.PlaCantidadTotal - p.PlaCantidadUsada) - cc.CueSaldoActual, 4) AS Dif_DebeSerCero
FROM PlanesMetros p
JOIN CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
WHERE p.PlaIdPlan = 149;
