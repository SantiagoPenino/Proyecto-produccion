-- =====================================================================================
-- PROD_corregir_rebaja_articulos_por_pieza.sql  (25-sep-2026)
--
-- CASO: artículos de Sublimación que se cotizan POR UNIDAD (Articulos.UniIdUnidad = 1, ej.
-- producto 218 "Bandera Confeccionada"). El sync los cotiza por PIEZAS = suma de copias de
-- los archivos de la orden (erpSyncService, "SUBLIMACIÓN por CANTIDAD"), y el plan del
-- cliente ("Plan desde Venta Directa Caja") se rebaja en unidades: -1, -2, -10.
--
-- Las órdenes de este tipo que quedaron sin línea entraron a depósito con la MAGNITUD en
-- metros (ej. 0,90) y el script de rebaja les descontó 0,90 "unidades" en vez de 1 pieza.
-- Este script corrige: ENTREGA = -piezas, ajusta PlaCantidadUsada y el saldo de la cuenta
-- por la diferencia, recalcula el saldo corrido, y deja OrdenesDeposito.OrdCantidad en piezas.
--
-- USO: @Aplicar = 0 lista; @Aplicar = 1 corrige. Solo órdenes desde @DesdeOrden (las del bug).
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar    BIT          = 0;
DECLARE @DesdeOrden DATE         = '2026-09-23';
DECLARE @Solo       NVARCHAR(50) = NULL;

IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;

SELECT
    RTRIM(o.CodigoOrden)                        AS Cod,
    o.OrdenID, o.Estado, o.CliIdCliente,
    TRY_CONVERT(DECIMAL(18,2), o.Magnitud)      AS MagnitudMetros,
    pz.Piezas,
    od.OrdIdOrden                               AS IdDeposito,
    CAST(od.OrdCantidad AS DECIMAL(18,4))       AS CantDeposito,
    ent.MovIdMovimiento                         AS MovEntrega,
    ent.CueIdCuenta,
    -ent.MovImporte                             AS RebajadoActual,
    ent.PlaIdPlan
INTO #C
FROM dbo.Ordenes o
JOIN dbo.Articulos a ON a.ProIdProducto = o.ProIdProducto AND a.UniIdUnidad = 1
CROSS APPLY (SELECT CAST(ISNULL(SUM(ao.Copias), 0) AS DECIMAL(18,2)) AS Piezas FROM dbo.ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID) pz
CROSS APPLY (SELECT TOP 1 x.OrdIdOrden, x.OrdCantidad FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY x.OrdIdOrden DESC) od
CROSS APPLY (SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte,
                    TRY_CONVERT(INT, LEFT(SUBSTRING(m.MovObservaciones, CHARINDEX('Plan #', m.MovObservaciones) + 6, 20),
                                          PATINDEX('%[^0-9]%', SUBSTRING(m.MovObservaciones, CHARINDEX('Plan #', m.MovObservaciones) + 6, 20) + 'x') - 1)) AS PlaIdPlan
             FROM dbo.MovimientosCuenta m
             JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = o.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
               AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovImporte < 0
               AND ISNULL(m.MovObservaciones, '') LIKE '%Plan #%'
               AND ( m.OrdIdOrden = o.OrdenID OR m.OrdIdOrden = od.OrdIdOrden
                     OR m.MovConcepto = RTRIM(o.CodigoOrden) OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %' )
             ORDER BY m.MovIdMovimiento DESC) ent
WHERE o.FechaIngreso >= @DesdeOrden
  AND LTRIM(RTRIM(o.AreaID)) = 'SB'
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND (@Solo IS NULL OR RTRIM(o.CodigoOrden) = @Solo)
  AND pz.Piezas > 0
  AND ABS(-ent.MovImporte - pz.Piezas) > 0.001;      -- rebajó algo distinto a las piezas

DECLARE @N INT; SELECT @N = COUNT(*) FROM #C;
PRINT '=== Artículos por unidad rebajados con otra cantidad que sus piezas (' + CAST(@N AS VARCHAR(10)) + ') ===';
SELECT Cod, Estado, MagnitudMetros, Piezas, CantDeposito, RebajadoActual, Piezas - RebajadoActual AS Diferencia, PlaIdPlan, MovEntrega,
       CASE WHEN PlaIdPlan IS NULL THEN 'SIN PLAN EN LA OBSERVACIÓN: revisar a mano' ELSE 'OK -> ENTREGA pasa a ' + CAST(Piezas AS VARCHAR(20)) + ' piezas' END AS Accion
FROM #C ORDER BY Cod;

IF @Aplicar = 1 AND EXISTS (SELECT 1 FROM #C WHERE PlaIdPlan IS NOT NULL)
BEGIN
    BEGIN TRAN;

    -- 1) la ENTREGA pasa a -piezas
    UPDATE m SET m.MovImporte = -c.Piezas
    FROM dbo.MovimientosCuenta m JOIN #C c ON c.MovEntrega = m.MovIdMovimiento
    WHERE c.PlaIdPlan IS NOT NULL;

    -- 2) plan y saldo de la cuenta: se mueven por la diferencia (piezas - lo rebajado antes)
    UPDATE p SET p.PlaCantidadUsada = p.PlaCantidadUsada + d.Dif
    FROM dbo.PlanesMetros p
    JOIN (SELECT PlaIdPlan, SUM(Piezas - RebajadoActual) AS Dif FROM #C WHERE PlaIdPlan IS NOT NULL GROUP BY PlaIdPlan) d ON d.PlaIdPlan = p.PlaIdPlan;

    UPDATE cc SET cc.CueSaldoActual = cc.CueSaldoActual - d.Dif
    FROM dbo.CuentasCliente cc
    JOIN (SELECT CueIdCuenta, SUM(Piezas - RebajadoActual) AS Dif FROM #C WHERE PlaIdPlan IS NOT NULL GROUP BY CueIdCuenta) d ON d.CueIdCuenta = cc.CueIdCuenta;

    -- 3) el depósito queda en piezas (es lo que muestra el retiro y el QR)
    UPDATE od SET od.OrdCantidad = c.Piezas
    FROM dbo.OrdenesDeposito od JOIN #C c ON c.IdDeposito = od.OrdIdOrden
    WHERE c.PlaIdPlan IS NOT NULL;

    -- 4) saldo corrido de cada cuenta tocada (misma fórmula del sistema)
    DECLARE @Cue INT;
    DECLARE cC CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT CueIdCuenta FROM #C WHERE PlaIdPlan IS NOT NULL;
    OPEN cC; FETCH NEXT FROM cC INTO @Cue;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        ;WITH ord AS (
            SELECT MovIdMovimiento,
                   SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') THEN MovImporte ELSE 0 END)
                     OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
            FROM dbo.MovimientosCuenta
            WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0)
        )
        UPDATE m SET m.MovSaldoPosterior = ord.run
        FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;
        FETCH NEXT FROM cC INTO @Cue;
    END
    CLOSE cC; DEALLOCATE cC;

    COMMIT;
    PRINT 'LISTO: ENTREGA, plan, saldo y depósito corregidos a piezas.';
    SELECT c.Cod, c.Piezas AS RebajadoAhora, p.PlaIdPlan, p.PlaCantidadUsada, cc.CueSaldoActual
    FROM #C c JOIN dbo.PlanesMetros p ON p.PlaIdPlan = c.PlaIdPlan JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta
    WHERE c.PlaIdPlan IS NOT NULL;
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0) o nada para corregir.';

DROP TABLE #C;
