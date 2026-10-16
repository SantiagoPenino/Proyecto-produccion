/* ═══════════════════════════════════════════════════════════════════════════
   FIX — CR SPORT, PC-1361 (deuda #3409): completar la corrección que quedó
   a mitad de camino  ·  28-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASÓ
     El paso "PASO 1b" de repara_cruce_saldos_espejo.sql (el ajuste de
     -213,34 por los 2 pagos reales de junio que la vieja
     fix_deudas_duplicadas nunca restó) se agregó al archivo DESPUÉS de que
     ya se había corrido y commiteado la versión anterior en prod. Por eso
     solo se aplicó el cruce de 209,32 (que sí corrió, y quedó anotado en
     DDeObservaciones), pero no el ajuste de -213,34.

     Resultado: PC-1361 quedó con pendiente 2.980,2446, cuando el total de
     las 5 deudas vivas de CR SPORT debería coincidir con la billetera real
     (-6.156,21). Las otras 4 deudas están bien (suman 3.598,63); para
     cuadrar, PC-1361 debe quedar en 2.557,5846 (2.980,2446 - 422,66).

   QUÉ HACE
     Ajusta DDeImportePendiente de la deuda #3409 a 2.557,5846.
     Idempotente (no se re-aplica si ya está en ese valor).

   VERIFICACIÓN: suma de las 5 deudas vivas de CR SPORT = 6.156,21 = billetera.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT DDeIdDocumento, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento WHERE DDeIdDocumento = 3409;

SELECT CAST(SUM(DDeImportePendiente) AS DECIMAL(18,2)) AS SumaDeudasVivas
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 222 AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

BEGIN TRANSACTION;

/* ── PASO 1 — Completar el ajuste que había quedado a mitad ────────────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 2557.5846,
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Completado el ajuste que había quedado a mitad de camino: faltaban -213,34 (2 pagos reales de jun-2026 que fix_deudas_duplicadas nunca restó) además del cruce de 209,32 ya aplicado. fix_crsport_pc1361_correccion_pendiente.sql', 500)
WHERE  DDeIdDocumento = 3409
  AND  DDeImportePendiente > 2600;   -- guard: no re-aplica si ya está corregido

PRINT CONCAT('PC-1361 corregido: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — Verificación: debe dar 6.156,21 (= billetera) ────────────── */
SELECT CAST(SUM(DDeImportePendiente) AS DECIMAL(18,2)) AS SumaDeudasVivasDespues
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 222 AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

/* Si da 6156.21 → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
