/* ═══════════════════════════════════════════════════════════════════════════
   FIX — Cruces de moneda flotantes nunca aplicados: Mrivero-745  ·  28-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   ANTECEDENTE: este es el cliente que ya tenías documentado en
   project_bug_deuda_neteo_cierreciclo.md como el caso original del bug
   "ajuste no se propaga a MovimientosCuenta" (guardarPrecios). Esta es su
   resolución concreta con datos reales.

   QUÉ PASA
     La billetera USD de Mrivero-745 marca −825,76, pero la suma de sus 3
     deudas vivas (PC-2517 489,34 + PC-2516 289,80 + PC-2084 291,94) da
     −1.071,08. Diferencia: 245,32.

     Esos 245,32 SON PLATA REAL que ya está en la cuenta: 6 movimientos de
     cobertura cruzada (pesos→dólares, MovTipo PAGO_CRUZADO) que entraron
     pero nunca se aplicaron (reducirDeuda) a ninguna deuda viva:
       - 3 sin DocIdDocumento en absoluto (68,04 + 89,28 + 37,064 = 194,38)
       - 3 mal etiquetados a un documento de OTRA factura ya saldada
         (19,2375 + 9,20 + 22,50 = 50,9375)

   QUÉ HACE
     Aplica los 245,32 a la deuda VIVA más antigua (PEPS): PC-2084 (deuda
     #6269), que baja de 291,9416 a 46,6216 pendiente. Las otras 2 deudas
     (PC-2516, PC-2517) quedan intactas — no alcanza para cubrirlas.
     NO mueve plata (ya está en la cuenta) ni toca movimientos: solo alinea
     DeudaDocumento con lo que el libro mayor ya dice.

   VALIDADO EN LOCAL: suma de pendientes tras el fix = 825,7617 = billetera
   exacta (46,62 + 289,80 + 489,34).
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT DDeIdDocumento, DocIdDocumento, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento
WHERE  DDeIdDocumento IN (6269, 7478, 7479, 7709);

SELECT CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)
                      THEN MovImporte END) AS DECIMAL(18,2)) AS BilleteraActual
FROM   dbo.MovimientosCuenta WHERE CueIdCuenta = 310;

BEGIN TRANSACTION;

/* ── PASO 1 — Aplicar los 245,32 a la deuda más antigua (PC-2084) ──────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 46.6216,
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Aplicados 245,32 de cruces de moneda reales que nunca se imputaron a ninguna deuda (mismo bug de precio/cierre que este cliente ya tenia documentado: guardarPrecios / cierre no propaga). fix_cruces_flotantes_mrivero745.sql', 500)
WHERE  DDeIdDocumento = 6269
  AND  ABS(DDeImportePendiente - 291.9416) < 0.01;   -- idempotente

PRINT CONCAT('PC-2084 realineado: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — Verificación: suma de pendientes debe dar 825,76 (=billetera) ── */
SELECT DDeIdDocumento, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 310 AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

SELECT CAST(SUM(DDeImportePendiente) AS DECIMAL(18,2)) AS TotalPendienteDespues   -- esperado: 825.76
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 310 AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

/* Si TotalPendienteDespues = 825.76 → COMMIT TRANSACTION;
   Si no                            → ROLLBACK TRANSACTION; */
