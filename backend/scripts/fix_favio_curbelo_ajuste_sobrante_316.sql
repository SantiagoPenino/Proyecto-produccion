/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN — Favio Curbelo (cuenta 472, US$): absorber el sobrante de $316,15
   29-jul-2026 (v2 — fecha retroactiva al 24/07, día del cobro que generó el sobrante)
   ───────────────────────────────────────────────────────────────────────────
   POR QUÉ ESTE SCRIPT Y NO SOLO PISAR CueSaldoActual
     La barra "Saldos" del Panel 360 NO lee la columna CuentasCliente.CueSaldoActual:
     el endpoint (getSaldoCliente, contabilidadService.js) la RECALCULA en vivo
     sumando dbo.MovimientosCuenta (excluyendo ORDEN/ORDEN_ANTICIPO). Por eso pisar
     esa columna no cambiaba nada en pantalla — hacía falta un movimiento real.

   QUÉ HACE
     Inserta UN movimiento de ajuste (-316.1502) en la cuenta 472, fechado
     24/07/2026 16:29:02 — un segundo después del cobro real (mov 23846, el que
     generó el sobrante) — así el estado de cuenta de cualquier período que
     empiece desde esa fecha en adelante ya sale cuadrado (útil para el envío
     semanal al cliente).
     MovTipo='AJUSTE_NEG': no matchea los tipos que el Estado de Cuenta
     muestra como "Cobro"/"A favor" (PAGO, ANTICIPO, SALDO_A_FAVOR, COBRO,
     NOTA_CREDITO, PAGO_CRUZADO) — no aparece ahí, pero SÍ queda visible en el
     libro mayor detallado (PDF/Excel completo) para quien necesite auditarlo.
     NO toca DeudaDocumento (FA-332 sigue con su pendiente real, 459,57).
     Recalcula MovSaldoPosterior de TODOS los movimientos de la cuenta en
     orden cronológico (excluyendo ORDEN/ORDEN_ANTICIPO, igual que el resto
     del sistema) — necesario porque el ajuste se inserta EN MEDIO del
     historial, no al final.
     Al final, re-alinea CuentasCliente.CueSaldoActual (la columna cacheada)
     al mismo valor, para que quede consistente en todos los reportes que la
     leen directamente.

   RESULTADO ESPERADO: Saldos (Panel 360) = US$ -459,57 · sin chip "A favor"
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT ISNULL(SUM(MovImporte), 0) AS SaldoMostrado_actual
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 472 AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');   -- esperado: -143.4198

BEGIN TRANSACTION;

/* ── PASO 1 — Insertar el movimiento de ajuste, fechado 24/07 (idempotente) ── */
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE CueIdCuenta = 472 AND MovConcepto LIKE 'Ajuste — sobrante FA-127/128%')
BEGIN
  INSERT INTO dbo.MovimientosCuenta
    (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, MovFecha, MovUsuarioAlta, MovObservaciones)
  VALUES
    (472, 'AJUSTE_NEG',
     'Ajuste — sobrante FA-127/128 no se expone como saldo a favor',
     -316.1502, 0, '2026-07-24T16:29:02', 1,
     'Sobrante real de $316,15 (anticipo RC-14 en pesos, cruces del 07/09/10-jul no descontados al facturar FA-128) — decisión del negocio 29-jul-2026: la cuenta muestra un solo número (lo que debe), sin desdoblar en pendiente + a favor. Fechado 24/07 (día del cobro que generó el sobrante) para que el estado de cuenta semanal salga cuadrado. No afecta DeudaDocumento (FA-332 sigue en 459,57).');
END
ELSE
BEGIN
  -- Si ya existe (por ejemplo, insertado antes con fecha de hoy), corregirle SOLO la fecha.
  UPDATE dbo.MovimientosCuenta
  SET    MovFecha = '2026-07-24T16:29:02'
  WHERE  CueIdCuenta = 472 AND MovConcepto LIKE 'Ajuste — sobrante FA-127/128%';
END

/* ── PASO 2 — Recalcular MovSaldoPosterior cronológico (excluyendo ORDEN) ── */
;WITH ord AS (
  SELECT MovIdMovimiento,
         SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') THEN MovImporte ELSE 0 END)
           OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
  FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta = 472 AND (MovAnulado IS NULL OR MovAnulado = 0)
)
UPDATE m SET m.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

/* ── PASO 3 — Re-alinear la columna cacheada CueSaldoActual ────────────── */
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = (
         SELECT ISNULL(SUM(MovImporte), 0) FROM dbo.MovimientosCuenta
         WHERE  CueIdCuenta = 472 AND (MovAnulado IS NULL OR MovAnulado = 0)
           AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
       )
WHERE  CueIdCuenta = 472;

/* ── PASO 4 — Verificación ─────────────────────────────────────────────── */
SELECT ISNULL(SUM(MovImporte), 0) AS SaldoMostrado_final
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 472 AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');   -- esperado: -459.57

SELECT CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 472;   -- esperado: -459.57

SELECT MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovSaldoPosterior
FROM dbo.MovimientosCuenta WHERE CueIdCuenta = 472 ORDER BY MovFecha, MovIdMovimiento;

/* Si el saldo final da -459.57 → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
