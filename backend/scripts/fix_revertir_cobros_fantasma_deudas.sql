/* ═══════════════════════════════════════════════════════════════════════════
   BUCKET C — COBRO FANTASMA: revertir 10 deudas marcadas cobradas SIN plata
   Auditoría "cobro sin movimiento que lo respalde"  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASA
     Estas 10 deudas figuran COBRADO/PARCIAL pero NO existe ningún cobro que
     las respalde: ni movimiento, ni Pago de caja, ni anticipo/saldo a favor
     que las cubra. En cada caso el "cobro" coincide en el minuto con un pago
     REAL del cliente por OTRA cosa (una venta nueva de caja) — el pago real
     ya está aplicado a su propio documento; la marca en la deuda vieja quedó
     de regalo. Los saldos en vivo de estos clientes confirman que la plata
     nunca entró (ej: Ponti saldo -138,04 = exactamente el PC-1808 "cobrado";
     Maxi.C y M.Castro saldo -1.500,00 = su PC completo).

   QUÉ HACE
     Devuelve cada deuda a su estado real: DDeImportePendiente vuelve al
     importe original (en todos los casos la reversión da el total), estado
     PENDIENTE, sin fecha de cobro, y DocPagado=0 en el comprobante.
     ⚠ EFECTO VISIBLE: estas deudas REAPARECEN como pendientes de cobro en el
     360 / Pago de Deudas. Es correcto: el cliente no las pagó.

   DEUDAS QUE SE REVIERTEN (deuda → doc, cliente, importe que revive)
     #4459 → PC-1808 MARTIN PONTI        US$   138,04  (cobro fantasma 17-jul 14:33)
     #6782 → PC-458  Puntogyf            US$    32,06  (fantasma 21-jul 19:09)
     #6783 → PC-1018 Puntogyf            US$    33,19  (queda pend. 120,34 = total)
     #3900 → PC-2199 Puntogyf            US$    65,25  (queda pend. 275,07 = total)
     #1510 → PC-525  Yesusport           $   1.881,00  (ver nota abajo)
     #1511 → PC-532  Yesusport           US$   675,68
     #4955 → PC-416  De Zuasnabar        US$     9,12  (el pago 9,12 mov 21766 fue ANULADO y la deuda no se revirtió)
     #6767 → PC-2180 Maxi.C              US$     6,58  (queda pend. 1.500 = total)
     #5097 → PC-1943 Maximiliano Castro  US$    29,16  (queda pend. 1.500 = total)
     #5253 → FA-58   Martin Moreira      US$    54,00  (queda pend. 546,75 = total)

   NOTA Yesusport PC-525 (#1510): el 21-jul se cobraron $1.881 reales, pero ese
   cobro quedó aplicado (con movimiento y todo) a la deuda #7318 de PC-2461 —
   casualmente por el mismo monto. Este script asume que la aplicación
   registrada (PC-2461) es la buena y revierte la marca sin plata de PC-525.
   Si el negocio confirma que el cliente quiso pagar PC-525, en vez de esto
   hay que mover la aplicación (patrón fix_pago_mal_aplicado_pc2220.sql).

   Guards por señas (deuda + pendiente actual + estado): si algo no coincide,
   esa fila se saltea y se lista. Idempotente.

   MODO DE USO: PASO 0 (lectura). Si cuadra, PASO 1 y verificar PASO 2
   (todas con Pendiente = Original y estado PENDIENTE) → COMMIT. Si no → ROLLBACK.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

DECLARE @d TABLE (DDeId INT, DocId INT, PendEsperado DECIMAL(18,2), EstadoEsperado VARCHAR(20), Doc VARCHAR(20));
INSERT INTO @d VALUES
  (4459, 2797,    0.00, 'COBRADO', 'PC-1808'),
  (6782,  724,    0.00, 'COBRADO', 'PC-458'),
  (6783, 1568,   87.15, 'PARCIAL', 'PC-1018'),
  (3900, 2383,  209.82, 'PARCIAL', 'PC-2199'),
  (1510,  829,    0.00, 'COBRADO', 'PC-525'),
  (1511,  840,    0.00, 'COBRADO', 'PC-532'),
  (4955,  633, 1507.30, 'PARCIAL', 'PC-416'),
  (6767, 4391, 1493.42, 'PARCIAL', 'PC-2180'),
  (5097, 3204, 1470.84, 'PARCIAL', 'PC-1943'),
  (5253, 3279,  492.75, 'PARCIAL', 'FA-58');

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT t.Doc, t.DDeId, dd.DDeEstado, dd.DDeImporteOriginal, dd.DDeImportePendiente,
       t.PendEsperado, t.EstadoEsperado, CONVERT(varchar(19),dd.DDeFechaCobro,120) AS FechaCobro,
       dc.DocPagado
FROM @d t
LEFT JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = t.DDeId
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = t.DocId
ORDER BY t.DDeId;

/* ── PASO 1 — Reversión ────────────────────────────────────────────────── */
BEGIN TRANSACTION;

UPDATE dd
SET dd.DDeImportePendiente = dd.DDeImporteOriginal,
    dd.DDeEstado           = 'PENDIENTE',
    dd.DDeFechaCobro       = NULL,
    dd.DDeObservaciones    = LEFT(ISNULL(dd.DDeObservaciones + ' | ','')
        + 'Revertida marca de cobro sin respaldo (no existe pago/movimiento que la cubra). '
        + 'fix_revertir_cobros_fantasma_deudas.sql', 500)
FROM dbo.DeudaDocumento dd
JOIN @d t ON t.DDeId = dd.DDeIdDocumento
WHERE dd.DDeEstado = t.EstadoEsperado
  AND ABS(dd.DDeImportePendiente - t.PendEsperado) < 0.01;

PRINT CONCAT('Deudas revertidas: ', @@ROWCOUNT, ' de 10 esperadas.');

-- Los comprobantes vuelven a figurar impagos
UPDATE dc SET dc.DocPagado = 0
FROM dbo.DocumentosContables dc
JOIN @d t ON t.DocId = dc.DocIdDocumento
WHERE dc.DocPagado = 1;

PRINT CONCAT('DocPagado repuesto a 0 en: ', @@ROWCOUNT, ' documentos (PC-525, PC-532, PC-1808).');

-- Filas que NO se pudieron aplicar (guard falló: ya corrido, o algo cambió)
SELECT t.Doc, t.DDeId, 'NO APLICADO (guard)' AS Estado, dd.DDeEstado, dd.DDeImportePendiente
FROM @d t LEFT JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = t.DDeId
WHERE dd.DDeIdDocumento IS NULL OR dd.DDeEstado <> 'PENDIENTE';

/* ── PASO 2 — Verificación: todas con Pendiente = Original, PENDIENTE, sin fecha ── */
SELECT t.Doc, t.DDeId, dd.DDeEstado, dd.DDeImporteOriginal, dd.DDeImportePendiente,
       dc.DocPagado
FROM @d t
JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = t.DDeId
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = t.DocId
ORDER BY t.DDeId;

/* Si las 10 quedaron PENDIENTE con Pendiente = Original y DocPagado = 0
   → COMMIT TRANSACTION;    si no → ROLLBACK TRANSACTION;  y avisar. */
