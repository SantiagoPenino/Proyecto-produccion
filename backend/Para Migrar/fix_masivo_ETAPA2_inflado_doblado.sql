/* ============================================================================
   FIX MASIVO — ETAPA 2: INFLADO DOBLADO (líneas que tomaron el retiro entero)
   Fecha: 2026-07-08
   ----------------------------------------------------------------------------
   Alcance: documentos de RETIRO, NO anulados, NO aceptados en DGI, con
     SumaLineas > DocTotal, >1 línea, y SumaLineas >= DocTotal*1.3 (doblado).

   Corrección: repartir el DocTotal en proporción al OrdCostoFinal de cada
     orden (match por OrdCodigoOrden). La última línea absorbe el redondeo.
     Sólo se corrigen los documentos donde TODAS las líneas matchean una orden
     con costo > 0. Los demás quedan flageados para revisión (Etapa 2b).

   NO toca DocTotal (correcto). MODO PREVIEW por defecto.
   ============================================================================ */


-- ============================================================================
-- 1) PREVIEW — resumen: cuáles son corregibles y cuáles no
-- ============================================================================
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'
      AND (EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                   WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion AND td.TdeTipoReferencia='ORDEN_RETIRO')
           OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                      WHERE x.DocIdDocumento = dc.DocIdDocumento AND x.DcdDscItem LIKE '%Retiro diferido%'))
),
Base AS (
    SELECT dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal,
           CAST(dc.DocFechaEmision AS DATE) AS FechaEmision,
           SUM(dcd.DcdTotal) AS SumaLineas, COUNT(*) AS CantLineas
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal, CAST(dc.DocFechaEmision AS DATE)
    HAVING SUM(dcd.DcdTotal) > dc.DocTotal + 0.10
       AND COUNT(*) > 1
       AND SUM(dcd.DcdTotal) >= dc.DocTotal * 1.3
),
LineaOrden AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.OrdCodigoOrden, od.OrdCostoFinal
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Base b ON b.DocIdDocumento = dcd.DocIdDocumento
    OUTER APPLY (
        SELECT TOP 1 o.OrdCostoFinal
        FROM dbo.OrdenesDeposito o
        WHERE LTRIM(RTRIM(o.OrdCodigoOrden)) = LTRIM(RTRIM(dcd.OrdCodigoOrden))
        ORDER BY o.OrdIdOrden DESC
    ) od
),
Estado AS (
    SELECT DocIdDocumento,
           SUM(CASE WHEN OrdCostoFinal IS NULL OR OrdCostoFinal = 0 THEN 1 ELSE 0 END) AS SinMatch,
           SUM(ISNULL(OrdCostoFinal,0)) AS SumaCosto
    FROM LineaOrden GROUP BY DocIdDocumento
)
SELECT b.DocSerie + '-' + CAST(b.DocNumero AS VARCHAR) AS Factura,
       b.DocIdDocumento, b.FechaEmision, b.CantLineas, b.DocTotal, b.SumaLineas,
       e.SumaCosto, e.SinMatch,
       CAST(b.DocTotal / NULLIF(e.SumaCosto,0) AS DECIMAL(12,4)) AS FactorCosto,
       CASE WHEN e.SinMatch > 0 THEN 'REVISAR: lineas sin orden'
            WHEN e.SumaCosto = 0 THEN 'REVISAR: costo 0'
            WHEN b.DocTotal / NULLIF(e.SumaCosto,0) BETWEEN 0.98 AND 1.02 THEN 'CORREGIBLE (par)'
            WHEN b.DocTotal / NULLIF(e.SumaCosto,0) BETWEEN 30 AND 55   THEN 'CORREGIBLE (usd)'
            ELSE 'REVISAR: factor raro (costo no coincide con DocTotal)' END AS Estado
FROM Base b
JOIN Estado e ON e.DocIdDocumento = b.DocIdDocumento
ORDER BY Estado, b.SumaLineas - b.DocTotal DESC;


-- ============================================================================
-- 2) PREVIEW — detalle por línea con valor propuesto (solo CORREGIBLES)
-- ============================================================================
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'
      AND (EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                   WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion AND td.TdeTipoReferencia='ORDEN_RETIRO')
           OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                      WHERE x.DocIdDocumento = dc.DocIdDocumento AND x.DcdDscItem LIKE '%Retiro diferido%'))
),
Base AS (
    SELECT dc.DocIdDocumento, dc.DocTotal
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING SUM(dcd.DcdTotal) > dc.DocTotal + 0.10
       AND COUNT(*) > 1
       AND SUM(dcd.DcdTotal) >= dc.DocTotal * 1.3
),
LineaOrden AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.OrdCodigoOrden, dcd.DcdNomItem,
           dcd.DcdCantidad, dcd.DcdTotal AS TotalActual, b.DocTotal, od.OrdCostoFinal
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Base b ON b.DocIdDocumento = dcd.DocIdDocumento
    OUTER APPLY (
        SELECT TOP 1 o.OrdCostoFinal FROM dbo.OrdenesDeposito o
        WHERE LTRIM(RTRIM(o.OrdCodigoOrden)) = LTRIM(RTRIM(dcd.OrdCodigoOrden))
        ORDER BY o.OrdIdOrden DESC
    ) od
),
Suma AS (
    SELECT DocIdDocumento, SUM(ISNULL(OrdCostoFinal,0)) AS SumaCosto,
           SUM(CASE WHEN OrdCostoFinal IS NULL OR OrdCostoFinal=0 THEN 1 ELSE 0 END) AS SinMatch
    FROM LineaOrden GROUP BY DocIdDocumento
)
SELECT lo.DocIdDocumento, lo.DcdIdDetalle, lo.OrdCodigoOrden, lo.DcdNomItem,
       lo.DcdCantidad, lo.TotalActual, lo.OrdCostoFinal, lo.DocTotal, s.SumaCosto,
       ROUND(lo.OrdCostoFinal * (lo.DocTotal / NULLIF(s.SumaCosto,0)), 2) AS NuevoTotalPropuesto
FROM LineaOrden lo
JOIN Suma s ON s.DocIdDocumento = lo.DocIdDocumento
WHERE s.SinMatch = 0 AND s.SumaCosto > 0
  AND (lo.DocTotal / NULLIF(s.SumaCosto,0) BETWEEN 0.98 AND 1.02
       OR lo.DocTotal / NULLIF(s.SumaCosto,0) BETWEEN 30 AND 55)
ORDER BY lo.DocIdDocumento, lo.DcdIdDetalle;


/* ============================================================================
   3) APLICAR — descomentá para escribir. Solo toca los CORREGIBLES.
   ----------------------------------------------------------------------------

BEGIN TRANSACTION;

;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'
      AND (EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                   WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion AND td.TdeTipoReferencia='ORDEN_RETIRO')
           OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                      WHERE x.DocIdDocumento = dc.DocIdDocumento AND x.DcdDscItem LIKE '%Retiro diferido%'))
),
Base AS (
    SELECT dc.DocIdDocumento, dc.DocTotal
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING SUM(dcd.DcdTotal) > dc.DocTotal + 0.10
       AND COUNT(*) > 1
       AND SUM(dcd.DcdTotal) >= dc.DocTotal * 1.3
),
LineaOrden AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.DcdCantidad, b.DocTotal, od.OrdCostoFinal
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Base b ON b.DocIdDocumento = dcd.DocIdDocumento
    OUTER APPLY (
        SELECT TOP 1 o.OrdCostoFinal FROM dbo.OrdenesDeposito o
        WHERE LTRIM(RTRIM(o.OrdCodigoOrden)) = LTRIM(RTRIM(dcd.OrdCodigoOrden))
        ORDER BY o.OrdIdOrden DESC
    ) od
),
Suma AS (
    SELECT DocIdDocumento, SUM(ISNULL(OrdCostoFinal,0)) AS SumaCosto,
           SUM(CASE WHEN OrdCostoFinal IS NULL OR OrdCostoFinal=0 THEN 1 ELSE 0 END) AS SinMatch
    FROM LineaOrden GROUP BY DocIdDocumento
),
Calc AS (
    SELECT lo.DcdIdDetalle, lo.DocIdDocumento, lo.DcdCantidad, lo.DocTotal,
           ROUND(lo.OrdCostoFinal * (lo.DocTotal / NULLIF(s.SumaCosto,0)), 2) AS NuevoTotal,
           ROW_NUMBER() OVER (PARTITION BY lo.DocIdDocumento ORDER BY lo.DcdIdDetalle DESC) AS Rn
    FROM LineaOrden lo
    JOIN Suma s ON s.DocIdDocumento = lo.DocIdDocumento
    WHERE s.SinMatch = 0 AND s.SumaCosto > 0
      AND (lo.DocTotal / NULLIF(s.SumaCosto,0) BETWEEN 0.98 AND 1.02
           OR lo.DocTotal / NULLIF(s.SumaCosto,0) BETWEEN 30 AND 55)
),
ConSuma AS (
    SELECT *, SUM(NuevoTotal) OVER (PARTITION BY DocIdDocumento) AS SumaNuevo FROM Calc
),
Final AS (
    SELECT DcdIdDetalle, DcdCantidad,
           CASE WHEN Rn = 1 THEN NuevoTotal + (DocTotal - SumaNuevo) ELSE NuevoTotal END AS TotalLinea
    FROM ConSuma
)
UPDATE dcd SET
    DcdTotal          = f.TotalLinea,
    DcdSubtotal       = ROUND(f.TotalLinea / 1.22, 2),
    DcdImpuestos      = f.TotalLinea - ROUND(f.TotalLinea / 1.22, 2),
    DcdPrecioUnitario = ROUND(f.TotalLinea / NULLIF(f.DcdCantidad, 0), 4)
FROM dbo.DocumentosContablesDetalle dcd
JOIN Final f ON f.DcdIdDetalle = dcd.DcdIdDetalle;

-- Verificación: 0 filas = todos los corregibles quedaron cuadrados
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO' AND ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'
      AND (EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                   WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion AND td.TdeTipoReferencia='ORDEN_RETIRO')
           OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                      WHERE x.DocIdDocumento = dc.DocIdDocumento AND x.DcdDscItem LIKE '%Retiro diferido%'))
),
Base AS (
    SELECT dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal
    HAVING SUM(dcd.DcdTotal) > dc.DocTotal + 0.10 AND COUNT(*) > 1
       AND SUM(dcd.DcdTotal) >= dc.DocTotal * 1.3
)
SELECT b.DocSerie + '-' + CAST(b.DocNumero AS VARCHAR) AS Factura,
       b.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas,
       ABS(b.DocTotal - SUM(dcd.DcdTotal)) AS Diferencia
FROM Base b
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = b.DocIdDocumento
GROUP BY b.DocSerie, b.DocNumero, b.DocTotal
HAVING ABS(b.DocTotal - SUM(dcd.DcdTotal)) > 0.10;

-- Las que sigan apareciendo = las flageadas REVISAR (líneas sin orden), no los corregibles.
-- 0 corregibles pendientes -> COMMIT TRANSACTION;
-- algo raro -> ROLLBACK TRANSACTION;

============================================================================ */
