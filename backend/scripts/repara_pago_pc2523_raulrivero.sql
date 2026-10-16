/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN — PC-2523 Raul Rivero: pago en cuenta equivocada + robado por
   el cierre de ciclo  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASÓ
     PC-2523 (doc 4981, USD 58,20, CONTADO, cobro del retiro RT-19576 el
     22-jul 14:18): el cargo fue bien a la cuenta USD (433), pero el PAGO
     (mov 22320) se insertó en la cuenta UYU (2033) con el importe en USD sin
     convertir, sin vínculo al documento, y con el ciclo 335 estampado.
     Al cerrarse el ciclo PC-2583 (doc 5323), el paso de vinculación se
     apropió del pago suelto (le estampó DocIdDocumento=5323).
     Resultado: USD "debe" 58,20 y UYU tiene 58,20 "a favor" — ambos falsos.
     Fixes de código ya aplicados (pend. deploy): el pago con documento va a
     la moneda del documento (cajaService) y el cierre solo vincula ÓRDENES
     (contabilidadService).

   QUÉ HACE
     Reubica el pago 22320: cuenta 2033 → 433, DocIdDocumento 5323 → 4981,
     CicIdCiclo → NULL. Ajusta CueSaldoActual por consistencia.

   VERIFICACIÓN: ambas billeteras de Raul Rivero (cliente 258) deben dar 0,00.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT MovIdMovimiento, CueIdCuenta, MovTipo, MovImporte, DocIdDocumento, CicIdCiclo,
       LEFT(MovConcepto,60) AS Conc
FROM   dbo.MovimientosCuenta
WHERE  MovIdMovimiento IN (22319, 22320);

BEGIN TRANSACTION;

/* ── PASO 1 — Reubicar el pago con su documento real ───────────────────── */
UPDATE dbo.MovimientosCuenta
SET    CueIdCuenta   = 433,
       DocIdDocumento = 4981,
       CicIdCiclo    = NULL,
       MovObservaciones = LEFT(ISNULL(MovObservaciones,'') +
         ' | Reparado: pago del contado PC-2523 (USD) que había caído en la cuenta UYU sin vínculo y el cierre PC-2583 se lo había apropiado. repara_pago_pc2523_raulrivero.sql', 500)
WHERE  MovIdMovimiento = 22320 AND CueIdCuenta = 2033;

PRINT CONCAT('Pago reubicado: ', @@ROWCOUNT);   -- esperado: 1

/* Consistencia de CueSaldoActual (columna legacy; la billetera recalcula) */
UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + 58.20 WHERE CueIdCuenta = 433;
UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - 58.20 WHERE CueIdCuenta = 2033;

/* ── PASO 2 — Verificación: ambas billeteras en 0,00 ───────────────────── */
SELECT cc.CueIdCuenta, cc.CueTipo,
       CAST(ISNULL(SUM(m.MovImporte),0) AS DECIMAL(18,2)) AS BilleteraDespues
FROM   dbo.CuentasCliente cc
LEFT JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
     AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
WHERE  cc.CueIdCuenta IN (433, 2033)
GROUP  BY cc.CueIdCuenta, cc.CueTipo;

/* Si ambas dan 0.00 →  COMMIT TRANSACTION;   Si no →  ROLLBACK TRANSACTION; */
