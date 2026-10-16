-- =====================================================================================
-- PROD_diagnostico_final_prepago_rollo.sql  (25-sep-2026)  — SOLO LECTURA
--
-- Control final después de correr los scripts de reparación del bug "línea cubierta por
-- plan no guardada" (deploy 23-sep). Cada bloque devuelve las filas que estarían MAL;
-- lo esperado es que todos vengan VACÍOS, salvo el 7 que es informativo.
--
-- Universo: órdenes ingresadas desde @DesdeOrden, de clientes con plan activo para su
-- artículo, sin línea de cobranza o con la línea repuesta (el conjunto del bug).
-- =====================================================================================
SET NOCOUNT ON;
DECLARE @DesdeOrden DATE = '2026-09-23';

IF OBJECT_ID('tempdb..#U') IS NOT NULL DROP TABLE #U;
SELECT
    o.OrdenID, RTRIM(o.CodigoOrden) AS Cod, o.Estado, o.FechaIngreso, o.CliIdCliente, o.Prioridad,
    ISNULL(od.ProIdProducto, o.ProIdProducto) AS ProIdProducto,
    TRY_CONVERT(DECIMAL(18,2), o.Magnitud)    AS CantOrden,
    od.OrdIdOrden AS IdDeposito, CAST(od.OrdCantidad AS DECIMAL(18,4)) AS CantDeposito, od.OrdFechaIngresoOrden AS FechaDeposito,
    pl.PlaIdPlan, pl.CueIdCuenta AS CuentaPlan,
    (SELECT COUNT(*) FROM dbo.Etiquetas e WHERE e.OrdenID = o.OrdenID) AS Etiquetas,
    (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID) AS Lineas
INTO #U
FROM dbo.Ordenes o
OUTER APPLY (SELECT TOP 1 x.OrdIdOrden, x.OrdCantidad, x.OrdFechaIngresoOrden, x.ProIdProducto
             FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY x.OrdIdOrden DESC) od
OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan, pm.CueIdCuenta
             FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
               AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
               AND (pm.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)
                    OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                               WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)))
             ORDER BY pm.PlaFechaAlta) pl
WHERE o.FechaIngreso >= @DesdeOrden
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND pl.PlaIdPlan IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d
                  WHERE d.OrdenID = o.OrdenID AND ISNULL(d.LogPrecioAplicado, '') NOT LIKE '%nea repuesta%');

-- Movimientos de metros de cada orden del universo
IF OBJECT_ID('tempdb..#M') IS NOT NULL DROP TABLE #M;
SELECT u.Cod, u.OrdenID, m.MovIdMovimiento, m.MovTipo, m.MovImporte, m.MovFecha, m.CueIdCuenta, m.MovObservaciones
INTO #M
FROM #U u
JOIN dbo.CuentasCliente cc ON cc.CliIdCliente = u.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE m.MovTipo IN ('ENTREGA', 'RECARGO_URGENCIA') AND ISNULL(m.MovAnulado, 0) = 0
  AND ( m.OrdIdOrden = u.OrdenID OR (u.IdDeposito IS NOT NULL AND m.OrdIdOrden = u.IdDeposito)
        OR m.MovConcepto = u.Cod OR m.MovConcepto LIKE u.Cod + ' %'
        OR m.MovConcepto LIKE '% - ' + u.Cod OR m.MovObservaciones LIKE '% - ' + u.Cod );

DECLARE @NU INT; SELECT @NU = COUNT(*) FROM #U;
PRINT 'Universo del bug (órdenes desde ' + CONVERT(VARCHAR(10), @DesdeOrden, 120) + ', cliente con plan, sin línea o con línea repuesta): ' + CAST(@NU AS VARCHAR(10));

-- 1) En depósito y SIN rebaja  → esperado 0
PRINT '1) En depósito sin ENTREGA (esperado: 0)';
SELECT u.Cod, u.Estado, u.CantDeposito, u.FechaDeposito, u.PlaIdPlan
FROM #U u WHERE u.IdDeposito IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM #M m WHERE m.OrdenID = u.OrdenID AND m.MovTipo = 'ENTREGA')
ORDER BY u.FechaDeposito;

-- 2) Rebajó otra cantidad que la que entró a depósito (doble rebaja o parcial) → esperado 0
PRINT '2) Metros ENTREGA distintos de la cantidad del depósito (esperado: 0)';
SELECT u.Cod, u.CantDeposito, ISNULL(x.Metros, 0) AS MetrosEntrega, ISNULL(x.Movs, 0) AS CantMovsEntrega
FROM #U u
OUTER APPLY (SELECT SUM(-m.MovImporte) AS Metros, COUNT(*) AS Movs FROM #M m WHERE m.OrdenID = u.OrdenID AND m.MovTipo = 'ENTREGA') x
WHERE u.IdDeposito IS NOT NULL AND x.Movs > 0 AND ABS(ISNULL(x.Metros, 0) - u.CantDeposito) > 0.01
ORDER BY u.Cod;

-- 3) Movimientos con fecha posterior al ingreso a depósito (quedaron con fecha de la corrida) → esperado 0
PRINT '3) ENTREGA/RECARGO con fecha > 1 h después del ingreso a depósito (esperado: 0)';
SELECT u.Cod, m.MovTipo, m.MovImporte, m.MovFecha, u.FechaDeposito, m.MovIdMovimiento
FROM #M m JOIN #U u ON u.OrdenID = m.OrdenID
WHERE u.FechaDeposito IS NOT NULL AND m.MovFecha > DATEADD(HOUR, 1, u.FechaDeposito)
ORDER BY u.Cod, m.MovIdMovimiento;

-- 4) Urgentes con ENTREGA y sin recargo, según la configuración vigente → esperado 0
DECLARE @Activo NVARCHAR(50), @Modo NVARCHAR(50);
SELECT @Activo = Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_ACTIVO';
SELECT @Modo   = ISNULL(Valor, 'TODOS') FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_MODO';
PRINT '4) Urgentes con ENTREGA y sin RECARGO_URGENCIA (esperado: 0) — recargo ACTIVO=' + ISNULL(@Activo,'NULL') + ' MODO=' + ISNULL(@Modo,'TODOS');
SELECT u.Cod, u.Prioridad, u.PlaIdPlan
FROM #U u
WHERE ISNULL(@Activo, '') = '1' AND u.Prioridad = 'Urgente'
  AND EXISTS (SELECT 1 FROM #M m WHERE m.OrdenID = u.OrdenID AND m.MovTipo = 'ENTREGA')
  AND NOT EXISTS (SELECT 1 FROM #M m WHERE m.OrdenID = u.OrdenID AND m.MovTipo = 'RECARGO_URGENCIA')
  AND ( (@Modo = 'PILOTO' AND EXISTS (SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones x WHERE x.CliIdCliente = u.CliIdCliente AND x.Activo = 1))
     OR (@Modo <> 'PILOTO' AND NOT EXISTS (SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones x WHERE x.CliIdCliente = u.CliIdCliente AND x.Activo = 1)) )
ORDER BY u.Cod;

-- 5) Cuentas de metros tocadas: saldo guardado vs suma de movimientos, y saldo corrido del último movimiento → esperado 0
PRINT '5) Cuentas de metros descuadradas (esperado: 0)';
;WITH cta AS (SELECT DISTINCT CueIdCuenta FROM #M)
SELECT c.CueIdCuenta, cc.CliIdCliente, cc.CueSaldoActual,
       s.SumaMovs,
       ult.MovSaldoPosterior AS SaldoCorridoUltimo,
       CASE WHEN ABS(cc.CueSaldoActual - s.SumaMovs) > 0.01 THEN 'SALDO GUARDADO <> SUMA DE MOVIMIENTOS' ELSE '' END AS Problema1,
       CASE WHEN ABS(ISNULL(ult.MovSaldoPosterior, 0) - s.SumaMovs) > 0.01 THEN 'SALDO CORRIDO DESALINEADO (recalcular)' ELSE '' END AS Problema2
FROM cta c
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta
CROSS APPLY (SELECT ISNULL(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') THEN MovImporte ELSE 0 END), 0) AS SumaMovs
             FROM dbo.MovimientosCuenta WHERE CueIdCuenta = c.CueIdCuenta AND ISNULL(MovAnulado, 0) = 0) s
OUTER APPLY (SELECT TOP 1 MovSaldoPosterior FROM dbo.MovimientosCuenta
             WHERE CueIdCuenta = c.CueIdCuenta AND ISNULL(MovAnulado, 0) = 0 ORDER BY MovFecha DESC, MovIdMovimiento DESC) ult
WHERE ABS(cc.CueSaldoActual - s.SumaMovs) > 0.01 OR ABS(ISNULL(ult.MovSaldoPosterior, 0) - s.SumaMovs) > 0.01
ORDER BY c.CueIdCuenta;

-- 6) Planes tocados: disponible del plan (Total - Usada) vs saldo de su cuenta → esperado 0
PRINT '6) Planes cuyo disponible no coincide con el saldo de su cuenta de metros (esperado: 0)';
;WITH pl AS (SELECT DISTINCT PlaIdPlan FROM #U)
SELECT p.PlaIdPlan, p.CliIdCliente, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Disponible, cc.CueSaldoActual AS SaldoCuenta, p.PlaActivo
FROM pl JOIN dbo.PlanesMetros p ON p.PlaIdPlan = pl.PlaIdPlan
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
WHERE ABS((p.PlaCantidadTotal - p.PlaCantidadUsada) - cc.CueSaldoActual) > 0.01
ORDER BY p.PlaIdPlan;

-- 7) Todavía sin línea de cobranza, o sin etiqueta, o sin entrar a depósito → informativo (van a entrar por el camino normal)
PRINT '7) Pendientes del circuito normal (informativo): sin línea / sin etiqueta / aún no en depósito';
SELECT u.Cod, u.Estado, u.CantOrden, u.Lineas, u.Etiquetas,
       CASE WHEN u.IdDeposito IS NULL THEN 'NO' ELSE 'SÍ' END AS EnDeposito,
       CASE WHEN u.Lineas = 0 THEN 'SIN LÍNEA: correr PROD_reparar_lineas_prepago_sin_cantidad.sql'
            WHEN u.Etiquetas = 0 THEN 'SIN ETIQUETA: generar desde la orden'
            WHEN u.IdDeposito IS NULL THEN 'CON ETIQUETA, falta recibir en depósito'
            ELSE '' END AS QueFalta
FROM #U u
WHERE u.Lineas = 0 OR u.Etiquetas = 0 OR u.IdDeposito IS NULL
ORDER BY u.Estado, u.FechaIngreso;

-- 8) Líneas "Prepago" con precio > 0 guardadas a mano desde el deploy (cobrarían metros ya cubiertos) → esperado 0
PRINT '8) Líneas Prepago con precio > 0 desde el deploy (esperado: 0) — ej. SUB-26932';
SELECT RTRIM(o.CodigoOrden) AS Cod, d.ID AS LineaID, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.EsFacturable, d.PerfilAplicado
FROM dbo.PedidosCobranzaDetalle d JOIN dbo.Ordenes o ON o.OrdenID = d.OrdenID
WHERE o.FechaIngreso >= @DesdeOrden AND d.PerfilAplicado LIKE '%Prepago%' AND d.PerfilAplicado NOT LIKE '%Excedente%' AND d.Subtotal > 0
ORDER BY o.FechaIngreso;


-- 9) BILLETERA DE DINERO con descuento automático: órdenes (desde @DesdeOrden) de clientes con esa billetera,
--    SIN plan de metros para el artículo, en depósito con costo > 0, que NO tienen CONSUMO_CUENTA en la billetera.
--    Regla del motor (buscarCuentaAutoConsumoParaOrden): cuenta activa, no principal, CueAutoConsumo=1, DINERO,
--    restringida con el artículo en su lista blanca o libre; para SEMANALES al ingreso solo descuentan las restringidas.
--    Si el saldo de la billetera era 0 y no acepta negativo, es legítimo que no haya consumido (fue a la principal).
PRINT '9) Órdenes con billetera automática CON SALDO que NO consumieron de la billetera (esperado: 0)';
SELECT RTRIM(o.CodigoOrden) AS Cod, o.Estado, od.OrdFechaIngresoOrden AS FechaDeposito, od.OrdCostoFinal AS CostoDeposito,
       od.MonIdMoneda AS MonOrden, b.CueIdCuenta AS Billetera, b.CueNombre, b.MonIdMoneda AS MonBilletera,
       b.CueRestringida, b.CuePuedeNegativo, b.Saldo AS SaldoBilletera,
       'TENÍA SALDO Y NO CONSUMIÓ: revisar' AS Lectura
FROM dbo.Ordenes o
JOIN dbo.Clientes c ON c.CliIdCliente = o.CliIdCliente
CROSS APPLY (SELECT TOP 1 x.OrdIdOrden, x.OrdCostoFinal, x.MonIdMoneda, x.OrdFechaIngresoOrden, x.ProIdProducto
             FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY x.OrdIdOrden DESC) od
CROSS APPLY (SELECT CASE WHEN c.TClIdTipoCliente = 2
                          OR EXISTS (SELECT 1 FROM dbo.CuentasCliente p WHERE p.CliIdCliente = c.CliIdCliente AND p.CueEsPrincipal = 1 AND ISNULL(p.CueDiasCiclo, 0) > 0)
                         THEN 1 ELSE 0 END AS EsSemanal) sem
CROSS APPLY (SELECT TOP 1 cc.CueIdCuenta, cc.CueNombre, cc.MonIdMoneda, cc.CueRestringida, cc.CuePuedeNegativo,
                    ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
             FROM dbo.CuentasCliente cc
             WHERE cc.CliIdCliente = o.CliIdCliente AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 0
               AND cc.CueAutoConsumo = 1 AND cc.CueTipo LIKE 'DINERO%'
               AND ( cc.CueRestringida = 0
                     OR EXISTS (SELECT 1 FROM dbo.CuentasClienteArticulosPermitidos ap
                                WHERE ap.CueIdCuenta = cc.CueIdCuenta AND ap.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)) )
               AND (sem.EsSemanal = 0 OR cc.CueRestringida = 1)
             ORDER BY cc.CueRestringida DESC,
                      CASE WHEN ISNULL(cc.MonIdMoneda, 1) = od.MonIdMoneda THEN 0 ELSE 1 END, cc.CueIdCuenta) b
WHERE o.FechaIngreso >= @DesdeOrden
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND ISNULL(od.OrdCostoFinal, 0) > 0
  -- solo billeteras que TENÍAN con qué pagar (saldo > 0) o que aceptan negativo; con saldo 0 es legítimo que no consuma
  AND (b.Saldo > 0.001 OR ISNULL(b.CuePuedeNegativo, 0) = 1)
  -- sin plan de metros para el artículo (si hay plan, el plan gana y la billetera no se toca)
  AND NOT EXISTS (SELECT 1 FROM dbo.PlanesMetros pm
                  WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
                    AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                    AND (pm.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)
                         OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                                    WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto))))
  -- sin consumo registrado en la billetera para esta orden
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  WHERE m.CueIdCuenta = b.CueIdCuenta AND m.MovTipo = 'CONSUMO_CUENTA' AND ISNULL(m.MovAnulado, 0) = 0
                    AND ( m.OrdIdOrden = od.OrdIdOrden OR m.OrdIdOrden = o.OrdenID
                          OR m.MovConcepto = RTRIM(o.CodigoOrden) OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %' ))
ORDER BY od.OrdFechaIngresoOrden;

-- 10) DESPUÉS DEL DEPLOY DEL FIX: órdenes de clientes con plan creadas desde @DesdeFix. Deben nacer con su
--     línea Prepago a $0 (con el fix: EsFacturable = 0; el código viejo la dejaba en 1 pero igual a $0, no cobra);
--     si están en depósito, con ENTREGA. Cualquier fila con Problema <> '' está mal.
DECLARE @DesdeFix DATETIME = '2026-09-25 12:00';   -- <<< poner la hora real del deploy del backend
PRINT '10) Órdenes con plan creadas después del deploy del fix (esperado: columna Problema vacía en todas)';
SELECT RTRIM(o.CodigoOrden) AS Cod, o.Estado, o.FechaIngreso, TRY_CONVERT(DECIMAL(18,2), o.Magnitud) AS CantOrden,
       lp.Cantidad AS CantLinea, lp.Subtotal AS SubtotalLinea, lp.EsFacturable, LEFT(lp.PerfilAplicado, 30) AS Perfil, LEFT(lp.LogPrecioAplicado, 45) AS Log,
       (SELECT COUNT(*) FROM dbo.Etiquetas e WHERE e.OrdenID = o.OrdenID) AS Etiquetas,
       CASE WHEN od.OrdIdOrden IS NULL THEN 'NO' ELSE 'SÍ' END AS EnDeposito,
       ent.Metros AS MetrosEntrega,
       CASE WHEN lp.ID IS NULL THEN 'SIN NINGUNA LÍNEA: EL FIX NO ESTÁ ANDANDO'
            WHEN lp.EsPlan = 0 AND lp.Subtotal > 0 THEN 'LÍNEA CON PRECIO NORMAL: el plan no la cubrió al crear (revisar si corresponde)'
            WHEN lp.EsPlan = 0 THEN 'LÍNEA SIN PLAN NI PRECIO: revisar'
            WHEN lp.Subtotal > 0 THEN 'LÍNEA COBRABLE: se le cobraría al cliente, revisar'
            WHEN ABS(ISNULL(tl.CantTotal, 0) - TRY_CONVERT(DECIMAL(18,2), o.Magnitud)) > 0.05 THEN 'CANTIDAD DE LAS LÍNEAS <> MAGNITUD (diferencia > 5 cm: revisar)'
            WHEN od.OrdIdOrden IS NOT NULL AND ISNULL(ent.Metros, 0) = 0 THEN 'EN DEPÓSITO SIN ENTREGA: no rebajó'
            ELSE '' END AS Problema
FROM dbo.Ordenes o
-- cualquier línea de la orden, primero la de plan si la hay
OUTER APPLY (SELECT TOP 1 d.ID, d.Cantidad, d.Subtotal, d.EsFacturable, d.PerfilAplicado, d.LogPrecioAplicado,
                    CASE WHEN d.PerfilAplicado LIKE '%Prepago%' OR d.LogPrecioAplicado LIKE '%Plan #%' THEN 1 ELSE 0 END AS EsPlan
             FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID
             ORDER BY CASE WHEN d.PerfilAplicado LIKE '%Prepago%' OR d.LogPrecioAplicado LIKE '%Plan #%' THEN 0 ELSE 1 END, d.ID DESC) lp
-- cobertura parcial: la cantidad se reparte en 2 líneas (cubierta + excedente); se compara la suma
OUTER APPLY (SELECT SUM(d.Cantidad) AS CantTotal FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID) tl
OUTER APPLY (SELECT TOP 1 x.OrdIdOrden FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%' ORDER BY x.OrdIdOrden DESC) od
OUTER APPLY (SELECT SUM(-m.MovImporte) AS Metros FROM dbo.MovimientosCuenta m
             JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = o.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%' AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
               AND ( m.OrdIdOrden = o.OrdenID OR m.OrdIdOrden = od.OrdIdOrden OR m.MovConcepto = RTRIM(o.CodigoOrden) OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %' )) ent
WHERE o.FechaIngreso >= @DesdeFix
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND EXISTS (SELECT 1 FROM dbo.PlanesMetros pm
              WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
                AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                AND (pm.ProIdProducto = o.ProIdProducto
                     OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = o.ProIdProducto)))
ORDER BY o.FechaIngreso DESC;


DROP TABLE #M; DROP TABLE #U;
