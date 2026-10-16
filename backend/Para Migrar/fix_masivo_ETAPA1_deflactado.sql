/* ============================================================================
   FIX MASIVO — ETAPA 1: DEFLACTADO UNIFORME (líneas en USD sin convertir a UYU)
   Fecha: 2026-07-08
   ----------------------------------------------------------------------------
   Alcance: documentos de RETIRO, NO anulados, NO aceptados en DGI, donde
     SumaLineas < DocTotal y el factor DocTotal/SumaLineas cae en [30,55]
     (rango de cotización USD plausible → confirma que TODAS las líneas están
      en USD crudo y el error es uniforme).

   Corrección: multiplicar Subtotal/Impuestos/Total/PrecioUnitario de CADA línea
     por el factor (= cotización implícita). Como el error es uniforme, esto es
     EXACTO y preserva las proporciones y el IVA de cada línea. La última línea
     absorbe el centavo de redondeo para que la suma quede = DocTotal.

   NO toca DocTotal (correcto). NO depende de OrdCostoFinal ni de OrdCodigoOrden.

   MODO PREVIEW por defecto. Para aplicar: descomentá el bloque BEGIN TRAN.
   ============================================================================ */

-- ── Definición común del conjunto ──────────────────────────────────────────
-- (se repite en cada statement porque T-SQL no comparte CTEs entre sentencias)


-- ============================================================================
-- 1) PREVIEW — documentos que entran y su factor
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
           SUM(dcd.DcdTotal) AS SumaLineas, COUNT(*) AS CantLineas
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal
    HAVING SUM(dcd.DcdTotal) < dc.DocTotal - 0.10
       AND dc.DocTotal / NULLIF(SUM(dcd.DcdTotal),0) BETWEEN 30 AND 55
)
SELECT DocSerie + '-' + CAST(DocNumero AS VARCHAR) AS Factura,
       DocIdDocumento, CantLineas, DocTotal, SumaLineas,
       CAST(DocTotal / NULLIF(SumaLineas,0) AS DECIMAL(10,4)) AS Factor
FROM Base
ORDER BY DocTotal DESC;


-- ============================================================================
-- 2) PREVIEW — detalle por línea con valor propuesto
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
    SELECT dc.DocIdDocumento, dc.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING SUM(dcd.DcdTotal) < dc.DocTotal - 0.10
       AND dc.DocTotal / NULLIF(SUM(dcd.DcdTotal),0) BETWEEN 30 AND 55
)
SELECT dcd.DocIdDocumento, dcd.DcdIdDetalle, dcd.DcdNomItem, dcd.DcdCantidad,
       dcd.DcdTotal AS TotalActual,
       ROUND(dcd.DcdTotal * (b.DocTotal / b.SumaLineas), 2) AS TotalPropuesto,
       b.DocTotal
FROM dbo.DocumentosContablesDetalle dcd
JOIN Base b ON b.DocIdDocumento = dcd.DocIdDocumento
ORDER BY dcd.DocIdDocumento, dcd.DcdIdDetalle;


/* ============================================================================
   3) APLICAR — descomentá para escribir. Revisá antes los PREVIEWs 1 y 2.
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
    SELECT dc.DocIdDocumento, dc.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING SUM(dcd.DcdTotal) < dc.DocTotal - 0.10
       AND dc.DocTotal / NULLIF(SUM(dcd.DcdTotal),0) BETWEEN 30 AND 55
),
Scaled AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, b.DocTotal,
           b.DocTotal / b.SumaLineas AS Factor,
           ROUND(dcd.DcdSubtotal       * (b.DocTotal / b.SumaLineas), 2) AS NewSub,
           ROUND(dcd.DcdImpuestos      * (b.DocTotal / b.SumaLineas), 2) AS NewImp,
           ROUND(dcd.DcdTotal          * (b.DocTotal / b.SumaLineas), 2) AS NewTot,
           ROUND(dcd.DcdPrecioUnitario * (b.DocTotal / b.SumaLineas), 4) AS NewPU,
           ROW_NUMBER() OVER (PARTITION BY dcd.DocIdDocumento ORDER BY dcd.DcdIdDetalle DESC) AS Rn
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Base b ON b.DocIdDocumento = dcd.DocIdDocumento
),
Sums AS (
    SELECT DocIdDocumento, SUM(NewTot) AS SumNewTot FROM Scaled GROUP BY DocIdDocumento
),
Final AS (
    SELECT s.DcdIdDetalle, s.NewSub, s.NewImp, s.NewPU, s.Rn,
           CASE WHEN s.Rn = 1 THEN s.NewTot + (s.DocTotal - su.SumNewTot) ELSE s.NewTot END AS FinalTot
    FROM Scaled s JOIN Sums su ON su.DocIdDocumento = s.DocIdDocumento
)
UPDATE dcd SET
    DcdTotal          = f.FinalTot,
    DcdSubtotal       = f.NewSub,
    DcdImpuestos      = CASE WHEN f.Rn = 1 THEN f.FinalTot - f.NewSub ELSE f.NewImp END,
    DcdPrecioUnitario = f.NewPU
FROM dbo.DocumentosContablesDetalle dcd
JOIN Final f ON f.DcdIdDetalle = dcd.DcdIdDetalle;

-- Verificación: 0 filas = todo cuadrado
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'
      AND (EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                   WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion AND td.TdeTipoReferencia='ORDEN_RETIRO')
           OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                      WHERE x.DocIdDocumento = dc.DocIdDocumento AND x.DcdDscItem LIKE '%Retiro diferido%'))
)
SELECT dc.DocSerie + '-' + CAST(dc.DocNumero AS VARCHAR) AS Factura,
       dc.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas,
       ABS(dc.DocTotal - SUM(dcd.DcdTotal)) AS Diferencia
FROM dbo.DocumentosContables dc
JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
GROUP BY dc.DocSerie, dc.DocNumero, dc.DocTotal
HAVING SUM(dcd.DcdTotal) < dc.DocTotal - 0.10
   AND dc.DocTotal / NULLIF(SUM(dcd.DcdTotal),0) BETWEEN 30 AND 55;

-- 0 filas  -> COMMIT TRANSACTION;
-- filas inesperadas -> ROLLBACK TRANSACTION;

============================================================================ */
