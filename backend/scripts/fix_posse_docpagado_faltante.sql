/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN (parche 2) — Posse Gutierrez: falta DocPagado=1
   30-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   fix_posse_aplicar_favor_existente.sql marcó DDeEstado='PAGADO' en las 2
   deudas — pero la consulta que arma el Estado de Cuenta
   (contabilidadService.js#runDocsQuery) EXCLUYE 'PAGADO' de "deuda viva"
   (PendVivo) y en ese caso cae a mirar DocumentosContables.DocPagado, que
   nunca se tocó. Por eso la pantalla seguía mostrando pendiente completo
   después del primer fix. Este script completa lo que faltó.

   RESULTADO ESPERADO: PC-2734 y FA-391 pasan a "Pagado" en el Estado de Cuenta.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT DocIdDocumento, DocSerie, DocNumero, DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento IN (6104, 6110);
-- esperado: DocPagado = 0 en ambas

BEGIN TRANSACTION;

UPDATE dbo.DocumentosContables
SET    DocPagado = 1
WHERE  DocIdDocumento IN (6104, 6110)
  AND  ISNULL(DocPagado, 0) = 0;

PRINT CONCAT('Documentos marcados pagados: ', @@ROWCOUNT);   -- esperado 2

/* ── Verificación ───────────────────────────────────────────────────────── */
SELECT DocIdDocumento, DocSerie, DocNumero, DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento IN (6104, 6110);
-- esperado: DocPagado = 1 en ambas

/* Si ambas dan DocPagado=1 → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
