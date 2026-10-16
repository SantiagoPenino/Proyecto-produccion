-- =============================================================================
-- FIX: Agregar ProId 479 (UV para rígidos) como artículo permitido
--      en los planes DTF de SABONIS y Matías Siri
--
-- Problema: Las órdenes de esos clientes usan ProId=479 (UV PARA RIGIDOS 0,27)
--           pero sus planes solo tienen ProId=255 (DTF para rígidos UV) como
--           artículo permitido. Son el mismo tipo de material — inconsistencia
--           en el código de artículo usado en las primeras órdenes.
--
-- Clientes afectados (Grupo A — 9 movimientos):
--   Plan #19 → SABONIS - ARTEIDEA  (1 orden: DTF-1423  $1.87)
--   Plan #21 → Matías Siri          (8 órdenes: DTF-557, DTF-719, etc.  $37.15)
--
-- Grupo B (NO se toca):
--   JBJPRINT SAS  TP-356    ProId=416 Parche         → sin plan, genera deuda monetaria
--   Matías Siri   ECOUV-13716 ProId=339 Vinilo brillo → sin plan, genera deuda monetaria
--   Diego Badaló  SB-65022  ProId=277 Dry Microporoso → sin plan, genera deuda monetaria
--
-- Fecha: 2026-06-22
-- =============================================================================

-- ── PASO 1: Verificar estado ANTES del fix ────────────────────────────────
SELECT pap.PlaIdPlan, c.Nombre AS Cliente, pap.ProIdProducto, art.Descripcion
FROM dbo.PlanesMetrosArticulosPermitidos pap
JOIN dbo.PlanesMetros pm ON pm.PlaIdPlan = pap.PlaIdPlan
JOIN dbo.Clientes c ON c.CliIdCliente = pm.CliIdCliente
LEFT JOIN dbo.Articulos art ON art.ProIdProducto = pap.ProIdProducto
WHERE pap.PlaIdPlan IN (19, 21)
ORDER BY pap.PlaIdPlan, pap.ProIdProducto;
-- Esperado: 4 filas (247 y 255 para cada plan). NO debe aparecer 479 aún.

-- ── PASO 2: Insertar artículos faltantes ─────────────────────────────────
INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto)
SELECT v.PlaIdPlan, v.ProIdProducto
FROM (VALUES
    (19, 479),   -- SABONIS - ARTEIDEA: agrega UV para rígidos 0,27
    (21, 479)    -- Matías Siri:        agrega UV para rígidos 0,27
) AS v(PlaIdPlan, ProIdProducto)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
    WHERE pap.PlaIdPlan = v.PlaIdPlan AND pap.ProIdProducto = v.ProIdProducto
);
-- Filas insertadas esperadas: 2

-- ── PASO 3: Verificar estado DESPUÉS del fix ─────────────────────────────
SELECT pap.PlaIdPlan, c.Nombre AS Cliente, pap.ProIdProducto, art.Descripcion
FROM dbo.PlanesMetrosArticulosPermitidos pap
JOIN dbo.PlanesMetros pm ON pm.PlaIdPlan = pap.PlaIdPlan
JOIN dbo.Clientes c ON c.CliIdCliente = pm.CliIdCliente
LEFT JOIN dbo.Articulos art ON art.ProIdProducto = pap.ProIdProducto
WHERE pap.PlaIdPlan IN (19, 21)
ORDER BY pap.PlaIdPlan, pap.ProIdProducto;
-- Esperado: 6 filas (247, 255 y 479 para cada plan)

-- ── PASO 4: Confirmar que las órdenes bloqueadas de Grupo A ya son cubribles
SELECT
    c.Nombre AS Cliente,
    COALESCE(od.OrdCodigoOrden, erp.CodigoOrden) AS Orden,
    art.Descripcion AS Articulo,
    ABS(m.MovImporte) AS Importe
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK)
    ON od.OrdIdOrden = m.OrdIdOrden
    OR (erp.CodigoOrden IS NOT NULL AND od.OrdCodigoOrden = erp.CodigoOrden)
LEFT JOIN dbo.Articulos art WITH(NOLOCK)
    ON art.ProIdProducto = COALESCE(od.ProIdProducto, erp.ProIdProducto)
WHERE m.MovIdMovimiento IN (1345, 1942, 2192, 3452, 4264, 5664, 5665, 5667)
  AND EXISTS (
      SELECT 1 FROM dbo.PlanesMetros pm
      JOIN dbo.PlanesMetrosArticulosPermitidos pap ON pap.PlaIdPlan = pm.PlaIdPlan
      WHERE pm.CliIdCliente = cc.CliIdCliente
        AND pm.PlaActivo = 1
        AND pap.ProIdProducto = COALESCE(od.ProIdProducto, erp.ProIdProducto)
  );
-- Esperado: 8 filas (todas las órdenes bloqueadas de Grupo A ya resueltas)
