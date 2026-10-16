/* ============================================================================
   backfill_DocIdDocumento_pago_deuda.sql
   ----------------------------------------------------------------------------
   Repara los cobros hechos por "Pago de Deudas" que quedaron sin el documento
   que cancelaron.

   POR QUÉ: procesarPagoDeuda registraba el movimiento 'PAGO' sin DocIdDocumento.
   Como el Panel 360 usa ese campo para decir a qué se imputó el cobro, cuando
   falta cae en el rótulo "anticipo" — aunque el cobro sí cancelaba una factura.
   El dato no se perdió: el movimiento dejó 'DeudaDoc #<id>' en MovObservaciones,
   y DeudaDocumento sí sabe cuál es su DocIdDocumento. De ahí se reconstruye.

   Solo toca movimientos que HOY tienen DocIdDocumento NULL: nunca pisa un
   vínculo existente. Idempotente.

   El código ya estampa DocIdDocumento en los cobros nuevos, así que esto es
   una sola pasada sobre el histórico.
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. PREVIEW — correr esto primero y revisar antes del UPDATE ──────────────
SELECT
    m.MovIdMovimiento,
    CONVERT(varchar(10), m.MovFecha, 23)                     AS Fecha,
    m.MovImporte,
    LEFT(m.MovConcepto, 50)                                  AS Concepto,
    TRY_CAST(SUBSTRING(m.MovObservaciones, 11,
        CHARINDEX(' ', m.MovObservaciones + ' ', 11) - 11) AS INT) AS DDeId,
    dd.DocIdDocumento                                        AS DocAImputar,
    RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero)           AS SeVeraComo
FROM dbo.MovimientosCuenta m
JOIN dbo.DeudaDocumento dd
  ON dd.DDeIdDocumento = TRY_CAST(SUBSTRING(m.MovObservaciones, 11,
       CHARINDEX(' ', m.MovObservaciones + ' ', 11) - 11) AS INT)
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE m.MovTipo = 'PAGO'
  AND m.DocIdDocumento IS NULL
  AND m.MovObservaciones LIKE 'DeudaDoc #%'
  AND dd.DocIdDocumento IS NOT NULL
ORDER BY m.MovIdMovimiento DESC;
GO

-- ── 2. UPDATE — descomentar y correr una vez revisado el preview ─────────────
/*
BEGIN TRANSACTION;

UPDATE m
SET m.DocIdDocumento = dd.DocIdDocumento
FROM dbo.MovimientosCuenta m
JOIN dbo.DeudaDocumento dd
  ON dd.DDeIdDocumento = TRY_CAST(SUBSTRING(m.MovObservaciones, 11,
       CHARINDEX(' ', m.MovObservaciones + ' ', 11) - 11) AS INT)
WHERE m.MovTipo = 'PAGO'
  AND m.DocIdDocumento IS NULL
  AND m.MovObservaciones LIKE 'DeudaDoc #%'
  AND dd.DocIdDocumento IS NOT NULL;

PRINT '[OK] Movimientos reparados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Revisar el resultado y recién ahí confirmar:
--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

-- ── 3. Los que quedan sin reparar ────────────────────────────────────────────
-- Cobros de deudas de órdenes que nunca se facturaron (DeudaDocumento sin
-- DocIdDocumento): no hay documento al que imputarlos, y es correcto que no lo
-- tengan. El 360 los muestra por su orden, no como anticipo.
SELECT COUNT(*) AS SinDocumentoPorqueNoHayFactura
FROM dbo.MovimientosCuenta m
JOIN dbo.DeudaDocumento dd
  ON dd.DDeIdDocumento = TRY_CAST(SUBSTRING(m.MovObservaciones, 11,
       CHARINDEX(' ', m.MovObservaciones + ' ', 11) - 11) AS INT)
WHERE m.MovTipo = 'PAGO'
  AND m.DocIdDocumento IS NULL
  AND m.MovObservaciones LIKE 'DeudaDoc #%'
  AND dd.DocIdDocumento IS NULL;
GO
