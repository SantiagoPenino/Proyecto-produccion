-- =====================================================================================
-- PROD_diagnostico_billeteras_con_saldo.sql  (25-sep-2026)  — SOLO LECTURA
--
-- ¿Las BILLETERAS de dinero (cuentas no principales) están descontando bien?
--   A) Clientes con billetera CON SALDO (o que acepta negativo): quiénes son y cómo está configurada.
--   B) Por cada ingreso a depósito de esos clientes desde @Desde: qué tenía que pasar según el
--      motor (plan de metros / billetera restringida / billetera libre / cierre semanal / principal)
--      y qué pasó (consumo en la billetera, deuda en la principal, entrega en el plan).
--   C) Movimientos de esas billeteras desde @Desde (cargas, consumos, ajustes).
--
-- Regla del motor (contabilidadService.buscarCuentaAutoConsumoParaOrden):
--   · si el cliente tiene PLAN DE METROS para el artículo → el plan cubre, la billetera no se toca
--   · si no: billetera activa, no principal, con descuento automático (CueAutoConsumo=1), DINERO,
--     restringida con el artículo en su lista blanca o libre; prioridad restringida > misma moneda > más vieja
--   · SEMANAL (tipo 2 o principal con días de ciclo): al ingreso solo descuentan las restringidas;
--     las libres van al cierre del ciclo
--   · si el saldo no alcanza y no acepta negativo: consume lo que hay y el resto va a la principal
-- =====================================================================================
SET NOCOUNT ON;
DECLARE @Desde DATETIME = DATEADD(DAY, -2, CAST(GETDATE() AS DATE));   -- últimos 2 días (cambiar si hace falta)

IF OBJECT_ID('tempdb..#B') IS NOT NULL DROP TABLE #B;
SELECT cc.CueIdCuenta, cc.CliIdCliente, LEFT(c.Nombre, 30) AS Cliente,
       UPPER(ISNULL(tc.TClDescripcion, '')) AS TipoCliente,
       CASE WHEN c.TClIdTipoCliente = 2 OR EXISTS (SELECT 1 FROM dbo.CuentasCliente p WHERE p.CliIdCliente = c.CliIdCliente AND p.CueEsPrincipal = 1 AND ISNULL(p.CueDiasCiclo, 0) > 0) THEN 1 ELSE 0 END AS EsSemanal,
       cc.CueNombre, cc.CueTipo, cc.MonIdMoneda, cc.CueAutoConsumo, cc.CueRestringida, cc.CuePuedeNegativo,
       ISNULL(cc.CueModalidadFiscal, 'ANTICIPO_A_FACTURAR') AS Modalidad,
       cc.CueSaldoActual AS SaldoGuardado,
       ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS SaldoReal,
       STUFF((SELECT ', ' + RTRIM(a.CodArticulo) FROM dbo.CuentasClienteArticulosPermitidos ap JOIN dbo.Articulos a ON a.ProIdProducto = ap.ProIdProducto WHERE ap.CueIdCuenta = cc.CueIdCuenta FOR XML PATH('')), 1, 2, '') AS ArticulosPermitidos
INTO #B
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
WHERE cc.CueActiva = 1 AND cc.CueEsPrincipal = 0 AND cc.CueTipo LIKE 'DINERO%';
DELETE FROM #B WHERE NOT (SaldoReal > 0.01 OR (CuePuedeNegativo = 1 AND ABS(SaldoReal) > 0.01));

PRINT 'A) Billeteras con saldo (o en rojo permitido)';
SELECT Cliente, TipoCliente, EsSemanal, CueIdCuenta, CueNombre, CueTipo, CueAutoConsumo, CueRestringida, CuePuedeNegativo, Modalidad,
       SaldoGuardado, SaldoReal,
       CASE WHEN ABS(SaldoGuardado - SaldoReal) > 0.01 THEN 'SALDO GUARDADO <> MOVIMIENTOS' ELSE '' END AS Alerta,
       ArticulosPermitidos
FROM #B ORDER BY Cliente, CueIdCuenta;

PRINT 'B) Ingresos a depósito de esos clientes desde @Desde: qué tenía que pasar y qué pasó';
SELECT RTRIM(od.OrdCodigoOrden) AS Cod, b.Cliente, od.OrdFechaIngresoOrden AS Ingreso, od.OrdCostoFinal AS Costo, od.MonIdMoneda AS Mon,
       RTRIM(a.CodArticulo) AS Art,
       CASE WHEN pl.PlaIdPlan IS NOT NULL THEN 'PLAN DE METROS #' + CAST(pl.PlaIdPlan AS VARCHAR(10)) + ' (billetera no aplica)'
            WHEN w.CueIdCuenta IS NULL AND b.EsSemanal = 1 THEN 'SEMANAL sin restringida: va al CIERRE (principal)'
            WHEN w.CueIdCuenta IS NULL THEN 'sin billetera automática que aplique: PRINCIPAL'
            ELSE 'BILLETERA ' + CAST(w.CueIdCuenta AS VARCHAR(10)) + ' (' + ISNULL(w.CueNombre, '') + CASE WHEN w.CueRestringida = 1 THEN ', restringida' ELSE ', libre' END + ')' END AS Esperado,
       w.Saldo AS SaldoBilleteraHoy,
       ISNULL(cons.Importe, 0) AS ConsumidoBilletera,
       ISNULL(ordp.Importe, 0)  AS DeudaPrincipal,
       ISNULL(ent.Metros, 0)    AS MetrosPlan,
       CASE WHEN ISNULL(od.OrdCostoFinal, 0) <= 0 AND pl.PlaIdPlan IS NULL THEN 'costo 0: nada que cobrar'
            WHEN pl.PlaIdPlan IS NOT NULL THEN CASE WHEN ISNULL(ent.Metros, 0) > 0 AND ISNULL(cons.Importe, 0) = 0 THEN 'OK: rebajó el plan' ELSE 'REVISAR: plan sin ENTREGA o billetera tocada' END
            -- semanal con billetera libre: al ingreso no descuenta; lo paga el CIERRE del ciclo (CONSUMO) o queda deuda en la principal
            WHEN w.CueIdCuenta IS NULL AND b.EsSemanal = 1 THEN CASE WHEN ISNULL(cons.Importe, 0) > 0 THEN 'OK: la billetera lo pagó en el cierre del ciclo'
                                                                   WHEN ISNULL(ordp.Importe, 0) > 0 THEN 'OK: deuda en principal (se resuelve en el cierre)'
                                                                   ELSE 'pendiente de cierre (normal si el ciclo sigue abierto)' END
            WHEN w.CueIdCuenta IS NULL THEN CASE WHEN ISNULL(ordp.Importe, 0) > 0 THEN 'OK: deuda en principal' ELSE 'REVISAR: sin deuda ni consumo' END
            -- con billetera automática que aplica (los importes pueden estar en otra moneda que la orden: no se compara al centavo)
            WHEN ISNULL(cons.Importe, 0) > 0 AND ISNULL(ordp.Importe, 0) = 0 THEN 'OK: la billetera pagó'
            WHEN ISNULL(cons.Importe, 0) > 0 AND ISNULL(ordp.Importe, 0) > 0 THEN 'OK: parcial billetera + resto principal (saldo no alcanzaba)'
            WHEN ISNULL(cons.Importe, 0) = 0 AND ISNULL(ordp.Importe, 0) > 0 AND w.Saldo <= 0.01 AND ISNULL(w.CuePuedeNegativo, 0) = 0 THEN 'OK: la billetera que aplica está sin saldo, fue a la principal'
            WHEN ISNULL(cons.Importe, 0) = 0 AND ISNULL(ordp.Importe, 0) > 0 THEN 'REVISAR: tenía billetera con saldo y fue TODO a la principal'
            ELSE 'REVISAR: sin consumo ni deuda' END AS Lectura
FROM dbo.OrdenesDeposito od
JOIN (SELECT DISTINCT CliIdCliente, Cliente, EsSemanal FROM #B) b ON b.CliIdCliente = od.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = od.ProIdProducto
OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = od.CliIdCliente AND pm.PlaActivo = 1
               AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
               AND (pm.ProIdProducto = od.ProIdProducto OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = od.ProIdProducto))) pl
-- billetera que el motor elegiría
OUTER APPLY (SELECT TOP 1 cc.CueIdCuenta, cc.CueNombre, cc.CueRestringida, cc.CuePuedeNegativo,
                    ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
             FROM dbo.CuentasCliente cc
             WHERE cc.CliIdCliente = od.CliIdCliente AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 0 AND cc.CueAutoConsumo = 1 AND cc.CueTipo LIKE 'DINERO%'
               AND (cc.CueRestringida = 0 OR EXISTS (SELECT 1 FROM dbo.CuentasClienteArticulosPermitidos ap WHERE ap.CueIdCuenta = cc.CueIdCuenta AND ap.ProIdProducto = od.ProIdProducto))
               AND (b.EsSemanal = 0 OR cc.CueRestringida = 1)
             ORDER BY cc.CueRestringida DESC, CASE WHEN ISNULL(cc.MonIdMoneda, 1) = od.MonIdMoneda THEN 0 ELSE 1 END, cc.CueIdCuenta) w
-- consumos en CUALQUIER billetera del cliente para esta orden
OUTER APPLY (SELECT SUM(-m.MovImporte) AS Importe FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = od.CliIdCliente AND cc.CueEsPrincipal = 0 AND cc.CueTipo LIKE 'DINERO%'
               AND m.MovTipo = 'CONSUMO_CUENTA' AND ISNULL(m.MovAnulado, 0) = 0
               AND (m.OrdIdOrden = od.OrdIdOrden OR m.MovConcepto = RTRIM(od.OrdCodigoOrden) OR m.MovConcepto LIKE RTRIM(od.OrdCodigoOrden) + ' %')) cons
-- deuda ORDEN en la principal para esta orden
OUTER APPLY (SELECT SUM(-m.MovImporte) AS Importe FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = od.CliIdCliente AND cc.CueEsPrincipal = 1
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ISNULL(m.MovAnulado, 0) = 0
               AND (m.OrdIdOrden = od.OrdIdOrden OR m.MovConcepto = RTRIM(od.OrdCodigoOrden) OR m.MovConcepto LIKE RTRIM(od.OrdCodigoOrden) + ' %')) ordp
-- entrega de metros en el plan
OUTER APPLY (SELECT SUM(-m.MovImporte) AS Metros FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = od.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
               AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
               AND (m.OrdIdOrden = od.OrdIdOrden OR m.MovConcepto = RTRIM(od.OrdCodigoOrden) OR m.MovConcepto LIKE RTRIM(od.OrdCodigoOrden) + ' %')) ent
WHERE od.OrdFechaIngresoOrden >= @Desde
  AND od.OrdEstadoActual <> 10
  AND od.OrdCodigoOrden NOT LIKE '%-R%' AND od.OrdCodigoOrden NOT LIKE '%-F%'
ORDER BY b.Cliente, od.OrdFechaIngresoOrden;

PRINT 'C) Movimientos de esas billeteras desde @Desde';
SELECT b.Cliente, b.CueIdCuenta, b.CueNombre, m.MovFecha, m.MovTipo, m.MovImporte, m.MovSaldoPosterior, LEFT(m.MovConcepto, 40) AS Concepto, LEFT(m.MovObservaciones, 50) AS Obs
FROM #B b JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = b.CueIdCuenta
WHERE m.MovFecha >= @Desde AND ISNULL(m.MovAnulado, 0) = 0
ORDER BY b.Cliente, m.MovFecha, m.MovIdMovimiento;

DROP TABLE #B;
