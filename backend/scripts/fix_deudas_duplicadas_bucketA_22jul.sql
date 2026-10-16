/* ═══════════════════════════════════════════════════════════════════════════
   FIX — Deudas duplicadas EXACTAS (Bucket A)  ·  22-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ ARREGLA
     Documentos con DOS filas idénticas en DeudaDocumento (mismo importe, misma
     cuenta, misma orden). El cobro imputa a una y la otra sobrevive PENDIENTE:
     la deuda ya cobrada vuelve a aparecer en "Documentos con deuda".
     Caso testigo: ET-2373 (Uniformes vym) — deudas 7250 (COBRADO) / 7251 (PENDIENTE).

   QUÉ **NO** TOCA (a propósito)
     · Bucket C — el cargo en MovimientosCuenta también está duplicado
       (PC-2515, PC-2442, PC-2327, PC-2220, PC-1932, PC-2082).
       Ahí el SALDO está inflado: hay que revertir el movimiento, no solo la deuda.
       → excluidos por el chequeo ABS(CargosCuenta - DocTotal) <= 0.01
     · Bucket B — dos deudas de importes DISTINTOS (PC-2420, PC-2461, PC-1982…).
       Hay que decidir cuál es la buena, uno por uno.
       → excluidos por el chequeo de un solo importe distinto
     · Bucket D — una sola deuda mayor al documento (ET-1498, PC-2404…).
       No es duplicado: el importe nació mal.
       → excluidos por Filas > 1

   NO toca MovimientosCuenta, ni CueSaldoActual, ni asientos contables.
   Solo marca CANCELADO la fila sobrante y recalcula DocPagado.

   MODO DE USO
     1) Correr PASO 0 y PASO 1 (solo lectura). Mirar.
     2) Si cuadra, correr PASO 2 y PASO 3 dentro de la transacción.
     3) PASO 4 vuelve a mostrar el estado. Si está bien → COMMIT. Si no → ROLLBACK.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ───────────────────────────────────────────────────────────────────────────
   PASO 0 — Estados que realmente existen en la tabla.
   Se usa 'CANCELADO' porque es el que ya usa el código (contabilidadController).
   Si acá aparece otro nombre para "deuda muerta", ajustar @EstadoAnulado.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT DDeEstado, COUNT(*) AS Filas
FROM dbo.DeudaDocumento WITH(NOLOCK)
GROUP BY DDeEstado
ORDER BY Filas DESC;
GO

DECLARE @EstadoAnulado VARCHAR(20) = 'CANCELADO';

/* ───────────────────────────────────────────────────────────────────────────
   Candidatos = documentos del Bucket A
   ─────────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('tempdb..#docsA') IS NOT NULL DROP TABLE #docsA;

SELECT dc.DocIdDocumento,
       CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       dc.DocTotal,
       agg.Filas,
       agg.DeudaOriginal,
       mov.CargosCuenta
INTO   #docsA
FROM   dbo.DocumentosContables dc
CROSS APPLY (
    SELECT COUNT(*)                          AS Filas,
           SUM(d.DDeImporteOriginal)         AS DeudaOriginal,
           COUNT(DISTINCT d.DDeImporteOriginal) AS ImportesDistintos
    FROM   dbo.DeudaDocumento d
    WHERE  d.DocIdDocumento = dc.DocIdDocumento
      AND  d.DDeEstado NOT IN ('ANULADO','ANULADA','CANCELADO','CANCELADA')
) agg
CROSS APPLY (
    SELECT ISNULL(SUM(ABS(m.MovImporte)),0) AS CargosCuenta
    FROM   dbo.MovimientosCuenta m
    WHERE  m.DocIdDocumento = dc.DocIdDocumento
      AND  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','AJUSTE','FACTURA')
) mov
WHERE  agg.Filas > 1                                   -- hay más de una deuda viva
  AND  agg.ImportesDistintos = 1                       -- todas del MISMO importe → copia
  AND  agg.DeudaOriginal > dc.DocTotal + 0.01          -- la deuda supera al documento
  AND  ABS(mov.CargosCuenta - dc.DocTotal) <= 0.01;    -- el CARGO está bien → saldo sano

/* ───────────────────────────────────────────────────────────────────────────
   Filas sobrantes: se queda la MÁS imputada (menor pendiente); a igualdad, la más vieja.
   Así nunca se anula una deuda que ya recibió cobros.
   ─────────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('tempdb..#sobrantes') IS NOT NULL DROP TABLE #sobrantes;

SELECT dd.DDeIdDocumento,
       dd.DocIdDocumento,
       a.Documento,
       dd.CueIdCuenta,
       dd.OrdIdOrden,
       dd.DDeEstado,
       dd.DDeImporteOriginal,
       dd.DDeImportePendiente,
       ROW_NUMBER() OVER (
         PARTITION BY dd.DocIdDocumento, dd.CueIdCuenta,
                      ISNULL(dd.OrdIdOrden,-1), dd.DDeImporteOriginal
         ORDER BY dd.DDeImportePendiente ASC, dd.DDeIdDocumento ASC
       ) AS rn
INTO   #sobrantes
FROM   dbo.DeudaDocumento dd
JOIN   #docsA a ON a.DocIdDocumento = dd.DocIdDocumento
WHERE  dd.DDeEstado NOT IN ('ANULADO','ANULADA','CANCELADO','CANCELADA');

/* ───────────────────────────────────────────────────────────────────────────
   PASO 1 — PREVIEW (solo lectura). Nada se modificó todavía.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'DOCUMENTOS AFECTADOS' AS Bloque, COUNT(*) AS Cantidad FROM #docsA;

SELECT 'SE CONSERVA' AS Accion, * FROM #sobrantes WHERE rn = 1 ORDER BY Documento;

SELECT 'SE CANCELA'  AS Accion, * FROM #sobrantes WHERE rn > 1 ORDER BY Documento;

-- Control: ninguna fila a cancelar debe tener cobros imputados
SELECT 'ALERTA: fila a cancelar CON cobros imputados' AS Aviso, *
FROM   #sobrantes
WHERE  rn > 1
  AND  DDeImportePendiente < DDeImporteOriginal - 0.01;
-- ↑ Si esto devuelve filas, PARAR y revisarlas a mano.

/* ═══════════════════════════════════════════════════════════════════════════
   A PARTIR DE ACÁ SE ESCRIBE. Todo dentro de una transacción.
   ═══════════════════════════════════════════════════════════════════════════ */
BEGIN TRANSACTION;

/* PASO 2 — Cancelar las deudas sobrantes */
UPDATE dd
SET    dd.DDeEstado           = @EstadoAnulado,
       dd.DDeImportePendiente = 0
FROM   dbo.DeudaDocumento dd
JOIN   #sobrantes s ON s.DDeIdDocumento = dd.DDeIdDocumento
WHERE  s.rn > 1;

PRINT 'Deudas canceladas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

/* PASO 3 — Recalcular DocPagado en los documentos que quedaron sin pendiente */
UPDATE dc
SET    dc.DocPagado = 1
FROM   dbo.DocumentosContables dc
JOIN   #docsA a ON a.DocIdDocumento = dc.DocIdDocumento
WHERE  (dc.DocPagado IS NULL OR dc.DocPagado = 0)
  AND  NOT EXISTS (
         SELECT 1 FROM dbo.DeudaDocumento d
         WHERE  d.DocIdDocumento = dc.DocIdDocumento
           AND  d.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
           AND  d.DDeImportePendiente > 0.01
       );

PRINT 'Documentos marcados DocPagado=1: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

/* PASO 4 — Verificación post-fix: la deuda viva de cada documento ya no lo supera */
SELECT a.Documento, a.DocTotal, a.CargosCuenta,
       (SELECT ISNULL(SUM(d.DDeImportePendiente),0) FROM dbo.DeudaDocumento d
         WHERE d.DocIdDocumento = a.DocIdDocumento
           AND d.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS PendienteVivoAhora,
       (SELECT dc.DocPagado FROM dbo.DocumentosContables dc
         WHERE dc.DocIdDocumento = a.DocIdDocumento)             AS DocPagadoAhora
FROM   #docsA a
ORDER  BY a.Documento;

/* ───────────────────────────────────────────────────────────────────────────
   Si el PASO 4 cuadra → descomentar COMMIT. Si no → ROLLBACK.
   ─────────────────────────────────────────────────────────────────────────── */
ROLLBACK TRANSACTION;
-- COMMIT TRANSACTION;
