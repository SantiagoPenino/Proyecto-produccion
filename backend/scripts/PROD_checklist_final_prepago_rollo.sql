-- =====================================================================================
-- PROD_checklist_final_prepago_rollo.sql  (25-sep-2026)  — SOLO LECTURA
-- Una fila por cada cosa que había que hacer, con OK / REVISAR. Si todo dice OK, terminaste.
-- =====================================================================================
SET NOCOUNT ON;
DECLARE @DesdeOrden DATE = '2026-09-23';
DECLARE @R TABLE (Nro INT, Item NVARCHAR(120), Resultado NVARCHAR(200), Estado NVARCHAR(10));

-- 1) SUB-26932: la línea a mano debe quedar en $0 y no facturable
INSERT @R SELECT 1, 'SUB-26932: línea a $0 y no facturable',
    'PU=' + CAST(d.PrecioUnitario AS VARCHAR(20)) + ' Sub=' + CAST(d.Subtotal AS VARCHAR(20)) + ' Fact=' + CAST(d.EsFacturable AS VARCHAR(2)),
    CASE WHEN d.Subtotal = 0 AND ISNULL(d.EsFacturable, 1) = 0 THEN 'OK' ELSE 'REVISAR' END
FROM dbo.PedidosCobranzaDetalle d JOIN dbo.Ordenes o ON o.OrdenID = d.OrdenID WHERE RTRIM(o.CodigoOrden) = 'SUB-26932';
IF NOT EXISTS (SELECT 1 FROM @R WHERE Nro = 1) INSERT @R VALUES (1, 'SUB-26932: línea a $0 y no facturable', 'sin línea', 'REVISAR');

-- 2) SUB-27265 (banderas): ENTREGA y depósito en PIEZAS (= copias de los archivos)
;WITH x AS (
    SELECT RTRIM(o.CodigoOrden) Cod,
           (SELECT ISNULL(SUM(Copias), 0) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) AS Piezas,
           (SELECT TOP 1 CAST(OrdCantidad AS DECIMAL(18,2)) FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden = RTRIM(o.CodigoOrden) ORDER BY OrdIdOrden DESC) AS CantDep,
           (SELECT ISNULL(SUM(-m.MovImporte), 0) FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = o.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%' AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
               AND (m.MovConcepto = RTRIM(o.CodigoOrden) OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %')) AS Rebajado
    FROM dbo.Ordenes o WHERE RTRIM(o.CodigoOrden) = 'SUB-27265')
INSERT @R SELECT 2, 'SUB-27265 (bandera): rebaja y depósito en piezas',
    'Piezas=' + CAST(Piezas AS VARCHAR(20)) + ' Rebajado=' + CAST(Rebajado AS VARCHAR(20)) + ' Depósito=' + CAST(ISNULL(CantDep, 0) AS VARCHAR(20)),
    CASE WHEN Piezas > 0 AND ABS(Rebajado - Piezas) < 0.01 AND ABS(ISNULL(CantDep, 0) - Piezas) < 0.01 THEN 'OK' ELSE 'REVISAR' END
FROM x;
IF NOT EXISTS (SELECT 1 FROM @R WHERE Nro = 2) INSERT @R VALUES (2, 'SUB-27265 (bandera): rebaja y depósito en piezas', 'la orden no existe en esta base', 'REVISAR');

-- 3) Cobertura parcial: órdenes con excedente y sin la línea cubierta
INSERT @R SELECT 3, 'Cobertura parcial: excedente sin línea cubierta (desde 23-sep)', CAST(COUNT(*) AS VARCHAR(10)) + ' orden(es)', CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'REVISAR' END
FROM dbo.Ordenes o
WHERE o.FechaIngreso >= @DesdeOrden AND o.Estado NOT IN ('Cancelado','Anulado','RECHAZADO')
  AND EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID AND (d.PerfilAplicado LIKE '%Excedente%' OR d.LogPrecioAplicado LIKE 'Excedente de prepago%'))
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID AND (d.PerfilAplicado LIKE '%Prepago%' OR d.LogPrecioAplicado LIKE '%Plan #%'));

-- Universo del bug para 4..7: órdenes desde 23-sep, cliente con plan para el artículo
;WITH U AS (
    SELECT o.OrdenID, RTRIM(o.CodigoOrden) Cod, o.CliIdCliente, o.Prioridad,
           (SELECT TOP 1 x.OrdIdOrden FROM dbo.OrdenesDeposito x WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%' ORDER BY x.OrdIdOrden DESC) AS IdDep,
           (SELECT TOP 1 x.OrdFechaIngresoOrden FROM dbo.OrdenesDeposito x WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%' ORDER BY x.OrdIdOrden DESC) AS FechaDep,
           (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID) AS Lineas
    FROM dbo.Ordenes o
    WHERE o.FechaIngreso >= @DesdeOrden AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
      AND o.Estado NOT IN ('Cancelado','Anulado','RECHAZADO')
      AND EXISTS (SELECT 1 FROM dbo.PlanesMetros pm WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
                  AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                  AND (pm.ProIdProducto = o.ProIdProducto OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = o.ProIdProducto))))
, M AS (
    SELECT u.OrdenID, m.MovTipo, m.MovFecha, m.MovImporte
    FROM U u JOIN dbo.CuentasCliente cc ON cc.CliIdCliente = u.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
    JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
    WHERE m.MovTipo IN ('ENTREGA','RECARGO_URGENCIA') AND ISNULL(m.MovAnulado, 0) = 0
      AND (m.OrdIdOrden = u.OrdenID OR m.OrdIdOrden = u.IdDep OR m.MovConcepto = u.Cod OR m.MovConcepto LIKE u.Cod + ' %' OR m.MovConcepto LIKE '% - ' + u.Cod))
, T AS (
    SELECT
      (SELECT COUNT(*) FROM U WHERE Lineas = 0) AS SinLinea,
      (SELECT COUNT(*) FROM U u WHERE u.IdDep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM M WHERE M.OrdenID = u.OrdenID AND M.MovTipo = 'ENTREGA')) AS EnDepSinRebaja,
      (SELECT COUNT(*) FROM U u JOIN M ON M.OrdenID = u.OrdenID WHERE u.FechaDep IS NOT NULL AND M.MovFecha > DATEADD(HOUR, 1, u.FechaDep)) AS FechasTardias,
      (SELECT COUNT(*) FROM U u WHERE u.Prioridad = 'Urgente'
         AND EXISTS (SELECT 1 FROM M WHERE M.OrdenID = u.OrdenID AND M.MovTipo = 'ENTREGA')
         AND NOT EXISTS (SELECT 1 FROM M WHERE M.OrdenID = u.OrdenID AND M.MovTipo = 'RECARGO_URGENCIA')
         AND (SELECT ISNULL(Valor,'') FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_ACTIVO') = '1'
         AND ( ((SELECT ISNULL(Valor,'TODOS') FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_MODO') = 'PILOTO'
                AND EXISTS (SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones x WHERE x.CliIdCliente = u.CliIdCliente AND x.Activo = 1))
            OR ((SELECT ISNULL(Valor,'TODOS') FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_MODO') <> 'PILOTO'
                AND NOT EXISTS (SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones x WHERE x.CliIdCliente = u.CliIdCliente AND x.Activo = 1)) )) AS UrgSinRecargo
)
INSERT @R
SELECT 4, 'Líneas: órdenes de clientes con plan sin ninguna línea', CAST(SinLinea AS VARCHAR(10)) + ' orden(es)', CASE WHEN SinLinea = 0 THEN 'OK' ELSE 'REVISAR' END FROM T
UNION ALL SELECT 5, 'Rebaja: en depósito sin ENTREGA', CAST(EnDepSinRebaja AS VARCHAR(10)) + ' orden(es)', CASE WHEN EnDepSinRebaja = 0 THEN 'OK' ELSE 'REVISAR' END FROM T
UNION ALL SELECT 6, 'Retrofechado: movimientos con fecha > 1 h después del ingreso', CAST(FechasTardias AS VARCHAR(10)) + ' movimiento(s)', CASE WHEN FechasTardias = 0 THEN 'OK' ELSE 'REVISAR' END FROM T
UNION ALL SELECT 7, 'Urgencias: urgentes con ENTREGA y sin recargo (según config)', CAST(UrgSinRecargo AS VARCHAR(10)) + ' orden(es)', CASE WHEN UrgSinRecargo = 0 THEN 'OK' ELSE 'REVISAR' END FROM T;

-- 8) El fix anda: la última orden de cliente con plan tiene línea puesta por el sync (no por el script)
;WITH ult AS (
    SELECT TOP 1 RTRIM(o.CodigoOrden) Cod, o.FechaIngreso,
           (SELECT TOP 1 d.LogPrecioAplicado FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID AND (d.PerfilAplicado LIKE '%Prepago%' OR d.LogPrecioAplicado LIKE '%Plan #%') ORDER BY d.ID DESC) AS Log
    FROM dbo.Ordenes o
    WHERE o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%' AND o.Estado NOT IN ('Cancelado','Anulado','RECHAZADO')
      AND EXISTS (SELECT 1 FROM dbo.PlanesMetros pm WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
                  AND (pm.ProIdProducto = o.ProIdProducto OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = o.ProIdProducto)))
    ORDER BY o.OrdenID DESC)
INSERT @R SELECT 8, 'Fix desplegado: última orden con plan cotizada por el sync',
    Cod + ' (' + CONVERT(VARCHAR(16), FechaIngreso, 120) + ' UTC): ' + ISNULL(LEFT(Log, 45), 'SIN LÍNEA DE PLAN'),
    CASE WHEN Log LIKE 'Cubierto%' OR Log LIKE 'Prepago Parcial%' THEN 'OK' WHEN Log LIKE '%repuesta%' THEN 'ESPERAR' ELSE 'REVISAR' END
FROM ult;

-- 9) Ventas VEN con la tela 411
INSERT @R SELECT 9, 'Ventas VEN estampadas con la tela 411', CAST(COUNT(*) AS VARCHAR(10)) + ' fila(s)', CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'REVISAR' END
FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden LIKE 'VEN-%' AND ProIdProducto = 411;

SELECT Nro, Item, Resultado, Estado FROM @R ORDER BY Nro;
