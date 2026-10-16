-- =====================================================================================
-- PROD_retrofechar_rebajas_reparadas.sql  (25-sep-2026)
--
-- Las ENTREGA (y RECARGO_URGENCIA) que crearon los scripts de reparación quedaron con la
-- fecha del día en que se corrieron, no con la fecha en que la orden entró a depósito.
-- Este script les pone la fecha de ingreso a depósito y recalcula el saldo corrido
-- (MovSaldoPosterior) de cada cuenta en orden cronológico, igual que hace el sistema
-- cuando se registra un ajuste con fecha retroactiva (contabilidadController,
-- registrarAjusteManual). CueSaldoActual no cambia: la fecha no altera el total.
--
-- CÓMO LOS RECONOCE: movimientos de cuentas de METROS, ENTREGA / RECARGO_URGENCIA,
-- ligados a la orden de depósito (OrdIdOrden = OrdenesDeposito.OrdIdOrden) y registrados
-- más de 1 hora DESPUÉS del ingreso a depósito (los del flujo normal se registran en el
-- mismo momento del ingreso). Se puede acotar con @DesdeCorrida (día en que corriste
-- la reparación) y @Solo. Y SOLO órdenes de producción ingresadas desde @DesdeOrden (23-sep)
-- que no tengan línea de cobranza o tengan la línea repuesta: el conjunto exacto de la reparación.
--
-- USO: @Aplicar = 0 lista; @Aplicar = 1 aplica. Se puede correr las veces que haga falta.
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar      BIT          = 0;
DECLARE @DesdeCorrida DATE         = '2026-09-25';   -- día en que se corrió la reparación
DECLARE @DesdeOrden   DATE         = '2026-09-23';   -- SOLO órdenes ingresadas desde el deploy (las del bug)
DECLARE @Solo         NVARCHAR(50) = NULL;           -- ej. 'DTF-27470'

IF OBJECT_ID('tempdb..#Mov') IS NOT NULL DROP TABLE #Mov;

SELECT
    m.MovIdMovimiento,
    m.CueIdCuenta,
    m.MovTipo,
    m.MovImporte,
    m.MovFecha                    AS FechaActual,
    od.OrdFechaIngresoOrden       AS FechaDeposito,
    RTRIM(od.OrdCodigoOrden)      AS Cod,
    m.MovObservaciones
INTO #Mov
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc  ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
-- la orden de producción: tiene que ser de las del bug (desde el deploy, sin línea de cobranza o con la repuesta)
CROSS APPLY (SELECT TOP 1 o.OrdenID, o.FechaIngreso FROM dbo.Ordenes o
             WHERE RTRIM(o.CodigoOrden) = RTRIM(od.OrdCodigoOrden) OR od.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY o.OrdenID DESC) o
WHERE cc.CueTipo NOT LIKE 'DINERO%'
  AND o.FechaIngreso >= @DesdeOrden
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d
                  WHERE d.OrdenID = o.OrdenID AND ISNULL(d.LogPrecioAplicado, '') NOT LIKE '%nea repuesta%')
  AND m.MovTipo IN ('ENTREGA', 'RECARGO_URGENCIA')
  AND ISNULL(m.MovAnulado, 0) = 0
  AND CAST(m.MovFecha AS DATE) >= @DesdeCorrida
  AND m.MovFecha > DATEADD(HOUR, 1, od.OrdFechaIngresoOrden)
  AND (@Solo IS NULL OR RTRIM(od.OrdCodigoOrden) = @Solo OR od.OrdCodigoOrden LIKE @Solo + ' (%');

DECLARE @N INT; SELECT @N = COUNT(*) FROM #Mov;
PRINT '=== Movimientos a retrofechar (' + CAST(@N AS VARCHAR(10)) + ') ===';
SELECT Cod, MovTipo, MovImporte, FechaActual, FechaDeposito AS FechaNueva, MovObservaciones, MovIdMovimiento, CueIdCuenta
FROM #Mov ORDER BY Cod, MovIdMovimiento;

IF @Aplicar = 1 AND @N > 0
BEGIN
    BEGIN TRAN;

    UPDATE m SET m.MovFecha = x.FechaDeposito
    FROM dbo.MovimientosCuenta m JOIN #Mov x ON x.MovIdMovimiento = m.MovIdMovimiento;
    PRINT 'Fechas actualizadas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    -- Saldo corrido de cada cuenta tocada, en orden cronológico (misma fórmula del sistema)
    DECLARE @Cue INT;
    DECLARE cC CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT CueIdCuenta FROM #Mov;
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
    PRINT 'LISTO: fechas corregidas y saldo corrido recalculado.';
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0) o nada para corregir.';

DROP TABLE #Mov;
