-- =====================================================================================
-- PROD_verificar_rebaja_plan_ordenes_sin_linea.sql  (25-sep-2026)  — SOLO LECTURA
--
-- ¿Las órdenes de clientes con plan (rollo) que quedaron SIN línea de cobranza rebajaron
-- igual los metros del plan?  Mismo universo que la sección A del script de reparación.
--
-- La rebaja del plan se graba SIEMPRE como un movimiento ENTREGA en la cuenta de metros
-- del plan (MovimientosCuenta, MovTipo='ENTREGA', MovObservaciones='Plan #N', OrdIdOrden =
-- id de OrdenesDeposito). Se dispara al INGRESAR el bulto a depósito. Entonces, por orden:
--   Etiquetas   : cuántas etiquetas tiene (sin etiqueta no hay bulto)
--   EnDeposito  : si ya entró a depósito (OrdenesDeposito) y con qué cantidad
--   MetrosRebaj : metros que se restaron del plan (suma de ENTREGA no anuladas)
--   Situacion   : REBAJÓ OK / ENTRÓ A DEPÓSITO PERO NO REBAJÓ / NO ENTRÓ A DEPÓSITO
-- =====================================================================================
SET NOCOUNT ON;
DECLARE @Desde DATE = '2026-09-23';

;WITH Base AS (
    SELECT
        o.OrdenID,
        RTRIM(o.CodigoOrden)                   AS Cod,
        o.Estado,
        o.FechaIngreso,
        o.CliIdCliente,
        o.ProIdProducto,
        TRY_CONVERT(DECIMAL(18,2), o.Magnitud) AS CantOrden,
        pl.PlaIdPlan,
        pl.CueIdCuenta                         AS CuentaPlan
    FROM dbo.Ordenes o
    OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan, pm.CueIdCuenta
                 FROM dbo.PlanesMetros pm
                 WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
                   AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                   AND (pm.ProIdProducto = o.ProIdProducto
                        OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                                   WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = o.ProIdProducto))
                 ORDER BY pm.PlaFechaAlta) pl
    WHERE o.FechaIngreso >= @Desde
      AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
      AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
      AND pl.PlaIdPlan IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID)
),
Detalle AS (
    SELECT
        b.*,
        (SELECT COUNT(*) FROM dbo.Etiquetas e WHERE e.OrdenID = b.OrdenID)                 AS Etiquetas,
        od.OrdIdOrden                                                                       AS IdDeposito,
        od.OrdCantidad                                                                      AS CantDeposito,
        od.OrdFechaIngresoOrden                                                             AS FechaDeposito,
        od.OrdCostoFinal                                                                    AS CostoDeposito,
        -- Metros rebajados del plan: ENTREGA sobre cuentas de METROS del cliente (no dinero),
        -- vinculadas por el id del depósito o por el código de la orden en el concepto.
        ISNULL((SELECT SUM(-m.MovImporte)
                FROM dbo.MovimientosCuenta m
                JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
                WHERE cc.CliIdCliente = b.CliIdCliente
                  AND cc.CueTipo NOT LIKE 'DINERO%'
                  AND m.MovTipo = 'ENTREGA'
                  AND ISNULL(m.MovAnulado, 0) = 0
                  AND ( m.OrdIdOrden = b.OrdenID OR (od.OrdIdOrden IS NOT NULL AND m.OrdIdOrden = od.OrdIdOrden)
                        OR m.MovConcepto = b.Cod
                        OR m.MovConcepto LIKE b.Cod + ' %' )), 0)                           AS MetrosRebaj,
        (SELECT MAX(m.MovFecha)
         FROM dbo.MovimientosCuenta m
         JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
         WHERE cc.CliIdCliente = b.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
           AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
           AND ( m.OrdIdOrden = b.OrdenID OR (od.OrdIdOrden IS NOT NULL AND m.OrdIdOrden = od.OrdIdOrden)
                 OR m.MovConcepto = b.Cod OR m.MovConcepto LIKE b.Cod + ' %' ))            AS FechaRebaja
    FROM Base b
    OUTER APPLY (SELECT TOP 1 x.OrdIdOrden, x.OrdCantidad, x.OrdFechaIngresoOrden, x.OrdCostoFinal
                 FROM dbo.OrdenesDeposito x
                 WHERE x.OrdCodigoOrden = b.Cod OR x.OrdCodigoOrden LIKE b.Cod + ' (%'
                 ORDER BY x.OrdIdOrden DESC) od
)
SELECT
    Cod, Estado, FechaIngreso, CantOrden, PlaIdPlan, Etiquetas,
    CASE WHEN IdDeposito IS NULL THEN 'NO' ELSE 'SÍ' END AS EnDeposito,
    CantDeposito, FechaDeposito, CostoDeposito,
    MetrosRebaj, FechaRebaja,
    CASE
        WHEN MetrosRebaj > 0 AND ABS(MetrosRebaj - CantOrden) <= 0.01 THEN 'REBAJÓ OK'
        WHEN MetrosRebaj > 0                                           THEN 'REBAJÓ OTRA CANTIDAD (revisar)'
        WHEN IdDeposito IS NOT NULL                                    THEN 'ENTRÓ A DEPÓSITO PERO NO REBAJÓ (revisar)'
        WHEN Etiquetas = 0                                             THEN 'SIN ETIQUETA: todavía no puede entrar a depósito'
        ELSE                                                                'CON ETIQUETA, AÚN NO ENTRÓ A DEPÓSITO'
    END AS Situacion
FROM Detalle
ORDER BY CASE WHEN Estado = 'Finalizado' THEN 0 ELSE 1 END, FechaIngreso DESC;

-- Resumen
;WITH Base AS (
    SELECT o.OrdenID, RTRIM(o.CodigoOrden) AS Cod, o.Estado, o.CliIdCliente,
           TRY_CONVERT(DECIMAL(18,2), o.Magnitud) AS CantOrden
    FROM dbo.Ordenes o
    WHERE o.FechaIngreso >= @Desde
      AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
      AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
      AND EXISTS (SELECT 1 FROM dbo.PlanesMetros pm
                  WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
                    AND (pm.ProIdProducto = o.ProIdProducto
                         OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                                    WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = o.ProIdProducto)))
      AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID)
)
, Flags AS (
    SELECT
        b.Estado,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.OrdenesDeposito x WHERE x.OrdCodigoOrden = b.Cod OR x.OrdCodigoOrden LIKE b.Cod + ' (%') THEN 1 ELSE 0 END AS EnDep,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
                          WHERE cc.CliIdCliente = b.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
                            AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
                            AND (m.OrdIdOrden = b.OrdenID OR m.MovConcepto = b.Cod OR m.MovConcepto LIKE b.Cod + ' %'
                                 OR m.OrdIdOrden IN (SELECT x.OrdIdOrden FROM dbo.OrdenesDeposito x WHERE x.OrdCodigoOrden = b.Cod OR x.OrdCodigoOrden LIKE b.Cod + ' (%')))
             THEN 1 ELSE 0 END AS Rebajo
    FROM Base b
)
SELECT Estado, COUNT(*) AS Ordenes, SUM(EnDep) AS EnDeposito, SUM(Rebajo) AS Rebajaron
FROM Flags
GROUP BY Estado
ORDER BY CASE WHEN Estado = 'Finalizado' THEN 0 ELSE 1 END, Estado;
