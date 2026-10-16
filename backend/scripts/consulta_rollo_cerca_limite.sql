-- ============================================================
-- Todos los planes de clientes ROLLO (activos e inactivos)
-- TClIdTipoCliente = 3 = "Rollo por adelantado"
-- ============================================================
SELECT
  RTRIM(LTRIM(c.Nombre))  AS Cliente,
  c.CliIdCliente,
  pm.PlaIdPlan,
  pm.PlaCantidadTotal     AS Total,
  pm.PlaCantidadUsada     AS Usado,
  ROUND(pm.PlaCantidadTotal - pm.PlaCantidadUsada, 4) AS Disponible,
  ROUND((pm.PlaCantidadUsada / NULLIF(pm.PlaCantidadTotal, 0)) * 100, 1) AS PctUsado,
  pm.PlaActivo,
  CAST(pm.PlaFechaAlta AS DATE)        AS FechaAlta,
  CAST(pm.PlaFechaVencimiento AS DATE) AS FechaVencimiento

FROM  dbo.PlanesMetros  pm WITH(NOLOCK)
JOIN  dbo.Clientes      c  WITH(NOLOCK) ON c.CliIdCliente = pm.CliIdCliente

WHERE c.TClIdTipoCliente = 3   -- Rollo por adelantado

ORDER BY pm.PlaActivo DESC, PctUsado DESC;
