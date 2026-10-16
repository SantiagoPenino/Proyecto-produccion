-- ============================================================================
-- DIAGNOSTICO DESCUADRE PRE-FACTURA CLIENTE 440 (Puntogyf) - SOLO LECTURA
-- El guard freno: ciclo = 146.14 vs lineas = 294.42. Este script muestra de
-- donde sale cada numero. Correr en prod (File -> Open, no copiar del chat).
-- ============================================================================
SET NOCOUNT ON;

-- 1) Cuentas y ciclos abiertos del cliente
SELECT 'CUENTA' AS Que, cc.CueIdCuenta, cc.CueTipo, cc.CueEsPrincipal,
       LTRIM(RTRIM(ISNULL(cc.CueNombre,''))) AS Nombre
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = 440 AND cc.CueTipo LIKE 'DINERO%';

SELECT 'CICLO ABIERTO' AS Que, c.CicIdCiclo, c.CueIdCuenta, c.CicFechaInicio
FROM dbo.CiclosCredito c JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta
WHERE cc.CliIdCliente = 440 AND c.CicEstado = 'ABIERTO';

-- 2) TODOS los movimientos ORDEN pendientes de facturar del cliente,
--    con su ciclo, su importe y su precio congelado en cobranza
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.CicIdCiclo,
       LEFT(LTRIM(m.MovConcepto), 45) AS Concepto,
       CAST(ABS(m.MovImporte) AS DECIMAL(18,2)) AS ImporteMov,
       pc.MontoTotal AS PrecioCongelado,
       LTRIM(RTRIM(ISNULL(pc.Moneda,''))) AS MonPC,
       LEFT(ISNULL(m.MovObservaciones,''), 55) AS Obs
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE cc.CliIdCliente = 440
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.CueIdCuenta, m.CicIdCiclo, m.MovIdMovimiento;

-- 3) Resumen: lo que sumaria el CIERRE (por ciclo) vs lo pendiente total
SELECT m.CueIdCuenta, m.CicIdCiclo, COUNT(*) AS Movs,
       CAST(SUM(ABS(m.MovImporte)) AS DECIMAL(18,2)) AS TotalMovs,
       CAST(SUM(CASE WHEN m.MovObservaciones LIKE 'CUBIERTO%' THEN ABS(m.MovImporte) ELSE 0 END) AS DECIMAL(18,2)) AS DeEsoCubierto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = 440
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
GROUP BY m.CueIdCuenta, m.CicIdCiclo
ORDER BY m.CueIdCuenta, m.CicIdCiclo;
