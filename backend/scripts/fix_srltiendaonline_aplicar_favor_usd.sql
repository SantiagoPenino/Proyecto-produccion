/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN — SRL Tienda Online (cuenta 71, US$): aplicar favor a deuda vieja
   31-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   CONTEXTO
     La cuenta tiene US$3,96 a favor reales (verificado contra el libro mayor:
     un cruce de moneda del 29/07 que quedó sin usar porque, al día siguiente,
     la misma orden se saldó de nuevo vía el mecanismo de "Rollo por
     adelantado" — dos sistemas de "esto ya está pagado" que no se hablan
     entre sí, sin relación con el bug de CueSaldoActual). Y hay una deuda
     vieja suelta (orden SB-63992, DDeIdDocumento 20, del 11/06, nunca
     facturada): pendiente US$67,0581.

   QUÉ HACE
     Aplica el US$3,9611 a favor contra esa deuda vieja — NO inserta ningún
     movimiento nuevo en MovimientosCuenta (esa plata ya está en la cuenta,
     solo se reconoce contra esta deuda puntual, igual que el caso Posse).
     Pendiente pasa de 67,0581 a 63,0970. El resto de la deuda ($63,10) queda
     igual — es una decisión de negocio aparte (cobrarla, darla de baja, o
     dejarla), no parte de este ajuste.

   RESULTADO ESPERADO: DDeImportePendiente = 63.0970 (antes 67.0581)
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento WHERE DDeIdDocumento = 20;
-- esperado: 67.0581 (PARCIAL)

SELECT ISNULL(SUM(MovImporte), 0) AS SaldoReal_USD
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 71 AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');
-- esperado: 3.9611 (sin cambios después del fix — no se toca el libro mayor)

BEGIN TRANSACTION;

/* ── PASO 1 — Aplicar el favor existente (idempotente) ─────────────────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 63.0970,
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Se aplicaron US$3,9611 de saldo a favor real (cruce de moneda del 29/07 sobre la orden XECOUV-14813, nunca descontado por el mecanismo de Rollo por adelantado) — resto de la deuda ($63,10) sin decisión aún. fix_srltiendaonline_aplicar_favor_usd.sql', 500)
WHERE  DDeIdDocumento = 20
  AND  ABS(DDeImportePendiente - 67.0581) < 0.02;

PRINT CONCAT('Deuda SB-63992 ajustada: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — Verificación ─────────────────────────────────────────────── */
SELECT DDeIdDocumento, DDeImportePendiente, DDeEstado FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 20;
-- esperado: 63.0970

SELECT ISNULL(SUM(MovImporte), 0) AS SaldoReal_USD_sin_cambios
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 71 AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');
-- esperado: 3.9611, IGUAL que antes

/* Si pendiente da 63.0970 y el saldo real sigue en 3.9611 →
   COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
