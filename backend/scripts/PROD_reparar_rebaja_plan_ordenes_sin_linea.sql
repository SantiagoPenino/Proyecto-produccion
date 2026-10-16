-- =====================================================================================
-- PROD_reparar_rebaja_plan_ordenes_sin_linea.sql  (25-sep-2026)
--
-- PROBLEMA: desde el deploy del 23-sep las órdenes cubiertas por plan de metros quedaron
-- sin línea de cobranza. Igual entraron a depósito (recepción de bultos), pero ese camino
-- suma los metros de esas líneas -> 0 -> no disparó contabilidad -> el plan NO se rebajó.
--
-- QUÉ HACE: para cada orden que YA ESTÁ EN DEPÓSITO, con plan activo para su artículo y
-- SIN movimiento ENTREGA, hace lo mismo que contabilidadService.hookEntregaMetros:
--   1. ENTREGA (metros en negativo) en la cuenta de metros del plan, vía
--      dbo.SP_RegistrarMovimiento (el mismo SP que usa el sistema; actualiza saldo).
--   2. PlanesMetros.PlaCantidadUsada += metros. Si no es cliente ROLLO/SEMANAL y el plan
--      se agota, PlaActivo = 0. Si sobran metros sin cubrir: ENTREGA "Exceso s/ Plan #N"
--      en el último plan; para ROLLO/SEMANAL el exceso se imputa al plan (queda en rojo).
-- NO aplica el recargo de urgencia s/ rollo (urgenciaDescuentoRolloService): las órdenes
-- urgentes salen marcadas en la vista previa para revisarlas a mano.
--
-- USO: 1) @Aplicar = 0 -> solo lista.  2) @Aplicar = 1, @Solo = 'DTF-27470' -> una sola.
--      3) confirmar la ENTREGA en el plan.  4) @Aplicar = 1, @Solo = NULL -> el resto.
-- Idempotente: una orden que ya tiene ENTREGA no vuelve a entrar.
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar BIT          = 0;              -- 0 = solo mostrar | 1 = rebajar
DECLARE @Desde   DATE         = '2026-09-23';   -- deploy con el cambio
DECLARE @Solo    NVARCHAR(50) = NULL;           -- ej. 'DTF-27470' para probar con una; NULL = todas
DECLARE @Usuario INT          = 1;              -- usuario "Sistema" (igual que el ingreso automático)

IF OBJECT_ID('tempdb..#Cand') IS NOT NULL DROP TABLE #Cand;
IF OBJECT_ID('tempdb..#Log')  IS NOT NULL DROP TABLE #Log;
CREATE TABLE #Log (Cod NVARCHAR(50), Accion NVARCHAR(200), PlanId INT, Metros DECIMAL(18,4), MovId INT);

SELECT
    o.OrdenID,
    RTRIM(o.CodigoOrden)                              AS Cod,
    o.Estado,
    o.FechaIngreso,
    o.CliIdCliente,
    ISNULL(od.ProIdProducto, o.ProIdProducto)         AS ProIdProducto,
    od.OrdIdOrden                                     AS IdDeposito,
    CAST(od.OrdCantidad AS DECIMAL(18,4))             AS Cant,
    od.OrdFechaIngresoOrden                           AS FechaDeposito,
    LTRIM(RTRIM(RTRIM(o.CodigoOrden) + ' ' + ISNULL(od.OrdNombreTrabajo, ''))) AS Concepto,
    CASE WHEN UPPER(ISNULL(tc.TClDescripcion,'')) LIKE '%ROLLO%'
           OR UPPER(ISNULL(tc.TClDescripcion,'')) LIKE '%SEMANAL%' THEN 1 ELSE 0 END AS EsRollo,
    CASE WHEN LOWER(ISNULL(o.Prioridad,'')) LIKE '%urgente%' OR LOWER(ISNULL(o.Prioridad,'')) LIKE '%alta%' THEN 1 ELSE 0 END AS Urgente,
    pl.PlaIdPlan                                      AS PrimerPlan
INTO #Cand
FROM dbo.Ordenes o
JOIN dbo.Clientes c            ON c.CliIdCliente = o.CliIdCliente
LEFT JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
CROSS APPLY (SELECT TOP 1 x.OrdIdOrden, x.OrdCantidad, x.OrdNombreTrabajo, x.ProIdProducto, x.OrdFechaIngresoOrden
             FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY x.OrdIdOrden DESC) od
OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan
             FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
               AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
               AND (pm.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)
                    OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                               WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)))
             ORDER BY pm.PlaFechaAlta) pl
WHERE o.FechaIngreso >= @Desde
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND pl.PlaIdPlan IS NOT NULL
  AND od.OrdCantidad > 0
  AND (@Solo IS NULL OR RTRIM(o.CodigoOrden) = @Solo)
  -- solo las de ESTE bug: sin línea de cobranza, o con la línea repuesta por el otro script
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d
                  WHERE d.OrdenID = o.OrdenID AND ISNULL(d.LogPrecioAplicado, '') NOT LIKE '%nea repuesta%')
  -- todavía no rebajó: ningún ENTREGA en cuentas de METROS del cliente para esta orden
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
                  WHERE cc.CliIdCliente = o.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
                    AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
                    AND ( m.OrdIdOrden = o.OrdenID OR m.OrdIdOrden = od.OrdIdOrden
                          OR m.MovConcepto = RTRIM(o.CodigoOrden) OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %' ));

PRINT '=== Órdenes en depósito con plan activo y SIN rebaja (' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ') ===';
SELECT Cod, Estado, FechaDeposito, Cant, PrimerPlan, EsRollo,
       CASE WHEN Urgente = 1 THEN 'URGENTE: el recargo de urgencia s/ rollo NO se aplica acá, revisar a mano' ELSE '' END AS Aviso
FROM #Cand ORDER BY CASE WHEN Estado = 'Finalizado' THEN 0 ELSE 1 END, FechaIngreso;

IF @Aplicar = 1 AND EXISTS (SELECT 1 FROM #Cand)
BEGIN
    DECLARE @OrdenID INT, @Cod NVARCHAR(50), @Cli INT, @Prod INT, @IdDep INT, @Cant DECIMAL(18,4), @Concepto NVARCHAR(500), @EsRollo BIT;
    DECLARE @Pend DECIMAL(18,4), @Plan INT, @Cue INT, @Total DECIMAL(18,4), @Usada DECIMAL(18,4), @Disp DECIMAL(18,4), @Cons DECIMAL(18,4), @Nueva DECIMAL(18,4);
    DECLARE @LastPlan INT, @LastCue INT, @MovId INT, @Saldo DECIMAL(18,4), @Neg DECIMAL(18,4), @Obs NVARCHAR(500);

    BEGIN TRAN;

    DECLARE cOrd CURSOR LOCAL FAST_FORWARD FOR
        SELECT OrdenID, Cod, CliIdCliente, ProIdProducto, IdDeposito, Cant, Concepto, EsRollo FROM #Cand
        ORDER BY CASE WHEN Estado = 'Finalizado' THEN 0 ELSE 1 END, FechaIngreso;
    OPEN cOrd;
    FETCH NEXT FROM cOrd INTO @OrdenID, @Cod, @Cli, @Prod, @IdDep, @Cant, @Concepto, @EsRollo;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Pend = @Cant;

        -- Planes activos que cubren el artículo, del más viejo al más nuevo (igual que el hook)
        SELECT @LastPlan = NULL, @LastCue = NULL;
        SELECT TOP 1 @LastPlan = pm.PlaIdPlan, @LastCue = pm.CueIdCuenta
        FROM dbo.PlanesMetros pm
        WHERE pm.CliIdCliente = @Cli AND pm.PlaActivo = 1
          AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
          AND (pm.ProIdProducto = @Prod OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = @Prod))
        ORDER BY pm.PlaFechaAlta DESC;

        DECLARE cPlan CURSOR LOCAL FAST_FORWARD FOR
            SELECT pm.PlaIdPlan, pm.CueIdCuenta, ISNULL(pm.PlaCantidadTotal, 0), ISNULL(pm.PlaCantidadUsada, 0)
            FROM dbo.PlanesMetros pm
            WHERE pm.CliIdCliente = @Cli AND pm.PlaActivo = 1
              AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
              AND (pm.ProIdProducto = @Prod OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = @Prod))
            ORDER BY pm.PlaFechaAlta ASC;
        OPEN cPlan;
        FETCH NEXT FROM cPlan INTO @Plan, @Cue, @Total, @Usada;
        WHILE @@FETCH_STATUS = 0 AND @Pend > 0
        BEGIN
            SET @Disp = @Total - @Usada;
            IF @Disp <= 0
            BEGIN
                -- plan agotado: los comunes lo cierran; el rollo lo deja activo (negativo al final)
                IF @EsRollo = 0
                BEGIN
                    UPDATE dbo.PlanesMetros SET PlaActivo = 0 WHERE PlaIdPlan = @Plan;
                    INSERT #Log VALUES (@Cod, 'Plan agotado -> PlaActivo = 0', @Plan, 0, NULL);
                END
            END
            ELSE
            BEGIN
                SET @Cons  = CASE WHEN @Pend < @Disp THEN @Pend ELSE @Disp END;
                SET @Nueva = @Usada + @Cons;
                SET @Neg   = -@Cons;                                   -- metros que salen: negativo, como el hook
                SET @Obs   = 'Plan #' + CAST(@Plan AS NVARCHAR(20));
                SET @MovId = NULL; SET @Saldo = NULL;
                EXEC dbo.SP_RegistrarMovimiento
                     @CueIdCuenta = @Cue, @MovTipo = 'ENTREGA', @MovConcepto = @Concepto,
                     @MovImporte = @Neg, @MovUsuarioAlta = @Usuario, @OrdIdOrden = @IdDep,
                     @MovObservaciones = @Obs,
                     @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;
                UPDATE dbo.PlanesMetros
                   SET PlaCantidadUsada = @Nueva,
                       PlaActivo = CASE WHEN @EsRollo = 1 OR @Nueva < @Total THEN 1 ELSE 0 END
                 WHERE PlaIdPlan = @Plan;
                INSERT #Log VALUES (@Cod, 'ENTREGA rebajada del plan', @Plan, @Cons, @MovId);
                SET @Pend = @Pend - @Cons;
            END
            FETCH NEXT FROM cPlan INTO @Plan, @Cue, @Total, @Usada;
        END
        CLOSE cPlan; DEALLOCATE cPlan;

        -- Sobrante sin cubrir: exceso en el último plan (rollo: se imputa y queda en rojo)
        IF @Pend > 0 AND @LastCue IS NOT NULL
        BEGIN
            SET @Neg = -@Pend;
            SET @Obs = 'Exceso s/ Plan #' + CAST(@LastPlan AS NVARCHAR(20));
            SET @MovId = NULL; SET @Saldo = NULL;
            EXEC dbo.SP_RegistrarMovimiento
                 @CueIdCuenta = @LastCue, @MovTipo = 'ENTREGA', @MovConcepto = @Concepto,
                 @MovImporte = @Neg, @MovUsuarioAlta = @Usuario, @OrdIdOrden = @IdDep,
                 @MovObservaciones = @Obs,
                 @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;
            IF @EsRollo = 1
                UPDATE dbo.PlanesMetros SET PlaCantidadUsada = PlaCantidadUsada + @Pend, PlaActivo = 1 WHERE PlaIdPlan = @LastPlan;
            INSERT #Log VALUES (@Cod, CASE WHEN @EsRollo = 1 THEN 'Exceso imputado al plan (rollo, queda en rojo)' ELSE 'Exceso registrado (sin plan que lo cubra)' END, @LastPlan, @Pend, @MovId);
        END

        FETCH NEXT FROM cOrd INTO @OrdenID, @Cod, @Cli, @Prod, @IdDep, @Cant, @Concepto, @EsRollo;
    END
    CLOSE cOrd; DEALLOCATE cOrd;

    COMMIT;

    PRINT '=== Rebajas hechas ===';
    SELECT * FROM #Log;
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0) o sin candidatas. Nada se modificó.';

DROP TABLE #Cand; DROP TABLE #Log;
