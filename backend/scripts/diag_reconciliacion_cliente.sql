/* ============================================================================
   diag_reconciliacion_cliente.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Reconstruye el historial completo de UN cliente, documento por documento:
   factura → deuda(s) asociada(s) → pagos reales (aunque hayan quedado mal
   archivados) → si cierra o no. Pensado para encontrar TODAS las roturas de
   una cuenta contaminada (deudas duplicadas, pagos sin DocIdDocumento, cross-
   moneda), no solo la que ya conocemos.

   Cambiá @Cli abajo (o dejá el de Palmero, 998).

   CÓMO SE ARMA "lo realmente cobrado" por documento:
   Un pago puede estar linkeado de 2 formas (por el bug ya conocido, no
   siempre las dos):
     a) MovimientosCuenta.DocIdDocumento apunta directo al documento.
     b) MovimientosCuenta.MovObservaciones tiene el texto "DeudaDoc #NNNN" →
        hay que ir a buscar esa fila de DeudaDocumento y de ahí a su
        DocIdDocumento real.
   Esta consulta resuelve las dos formas y las une, para no perderse ningún
   pago aunque haya quedado "flotando" como anticipo.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 998;  -- Palmero. Cambiar para otro cliente.

-- ── 0. Setup: pagos del cliente con su DocIdDocumento RESUELTO (directo o vía Obs) ──
IF OBJECT_ID('tempdb..#pagosResueltos') IS NOT NULL DROP TABLE #pagosResueltos;

;WITH pagosCli AS (
    SELECT m.MovIdMovimiento, m.MovImporte, m.MovFecha, m.MovAnulado, m.DocIdDocumento,
           m.MovObservaciones, m.MovConcepto, cc.CueTipo,
           -- Parsea "DeudaDoc #NNNN" del texto de observaciones, si está
           DDeIdDesdeObs = CASE WHEN m.MovObservaciones LIKE '%DeudaDoc #%' THEN
               TRY_CAST(
                 LEFT(
                   STUFF(m.MovObservaciones, 1, PATINDEX('%DeudaDoc #%', m.MovObservaciones) + 9, ''),
                   PATINDEX('%[^0-9]%', STUFF(m.MovObservaciones, 1, PATINDEX('%DeudaDoc #%', m.MovObservaciones) + 9, '') + ' ') - 1
                 ) AS INT)
           ELSE NULL END
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo IN ('PAGO','COBRO')
)
SELECT
    p.MovIdMovimiento, p.MovImporte, p.MovFecha, p.MovAnulado, p.CueTipo,
    DocIdResuelto = COALESCE(p.DocIdDocumento, dd.DocIdDocumento),
    ViaObs = CASE WHEN p.DocIdDocumento IS NULL AND dd.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END,
    p.DDeIdDesdeObs,
    LEFT(ISNULL(p.MovObservaciones,''),120) AS Obs
INTO #pagosResueltos
FROM pagosCli p
LEFT JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = p.DDeIdDesdeObs;

-- ── 1. TODOS los documentos del cliente, con lo que dicen las 3 fuentes ──────
SELECT
    Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero), dc.DocIdDocumento,
    DocMoneda = mo.MonSimbolo, DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)), dc.DocEstado,
    dc.DocFechaEmision,
    -- Cuánto dicen las filas de DeudaDocumento que quedó pendiente (sumando todas las vivas)
    PendienteSegunDeuda = (SELECT CAST(SUM(dd.DDeImportePendiente) AS DECIMAL(18,2))
                           FROM dbo.DeudaDocumento dd
                           WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    -- Cuántas filas de deuda tiene (>1 = hubo duplicado en algún momento)
    FilasDeDeuda = (SELECT COUNT(*) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento),
    -- Lo REALMENTE cobrado según el libro mayor (resuelto directo + vía Obs), pagos vivos
    CobradoReal = (SELECT CAST(ISNULL(SUM(pr.MovImporte),0) AS DECIMAL(18,2))
                   FROM #pagosResueltos pr WHERE pr.DocIdResuelto = dc.DocIdDocumento AND pr.MovAnulado = 0),
    -- Diferencia: CobradoReal - (DocTotal - PendienteSegunDeuda) → si no da ~0, algo no cierra
    PagosViaObs = (SELECT COUNT(*) FROM #pagosResueltos pr WHERE pr.DocIdResuelto = dc.DocIdDocumento AND pr.ViaObs = 1 AND pr.MovAnulado = 0)
FROM dbo.DocumentosContables dc
JOIN dbo.Monedas mo ON mo.MonIdMoneda = dc.MonIdMoneda
WHERE dc.CliIdCliente = @Cli
ORDER BY dc.DocIdDocumento;

-- ── 2. Semáforo de anomalías — solo lo que no cierra limpio ─────────────────
-- OJO: comparamos "lo cobrado" contra lo que la DEUDA dice que debería estar
-- cobrado (DocTotal - PendienteSegunDeuda), NO contra el total de la factura
-- directo — un documento sin ninguna fila de deuda (ej. un recibo RC-xx, que
-- ES el pago en sí) o parcialmente pendiente A PROPÓSITO no es una anomalía.
IF OBJECT_ID('tempdb..#docsCli') IS NOT NULL DROP TABLE #docsCli;
SELECT
    dc.DocIdDocumento, Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)), dc.DocEstado,
    FilasDeDeudaVivas = (SELECT COUNT(*) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    FilasDeDeudaTotal = (SELECT COUNT(*) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento),
    PendienteSegunDeuda = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    CobradoReal = CAST(ISNULL((SELECT SUM(pr.MovImporte) FROM #pagosResueltos pr WHERE pr.DocIdResuelto = dc.DocIdDocumento AND pr.MovAnulado = 0),0) AS DECIMAL(18,2)),
    PagosViaObs = (SELECT COUNT(*) FROM #pagosResueltos pr WHERE pr.DocIdResuelto = dc.DocIdDocumento AND pr.ViaObs = 1 AND pr.MovAnulado = 0)
INTO #docsCli
FROM dbo.DocumentosContables dc
WHERE dc.CliIdCliente = @Cli;

SELECT
    Doc, DocIdDocumento, DocTotal, CobradoReal, FilasDeDeudaVivas, FilasDeDeudaTotal, PagosViaObs,
    EsperadoSegunDeuda = CAST(DocTotal - PendienteSegunDeuda AS DECIMAL(18,2)),
    Alerta = CASE
        WHEN FilasDeDeudaVivas > 1
            THEN '⚠️ MÁS DE UNA DEUDA VIVA (duplicado sin resolver)'
        WHEN FilasDeDeudaTotal > 0 AND ABS(CobradoReal - (DocTotal - PendienteSegunDeuda)) > 2
            THEN '⚠️ LO REALMENTE COBRADO NO COINCIDE CON LO QUE DICE LA DEUDA'
        WHEN PagosViaObs > 0
            THEN 'ⓘ tiene pagos que solo se encontraron vía observaciones (no linkeados directo)'
        ELSE NULL
    END
FROM #docsCli
WHERE DocEstado <> 'ANULADO'
  AND (
    FilasDeDeudaVivas > 1
    OR (FilasDeDeudaTotal > 0 AND ABS(CobradoReal - (DocTotal - PendienteSegunDeuda)) > 2)
    OR PagosViaObs > 0
  )
ORDER BY DocIdDocumento;

-- ── 3. Pagos que NO se pudieron atar a ningún documento (huérfanos totales) ──
-- Si aparece algo acá, es plata cobrada que no se sabe de qué factura es.
SELECT pr.MovIdMovimiento, pr.MovImporte, pr.MovFecha, pr.CueTipo, pr.Obs
FROM #pagosResueltos pr
WHERE pr.DocIdResuelto IS NULL AND pr.MovAnulado = 0
ORDER BY pr.MovFecha;

-- ── 4. Libro mayor completo del cliente (todos los movimientos, cronológico) ─
-- Para revisar a ojo la historia completa si algo de arriba no explica todo.
SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado,
       m.DocIdDocumento, LEFT(ISNULL(m.MovConcepto,''),60) AS Concepto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
ORDER BY m.MovFecha;

DROP TABLE #pagosResueltos;
DROP TABLE #docsCli;
