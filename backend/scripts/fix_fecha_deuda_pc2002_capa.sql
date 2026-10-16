/* ═══════════════════════════════════════════════════════════════════════════
   FIX — Fecha de la deuda del PC-2002 (CAPA Indumentaria Deportiva)  ·  28-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASA
     El documento PC-2002 (doc 2946, cliente CAPA) se emitió el 06/07/2026,
     pero su deuda (#5920, $86.554,63, VENCIDO) nació con fecha 13/07 — una
     semana después. Mismo bug que Lepra/PC-423: la deuda se regeneró
     estampando la fecha del día en vez de la fecha real del documento
     (bug ya corregido en el código, `crearDeudaDocumento` desde el commit
     de "fecha editable en documentos" — esto es solo el dato histórico).
   QUÉ HACE
     Realinea DDeFechaEmision al 06/07 (fecha real del doc) y recalcula
     DDeFechaVencimiento con los días de la condición de pago de CAPA (0 días
     → vencimiento = misma fecha). NO toca importe, estado ni saldo.
   NOTA: el script genérico `fix_fecha_deuda_segun_documento.sql` ya cubre
     este caso (y cualquier otro con el mismo patrón) — este es un script
     puntual solo para aislar y verificar ESTE documento primero.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT dd.DDeIdDocumento,
       CONVERT(varchar(10), dd.DDeFechaEmision, 23)      AS Deuda_Emision_Actual,
       CONVERT(varchar(10), dd.DDeFechaVencimiento, 23)  AS Deuda_Vto_Actual,
       CONVERT(varchar(10), dc.DocFechaEmision, 23)       AS Doc_Emision_Real,
       dd.DDeImportePendiente, dd.DDeEstado
FROM   dbo.DeudaDocumento dd
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  dd.DDeIdDocumento = 5920;

BEGIN TRANSACTION;

/* ── PASO 1 — Realinear fecha (0 días de vencimiento, condición de pago
      de CAPA) ─────────────────────────────────────────────────────────── */
UPDATE dbo.DeudaDocumento
SET    DDeFechaEmision     = '2026-07-06',
       DDeFechaVencimiento = '2026-07-06',
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Fecha realineada al doc real (06/07, antes decia 13/07 — deuda regenerada con la fecha del dia). fix_fecha_deuda_pc2002_capa.sql', 500)
WHERE  DDeIdDocumento = 5920
  AND  CAST(DDeFechaEmision AS DATE) <> '2026-07-06';   -- idempotente

PRINT CONCAT('Fecha corregida: ', @@ROWCOUNT);   -- esperado: 1 la primera vez, 0 si ya estaba

/* ── PASO 2 — Verificación ─────────────────────────────────────────────── */
SELECT dd.DDeIdDocumento,
       CONVERT(varchar(10), dd.DDeFechaEmision, 23)      AS Deuda_Emision,
       CONVERT(varchar(10), dd.DDeFechaVencimiento, 23)  AS Deuda_Vto,
       dd.DDeImportePendiente, dd.DDeEstado   -- deben quedar IGUALES: 86554.63, VENCIDO
FROM   dbo.DeudaDocumento dd
WHERE  dd.DDeIdDocumento = 5920;

/* Si Deuda_Emision = 2026-07-06 y el importe/estado no cambiaron →
   COMMIT TRANSACTION;   Si no →   ROLLBACK TRANSACTION; */
