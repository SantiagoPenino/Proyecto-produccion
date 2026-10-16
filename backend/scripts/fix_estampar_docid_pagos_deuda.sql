/* ═══════════════════════════════════════════════════════════════════════════
   BUCKET A — SOLO FALTA VÍNCULO: estampar DocIdDocumento en movs PAGO  ·  27-jul-2026
   Auditoría "cobro sin movimiento que lo respalde" (barrido post-MoreggiT).
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASA
     Estos 15 movimientos PAGO existen, la plata es real (cobros de "Pago de
     deudas combinadas" en caja), pero quedaron con DocIdDocumento NULL (cobros
     anteriores al fix de pagos-360 que estampa el doc) o estampados a OTRO
     documento del mismo cliente. Por eso el barrido los daba como "cobro sin
     movimiento": el pago está, solo le falta el vínculo al comprobante.

   QUÉ HACE
     Estampa el DocIdDocumento correcto (tomado del "DeudaDoc #NNNN" que cada
     movimiento trae en sus observaciones) y, en 3 casos donde se conoce, el
     PagIdPago del pago de caja. NO toca importes, deudas ni saldos: los saldos
     de los clientes NO cambian, solo el 360 pasa a mostrar a qué documento fue
     cada cobro (hoy los muestra como anticipo o contra el doc equivocado).

   DOCUMENTOS QUE QUEDAN RESPALDADOS
     PC-2056 Atan 1.427,68 · PC-2094 Maidana 15.123 · PC-2071 Támara 14.559,62
     PC-2072 Palmero 3.578+1.416,54 · PC-2220 Palmero 6.600+1.883+446+4.000
     PC-2074 Palmero 154 · FA-212 G.Casas 328,50 · PC-2461 Yesusport 1.881
     PC-2093 Yesusport 873,06 · FA-19 F.Curbelo 461,67 (estaba en FA-189)
     FA-48 Posse 1.544,88 (estaba en FA-254, cuya deuda sigue viva)

   Guards por señas (MovId + importe + doc actual): si algo no coincide, esa
   fila se saltea y se lista al final. Idempotente (re-correrlo no duplica).

   MODO DE USO: correr PASO 0 (lectura). Si cuadra, PASO 1 y revisar el PASO 2:
   la columna Faltante de los docs tocados debe quedar en ~0 → COMMIT.
   Si algo no cierra → ROLLBACK TRANSACTION;
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

DECLARE @t TABLE (MovId INT, Importe DECIMAL(18,2), DocViejo INT, DocNuevo INT, PagId INT);
INSERT INTO @t (MovId, Importe, DocViejo, DocNuevo, PagId) VALUES
  (21826,  1427.68, NULL, 3863, NULL),  -- PC-2056 Atan
  (20324, 15123.00, NULL, 4071, NULL),  -- PC-2094 Maidana
  (21600, 14559.62, NULL, 3962, 53999), -- PC-2071 Támara
  (20993,  3578.00, NULL, 3977, NULL),  -- PC-2072 Palmero
  (20996,  1416.54, NULL, 3977, NULL),  -- PC-2072 Palmero
  (21640,  6600.00, NULL, 4462, NULL),  -- PC-2220 Palmero
  (21641,  1883.00, NULL, 4462, NULL),  -- PC-2220 Palmero
  (22201,   446.00, NULL, 4462, NULL),  -- PC-2220 Palmero
  (22204,  4000.00, NULL, 4462, NULL),  -- PC-2220 Palmero
  (22200,   154.00, NULL, 3980, NULL),  -- PC-2074 Palmero
  (21651,   328.50, NULL, 4823, NULL),  -- FA-212 Gustavo Casas
  (22192,  1881.00, NULL, 4840, 54184), -- PC-2461 Yesusport
  (22184,   873.06, NULL, 4067, 54182), -- PC-2093 Yesusport
  (20318,   461.67, 4675, 3034, NULL),  -- FA-19 Favio Curbelo (sacar de FA-189)
  (20986,  1544.88, 5070, 3228, NULL);  -- FA-48 Posse (sacar de FA-254)

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT t.MovId, t.Importe AS ImporteEsperado, t.DocViejo, t.DocNuevo,
       m.MovImporte, m.DocIdDocumento AS DocActual, m.PagIdPago, m.MovAnulado,
       LEFT(ISNULL(m.MovObservaciones,''),90) AS Obs
FROM @t t LEFT JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = t.MovId
ORDER BY t.MovId;

/* ── PASO 1 — Estampado ────────────────────────────────────────────────── */
BEGIN TRANSACTION;

UPDATE m
SET m.DocIdDocumento = t.DocNuevo,
    m.PagIdPago      = COALESCE(t.PagId, m.PagIdPago),
    m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones,'')
        + ' | DocIdDocumento estampado a ' + CAST(t.DocNuevo AS VARCHAR(20))
        + CASE WHEN t.DocViejo IS NOT NULL THEN ' (estaba en ' + CAST(t.DocViejo AS VARCHAR(20)) + ' por error)' ELSE '' END
        + '. fix_estampar_docid_pagos_deuda.sql', 500)
FROM dbo.MovimientosCuenta m
JOIN @t t ON t.MovId = m.MovIdMovimiento
WHERE ABS(m.MovImporte - t.Importe) < 0.01
  AND ISNULL(m.DocIdDocumento, -1) = ISNULL(t.DocViejo, -1)
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

PRINT CONCAT('Movimientos estampados: ', @@ROWCOUNT, ' de 15 esperados.');

-- Filas que NO se pudieron aplicar (guard falló: ya corrido, o algo cambió)
SELECT t.MovId, 'NO APLICADO (guard)' AS Estado, m.MovImporte, m.DocIdDocumento, m.MovAnulado
FROM @t t LEFT JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = t.MovId
WHERE m.MovIdMovimiento IS NULL
   OR ABS(m.MovImporte - t.Importe) >= 0.01
   OR ISNULL(m.DocIdDocumento, -1) <> t.DocNuevo;  -- tras el update deben apuntar todos al DocNuevo

-- La deuda de PC-2093 (#6326) quedó pagada entera (pend 0.0001) pero con estado
-- 'VENCIDO': coherencia — su pago es justamente el mov 22184 recién estampado.
UPDATE dbo.DeudaDocumento
SET DDeEstado = 'COBRADO',
    DDeFechaCobro = ISNULL(DDeFechaCobro, '2026-07-15T12:26:07'),
    DDeObservaciones = LEFT(ISNULL(DDeObservaciones + ' | ','')
        + 'Estado corregido VENCIDO->COBRADO (pendiente 0, pagada por mov 22184 / Pago #54182). fix_estampar_docid_pagos_deuda.sql', 500)
WHERE DDeIdDocumento = 6326 AND DDeEstado = 'VENCIDO' AND DDeImportePendiente < 0.01;
PRINT CONCAT('Deuda #6326 (PC-2093) VENCIDO->COBRADO: ', @@ROWCOUNT, ' fila.');

/* ── PASO 2 — Verificación: cobrado vs movs vinculados de los docs tocados.
      Faltante debe quedar ~0 en todos, salvo negativos ESPERADOS (no son error):
        PC-2220 -362,28 y PC-2461 -244,50 → PAGO_CRUZADO de cobertura de órdenes
          que ya estaban estampados a esos docs (no se tocan acá);
        FA-189 -5,41 → un pago chico propio de ese doc, correcto. */
;WITH deu AS (
  SELECT DocIdDocumento, SUM(DDeImporteOriginal - DDeImportePendiente) AS Cobrado
  FROM dbo.DeudaDocumento WHERE DDeEstado IN ('COBRADO','PARCIAL')
  GROUP BY DocIdDocumento
), mov AS (
  SELECT DocIdDocumento, SUM(MovImporte) AS Pagado
  FROM dbo.MovimientosCuenta
  WHERE MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO','CREDITO_PLAN')
    AND (MovAnulado IS NULL OR MovAnulado = 0)
  GROUP BY DocIdDocumento
)
SELECT d.DocIdDocumento, RTRIM(d.DocSerie)+'-'+RTRIM(d.DocNumero) AS Doc,
       CAST(ISNULL(deu.Cobrado,0) AS DECIMAL(18,2)) AS Cobrado,
       CAST(ISNULL(mov.Pagado,0)  AS DECIMAL(18,2)) AS MovVinculados,
       CAST(ISNULL(deu.Cobrado,0) - ISNULL(mov.Pagado,0) AS DECIMAL(18,2)) AS Faltante
FROM dbo.DocumentosContables d
LEFT JOIN deu ON deu.DocIdDocumento = d.DocIdDocumento
LEFT JOIN mov ON mov.DocIdDocumento = d.DocIdDocumento
WHERE d.DocIdDocumento IN (3863,4071,3962,3977,4462,3980,4823,4840,4067,3034,3228,4675,5070)
ORDER BY d.DocIdDocumento;

/* Si los Faltante quedaron ~0 (y FA-189/FA-254 sin pagos ajenos) →  COMMIT TRANSACTION;
   Si algo no cierra                                              →  ROLLBACK TRANSACTION;  y avisar. */
