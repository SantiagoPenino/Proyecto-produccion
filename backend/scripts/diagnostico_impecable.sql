/* ============================================================================
   DIAGNÓSTICO "BASE IMPECABLE" — coherencia líneas vs DocTotal (SOLO LECTURA)
   ----------------------------------------------------------------------------
   Corré esto DESPUÉS de aplicar fix_lineas_MAESTRO.sql + fix_lineas_parciales.sql.
   La foto "impecable" = DESCUADRE_REAL en 0 (o solo lo que decidas dejar).
   NO escribe nada.
   ============================================================================ */
SET NOCOUNT ON;
DECLARE @dias int = 30;   -- ventana para "¿sigue pasando?"

IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;

;WITH L AS (
    SELECT DocIdDocumento, SUM(CAST(DcdTotal AS float)) AS Suma, COUNT(*) AS N
    FROM dbo.DocumentosContablesDetalle GROUP BY DocIdDocumento
)
SELECT
    dc.DocIdDocumento,
    RTRIM(dc.DocSerie) AS Serie,
    RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) AS Comprobante,
    dc.DocFechaEmision,
    RTRIM(ISNULL(dc.CfeEstado,'-')) AS Cfe,
    dc.CfeCAE,
    CASE WHEN dc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    CAST(dc.DocTotal AS decimal(18,2))  AS DocTotal,
    CAST(L.Suma AS decimal(18,2))       AS SumaLineas,
    CASE WHEN L.Suma > 0 THEN CAST(dc.DocTotal / L.Suma AS decimal(18,4)) END AS Ratio,
    CASE
        WHEN RTRIM(dc.DocSerie) = 'RC'                             THEN 'RC_RECIBO'
        WHEN ABS(dc.DocTotal - L.Suma) <= 2                         THEN 'OK'
        WHEN L.Suma > 0 AND dc.DocTotal / L.Suma BETWEEN 0.97 AND 1.03 THEN 'RUIDO_IVA'
        ELSE 'DESCUADRE_REAL'
    END AS Clase
INTO #C
FROM dbo.DocumentosContables dc
JOIN L ON L.DocIdDocumento = dc.DocIdDocumento
WHERE dc.DocTotal > 0
  AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%');

/* ── 1) RESUMEN por clase ─────────────────────────────────────────────────── */
SELECT Clase, COUNT(*) AS Cantidad FROM #C GROUP BY Clase ORDER BY Cantidad DESC;

/* ── 2) DESCUADRES REALES (esto es lo que falta para impecable) ───────────── */
SELECT Comprobante, Moneda, DocTotal, SumaLineas, Ratio, Cfe,
       CASE WHEN CfeCAE IS NOT NULL THEN 'ACEPTADO DGI' ELSE '' END AS DGI,
       CONVERT(varchar(10), DocFechaEmision, 23) AS Fecha
FROM #C WHERE Clase = 'DESCUADRE_REAL'
ORDER BY DocFechaEmision DESC;

/* ── 3) ¿SIGUE PASANDO? descuadres reales en los últimos @dias (confirma el fix de código) ── */
SELECT Comprobante, Moneda, DocTotal, SumaLineas, Ratio, Cfe,
       CONVERT(varchar(10), DocFechaEmision, 23) AS Fecha
FROM #C
WHERE Clase = 'DESCUADRE_REAL' AND DocFechaEmision >= DATEADD(DAY, -@dias, GETDATE())
ORDER BY DocFechaEmision DESC;

/* ── 4) DOCS con DocTotal>0 y SIN líneas de detalle ───────────────────────── */
SELECT RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) AS Comprobante,
       CAST(dc.DocTotal AS decimal(18,2)) AS DocTotal,
       RTRIM(ISNULL(dc.CfeEstado,'-')) AS Cfe,
       CONVERT(varchar(10), dc.DocFechaEmision, 23) AS Fecha
FROM dbo.DocumentosContables dc
WHERE dc.DocTotal > 0
  AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
  AND NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = dc.DocIdDocumento);

DROP TABLE #C;
