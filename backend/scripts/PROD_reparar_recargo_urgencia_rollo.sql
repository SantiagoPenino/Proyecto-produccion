-- =====================================================================================
-- PROD_reparar_recargo_urgencia_rollo.sql  (25-sep-2026)
--
-- COMPLEMENTO de PROD_reparar_rebaja_plan_ordenes_sin_linea.sql. Ese script rebaja los
-- metros normales (ENTREGA) pero no el recargo de urgencia. Este hace el recargo, copiando
-- la regla de urgenciaDescuentoRolloService.js:
--   · ConfiguracionGlobal.URGENCIA_DESCUENTO_ROLLO_ACTIVO debe ser '1'
--   · % = URGENCIA_DESCUENTO_ROLLO_PORCENTAJE (si no está o es inválido, 25)
--   · modo = URGENCIA_DESCUENTO_ROLLO_MODO: PILOTO = solo clientes en
--     UrgenciaDescuentoRolloExcepciones (Activo=1); TODOS = todos menos los de esa tabla
--   · la orden tiene que tener Prioridad = 'Urgente'
--   · recargo = metros de la ENTREGA × % ; se suma a PlaCantidadUsada del mismo plan y se
--     graba un movimiento RECARGO_URGENCIA (negativo) en la misma cuenta de metros,
--     vía dbo.SP_RegistrarMovimiento, con el mismo concepto/observación que el sistema.
--
-- UNIVERSO: órdenes desde @Desde, en depósito, con ENTREGA ya registrada (por el script
-- anterior o por el ingreso normal) y SIN recargo todavía. Idempotente.
--
-- USO: 1) @Aplicar = 0 -> lista.  2) @Aplicar = 1, @Solo = 'COD' -> una.  3) @Solo = NULL -> el resto.
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar BIT          = 0;
DECLARE @Desde   DATE         = '2026-09-23';
DECLARE @Solo    NVARCHAR(50) = NULL;
DECLARE @Usuario INT          = 1;

-- Configuración (misma lectura que el servicio)
DECLARE @Activo NVARCHAR(50), @PctTxt NVARCHAR(50), @Modo NVARCHAR(50), @Pct DECIMAL(9,4);
SELECT @Activo = Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_ACTIVO';
SELECT @PctTxt = Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_PORCENTAJE';
SELECT @Modo   = Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_MODO';
SET @Pct = TRY_CONVERT(DECIMAL(9,4), @PctTxt);
IF @Pct IS NULL OR @Pct <= 0 OR @Pct > 100 SET @Pct = 25;
SET @Modo = ISNULL(@Modo, 'TODOS');

PRINT 'Config: ACTIVO=' + ISNULL(@Activo, 'NULL') + ' | PORCENTAJE=' + CAST(@Pct AS VARCHAR(20)) + ' | MODO=' + @Modo;
IF ISNULL(@Activo, '') <> '1'
BEGIN
    PRINT 'El recargo de urgencia s/ rollo está APAGADO en ConfiguracionGlobal: el sistema tampoco lo aplicaría. Nada que hacer.';
    RETURN;
END

IF OBJECT_ID('tempdb..#Cand') IS NOT NULL DROP TABLE #Cand;
IF OBJECT_ID('tempdb..#Log')  IS NOT NULL DROP TABLE #Log;
CREATE TABLE #Log (Cod NVARCHAR(50), PlanId INT, Recargo DECIMAL(18,4), MovId INT, CueIdCuenta INT);

SELECT
    RTRIM(o.CodigoOrden)                                   AS Cod,
    o.OrdenID,
    o.Estado,
    o.CliIdCliente,
    ent.MovIdMovimiento                                    AS MovEntrega,
    ent.CueIdCuenta,
    ent.OrdIdOrden                                         AS OrdIdMov,
    ent.MovFecha                                           AS FechaEntrega,   -- el recargo lleva la MISMA fecha que la ENTREGA
    -ent.MovImporte                                        AS MetrosEntrega,
    -- número que sigue a 'Plan #' (la observación puede traer otro '#' antes, ej. 'Ref#57258 - Plan #82')
    TRY_CONVERT(INT, LEFT(pn.Resto, PATINDEX('%[^0-9]%', pn.Resto + 'x') - 1)) AS PlaIdPlan,
    CASE WHEN UPPER(ISNULL(tc.TClDescripcion,'')) LIKE '%ROLLO%'
           OR UPPER(ISNULL(tc.TClDescripcion,'')) LIKE '%SEMANAL%' THEN 1 ELSE 0 END AS EsRollo,
    CASE WHEN EXISTS (SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones ux WHERE ux.CliIdCliente = o.CliIdCliente AND ux.Activo = 1) THEN 1 ELSE 0 END AS EnLista
INTO #Cand
FROM dbo.Ordenes o
JOIN dbo.Clientes c            ON c.CliIdCliente = o.CliIdCliente
LEFT JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
CROSS APPLY (SELECT TOP 1 x.OrdIdOrden FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY x.OrdIdOrden DESC) od
-- la ENTREGA de la orden en cuentas de metros (la más reciente), con su plan en la observación
CROSS APPLY (SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.OrdIdOrden, m.MovImporte, m.MovObservaciones, m.MovFecha
             FROM dbo.MovimientosCuenta m
             JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
             WHERE cc.CliIdCliente = o.CliIdCliente AND cc.CueTipo NOT LIKE 'DINERO%'
               AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovImporte < 0
               AND ISNULL(m.MovObservaciones, '') LIKE '%Plan #%'
               AND ( m.OrdIdOrden = o.OrdenID OR m.OrdIdOrden = od.OrdIdOrden
                     OR m.MovConcepto = RTRIM(o.CodigoOrden) OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %' )
             ORDER BY m.MovIdMovimiento DESC) ent
CROSS APPLY (SELECT SUBSTRING(ent.MovObservaciones, CHARINDEX('Plan #', ent.MovObservaciones) + 6, 20) AS Resto) pn
WHERE o.FechaIngreso >= @Desde
  AND o.Prioridad = 'Urgente'
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND (@Solo IS NULL OR RTRIM(o.CodigoOrden) = @Solo)
  -- todavía sin recargo para esta orden
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta r
                  WHERE r.MovTipo = 'RECARGO_URGENCIA' AND ISNULL(r.MovAnulado, 0) = 0
                    AND ( r.OrdIdOrden = ent.OrdIdOrden OR r.OrdIdOrden = o.OrdenID
                          OR r.MovConcepto LIKE '% ' + RTRIM(o.CodigoOrden) OR r.MovObservaciones LIKE '% ' + RTRIM(o.CodigoOrden) ));

-- Regla del modo: PILOTO = solo los de la lista; TODOS = todos menos los de la lista
DELETE FROM #Cand WHERE (@Modo = 'PILOTO' AND EnLista = 0) OR (@Modo <> 'PILOTO' AND EnLista = 1);

DECLARE @N INT; SELECT @N = COUNT(*) FROM #Cand;
PRINT '=== Órdenes URGENTES con ENTREGA y sin recargo, a las que les corresponde (' + CAST(@N AS VARCHAR(10)) + ') ===';
SELECT Cod, Estado, PlaIdPlan, MetrosEntrega,
       CAST(ROUND(MetrosEntrega * @Pct / 100, 4) AS DECIMAL(18,4)) AS RecargoMetros,
       EsRollo, EnLista,
       CASE WHEN PlaIdPlan IS NULL THEN 'SIN PLAN EN LA OBSERVACIÓN: revisar' ELSE '' END AS Aviso
FROM #Cand ORDER BY Cod;

IF @Aplicar = 1 AND EXISTS (SELECT 1 FROM #Cand WHERE PlaIdPlan IS NOT NULL)
BEGIN
    DECLARE @Cod NVARCHAR(50), @Cli INT, @Cue INT, @OrdMov INT, @Metros DECIMAL(18,4), @Plan INT, @EsRollo BIT, @FechaEnt DATETIME;
    DECLARE @Rec DECIMAL(18,4), @Neg DECIMAL(18,4), @Total DECIMAL(18,4), @Usada DECIMAL(18,4), @Nueva DECIMAL(18,4);
    DECLARE @Conc NVARCHAR(500), @Obs NVARCHAR(500), @PctTxtFmt NVARCHAR(20), @MovId INT, @Saldo DECIMAL(18,4);
    -- "25" y no "25.0000", como lo escribe el servicio
    SET @PctTxtFmt = CASE WHEN @Pct = FLOOR(@Pct) THEN CAST(CAST(@Pct AS INT) AS NVARCHAR(20)) ELSE CAST(@Pct AS NVARCHAR(20)) END;

    BEGIN TRAN;
    DECLARE cU CURSOR LOCAL FAST_FORWARD FOR
        SELECT Cod, CliIdCliente, CueIdCuenta, OrdIdMov, MetrosEntrega, PlaIdPlan, EsRollo, FechaEntrega FROM #Cand WHERE PlaIdPlan IS NOT NULL ORDER BY Cod;
    OPEN cU;
    FETCH NEXT FROM cU INTO @Cod, @Cli, @Cue, @OrdMov, @Metros, @Plan, @EsRollo, @FechaEnt;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Rec = ROUND(@Metros * @Pct / 100, 4);
        IF @Rec > 0
        BEGIN
            SELECT @Total = ISNULL(PlaCantidadTotal, 0), @Usada = ISNULL(PlaCantidadUsada, 0) FROM dbo.PlanesMetros WHERE PlaIdPlan = @Plan;
            SET @Nueva = @Usada + @Rec;
            UPDATE dbo.PlanesMetros
               SET PlaCantidadUsada = @Nueva,
                   PlaActivo = CASE WHEN @EsRollo = 0 AND @Nueva >= @Total THEN 0 ELSE 1 END
             WHERE PlaIdPlan = @Plan;

            SET @Neg  = -@Rec;
            SET @Conc = 'Recargo urgencia ' + @PctTxtFmt + '% - ' + @Cod;
            SET @Obs  = 'Recargo de ' + @PctTxtFmt + '% en metros por urgencia no cobrada en $ (Plan #' + CAST(@Plan AS NVARCHAR(20)) + ') - ' + @Cod;
            SET @MovId = NULL; SET @Saldo = NULL;
            EXEC dbo.SP_RegistrarMovimiento
                 @CueIdCuenta = @Cue, @MovTipo = 'RECARGO_URGENCIA', @MovConcepto = @Conc,
                 @MovImporte = @Neg, @MovUsuarioAlta = @Usuario, @OrdIdOrden = @OrdMov,
                 @MovObservaciones = @Obs,
                 @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;
            -- misma fecha que la ENTREGA (queda pegado a ella en el estado de cuenta, no con la fecha de hoy)
            UPDATE dbo.MovimientosCuenta SET MovFecha = @FechaEnt WHERE MovIdMovimiento = @MovId;
            INSERT #Log VALUES (@Cod, @Plan, @Rec, @MovId, @Cue);
        END
        FETCH NEXT FROM cU INTO @Cod, @Cli, @Cue, @OrdMov, @Metros, @Plan, @EsRollo, @FechaEnt;
    END
    CLOSE cU; DEALLOCATE cU;

    -- Saldo corrido de cada cuenta tocada, en orden cronológico (el recargo quedó con fecha retroactiva)
    DECLARE @CueR INT;
    DECLARE cR CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT CueIdCuenta FROM #Log;
    OPEN cR; FETCH NEXT FROM cR INTO @CueR;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        ;WITH ord AS (
            SELECT MovIdMovimiento,
                   SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') THEN MovImporte ELSE 0 END)
                     OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
            FROM dbo.MovimientosCuenta
            WHERE CueIdCuenta = @CueR AND (MovAnulado IS NULL OR MovAnulado = 0)
        )
        UPDATE m SET m.MovSaldoPosterior = ord.run
        FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;
        FETCH NEXT FROM cR INTO @CueR;
    END
    CLOSE cR; DEALLOCATE cR;

    COMMIT;

    PRINT '=== Recargos hechos ===';
    SELECT * FROM #Log;
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0) o sin candidatas. Nada se modificó.';

DROP TABLE #Cand; DROP TABLE #Log;
