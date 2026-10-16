-- ============================================================
-- DIAGNÓSTICO Y CORRECCIÓN: Facturas UYU con líneas en USD
-- Síntoma: DocTotal (UYU) ≠ SUM(DcdTotal) (USD) → ratio ≈ tipo de cambio
-- ============================================================


-- ── PASO 1: RESUMEN — ¿cuántas facturas están afectadas? ──────
WITH Base AS (
    SELECT
        doc.DocIdDocumento,
        doc.DocFechaEmision,
        ROUND(doc.DocTotal / NULLIF(SUM(dcd.DcdTotal), 0), 2) AS Ratio
    FROM dbo.DocumentosContables doc WITH(NOLOCK)
    JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
        ON dcd.DocIdDocumento = doc.DocIdDocumento
    WHERE doc.MonIdMoneda = 1
      AND doc.DocTotal > 0
    GROUP BY doc.DocIdDocumento, doc.DocFechaEmision, doc.DocTotal
    HAVING ROUND(doc.DocTotal / NULLIF(SUM(dcd.DcdTotal), 0), 2) BETWEEN 5 AND 100
)
SELECT
    COUNT(*)       AS FacturasAfectadas,
    MIN(DocFechaEmision) AS DesdeF,
    MAX(DocFechaEmision) AS HastaF,
    MIN(Ratio)     AS RatioMin,
    MAX(Ratio)     AS RatioMax
FROM Base;
-- Ratio entre 5 y 100 = las líneas están en USD y el total en UYU


-- ── PASO 2: DETALLE de cada factura afectada ──────────────────
SELECT
    doc.DocIdDocumento,
    doc.DocSerie + '-' + doc.DocNumero           AS Comprobante,
    doc.DocTipo,
    CONVERT(VARCHAR(10), doc.DocFechaEmision, 103) AS Fecha,
    doc.DocTotal                                 AS TotalUYU,
    ROUND(SUM(dcd.DcdTotal), 2)                  AS SumaLineasActual,
    ROUND(doc.DocTotal / NULLIF(SUM(dcd.DcdTotal),0), 4) AS FactorConversion,
    COUNT(dcd.DcdIdDetalle)                      AS CantLineas,
    doc.CfeEstado
FROM dbo.DocumentosContables doc WITH(NOLOCK)
JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
    ON dcd.DocIdDocumento = doc.DocIdDocumento
WHERE doc.MonIdMoneda = 1
  AND doc.DocTotal > 0
GROUP BY doc.DocIdDocumento, doc.DocSerie, doc.DocNumero,
         doc.DocTipo, doc.DocFechaEmision, doc.DocTotal, doc.CfeEstado
HAVING ROUND(doc.DocTotal / NULLIF(SUM(dcd.DcdTotal),0), 2) BETWEEN 5 AND 100
ORDER BY doc.DocFechaEmision DESC;


-- ── PASO 3: VER LÍNEAS ACTUALES vs LO QUE DEBERÍAN SER ────────
SELECT
    doc.DocSerie + '-' + doc.DocNumero           AS Comprobante,
    dcd.DcdIdDetalle,
    dcd.OrdCodigoOrden,
    dcd.DcdNomItem,
    dcd.DcdCantidad,
    dcd.DcdPrecioUnitario                        AS PU_Actual,
    ROUND(dcd.DcdPrecioUnitario * factor.F, 4)  AS PU_Corregido,
    dcd.DcdSubtotal                              AS Sub_Actual,
    ROUND(dcd.DcdSubtotal      * factor.F, 2)   AS Sub_Corregido,
    dcd.DcdImpuestos                             AS Imp_Actual,
    ROUND(dcd.DcdImpuestos     * factor.F, 2)   AS Imp_Corregido,
    dcd.DcdTotal                                 AS Tot_Actual,
    ROUND(dcd.DcdTotal         * factor.F, 2)   AS Tot_Corregido,
    ROUND(factor.F, 4)                           AS FactorUsado
FROM dbo.DocumentosContables doc WITH(NOLOCK)
JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
    ON dcd.DocIdDocumento = doc.DocIdDocumento
JOIN (
    SELECT
        d2.DocIdDocumento,
        d2.DocTotal / NULLIF(SUM(dd2.DcdTotal), 0) AS F
    FROM dbo.DocumentosContables d2 WITH(NOLOCK)
    JOIN dbo.DocumentosContablesDetalle dd2 WITH(NOLOCK)
        ON dd2.DocIdDocumento = d2.DocIdDocumento
    WHERE d2.MonIdMoneda = 1 AND d2.DocTotal > 0
    GROUP BY d2.DocIdDocumento, d2.DocTotal
    HAVING ROUND(d2.DocTotal / NULLIF(SUM(dd2.DcdTotal),0), 2) BETWEEN 5 AND 100
) factor ON factor.DocIdDocumento = doc.DocIdDocumento
ORDER BY doc.DocFechaEmision DESC, dcd.DcdIdDetalle;


-- ============================================================
-- ── CORRECCIÓN (ejecutar solo después de revisar PASO 2 y 3) ─
-- ============================================================
-- El factor de conversión se calcula por documento como:
--   DocTotal (UYU) / SUM(DcdTotal) (USD) = tipo de cambio exacto aplicado

BEGIN TRANSACTION;

UPDATE dcd
SET
    dcd.DcdPrecioUnitario = ROUND(dcd.DcdPrecioUnitario * factor.F, 4),
    dcd.DcdSubtotal       = ROUND(dcd.DcdSubtotal       * factor.F, 2),
    dcd.DcdImpuestos      = ROUND(dcd.DcdImpuestos      * factor.F, 2),
    dcd.DcdTotal          = ROUND(dcd.DcdTotal           * factor.F, 2)
FROM dbo.DocumentosContablesDetalle dcd
JOIN (
    SELECT
        d2.DocIdDocumento,
        d2.DocTotal / NULLIF(SUM(dd2.DcdTotal), 0) AS F
    FROM dbo.DocumentosContables d2
    JOIN dbo.DocumentosContablesDetalle dd2
        ON dd2.DocIdDocumento = d2.DocIdDocumento
    WHERE d2.MonIdMoneda = 1 AND d2.DocTotal > 0
    GROUP BY d2.DocIdDocumento, d2.DocTotal
    HAVING ROUND(d2.DocTotal / NULLIF(SUM(dd2.DcdTotal),0), 2) BETWEEN 5 AND 100
) factor ON factor.DocIdDocumento = dcd.DocIdDocumento;

-- Verificar que las sumas cuadren antes de confirmar:
SELECT
    doc.DocSerie + '-' + doc.DocNumero   AS Comprobante,
    doc.DocTotal                         AS TotalDocumento,
    ROUND(SUM(dcd.DcdTotal), 2)          AS SumaLineasTrasUpdate,
    ABS(doc.DocTotal - SUM(dcd.DcdTotal)) AS Diferencia
FROM dbo.DocumentosContables doc
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = doc.DocIdDocumento
WHERE doc.DocIdDocumento IN (
    SELECT d2.DocIdDocumento
    FROM dbo.DocumentosContables d2
    JOIN dbo.DocumentosContablesDetalle dd2 ON dd2.DocIdDocumento = d2.DocIdDocumento
    WHERE d2.MonIdMoneda = 1 AND d2.DocTotal > 0
    GROUP BY d2.DocIdDocumento, d2.DocTotal
    HAVING ROUND(d2.DocTotal / NULLIF(SUM(dd2.DcdTotal),0), 2) BETWEEN 5 AND 100
)
GROUP BY doc.DocIdDocumento, doc.DocSerie, doc.DocNumero, doc.DocTotal
ORDER BY Diferencia DESC;

-- Si Diferencia es < 0.05 en todos → COMMIT; si algo está raro → ROLLBACK
-- ROLLBACK TRANSACTION;
COMMIT TRANSACTION;
