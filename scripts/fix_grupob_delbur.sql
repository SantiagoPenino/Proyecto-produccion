/* ============================================================================
   REGULARIZACIÓN — Grupo B: Javier Burguez / DELBUR (CliIdCliente 5992,
   cuenta 2190, ProIdProducto 489).

   Este es el caso YA CONOCIDO de project_bug_anular_rollo_adelantado_recurso:
   PC-2721 (29/7, $800) creó el plan #115; se anuló 17 min después (ET-3375,
   "ANULADO POR ANULACION COMPROBANTE") y en su momento se revirtió el plan
   A MANO en prod — por eso hoy el plan #115 está en 0/0, cerrado. Lo que
   quedó sin tocar es el SALDO DE LA CUENTA: sigue en 200, sin ningún
   movimiento que lo respalde (0 en MovimientosCuenta) — es el mismo
   crédito directo de siempre que nunca pasó por el libro.

   Como el plan ya fue juzgado y cerrado a mano, la corrección de la cuenta
   es la misma: 0. No hace falta la regla "el libro manda" para decidirlo,
   ya está decidido de antes.

   Qué hace: CueSaldoActual de la cuenta 2190 → 0. NO toca el plan #115
   (ya está en 0/0, cerrado) ni las otras cuentas de metros de este cliente
   (1449 y 2199, que están bien).

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES ──────────────────────────────────────────────────────────
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 2190;

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE CuentasCliente
SET CueSaldoActual = 0
WHERE CueIdCuenta = 2190;

/* Revisar el PASO 3. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS ─────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 2190;
