/* ============================================================================
   fix_fecha_deuda_segun_documento.sql
   ----------------------------------------------------------------------------
   Realinea la fecha de las deudas con la fecha de SU documento.

   EL PROBLEMA
   `crearDeudaDocumento` estampaba SIEMPRE la fecha de hoy (new Date()) en
   DDeFechaEmision, y calculaba DDeFechaVencimiento a partir de ella. Si la deuda
   se creó después que el documento (re-facturación, edición, arreglo manual), la
   deuda nace con fecha de HOY aunque la factura sea de hace un mes:

     PC-458  → factura del 16/06, deuda con fecha 15/07 → figura "AL DÍA"
     PC-415  → factura del 16/06, deuda con fecha 10/07 → 24 días de desfasaje

   Consecuencia: deuda vieja que NO aparece vencida, no entra en la antigüedad de
   saldos y no se reclama. La fecha la manda el comprobante.

   El código ya toma la fecha del documento, así que esto es una sola pasada sobre
   el histórico.

   NO TOCA:
     · deudas sin documento (DocIdDocumento NULL) — son de órdenes sin facturar y
       su fecha propia es la correcta;
     · deudas cuya fecha ya coincide con la del documento (±2 días).

   El vencimiento se recalcula respetando los días de la condición de pago del
   cliente, igual que hace el alta: vencimiento = emisión + CPaDiasVencimiento.
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. PREVIEW — correr esto primero ────────────────────────────────────────
SELECT
    Doc            = RTRIM(dc.DocSerie) + '-' + RTRIM(CAST(dc.DocNumero AS VARCHAR(20))),
    dd.DDeIdDocumento,
    dd.DDeEstado,
    dd.DDeImportePendiente,
    Doc_Emision    = CONVERT(varchar(10), dc.DocFechaEmision, 23),
    Deuda_Emision  = CONVERT(varchar(10), dd.DDeFechaEmision, 23),
    Deuda_Vto      = CONVERT(varchar(10), dd.DDeFechaVencimiento, 23),
    DiasDeError    = DATEDIFF(DAY, dc.DocFechaEmision, dd.DDeFechaEmision),
    -- Cómo queda
    Nueva_Emision  = CONVERT(varchar(10), CAST(dc.DocFechaEmision AS DATE), 23),
    Nuevo_Vto      = CONVERT(varchar(10), DATEADD(DAY, ISNULL(cp.CPaDiasVencimiento, 0), CAST(dc.DocFechaEmision AS DATE)), 23),
    VencidaHoy     = CASE WHEN DATEADD(DAY, ISNULL(cp.CPaDiasVencimiento, 0), CAST(dc.DocFechaEmision AS DATE)) < CAST(GETDATE() AS DATE)
                          THEN 'SI — pasa a figurar vencida' ELSE 'no' END
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
JOIN dbo.CuentasCliente cc      ON cc.CueIdCuenta    = dd.CueIdCuenta
LEFT JOIN dbo.CondicionesPago cp ON cp.CPaIdCondicion = cc.CPaIdCondicion
WHERE dd.DocIdDocumento IS NOT NULL
  AND dc.DocFechaEmision IS NOT NULL
  AND ABS(DATEDIFF(DAY, dc.DocFechaEmision, dd.DDeFechaEmision)) > 2
ORDER BY ABS(DATEDIFF(DAY, dc.DocFechaEmision, dd.DDeFechaEmision)) DESC;
GO

-- ── 2. EL FIX — descomentar tras revisar el preview ──────────────────────────
/*
BEGIN TRANSACTION;

UPDATE dd
SET dd.DDeFechaEmision     = CAST(dc.DocFechaEmision AS DATE),
    dd.DDeFechaVencimiento = DATEADD(DAY, ISNULL(cp.CPaDiasVencimiento, 0), CAST(dc.DocFechaEmision AS DATE))
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
JOIN dbo.CuentasCliente cc      ON cc.CueIdCuenta    = dd.CueIdCuenta
LEFT JOIN dbo.CondicionesPago cp ON cp.CPaIdCondicion = cc.CPaIdCondicion
WHERE dd.DocIdDocumento IS NOT NULL
  AND dc.DocFechaEmision IS NOT NULL
  AND ABS(DATEDIFF(DAY, dc.DocFechaEmision, dd.DDeFechaEmision)) > 2;

PRINT '[OK] Deudas realineadas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Verificación: no debe quedar ninguna con más de 2 días de diferencia.
SELECT Quedan = COUNT(*)
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE dd.DocIdDocumento IS NOT NULL AND dc.DocFechaEmision IS NOT NULL
  AND ABS(DATEDIFF(DAY, dc.DocFechaEmision, dd.DDeFechaEmision)) > 2;

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

-- ── 3. OJO: el estado no se recalcula solo ──────────────────────────────────
-- DDeEstado ('PENDIENTE' vs 'VENCIDO') es una columna, no se deriva de la fecha.
-- Tras el UPDATE, las deudas que pasaron a estar vencidas siguen diciendo
-- 'PENDIENTE'. La pantalla igual las muestra vencidas porque el badge se calcula
-- con DiasVencido (DATEDIFF contra DDeFechaVencimiento), pero si querés que la
-- columna también quede coherente, esto las alinea:
/*
BEGIN TRANSACTION;

UPDATE dbo.DeudaDocumento
SET DDeEstado = 'VENCIDO'
WHERE DDeEstado = 'PENDIENTE'
  AND DDeImportePendiente > 0.01
  AND DDeFechaVencimiento < CAST(GETDATE() AS DATE);

PRINT '[OK] Deudas marcadas VENCIDO: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO
