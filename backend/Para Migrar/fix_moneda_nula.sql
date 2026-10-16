-- ============================================================
-- DIAGNÓSTICO Y CORRECCIÓN: PedidosCobranza / Detalle sin Moneda
-- Ejecutar primero los bloques SELECT, luego decidir si aplicar UPDATE
-- ============================================================

-- ── PASO 1: ¿Cuántos registros tienen Moneda NULL? ─────────────
SELECT
    'PedidosCobranza'          AS Tabla,
    COUNT(*)                   AS TotalRegistros,
    SUM(CASE WHEN Moneda IS NULL THEN 1 ELSE 0 END) AS ConMonedaNULL,
    SUM(CASE WHEN Moneda = 'USD' THEN 1 ELSE 0 END) AS EnUSD,
    SUM(CASE WHEN Moneda = 'UYU' THEN 1 ELSE 0 END) AS EnUYU
FROM dbo.PedidosCobranza WITH(NOLOCK)

UNION ALL

SELECT
    'PedidosCobranzaDetalle'   AS Tabla,
    COUNT(*)                   AS TotalRegistros,
    SUM(CASE WHEN Moneda IS NULL THEN 1 ELSE 0 END) AS ConMonedaNULL,
    SUM(CASE WHEN Moneda = 'USD' THEN 1 ELSE 0 END) AS EnUSD,
    SUM(CASE WHEN Moneda = 'UYU' THEN 1 ELSE 0 END) AS EnUYU
FROM dbo.PedidosCobranzaDetalle WITH(NOLOCK);


-- ── PASO 2: De los NULL en PedidosCobranza, ¿cuáles son USD según OrdenesDeposito? ──
SELECT
    pc.ID,
    pc.NoDocERP,
    pc.MontoTotal,
    pc.Moneda                           AS MonedaActual,
    MAX(od.MonIdMoneda)                 AS MonIdMonedaOrden,
    CASE WHEN MAX(od.MonIdMoneda) = 2 THEN 'USD' ELSE 'UYU' END AS MonedaDeducida,
    MIN(pc.FechaGeneracion)             AS FechaGeneracion
FROM dbo.PedidosCobranza pc WITH(NOLOCK)
LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK)
    ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
WHERE pc.Moneda IS NULL
GROUP BY pc.ID, pc.NoDocERP, pc.MontoTotal, pc.Moneda
ORDER BY pc.FechaGeneracion DESC;


-- ── PASO 3: Misma vista para los Detalles con NULL ──────────────
SELECT
    pcd.ID,
    pcd.PedidoCobranzaID,
    pcd.Subtotal,
    pcd.Moneda                          AS MonedaActual,
    pc.Moneda                           AS MonedaEnCabecera,
    od.MonIdMoneda                      AS MonIdMonedaOrden,
    CASE WHEN ISNULL(pc.Moneda,'') = 'USD' OR od.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS MonedaDeducida
FROM dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK)
INNER JOIN dbo.PedidosCobranza pc WITH(NOLOCK) ON pc.ID = pcd.PedidoCobranzaID
LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK)
    ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
WHERE pcd.Moneda IS NULL
ORDER BY pcd.ID DESC;


-- ============================================================
-- ── CORRECCIÓN (ejecutar solo después de revisar los SELECTs) ──
-- ============================================================

-- CORRECCIÓN A: PedidosCobranza — inferir moneda desde OrdenesDeposito
UPDATE pc
SET pc.Moneda = CASE WHEN MAX(od.MonIdMoneda) = 2 THEN 'USD' ELSE 'UYU' END
FROM dbo.PedidosCobranza pc
LEFT JOIN dbo.OrdenesDeposito od
    ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
WHERE pc.Moneda IS NULL
GROUP BY pc.ID, pc.NoDocERP, pc.MontoTotal;
-- (si el UPDATE con GROUP BY no funciona en tu versión de MSSQL, usar la forma CTE abajo)

/*
-- Versión CTE (más compatible):
WITH MonedaDeducida AS (
    SELECT
        pc.ID,
        CASE WHEN MAX(od.MonIdMoneda) = 2 THEN 'USD' ELSE 'UYU' END AS MonedaNew
    FROM dbo.PedidosCobranza pc
    LEFT JOIN dbo.OrdenesDeposito od
        ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
    WHERE pc.Moneda IS NULL
    GROUP BY pc.ID
)
UPDATE pc
SET pc.Moneda = md.MonedaNew
FROM dbo.PedidosCobranza pc
INNER JOIN MonedaDeducida md ON md.ID = pc.ID;
*/


-- CORRECCIÓN B: PedidosCobranzaDetalle — heredar moneda de la cabecera
UPDATE pcd
SET pcd.Moneda = ISNULL(pc.Moneda, 'UYU')
FROM dbo.PedidosCobranzaDetalle pcd
INNER JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE pcd.Moneda IS NULL;


-- ── VERIFICACIÓN FINAL ──────────────────────────────────────────
SELECT
    'PedidosCobranza'      AS Tabla,
    SUM(CASE WHEN Moneda IS NULL THEN 1 ELSE 0 END) AS AunConNULL,
    COUNT(*) AS Total
FROM dbo.PedidosCobranza WITH(NOLOCK)
UNION ALL
SELECT
    'PedidosCobranzaDetalle',
    SUM(CASE WHEN Moneda IS NULL THEN 1 ELSE 0 END),
    COUNT(*)
FROM dbo.PedidosCobranzaDetalle WITH(NOLOCK);
