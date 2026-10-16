-- ============================================================================
-- Diagnóstico SOLO-LECTURA: coherencia moneda del documento vs moneda de líneas
-- ============================================================================
-- Detecta el bug "pagar en UY cosas que están en USD" (y su inverso): el cabezal
-- (DocumentosContables.DocTotal + MonIdMoneda) quedó en una moneda pero las líneas
-- (DocumentosContablesDetalle.DcdTotal) quedaron guardadas en la otra.
--
-- Firma: el ratio DocTotal / SUM(DcdTotal) cae en la banda del tipo de cambio.
-- Misma heurística que el fix del front (FacturacionManualModal.jsx, factorConversion).
--
-- NO escribe nada. Solo SELECTs. Correr en SSMS contra producción.
-- ============================================================================

SET NOCOUNT ON;

-- ── Parámetros ──────────────────────────────────────────────────────────────
DECLARE @cot        float;
DECLARE @cotLow     float;
DECLARE @cotHigh    float;
DECLARE @diasReciente int = 60;

SELECT TOP 1 @cot = CotDolar
FROM dbo.Cotizaciones WITH(NOLOCK)
ORDER BY CotFecha DESC;

SET @cot     = ISNULL(@cot, 40);
SET @cotLow  = @cot * 0.6;   -- ~24 si cot=40
SET @cotHigh = @cot * 1.6;   -- ~64 si cot=40

PRINT 'Cotizacion usada: US$1 = $' + CAST(@cot AS varchar(20));
PRINT 'Banda ratio: [' + CAST(@cotLow AS varchar(20)) + ' , ' + CAST(@cotHigh AS varchar(20)) + ']';

-- ── Base clasificada (tabla temporal reutilizable) ──────────────────────────
IF OBJECT_ID('tempdb..#Clasif') IS NOT NULL DROP TABLE #Clasif;

;WITH Lineas AS (
    SELECT DocIdDocumento,
           SUM(CAST(DcdTotal AS float)) AS SumaLineas,
           COUNT(*) AS NLineas
    FROM dbo.DocumentosContablesDetalle
    GROUP BY DocIdDocumento
),
Docs AS (
    SELECT
        dc.DocIdDocumento, dc.DocTipo, dc.DocSerie, dc.DocNumero,
        dc.DocFechaEmision, dc.DocEstado, dc.CfeEstado, dc.MonIdMoneda,
        CAST(dc.DocTotal AS decimal(18,2))  AS DocTotal,
        CAST(l.SumaLineas AS decimal(18,2)) AS SumaLineas,
        l.NLineas,
        CASE WHEN l.SumaLineas <> 0
             THEN CAST(dc.DocTotal / l.SumaLineas AS decimal(18,4)) END AS Ratio
    FROM dbo.DocumentosContables dc
    JOIN Lineas l ON l.DocIdDocumento = dc.DocIdDocumento
    WHERE l.SumaLineas > 0 AND dc.DocTotal > 0
)
SELECT
    *,
    CASE
        WHEN MonIdMoneda = 1 AND Ratio BETWEEN @cotLow AND @cotHigh
            THEN 'DOC_UYU_LINEAS_USD'
        WHEN MonIdMoneda = 2 AND Ratio BETWEEN (1.0/@cotHigh) AND (1.0/@cotLow)
            THEN 'DOC_USD_LINEAS_UYU'
        WHEN ABS(DocTotal - SumaLineas) > 1
            THEN 'DESCUADRE_OTRO'
        ELSE 'OK'
    END AS Clasificacion
INTO #Clasif
FROM Docs;

-- ── 1) Resumen por clasificación ────────────────────────────────────────────
SELECT Clasificacion, COUNT(*) AS Cantidad
FROM #Clasif
GROUP BY Clasificacion
ORDER BY Cantidad DESC;

-- ── 2) INCOHERENCIA DE MONEDA (el bug: líneas en la otra moneda que el cabezal) ─
SELECT
    DocIdDocumento AS Doc, RTRIM(DocTipo) AS Tipo,
    RTRIM(ISNULL(DocSerie,'')) + CAST(ISNULL(DocNumero,'') AS varchar(20)) AS Comprobante,
    CONVERT(varchar(10), DocFechaEmision, 23) AS Fecha,
    CASE WHEN MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    DocTotal, SumaLineas, Ratio,
    DocEstado, CfeEstado, Clasificacion
FROM #Clasif
WHERE Clasificacion IN ('DOC_UYU_LINEAS_USD','DOC_USD_LINEAS_UYU')
ORDER BY DocFechaEmision DESC;

-- ── 3) ¿SIGUE PASANDO? Incoherencias de moneda en los últimos N días ────────
SELECT
    DocIdDocumento AS Doc, RTRIM(DocTipo) AS Tipo,
    RTRIM(ISNULL(DocSerie,'')) + CAST(ISNULL(DocNumero,'') AS varchar(20)) AS Comprobante,
    CONVERT(varchar(10), DocFechaEmision, 23) AS Fecha,
    CASE WHEN MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    DocTotal, SumaLineas, Ratio, DocEstado, CfeEstado, Clasificacion
FROM #Clasif
WHERE Clasificacion IN ('DOC_UYU_LINEAS_USD','DOC_USD_LINEAS_UYU')
  AND DocFechaEmision >= DATEADD(DAY, -@diasReciente, GETDATE())
ORDER BY DocFechaEmision DESC;

-- ── 4) OTROS DESCUADRES (líneas <> total pero ratio NO es tipo de cambio) ────
--     Ojo: un ratio ~0.99 suele ser solo redondeo de IVA línea-a-línea (ruido),
--     no un problema de moneda. Se listan los mas alejados de 1 primero.
SELECT TOP 100
    DocIdDocumento AS Doc, RTRIM(DocTipo) AS Tipo,
    RTRIM(ISNULL(DocSerie,'')) + CAST(ISNULL(DocNumero,'') AS varchar(20)) AS Comprobante,
    CONVERT(varchar(10), DocFechaEmision, 23) AS Fecha,
    CASE WHEN MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    DocTotal, SumaLineas, Ratio, DocEstado, CfeEstado
FROM #Clasif
WHERE Clasificacion = 'DESCUADRE_OTRO'
ORDER BY ABS(1.0 - ISNULL(Ratio,0)) DESC;

-- ── 5) Documentos con DocTotal>0 y SIN líneas de detalle ────────────────────
SELECT COUNT(*) AS DocsSinLineas
FROM dbo.DocumentosContables dc
WHERE dc.DocTotal > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d
                  WHERE d.DocIdDocumento = dc.DocIdDocumento);

DROP TABLE #Clasif;
