-- ============================================================
-- fix_rollo_coberturas_parciales.sql
-- Convierte CUBIERTO_PARCIAL de clientes ROLLO al nuevo formato:
--   - Registra los metros faltantes como ENTREGA negativa
--   - Actualiza la observación a CUBIERTO_NEG_X.XX_PLAN_Y
--
-- Formato del string: CUBIERTO_PARCIAL_2.52/8.10_PLAN_67
--   posicion 18 = inicio de metros cubiertos (despues de 'CUBIERTO_PARCIAL_' = 17 chars)
--
-- 1) Corre en ROLLBACK, revisa los dos SELECT
-- 2) Cuando conforme → cambiar ROLLBACK → COMMIT
-- ============================================================
BEGIN TRANSACTION;

-- ── 1. DIAGNÓSTICO: qué registros se van a corregir ─────────────────────
;WITH base AS (
  SELECT
    m.MovIdMovimiento,
    m.OrdIdOrden,
    m.MovObservaciones,
    cc.CliIdCliente,
    -- Metro cubiertos (entre posicion 18 y el /)
    TRY_CAST(SUBSTRING(m.MovObservaciones, 18,
      CHARINDEX('/', m.MovObservaciones) - 18) AS DECIMAL(18,4)) AS MtsCubiertos,
    -- Metro totales (entre el / y _PLAN_)
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('/', m.MovObservaciones) + 1,
      CHARINDEX('_PLAN_', m.MovObservaciones) - CHARINDEX('/', m.MovObservaciones) - 1) AS DECIMAL(18,4)) AS MtsTotales,
    -- Plan ID (despues de _PLAN_)
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('_PLAN_', m.MovObservaciones) + 6,
      LEN(m.MovObservaciones)) AS INT) AS PlanId
  FROM dbo.MovimientosCuenta m
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  JOIN dbo.Clientes c        ON c.CliIdCliente  = cc.CliIdCliente
  JOIN dbo.TiposClientes tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE m.MovObservaciones LIKE 'CUBIERTO_PARCIAL_%/%_PLAN_%'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
)
SELECT
  RTRIM(c.Nombre)                                                      AS Cliente,
  b.MovIdMovimiento,
  COALESCE(od.OrdCodigoOrden, 'ORD-' + CAST(b.OrdIdOrden AS VARCHAR)) AS Orden,
  b.MovObservaciones                                                    AS ObsActual,
  b.MtsCubiertos,
  b.MtsTotales,
  b.MtsTotales - b.MtsCubiertos                                        AS MtsFaltantes,
  b.PlanId,
  pm.CueIdCuenta                                                        AS CueMTS,
  cc_rec.CueSaldoActual                                                 AS SaldoCuentaActual
FROM base b
JOIN dbo.Clientes c         ON c.CliIdCliente  = b.CliIdCliente
JOIN dbo.PlanesMetros pm    ON pm.PlaIdPlan    = b.PlanId
JOIN dbo.CuentasCliente cc_rec ON cc_rec.CueIdCuenta = pm.CueIdCuenta
LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = b.OrdIdOrden
WHERE b.MtsCubiertos IS NOT NULL
  AND b.MtsTotales   IS NOT NULL
  AND b.PlanId       IS NOT NULL
  AND b.MtsTotales > b.MtsCubiertos
ORDER BY c.Nombre;

-- ── 2. INSERTAR ENTREGA negativa para los metros faltantes ───────────────
;WITH base AS (
  SELECT
    m.MovIdMovimiento,
    m.OrdIdOrden,
    TRY_CAST(SUBSTRING(m.MovObservaciones, 18,
      CHARINDEX('/', m.MovObservaciones) - 18) AS DECIMAL(18,4)) AS MtsCubiertos,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('/', m.MovObservaciones) + 1,
      CHARINDEX('_PLAN_', m.MovObservaciones) - CHARINDEX('/', m.MovObservaciones) - 1) AS DECIMAL(18,4)) AS MtsTotales,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('_PLAN_', m.MovObservaciones) + 6,
      LEN(m.MovObservaciones)) AS INT) AS PlanId
  FROM dbo.MovimientosCuenta m
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  JOIN dbo.Clientes c        ON c.CliIdCliente  = cc.CliIdCliente
  JOIN dbo.TiposClientes tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE m.MovObservaciones LIKE 'CUBIERTO_PARCIAL_%/%_PLAN_%'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
),
parsed AS (
  SELECT
    b.OrdIdOrden,
    b.PlanId,
    b.MtsTotales - b.MtsCubiertos                           AS MtsFaltantes,
    pm.CueIdCuenta                                           AS CueMTS,
    cc_rec.CueSaldoActual - (b.MtsTotales - b.MtsCubiertos) AS NuevoSaldo,
    COALESCE(od.OrdCodigoOrden, 'ORD-' + CAST(b.OrdIdOrden AS VARCHAR)) AS CodigoOrden
  FROM base b
  JOIN dbo.PlanesMetros pm    ON pm.PlaIdPlan    = b.PlanId
  JOIN dbo.CuentasCliente cc_rec ON cc_rec.CueIdCuenta = pm.CueIdCuenta
  LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = b.OrdIdOrden
  WHERE b.MtsCubiertos IS NOT NULL
    AND b.MtsTotales   IS NOT NULL
    AND b.PlanId       IS NOT NULL
    AND b.MtsTotales > b.MtsCubiertos
)
INSERT INTO dbo.MovimientosCuenta
  (CueIdCuenta, MovTipo, MovImporte, MovConcepto, MovSaldoPosterior,
   MovFecha, MovUsuarioAlta, OrdIdOrden, MovObservaciones)
SELECT
  p.CueMTS,
  'ENTREGA',
  -p.MtsFaltantes,
  'Saldo negativo ROLLO: ' + p.CodigoOrden,
  p.NuevoSaldo,
  GETDATE(),
  1,
  p.OrdIdOrden,
  'Negativo retroactivo fix — Plan #' + CAST(p.PlanId AS VARCHAR(10))
FROM parsed p;

-- ── 3. ACTUALIZAR SALDO de la cuenta de recursos (suma todos los faltantes) ─
;WITH base AS (
  SELECT
    TRY_CAST(SUBSTRING(m.MovObservaciones, 18,
      CHARINDEX('/', m.MovObservaciones) - 18) AS DECIMAL(18,4)) AS MtsCubiertos,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('/', m.MovObservaciones) + 1,
      CHARINDEX('_PLAN_', m.MovObservaciones) - CHARINDEX('/', m.MovObservaciones) - 1) AS DECIMAL(18,4)) AS MtsTotales,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('_PLAN_', m.MovObservaciones) + 6,
      LEN(m.MovObservaciones)) AS INT) AS PlanId
  FROM dbo.MovimientosCuenta m
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  JOIN dbo.Clientes c        ON c.CliIdCliente  = cc.CliIdCliente
  JOIN dbo.TiposClientes tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE m.MovObservaciones LIKE 'CUBIERTO_PARCIAL_%/%_PLAN_%'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
),
totales AS (
  SELECT
    pm.CueIdCuenta                    AS CueMTS,
    SUM(b.MtsTotales - b.MtsCubiertos) AS TotalFaltante
  FROM base b
  JOIN dbo.PlanesMetros pm ON pm.PlaIdPlan = b.PlanId
  WHERE b.MtsCubiertos IS NOT NULL
    AND b.MtsTotales   IS NOT NULL
    AND b.PlanId       IS NOT NULL
    AND b.MtsTotales > b.MtsCubiertos
  GROUP BY pm.CueIdCuenta
)
UPDATE cc
SET cc.CueSaldoActual = cc.CueSaldoActual - t.TotalFaltante
FROM dbo.CuentasCliente cc
JOIN totales t ON t.CueMTS = cc.CueIdCuenta;

-- ── 4. ACTUALIZAR OBSERVACIÓN: CUBIERTO_PARCIAL → CUBIERTO_NEG ──────────
;WITH base AS (
  SELECT
    m.MovIdMovimiento,
    TRY_CAST(SUBSTRING(m.MovObservaciones, 18,
      CHARINDEX('/', m.MovObservaciones) - 18) AS DECIMAL(18,4)) AS MtsCubiertos,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('/', m.MovObservaciones) + 1,
      CHARINDEX('_PLAN_', m.MovObservaciones) - CHARINDEX('/', m.MovObservaciones) - 1) AS DECIMAL(18,4)) AS MtsTotales,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('_PLAN_', m.MovObservaciones) + 6,
      LEN(m.MovObservaciones)) AS INT) AS PlanId
  FROM dbo.MovimientosCuenta m
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  JOIN dbo.Clientes c        ON c.CliIdCliente  = cc.CliIdCliente
  JOIN dbo.TiposClientes tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE m.MovObservaciones LIKE 'CUBIERTO_PARCIAL_%/%_PLAN_%'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
)
UPDATE m
SET m.MovObservaciones =
  'CUBIERTO_NEG_' +
  CAST(CAST(ROUND(b.MtsTotales - b.MtsCubiertos, 2) AS DECIMAL(18,2)) AS VARCHAR(20)) +
  '_PLAN_' + CAST(b.PlanId AS VARCHAR(10))
FROM dbo.MovimientosCuenta m
JOIN base b ON b.MovIdMovimiento = m.MovIdMovimiento
WHERE b.MtsCubiertos IS NOT NULL
  AND b.MtsTotales   IS NOT NULL
  AND b.PlanId       IS NOT NULL;

-- ── 5. VERIFICACIÓN FINAL ────────────────────────────────────────────────
;WITH base AS (
  SELECT
    m.MovIdMovimiento,
    m.MovObservaciones,
    cc.CliIdCliente,
    TRY_CAST(SUBSTRING(m.MovObservaciones,
      CHARINDEX('_PLAN_', m.MovObservaciones) + 6,
      LEN(m.MovObservaciones)) AS INT) AS PlanId
  FROM dbo.MovimientosCuenta m
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  JOIN dbo.Clientes c        ON c.CliIdCliente  = cc.CliIdCliente
  JOIN dbo.TiposClientes tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE m.MovObservaciones LIKE 'CUBIERTO_NEG_%_PLAN_%'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
)
SELECT
  RTRIM(c.Nombre)        AS Cliente,
  b.MovObservaciones     AS ObsNueva,
  cc_rec.CueSaldoActual  AS SaldoCuentaRecurso
FROM base b
JOIN dbo.Clientes c         ON c.CliIdCliente  = b.CliIdCliente
JOIN dbo.PlanesMetros pm    ON pm.PlaIdPlan    = b.PlanId
JOIN dbo.CuentasCliente cc_rec ON cc_rec.CueIdCuenta = pm.CueIdCuenta
ORDER BY c.Nombre;

ROLLBACK; -- ← cambiar a COMMIT cuando el diagnóstico (paso 1) se vea correcto
