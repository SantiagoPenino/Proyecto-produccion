/* ============================================================================
   CERRAR 2 PLANES DE RECURSOS (pedido del usuario, 22-sep-2026)
     - Plan #45  · CAPA        · NeoStretch (1,83)
     - Plan #140 · KASAK-1899  · Hexagonal (1,83)

   Hace lo mismo que el botón "Cerrar plan": PlaActivo = 0 + fecha y usuario
   de baja. NO toca la cuenta de metros ni sus movimientos (el botón, además,
   a CAPA le restaría de la cuenta los 1,82 m que muestra el plan, y esa
   cuenta ya está en 0).

   Correr en PRODUCCIÓN, en SSMS, entero (F5). Es un solo UPDATE: no deja
   transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;

-- ── PASO 1 · ANTES ──────────────────────────────────────────────────────────
SELECT 'ANTES' AS Paso, p.PlaIdPlan, RTRIM(c.IDCliente) AS Cliente, RTRIM(a.Descripcion) AS Material,
       p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante,
       p.PlaActivo, cc.CueSaldoActual AS SaldoCuenta
FROM dbo.PlanesMetros p
JOIN dbo.Clientes c        ON c.CliIdCliente  = p.CliIdCliente
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta  = p.CueIdCuenta
LEFT JOIN dbo.Articulos a  ON a.ProIdProducto = p.ProIdProducto
WHERE p.PlaIdPlan IN (45, 140);

-- ── PASO 2 · CERRAR ─────────────────────────────────────────────────────────
-- Candado: solo si sigue activo y es el cliente + material correctos.
UPDATE p
SET p.PlaActivo        = 0,
    p.PlaFechaBaja     = GETDATE(),
    p.PlaUsuarioBaja   = 1,
    p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
        + 'Cerrado a mano 22-sep-2026 (pedido del usuario)', 500)
FROM dbo.PlanesMetros p
JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE p.PlaActivo = 1
  AND (   (p.PlaIdPlan = 45  AND RTRIM(LTRIM(c.IDCliente)) = 'CAPA'       AND p.ProIdProducto = 53)
       OR (p.PlaIdPlan = 140 AND RTRIM(LTRIM(c.IDCliente)) = 'KASAK-1899' AND p.ProIdProducto = 258));

SELECT @@ROWCOUNT AS PlanesCerrados;   -- debe dar 2

-- ── PASO 3 · DESPUÉS ────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso, p.PlaIdPlan, RTRIM(c.IDCliente) AS Cliente, RTRIM(a.Descripcion) AS Material,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante,
       p.PlaActivo, p.PlaFechaBaja, cc.CueSaldoActual AS SaldoCuenta
FROM dbo.PlanesMetros p
JOIN dbo.Clientes c        ON c.CliIdCliente  = p.CliIdCliente
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta  = p.CueIdCuenta
LEFT JOIN dbo.Articulos a  ON a.ProIdProducto = p.ProIdProducto
WHERE p.PlaIdPlan IN (45, 140);
