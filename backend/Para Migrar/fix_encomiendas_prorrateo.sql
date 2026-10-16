/* ============================================================================
   FIX: facturas de ENCOMIENDA (retiro con >1 orden) con líneas DUPLICADAS
   Fecha: 2026-07-08
   ----------------------------------------------------------------------------
   BUG (raíz):
     Un retiro genera UNA fila en TransaccionDetalle cuyo TdeImporteFinal es el
     TOTAL del retiro. RelOrdenesRetiroOrdenes lo abre en N líneas (una por
     orden). En el MODO 1 de resolverLineasDetalle, cuando no había
     PedidosCobranzaDetalle, cada línea tomaba td.TdeImporteFinal (el retiro
     COMPLETO) -> el total de las líneas queda multiplicado por N.
     Resultado: DocTotal (cobro real) < SUM(DcdTotal) (inflado).

   ESTE SCRIPT corrige el DETALLE ya guardado reconstruyéndolo desde la fuente
   de verdad: el costo real de cada orden (OrdenesDeposito.OrdCostoFinal),
   repartiendo el DocTotal en proporción a ese costo. Así:
     - la suma de líneas vuelve a cuadrar EXACTO con DocTotal, y
     - cada línea refleja el costo real de su orden (no un 50/50).

   NO cambia DocTotal (que ya es correcto = el cobro real del retiro).

   Diferencia con fix_facturas_repetidas.sql:
     Aquel arregla descuadres de MONEDA/ESCALA (Patrón A: líneas en USD crudo;
     Patrón B: reescala proporcional al valor actual, sin USD). NINGUNO toca
     este caso: A no matchea (las líneas ya están en UYU), y B excluye docs con
     movimientos USD. Por eso hace falta este script aparte.

   MODO PREVIEW por defecto (solo SELECTs). Para aplicar: descomentá el bloque
   BEGIN TRANSACTION ... al final, revisá la verificación y COMMIT/ROLLBACK.

   SUPUESTOS (validalos con los SELECTs de preview):
     - DocTotal es correcto (= cobro real del retiro).
     - Cada línea del documento matchea una OrdenesDeposito por OrdCodigoOrden.
     - OrdCostoFinal está expresado con IVA incluido (igual que el MODO 2).
     - IVA 22% plano (Subtotal = Total/1.22), igual que como se generaron.
   ============================================================================ */


-- ============================================================================
-- 0) Conjunto AFECTADO (reutilizado por todos los bloques)
--    = documentos de un retiro, con >1 línea, cuya SUMA de líneas supera el
--      DocTotal y donde alguna línea sola vale ~el DocTotal completo (la firma
--      del bug: una orden tomó el importe del retiro entero en vez de su parte).
--      Cubre tanto el doblado total (todas las líneas fallaron) como el parcial
--      (solo algunas líneas fallaron, ej. ET-899: 14 + 35 = 49 con DocTotal 35).
-- ============================================================================
-- (definición repetida como CTE en cada bloque porque T-SQL no comparte CTEs
--  entre statements)


-- ============================================================================
-- 1) PREVIEW — RESUMEN: qué facturas están afectadas
-- ============================================================================
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND (
        EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion
                  AND td.TdeTipoReferencia = 'ORDEN_RETIRO')
        OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                   WHERE x.DocIdDocumento = dc.DocIdDocumento
                     AND x.DcdDscItem LIKE '%Retiro diferido%')
      )
),
Resumen AS (
    SELECT dc.DocIdDocumento,
           dc.DocSerie, dc.DocNumero, dc.DocTipo, dc.CfeEstado, dc.MonIdMoneda,
           dc.TcaIdTransaccion,
           dc.DocCliNombre,
           CAST(dc.DocFechaEmision AS DATE)     AS FechaEmision,
           dc.DocTotal,
           COUNT(*)                             AS CantLineas,
           SUM(dcd.DcdTotal)                    AS SumaLineas,
           MAX(dcd.DcdTotal)                    AS MaxLinea
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTipo,
             dc.CfeEstado, dc.MonIdMoneda, dc.TcaIdTransaccion, dc.DocCliNombre,
             CAST(dc.DocFechaEmision AS DATE), dc.DocTotal
)
SELECT
    r.DocIdDocumento,
    r.DocSerie + '-' + CAST(r.DocNumero AS VARCHAR) AS Factura,
    r.DocCliNombre                                   AS Cliente,
    -- Retiro (RW-...) desde la transacción de caja
    (SELECT TOP 1 'RW-' + CAST(td.TdeReferenciaId AS VARCHAR)
     FROM dbo.TransaccionDetalle td
     WHERE td.TcaIdTransaccion = r.TcaIdTransaccion
       AND td.TdeTipoReferencia = 'ORDEN_RETIRO')    AS Retiro,
    -- Órdenes (DTF-...) de la factura
    STUFF((SELECT ', ' + LTRIM(RTRIM(d2.OrdCodigoOrden))
           FROM dbo.DocumentosContablesDetalle d2
           WHERE d2.DocIdDocumento = r.DocIdDocumento
             AND d2.OrdCodigoOrden IS NOT NULL
           FOR XML PATH('')), 1, 2, '')              AS Ordenes,
    r.DocTipo, r.CfeEstado, r.MonIdMoneda, r.FechaEmision,
    r.DocTotal,
    r.CantLineas,
    r.SumaLineas,
    r.SumaLineas - r.DocTotal                        AS Descuadre,
    CAST(r.SumaLineas / NULLIF(r.DocTotal,0) AS DECIMAL(10,3)) AS RatioSumaVsTotal,
    CASE WHEN r.CfeEstado = 'ACEPTADO_DGI'
         THEN 'ATENCION: ya aceptada en DGI -> NC + reemision, NO se auto-corrige'
         ELSE 'Corregible por este script' END       AS Nota
FROM Resumen r
WHERE r.CantLineas > 1
  AND r.SumaLineas > r.DocTotal + 0.10         -- líneas infladas por encima del cobro real
  AND r.MaxLinea  >= r.DocTotal - 0.10         -- FIRMA: alguna línea sola vale ~el retiro completo
ORDER BY Descuadre DESC;


-- ============================================================================
-- 2) PREVIEW — DETALLE por línea: valor actual vs valor propuesto (por orden)
--    Revisá que cada línea matchee una orden (OrdCostoFinal no NULL) y que
--    el NuevoTotal por documento sume el DocTotal.
-- ============================================================================
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND (
        EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion
                  AND td.TdeTipoReferencia = 'ORDEN_RETIRO')
        OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                   WHERE x.DocIdDocumento = dc.DocIdDocumento
                     AND x.DcdDscItem LIKE '%Retiro diferido%')
      )
),
Afectadas AS (
    SELECT dc.DocIdDocumento, dc.DocTotal, dc.CfeEstado,
           dc.DocCliNombre, dc.TcaIdTransaccion
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal, dc.CfeEstado,
             dc.DocCliNombre, dc.TcaIdTransaccion
    HAVING COUNT(*) > 1
       AND SUM(dcd.DcdTotal) > dc.DocTotal + 0.10       -- líneas infladas
       AND MAX(dcd.DcdTotal) >= dc.DocTotal - 0.10      -- FIRMA: una línea vale ~el retiro completo
),
LineaOrden AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.OrdCodigoOrden,
           dcd.DcdNomItem, dcd.DcdCantidad, dcd.DcdTotal AS TotalActual,
           a.DocTotal, a.CfeEstado, a.DocCliNombre, a.TcaIdTransaccion,
           od.OrdCostoFinal
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Afectadas a ON a.DocIdDocumento = dcd.DocIdDocumento
    OUTER APPLY (
        SELECT TOP 1 o.OrdCostoFinal
        FROM dbo.OrdenesDeposito o
        WHERE LTRIM(RTRIM(o.OrdCodigoOrden)) = LTRIM(RTRIM(dcd.OrdCodigoOrden))
        ORDER BY o.OrdIdOrden DESC
    ) od
),
SumaCosto AS (
    SELECT DocIdDocumento,
           SUM(OrdCostoFinal) AS SumaCosto,
           SUM(CASE WHEN OrdCostoFinal IS NULL THEN 1 ELSE 0 END) AS LineasSinMatch
    FROM LineaOrden GROUP BY DocIdDocumento
)
SELECT
    lo.DocIdDocumento,
    lo.DocCliNombre AS Cliente,
    (SELECT TOP 1 'RW-' + CAST(td.TdeReferenciaId AS VARCHAR)
     FROM dbo.TransaccionDetalle td
     WHERE td.TcaIdTransaccion = lo.TcaIdTransaccion
       AND td.TdeTipoReferencia = 'ORDEN_RETIRO')    AS Retiro,
    lo.CfeEstado,
    lo.DcdIdDetalle,
    lo.OrdCodigoOrden,
    lo.DcdNomItem   AS Concepto,
    lo.DcdCantidad,
    lo.TotalActual,
    lo.OrdCostoFinal,
    lo.DocTotal,
    sc.SumaCosto,
    ROUND(lo.OrdCostoFinal * (lo.DocTotal / NULLIF(sc.SumaCosto,0)), 2) AS NuevoTotalPropuesto,
    CASE WHEN sc.LineasSinMatch > 0
         THEN 'NO corregible: hay lineas sin match a orden'
         WHEN sc.SumaCosto IS NULL OR sc.SumaCosto = 0
         THEN 'NO corregible: SumaCosto=0'
         ELSE 'OK' END AS Estado
FROM LineaOrden lo
JOIN SumaCosto sc ON sc.DocIdDocumento = lo.DocIdDocumento
ORDER BY lo.DocIdDocumento, lo.DcdIdDetalle;


/* ============================================================================
   3) APLICAR — descomentá este bloque completo para escribir cambios.
      Revisá primero los PREVIEWs 1 y 2.
      - Sólo corrige documentos NO aceptados en DGI y donde TODAS las líneas
        matchean una orden con costo > 0.
      - Reparte DocTotal en proporción a OrdCostoFinal; la última línea absorbe
        el centavo de redondeo -> la suma cuadra EXACTO con DocTotal.
   ----------------------------------------------------------------------------

BEGIN TRANSACTION;

;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'          -- no tocar fiscales ya aceptados
      AND (
        EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion
                  AND td.TdeTipoReferencia = 'ORDEN_RETIRO')
        OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                   WHERE x.DocIdDocumento = dc.DocIdDocumento
                     AND x.DcdDscItem LIKE '%Retiro diferido%')
      )
),
Afectadas AS (
    SELECT dc.DocIdDocumento, dc.DocTotal
    FROM dbo.DocumentosContables dc
    JOIN RetiroDocs rd ON rd.DocIdDocumento = dc.DocIdDocumento
    JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING COUNT(*) > 1
       AND SUM(dcd.DcdTotal) > dc.DocTotal + 0.10       -- líneas infladas
       AND MAX(dcd.DcdTotal) >= dc.DocTotal - 0.10      -- FIRMA: una línea vale ~el retiro completo
),
LineaOrden AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.DcdCantidad,
           a.DocTotal, od.OrdCostoFinal
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Afectadas a ON a.DocIdDocumento = dcd.DocIdDocumento
    OUTER APPLY (
        SELECT TOP 1 o.OrdCostoFinal
        FROM dbo.OrdenesDeposito o
        WHERE LTRIM(RTRIM(o.OrdCodigoOrden)) = LTRIM(RTRIM(dcd.OrdCodigoOrden))
        ORDER BY o.OrdIdOrden DESC
    ) od
),
SumaCosto AS (
    SELECT DocIdDocumento, SUM(OrdCostoFinal) AS SumaCosto,
           SUM(CASE WHEN OrdCostoFinal IS NULL THEN 1 ELSE 0 END) AS SinMatch
    FROM LineaOrden GROUP BY DocIdDocumento
),
Calc AS (
    SELECT lo.DcdIdDetalle, lo.DocIdDocumento, lo.DcdCantidad, lo.DocTotal,
           ROUND(lo.OrdCostoFinal * (lo.DocTotal / NULLIF(sc.SumaCosto,0)), 2) AS NuevoTotal,
           ROW_NUMBER() OVER (PARTITION BY lo.DocIdDocumento ORDER BY lo.DcdIdDetalle DESC) AS Rn
    FROM LineaOrden lo
    JOIN SumaCosto sc ON sc.DocIdDocumento = lo.DocIdDocumento
    WHERE sc.SinMatch = 0 AND sc.SumaCosto > 0                 -- todas las líneas matchean
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

-- Verificación: debe devolver 0 filas (todo cuadrado).
;WITH RetiroDocs AS (
    SELECT dc.DocIdDocumento
    FROM dbo.DocumentosContables dc
    WHERE dc.DocEstado <> 'ANULADO'
      AND (
        EXISTS (SELECT 1 FROM dbo.TransaccionDetalle td
                WHERE td.TcaIdTransaccion = dc.TcaIdTransaccion
                  AND td.TdeTipoReferencia = 'ORDEN_RETIRO')
        OR EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle x
                   WHERE x.DocIdDocumento = dc.DocIdDocumento
                     AND x.DcdDscItem LIKE '%Retiro diferido%')
      )
)
SELECT dc.DocSerie + '-' + CAST(dc.DocNumero AS VARCHAR) AS Factura,
       dc.CfeEstado, dc.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas,
       ABS(dc.DocTotal - SUM(dcd.DcdTotal)) AS Diferencia
FROM dbo.DocumentosContables dc
JOIN RetiroDocs rd  ON rd.DocIdDocumento = dc.DocIdDocumento
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
WHERE ISNULL(dc.CfeEstado,'') <> 'ACEPTADO_DGI'
GROUP BY dc.DocSerie, dc.DocNumero, dc.CfeEstado, dc.DocTotal
HAVING SUM(dcd.DcdTotal) > dc.DocTotal + 0.10
   AND MAX(dcd.DcdTotal) >= dc.DocTotal - 0.10;

-- Si 0 filas -> COMMIT TRANSACTION;
-- Si hay filas inesperadas -> ROLLBACK TRANSACTION;

============================================================================ */
