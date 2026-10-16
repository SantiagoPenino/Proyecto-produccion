/* ═══════════════════════════════════════════════════════════════════════════
   FIX — Deudas duplicadas exactas en documentos CROSS-MONEDA (Bucket A, 2ª tanda)
   ───────────────────────────────────────────────────────────────────────────
   POR QUÉ HACE FALTA UN SEGUNDO SCRIPT
     fix_deudas_duplicadas_bucketA_22jul.sql exigía
         SUM(cargos del documento) = DocTotal
     sumando TODAS las cuentas. En un cierre de ciclo cross-moneda el documento
     genera DOS movimientos legítimos, uno en la cuenta UYU y otro en la USD:
     la suma da 2x DocTotal y esos documentos quedaban excluidos por error,
     como si tuvieran el cargo duplicado. No lo tienen — son dos cuentas.

     Acá el cargo se compara contra LA CUENTA DE LA PROPIA DEUDA. Si en esa
     cuenta el cargo coincide con el total del documento, el saldo está sano y
     la única basura es la fila repetida en DeudaDocumento.

   CASOS DETECTADOS (22-jul-2026)
     PC-2515  Palmero        cuenta 1115  deudas 7475 / 7476  48.419,74 c/u
     PC-2442  Támara flores  cuenta 1212  deudas 7281 / 7282  17.279,54 c/u

   NO ENTRAN (a propósito, los excluye la condición de "mismo importe"):
     PC-2327  deudas 29.352,00 vs 28.247,60 en la cuenta 452 → decidir cuál manda
     PC-2220 / PC-1932 / PC-2082 → ya limpios o sin duplicado

   NO toca MovimientosCuenta, ni CueSaldoActual, ni asientos.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

DECLARE @EstadoAnulado VARCHAR(20) = 'CANCELADO';

/* ───────────────────────────────────────────────────────────────────────────
   Candidatos: (documento, cuenta) con más de una deuda viva del MISMO importe,
   y cuyo cargo EN ESA CUENTA coincide con el total del documento.
   ─────────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;

SELECT dd.DocIdDocumento,
       dd.CueIdCuenta,
       dd.DDeImporteOriginal,
       CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       dc.DocTotal,
       COUNT(*) AS FilasVivas
INTO   #cand
FROM   dbo.DeudaDocumento dd
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
GROUP  BY dd.DocIdDocumento, dd.CueIdCuenta, dd.DDeImporteOriginal,
          dc.DocSerie, dc.DocNumero, dc.DocTotal
HAVING COUNT(*) > 1                                   -- dos o más filas idénticas
   AND ABS(
         ISNULL((SELECT SUM(ABS(m.MovImporte))
                 FROM   dbo.MovimientosCuenta m
                 WHERE  m.DocIdDocumento = dd.DocIdDocumento
                   AND  m.CueIdCuenta    = dd.CueIdCuenta   -- ← LA CUENTA DE LA DEUDA
                   AND  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','AJUSTE','FACTURA')
                   AND  ISNULL(m.MovAnulado, 0) = 0), 0)
         - dc.DocTotal
       ) <= 0.01;                                     -- el cargo de esa cuenta está sano

/* ───────────────────────────────────────────────────────────────────────────
   Filas sobrantes: se conserva la MÁS imputada (menor pendiente);
   a igualdad, la más vieja. Nunca se anula una deuda que recibió cobros.
   ─────────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('tempdb..#sobrantes') IS NOT NULL DROP TABLE #sobrantes;

SELECT dd.DDeIdDocumento, dd.DocIdDocumento, c.Documento, c.DocTotal,
       dd.CueIdCuenta, dd.OrdIdOrden, dd.DDeEstado,
       dd.DDeImporteOriginal, dd.DDeImportePendiente,
       ROW_NUMBER() OVER (
         PARTITION BY dd.DocIdDocumento, dd.CueIdCuenta, dd.DDeImporteOriginal
         ORDER BY dd.DDeImportePendiente ASC, dd.DDeIdDocumento ASC
       ) AS rn
INTO   #sobrantes
FROM   dbo.DeudaDocumento dd
JOIN   #cand c ON c.DocIdDocumento     = dd.DocIdDocumento
              AND c.CueIdCuenta        = dd.CueIdCuenta
              AND c.DDeImporteOriginal = dd.DDeImporteOriginal
WHERE  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL');

/* ── PASO 1 — PREVIEW (solo lectura) ─────────────────────────────────────── */
SELECT 'CANDIDATOS' AS Bloque, * FROM #cand ORDER BY Documento;

SELECT 'SE CONSERVA' AS Accion, * FROM #sobrantes WHERE rn = 1 ORDER BY Documento;
SELECT 'SE CANCELA'  AS Accion, * FROM #sobrantes WHERE rn > 1 ORDER BY Documento;

-- Control: ninguna fila a cancelar debería tener cobros imputados
SELECT 'ALERTA: fila a cancelar CON cobros' AS Aviso, *
FROM   #sobrantes
WHERE  rn > 1 AND DDeImportePendiente < DDeImporteOriginal - 0.01;
-- ↑ si devuelve filas, PARAR y revisarlas a mano.

/* ═══ A PARTIR DE ACÁ SE ESCRIBE ═══════════════════════════════════════════ */
BEGIN TRANSACTION;

/* PASO 2 — Cancelar las sobrantes */
UPDATE dd
SET    dd.DDeEstado           = @EstadoAnulado,
       dd.DDeImportePendiente = 0
FROM   dbo.DeudaDocumento dd
JOIN   #sobrantes s ON s.DDeIdDocumento = dd.DDeIdDocumento
WHERE  s.rn > 1;

PRINT 'Deudas canceladas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

/* PASO 3 — Recalcular DocPagado en los que quedaron sin pendiente */
UPDATE dc
SET    dc.DocPagado = 1
FROM   dbo.DocumentosContables dc
WHERE  (dc.DocPagado IS NULL OR dc.DocPagado = 0)
  AND  dc.DocIdDocumento IN (SELECT DISTINCT DocIdDocumento FROM #cand)
  AND  NOT EXISTS (
         SELECT 1 FROM dbo.DeudaDocumento d
         WHERE  d.DocIdDocumento = dc.DocIdDocumento
           AND  d.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
           AND  d.DDeImportePendiente > 0.01
       );

PRINT 'Documentos marcados DocPagado=1: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

/* PASO 4 — Verificación */
SELECT DISTINCT c.Documento, c.DocTotal, c.CueIdCuenta,
       (SELECT ISNULL(SUM(d.DDeImportePendiente),0) FROM dbo.DeudaDocumento d
         WHERE d.DocIdDocumento = c.DocIdDocumento
           AND d.CueIdCuenta    = c.CueIdCuenta
           AND d.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS PendienteVivoAhora
FROM   #cand c
ORDER  BY c.Documento;
-- Esperado: PendienteVivoAhora = DocTotal (una sola deuda, no el doble)

/* Si el PASO 4 cuadra → descomentar COMMIT. Si no → ROLLBACK. */
ROLLBACK TRANSACTION;
-- COMMIT TRANSACTION;
