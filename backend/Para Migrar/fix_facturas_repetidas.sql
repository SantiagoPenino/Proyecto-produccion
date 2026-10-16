/* ============================================================================
   FIX: facturas descuadradas — dos patrones cubiertos
   ----------------------------------------------------------------------------
   PATRÓN A — Mixed-currency (algunas líneas en USD, otras en UYU):
     Facturas que tienen movimientos ORDEN con MonIdMoneda=2 vinculados.
     Las líneas que coinciden (±0.10) con un movimiento USD se convierten
     × cotDólar. Si queda exactamente UNA línea sin match, esa línea se
     ajusta al saldo restante (DocTotal − ΣConvertidas).
     Si quedan 2+ líneas sin match → la factura se deja para revisión manual.
     NO SE ELIMINA NINGUNA LÍNEA.

   PATRÓN B — Sin movimientos USD identificables:
     DocTotal en UYU pero todas las líneas en escala incorrecta (ej: todas en
     USD sin cotDólar). Se reescalan proporcionalmente: cada línea × (DocTotal
     / SumaLineas). El último renglón absorbe el centavo de redondeo.

   MODO PREVIEW por defecto (solo SELECTs, no modifica nada).
   Para aplicar: descomentá el bloque BEGIN ... COMMIT al final.
   ============================================================================ */


-- ============================================================
-- PREVIEW — PATRÓN A: líneas USD + línea residual de retiro
-- ============================================================
;WITH FacturasMalas AS (
    SELECT dc.DocIdDocumento,
           dc.DocTotal,
           SUM(dcd.DcdTotal) AS SumaLineas,
           CAST(dc.DocFechaEmision AS DATE) AS FechaEmision
    FROM dbo.DocumentosContables dc
    JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal, CAST(dc.DocFechaEmision AS DATE)
    HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1 AND SUM(dcd.DcdTotal) > 0
),
CotizacionPorFactura AS (
    SELECT fm.DocIdDocumento, fm.DocTotal, fm.SumaLineas, fm.FechaEmision,
           (SELECT TOP 1 cot.CotDolar FROM dbo.Cotizaciones cot
            WHERE cot.CotFecha <= fm.FechaEmision
            ORDER BY cot.CotFecha DESC) AS CotDolar
    FROM FacturasMalas fm
),
MovsUSD AS (
    SELECT m.DocIdDocumento,
           m.OrdIdOrden,
           ABS(m.MovImporte) AS MontoUSD
    FROM dbo.MovimientosCuenta m
    INNER JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
    WHERE m.DocIdDocumento IN (SELECT DocIdDocumento FROM FacturasMalas)
      AND od.MonIdMoneda = 2
      AND m.MovTipo = 'ORDEN'
      AND ABS(m.MovImporte) > 0
),
LineasEnUSD AS (
    SELECT dcd.DcdIdDetalle,
           dcd.DocIdDocumento,
           dcd.DcdTotal            AS DcdTotalActual,
           dcd.DcdSubtotal         AS DcdSubtotalActual,
           dcd.DcdImpuestos        AS DcdImpuestosActual,
           dcd.DcdCantidad,
           mu.MontoUSD,
           cf.CotDolar,
           ROUND(mu.MontoUSD * cf.CotDolar, 2)  AS DcdTotalNuevo,
           cf.DocTotal
    FROM dbo.DocumentosContablesDetalle dcd
    INNER JOIN CotizacionPorFactura cf ON cf.DocIdDocumento = dcd.DocIdDocumento
    INNER JOIN MovsUSD mu           ON mu.DocIdDocumento = dcd.DocIdDocumento
        AND ABS(dcd.DcdTotal - mu.MontoUSD) < 0.10
),
SumaCorregidas AS (
    SELECT DocIdDocumento, SUM(DcdTotalNuevo) AS SumaNuevosUSD
    FROM LineasEnUSD
    GROUP BY DocIdDocumento
),
LineasResidual AS (
    SELECT dcd.DcdIdDetalle,
           dcd.DocIdDocumento,
           dcd.DcdTotal            AS DcdTotalActual,
           dcd.DcdCantidad,
           cf.DocTotal,
           cf.CotDolar,
           sc.SumaNuevosUSD,
           cf.DocTotal - sc.SumaNuevosUSD  AS DcdTotalNuevo
    FROM dbo.DocumentosContablesDetalle dcd
    INNER JOIN CotizacionPorFactura cf ON cf.DocIdDocumento = dcd.DocIdDocumento
    INNER JOIN SumaCorregidas sc      ON sc.DocIdDocumento  = dcd.DocIdDocumento
    WHERE NOT EXISTS (
        SELECT 1 FROM LineasEnUSD lu
        WHERE lu.DcdIdDetalle = dcd.DcdIdDetalle
    )
)
SELECT 'PATRON_A_USD'      AS Patron,
       lu.DocIdDocumento,
       lu.DcdIdDetalle,
       lu.DcdTotalActual,
       lu.DcdTotalNuevo,
       ROUND(lu.DcdTotalNuevo / 1.22, 4)           AS SubtotalNuevo,
       lu.DcdTotalNuevo - ROUND(lu.DcdTotalNuevo / 1.22, 4) AS ImpuestosNuevo,
       lu.CotDolar,
       lu.DocTotal
FROM LineasEnUSD lu
UNION ALL
SELECT 'PATRON_A_RESIDUAL' AS Patron,
       lr.DocIdDocumento,
       lr.DcdIdDetalle,
       lr.DcdTotalActual,
       lr.DcdTotalNuevo,
       ROUND(lr.DcdTotalNuevo / 1.22, 4)           AS SubtotalNuevo,
       lr.DcdTotalNuevo - ROUND(lr.DcdTotalNuevo / 1.22, 4) AS ImpuestosNuevo,
       lr.CotDolar,
       lr.DocTotal
FROM LineasResidual lr
WHERE ABS(lr.DcdTotalNuevo - lr.DcdTotalActual) > 0.10
ORDER BY DocIdDocumento, Patron, DcdIdDetalle;


-- ============================================================
-- PREVIEW — PATRÓN B: todas las líneas en USD (sin movimientos USD identificables)
-- ============================================================
;WITH FacturasMalas AS (
    SELECT dc.DocIdDocumento, dc.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas
    FROM dbo.DocumentosContables dc
    JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1 AND SUM(dcd.DcdTotal) > 0
),
MovsUSD AS (
    SELECT DISTINCT m.DocIdDocumento
    FROM dbo.MovimientosCuenta m
    INNER JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
    WHERE m.DocIdDocumento IN (SELECT DocIdDocumento FROM FacturasMalas)
      AND od.MonIdMoneda = 2
      AND m.MovTipo = 'ORDEN'
      AND ABS(m.MovImporte) > 0
),
SoloPatronB AS (
    SELECT fm.DocIdDocumento, fm.DocTotal, fm.SumaLineas
    FROM FacturasMalas fm
    WHERE fm.DocIdDocumento NOT IN (SELECT DocIdDocumento FROM MovsUSD)
),
Escaladas AS (
    SELECT
        dcd.DcdIdDetalle,
        dcd.DocIdDocumento,
        fm.DocTotal,
        ISNULL(dcd.DcdCantidad, 1.0)                                    AS Cantidad,
        COALESCE(dcd.DcdSubtotal / NULLIF(dcd.DcdTotal,0), 1.0/1.22)   AS RatioSubtotal,
        ROUND(dcd.DcdTotal * (fm.DocTotal / fm.SumaLineas), 2)          AS NuevoTotal,
        ROW_NUMBER() OVER (PARTITION BY dcd.DocIdDocumento
                           ORDER BY dcd.DcdIdDetalle DESC)              AS Rn
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN SoloPatronB fm ON dcd.DocIdDocumento = fm.DocIdDocumento
),
ConSuma AS (
    SELECT *, SUM(NuevoTotal) OVER (PARTITION BY DocIdDocumento) AS SumaNuevoTotal
    FROM Escaladas
),
Calculadas AS (
    SELECT
        DcdIdDetalle, DocIdDocumento, Cantidad, RatioSubtotal, DocTotal,
        CASE WHEN Rn = 1
             THEN NuevoTotal + (DocTotal - SumaNuevoTotal)
             ELSE NuevoTotal
        END AS TotalLinea
    FROM ConSuma
)
SELECT
    'PATRON_B'         AS Patron,
    c.DocIdDocumento,
    c.DcdIdDetalle,
    dcd.DcdTotal       AS TotalLineaActual,
    c.TotalLinea       AS TotalLineaNuevo,
    ROUND(c.TotalLinea * c.RatioSubtotal, 2) AS SubtotalNuevo,
    c.TotalLinea - ROUND(c.TotalLinea * c.RatioSubtotal, 2) AS ImpuestosNuevo,
    NULL               AS CotDolar,
    c.DocTotal
FROM Calculadas c
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DcdIdDetalle = c.DcdIdDetalle
ORDER BY c.DocIdDocumento, c.DcdIdDetalle;


/* ============================================================================
   APLICAR EL FIX — descomentá este bloque completo para escribir cambios.
   Revisá ambos PREVIEWs primero. Se ejecuta dentro de una transacción.
   ----------------------------------------------------------------------------

BEGIN TRANSACTION;

-- ── PATRÓN A (single-pass) ────────────────────────────────────────────────
-- Un solo UPDATE evalúa todo en la misma lectura de datos originales, sin el
-- bug del two-pass donde UPDATE-1b no puede re-matchear líneas ya escaladas.
--
-- Regla: si quedan 2+ líneas sin match → esa factura NO se toca en la parte
-- residual (se deja para revisión manual; aparecerá en la verificación final).
;WITH FacturasMalas AS (
    SELECT dc.DocIdDocumento, dc.DocTotal,
           CAST(dc.DocFechaEmision AS DATE) AS FechaEmision
    FROM dbo.DocumentosContables dc
    JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal, CAST(dc.DocFechaEmision AS DATE)
    HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1 AND SUM(dcd.DcdTotal) > 0
),
CotizacionPorFactura AS (
    SELECT fm.DocIdDocumento, fm.DocTotal, fm.FechaEmision,
           (SELECT TOP 1 c.CotDolar FROM dbo.Cotizaciones c
            WHERE c.CotFecha <= fm.FechaEmision ORDER BY c.CotFecha DESC) AS CotDolar
    FROM FacturasMalas fm
),
MovsUSD AS (
    SELECT m.DocIdDocumento, ABS(m.MovImporte) AS MontoUSD
    FROM dbo.MovimientosCuenta m
    INNER JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
    WHERE m.DocIdDocumento IN (SELECT DocIdDocumento FROM FacturasMalas)
      AND od.MonIdMoneda = 2 AND m.MovTipo = 'ORDEN' AND ABS(m.MovImporte) > 0
),
-- Pares válidos: una línea ↔ un movimiento (tolerancia ±0.10, 1-a-1)
MatchCandidates AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.DcdCantidad,
           cf.DocTotal AS DocTotalFact, cf.CotDolar, mu.MontoUSD,
           ROW_NUMBER() OVER (PARTITION BY dcd.DcdIdDetalle
                              ORDER BY ABS(dcd.DcdTotal - mu.MontoUSD))              AS RnLine,
           ROW_NUMBER() OVER (PARTITION BY dcd.DocIdDocumento, ROUND(mu.MontoUSD,4)
                              ORDER BY ABS(dcd.DcdTotal - mu.MontoUSD), dcd.DcdIdDetalle) AS RnMov
    FROM dbo.DocumentosContablesDetalle dcd
    INNER JOIN CotizacionPorFactura cf ON cf.DocIdDocumento = dcd.DocIdDocumento
    INNER JOIN MovsUSD mu ON mu.DocIdDocumento = dcd.DocIdDocumento
        AND ABS(dcd.DcdTotal - mu.MontoUSD) < 0.10
    WHERE dcd.DocIdDocumento IN (SELECT DocIdDocumento FROM MovsUSD)
),
UniqueMatches AS (
    SELECT DcdIdDetalle, DocIdDocumento, DcdCantidad, DocTotalFact, CotDolar, MontoUSD
    FROM MatchCandidates WHERE RnLine = 1 AND RnMov = 1
),
SumaMatchedPorFactura AS (
    SELECT DocIdDocumento, SUM(ROUND(MontoUSD * CotDolar, 2)) AS SumaConvertida
    FROM UniqueMatches GROUP BY DocIdDocumento
),
-- Contar líneas sin match por factura (seguridad: solo tocar el residual si N=1)
LineasSinMatchCount AS (
    SELECT dcd.DocIdDocumento, COUNT(*) AS N
    FROM dbo.DocumentosContablesDetalle dcd
    WHERE dcd.DocIdDocumento IN (SELECT DocIdDocumento FROM SumaMatchedPorFactura)
      AND dcd.DcdIdDetalle NOT IN (SELECT DcdIdDetalle FROM UniqueMatches)
    GROUP BY dcd.DocIdDocumento
),
ValorFinal AS (
    -- 1) Líneas USD (matched): convertir × cotDólar
    SELECT um.DcdIdDetalle, um.DocIdDocumento, um.DcdCantidad,
           ROUND(um.MontoUSD * um.CotDolar, 2) AS TotalFinal
    FROM UniqueMatches um
    UNION ALL
    -- 2) Única línea sin match: saldo restante (DocTotal − ΣConvertidas)
    --    Solo aplica cuando hay exactamente 1 línea sin match en esa factura.
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, dcd.DcdCantidad,
           cf.DocTotal - sm.SumaConvertida AS TotalFinal
    FROM dbo.DocumentosContablesDetalle dcd
    INNER JOIN CotizacionPorFactura cf ON cf.DocIdDocumento = dcd.DocIdDocumento
    INNER JOIN SumaMatchedPorFactura sm ON sm.DocIdDocumento = dcd.DocIdDocumento
    INNER JOIN LineasSinMatchCount   lsm ON lsm.DocIdDocumento = dcd.DocIdDocumento
        AND lsm.N = 1   -- solo si hay exactamente UNA línea residual
    WHERE dcd.DcdIdDetalle NOT IN (SELECT DcdIdDetalle FROM UniqueMatches)
      AND ABS((cf.DocTotal - sm.SumaConvertida) - dcd.DcdTotal) > 0.10
)
UPDATE dcd SET
    DcdTotal          = vf.TotalFinal,
    DcdSubtotal       = ROUND(vf.TotalFinal / 1.22, 4),
    DcdImpuestos      = vf.TotalFinal - ROUND(vf.TotalFinal / 1.22, 4),
    DcdPrecioUnitario = ROUND(vf.TotalFinal / NULLIF(vf.DcdCantidad, 0), 4)
FROM dbo.DocumentosContablesDetalle dcd
INNER JOIN ValorFinal vf ON dcd.DcdIdDetalle = vf.DcdIdDetalle;

-- ── PATRÓN B (sin movimientos USD vinculados): escalar proporcionalmente ────
;WITH FacturasMalas AS (
    SELECT dc.DocIdDocumento, dc.DocTotal, SUM(dcd.DcdTotal) AS SumaLineas
    FROM dbo.DocumentosContables dc
    JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
    GROUP BY dc.DocIdDocumento, dc.DocTotal
    HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1 AND SUM(dcd.DcdTotal) > 0
),
MovsUSD AS (
    SELECT DISTINCT m.DocIdDocumento
    FROM dbo.MovimientosCuenta m
    INNER JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
    WHERE m.DocIdDocumento IN (SELECT DocIdDocumento FROM FacturasMalas)
      AND od.MonIdMoneda = 2 AND m.MovTipo = 'ORDEN' AND ABS(m.MovImporte) > 0
),
SoloPatronB AS (
    SELECT fm.DocIdDocumento, fm.DocTotal, fm.SumaLineas FROM FacturasMalas fm
    WHERE fm.DocIdDocumento NOT IN (SELECT DocIdDocumento FROM MovsUSD)
),
Escaladas AS (
    SELECT dcd.DcdIdDetalle, dcd.DocIdDocumento, fm.DocTotal,
           ISNULL(dcd.DcdCantidad, 1.0) AS Cantidad,
           COALESCE(dcd.DcdSubtotal / NULLIF(dcd.DcdTotal,0), 1.0/1.22) AS RatioSubtotal,
           ROUND(dcd.DcdTotal * (fm.DocTotal / fm.SumaLineas), 2) AS NuevoTotal,
           ROW_NUMBER() OVER (PARTITION BY dcd.DocIdDocumento ORDER BY dcd.DcdIdDetalle DESC) AS Rn
    FROM dbo.DocumentosContablesDetalle dcd JOIN SoloPatronB fm ON dcd.DocIdDocumento = fm.DocIdDocumento
),
ConSuma AS (SELECT *, SUM(NuevoTotal) OVER (PARTITION BY DocIdDocumento) AS SumaNuevoTotal FROM Escaladas),
Calculadas AS (
    SELECT DcdIdDetalle, Cantidad, RatioSubtotal,
           CASE WHEN Rn = 1 THEN NuevoTotal + (DocTotal - SumaNuevoTotal) ELSE NuevoTotal END AS TotalLinea
    FROM ConSuma
)
UPDATE dcd SET
    DcdTotal          = c.TotalLinea,
    DcdSubtotal       = ROUND(c.TotalLinea * c.RatioSubtotal, 2),
    DcdImpuestos      = c.TotalLinea - ROUND(c.TotalLinea * c.RatioSubtotal, 2),
    DcdPrecioUnitario = ROUND(c.TotalLinea / NULLIF(c.Cantidad, 0), 4)
FROM dbo.DocumentosContablesDetalle dcd JOIN Calculadas c ON dcd.DcdIdDetalle = c.DcdIdDetalle;

-- ── Verificación: debe devolver 0 filas (o solo las que quedaron para revisión manual) ──
SELECT dc.DocIdDocumento,
       dc.DocSerie + '-' + CAST(dc.DocNumero AS VARCHAR) AS Factura,
       dc.DocTotal,
       SUM(dcd.DcdTotal) AS SumaLineas,
       ABS(dc.DocTotal - SUM(dcd.DcdTotal)) AS Diferencia,
       COUNT(*) AS CantLineas
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
GROUP BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal
HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1;

-- Si 0 filas (o solo las complejas conocidas) → COMMIT TRANSACTION;
-- Si hay filas inesperadas                    → ROLLBACK TRANSACTION;

============================================================================ */
