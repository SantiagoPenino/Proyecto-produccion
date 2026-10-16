/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN — Favio Curbelo: FA-332 debe verse por su monto completo
   28-jul-2026 (corrige el criterio de fix_favio_curbelo_cargo_y_surplus.sql)
   ───────────────────────────────────────────────────────────────────────────
   CONTEXTO
     El script anterior (fix_favio_curbelo_cargo_y_surplus.sql) había netado
     el sobrante de FA-127/128 (US$316,15) contra la deuda de FA-332, dejando
     pendiente = 143,42. Contabilidad confirmó que la FACTURA debe mostrarse
     por su monto real (459,57) sin netear en silencio.

     Se confirmó además que el sobrante SÍ es real (no un error de
     etiquetado): las 4 órdenes de FA-128 (18 + 26,10 + 405,24 + 162,89 =
     612,23) coinciden exacto con su total — Favio pagó 3 de ellas por
     adelantado (retiro durante el ciclo) y el resto después, totalizando
     928,38 contra una factura de 612,23. El sobrante de 316,15 es plata
     genuina de Favio.

   QUÉ HACE
     Revierte DDeImportePendiente de FA-332 (#8224) a su monto completo
     (459,57). NO toca la billetera ni ningún movimiento — el sobrante de
     316,15 sigue en la cuenta y ahora aparece como "A favor" SEPARADO del
     pendiente (gracias al chip de saldo-a-favor-implícito agregado hoy en
     ClienteVista360.jsx), en vez de netearse en silencio contra la factura.

   RESULTADO ESPERADO: PENDIENTE US$459,57 · A favor: US$316,15
   (billetera se mantiene en -143,42, sin cambios)
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento WHERE DDeIdDocumento = 8224;

BEGIN TRANSACTION;

/* ── PASO 1 — Revertir a monto completo ────────────────────────────────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 459.57,
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | REVERTIDO: contabilidad confirma que FA-332 debe verse por su monto completo (459,57). El sobrante de 316,15 (pago adelantado de FA-127/128) queda como saldo a favor visible, NO aplicado a esta factura. fix_favio_curbelo_revertir_neteo.sql', 500)
WHERE  DDeIdDocumento = 8224
  AND  ABS(DDeImportePendiente - 143.4198) < 0.01;   -- idempotente: solo si sigue neteada

PRINT CONCAT('FA-332 revertida a monto completo: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — Verificación ─────────────────────────────────────────────── */
SELECT DDeImportePendiente, DDeEstado FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 8224;   -- esperado: 459.57

SELECT CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)
                      THEN MovImporte END) AS DECIMAL(18,2)) AS Billetera
FROM   dbo.MovimientosCuenta WHERE CueIdCuenta = 472;   -- esperado: -143.42, sin cambios

/* Si pendiente=459.57 y billetera=-143.42 → el 360 mostrará "Pendiente 459,57 · A favor 316,15"
   → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
