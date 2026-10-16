-- =====================================================================================
-- transicion_rollo_negativo.sql — PRODUCCIÓN (lo corre el usuario en SSMS)
-- Acompaña el deploy "el plan del cliente rollo Y SEMANAL no se cierra y consume en negativo".
--
-- Qué hace (en una sola transacción):
--   PASO 1  Reactiva el ÚLTIMO plan de cada cuenta de metros de cliente rollo/semanal que
--           quedó sin ningún plan activo (el cierre automático viejo los cerró).
--   PASO 2  Absorbe en el plan activo el negativo huérfano: si la cuenta dice menos
--           metros que el plan (restante del plan > saldo de la cuenta), la
--           diferencia se suma a PlaCantidadUsada. Mismo criterio que la
--           regularización de TF SPORT del 31/8 (medir por DIFERENCIA, no por texto).
--           Si la diferencia es <= 0 no toca nada.
--           OJO: este paso NO chequea si el libro de la cuenta cierra (a diferencia de
--           fix_sobregiro_grupo_a_todos.sql). Si una cuenta está en el Grupo B (saldo sin
--           respaldo — ver project_bug_plan_vs_cuenta_metros), este paso igual la va a
--           "corregir" apoyándose en un CueSaldoActual que no es confiable. Por eso
--           @ExcluirDeGrupoB abajo — completar con las cuentas ya identificadas como
--           Grupo B antes de aplicar. 09-sep-2026: CAMILO-7008 (cuenta 1158) confirmado
--           Grupo B, va excluido por default.
--   PASO 3  Re-estampa costo 0 en órdenes de clientes rollo/semanal que están en depósito
--           con costo > 0 pero cuyos metros YA fueron descontados COMPLETOS de un
--           plan según el libro. Solo órdenes SIN pago y SIN retiro asignado
--           (las que ya están en un retiro frenado se resuelven a mano, caso a caso).
--
-- INTERRUPTORES INDEPENDIENTES (09-sep-2026): antes los 3 pasos compartían un solo
-- @SoloVista — poner @SoloVista=0 aplicaba los 3 juntos, sin poder aplicar uno sin los
-- otros. Ahora cada PASO tiene su propio interruptor. @SoloVista sigue existiendo como
-- freno general: si está en 1, NADA se aplica pase lo que digan los otros 3 (para poder
-- correr todo el script de punta a punta y solo mirar). Para aplicar de verdad hace falta
-- @SoloVista = 0 Y el interruptor del paso puntual en 1.
--
-- Los 3 SELECT de vista previa se muestran SIEMPRE, apliques o no — para revisar antes.
-- Los defaults de abajo dejan preparado "aplicar solo el PASO 1" (que ya se revisó y es
-- seguro), con PASO 2 y PASO 3 en modo vista previa nomás hasta decidir.
--
-- IMPORTANTE: correr el script ENTERO de punta a punta (Ctrl+A → Ejecutar), nunca por
-- partes — todo vive en un solo BEGIN TRAN/COMMIT y correr solo un pedazo deja la
-- transacción abierta colgada en tu sesión de SSMS (pasó el 09-sep, se resolvió con
-- ROLLBACK TRANSACTION en la pestaña afectada).
-- =====================================================================================
SET NOCOUNT ON;

DECLARE @SoloVista      BIT = 0;   -- << freno general: 1 = no aplica nada, pase lo que pase abajo
DECLARE @AplicarPaso1   BIT = 1;   -- << reactivar planes cerrados sin plan activo — YA REVISADO, seguro
DECLARE @AplicarPaso2   BIT = 0;   -- << absorber negativo huérfano — poner en 1 recién cuando se decida
DECLARE @AplicarPaso3   BIT = 0;   -- << costo 0 en órdenes cubiertas — sin revisar todavía, dejar en 0

BEGIN TRAN;

-- ── Universo: clientes "Rollo por adelantado" y "Semanal" ────────────────────────────
IF OBJECT_ID('tempdb..#rollo') IS NOT NULL DROP TABLE #rollo;
SELECT c.CliIdCliente
INTO #rollo
FROM dbo.Clientes c
JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
WHERE UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
   OR UPPER(tc.TClDescripcion) LIKE '%SEMANAL%';

-- ── PASO 1: último plan de cada cuenta sin plan activo ──────────────────────────────
IF OBJECT_ID('tempdb..#reabrir') IS NOT NULL DROP TABLE #reabrir;
SELECT pm.PlaIdPlan, pm.CliIdCliente, pm.CueIdCuenta,
       pm.PlaCantidadTotal, pm.PlaCantidadUsada
INTO #reabrir
FROM dbo.PlanesMetros pm
JOIN #rollo r ON r.CliIdCliente = pm.CliIdCliente
WHERE pm.PlaActivo = 0
  AND pm.PlaIdPlan = (SELECT TOP 1 p2.PlaIdPlan FROM dbo.PlanesMetros p2
                      WHERE p2.CueIdCuenta = pm.CueIdCuenta
                      ORDER BY p2.PlaFechaAlta DESC, p2.PlaIdPlan DESC)
  AND NOT EXISTS (SELECT 1 FROM dbo.PlanesMetros p3
                  WHERE p3.CueIdCuenta = pm.CueIdCuenta AND p3.PlaActivo = 1);

SELECT 'PASO 1 — planes a reactivar' AS Paso, r.PlaIdPlan, r.CliIdCliente, c.IDCliente,
       r.CueIdCuenta, r.PlaCantidadTotal, r.PlaCantidadUsada
FROM #reabrir r JOIN dbo.Clientes c ON c.CliIdCliente = r.CliIdCliente
ORDER BY r.CliIdCliente;

IF @SoloVista = 0 AND @AplicarPaso1 = 1
BEGIN
    UPDATE pm SET pm.PlaActivo = 1,
                  pm.PlaObservaciones = LEFT(ISNULL(pm.PlaObservaciones,'')
                      + ' | Reactivado transicion rollo-negativo ' + CONVERT(varchar(10), GETDATE(), 120), 500)
    FROM dbo.PlanesMetros pm JOIN #reabrir r ON r.PlaIdPlan = pm.PlaIdPlan;
    PRINT CONCAT('PASO 1: reactivados ', @@ROWCOUNT, ' plan(es).');
END
ELSE
    PRINT 'PASO 1: NO aplicado (vista previa solamente).';

-- ── PASO 2: absorber el negativo huérfano (restante de planes activos - saldo cuenta) ─
-- Excluidas por Grupo B (saldo de cuenta sin respaldo en el libro — necesitan reparación
-- propia, no esta): CAMILO-7008 = CueIdCuenta 1158 (confirmado 09-sep-2026, fantasma
-- 103,10 m). Agregar más CueIdCuenta acá a medida que se confirmen otros del Grupo B.
IF OBJECT_ID('tempdb..#excluirGrupoB') IS NOT NULL DROP TABLE #excluirGrupoB;
CREATE TABLE #excluirGrupoB (CueIdCuenta INT PRIMARY KEY);
INSERT INTO #excluirGrupoB (CueIdCuenta) VALUES (1158);   -- CAMILO-7008

IF OBJECT_ID('tempdb..#absorber') IS NOT NULL DROP TABLE #absorber;
SELECT cc.CueIdCuenta, cc.CliIdCliente,
       act.PlaIdPlan,
       act.RestanteActivos,
       cc.CueSaldoActual AS SaldoCuenta,
       CAST(act.RestanteActivos - cc.CueSaldoActual AS DECIMAL(18,4)) AS Diferencia
INTO #absorber
FROM dbo.CuentasCliente cc
JOIN #rollo r ON r.CliIdCliente = cc.CliIdCliente
CROSS APPLY (
    -- restante total de los planes activos de la cuenta + el plan MÁS NUEVO (recibe el ajuste)
    SELECT SUM(pm.PlaCantidadTotal - pm.PlaCantidadUsada) AS RestanteActivos,
           MAX(pm.PlaIdPlan) AS PlaIdPlan
    FROM dbo.PlanesMetros pm
    WHERE pm.CueIdCuenta = cc.CueIdCuenta
      AND (pm.PlaActivo = 1 OR (@SoloVista = 1 AND pm.PlaIdPlan IN (SELECT PlaIdPlan FROM #reabrir)))
) act
WHERE cc.CueActiva = 1
  AND cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU','USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA')
  AND act.PlaIdPlan IS NOT NULL
  AND act.RestanteActivos - cc.CueSaldoActual > 0.005   -- solo cuando el plan REGALA metros
  AND cc.CueIdCuenta NOT IN (SELECT CueIdCuenta FROM #excluirGrupoB);

SELECT 'PASO 2 — negativo a absorber en el plan' AS Paso, a.CueIdCuenta, a.CliIdCliente, c.IDCliente,
       a.PlaIdPlan, a.RestanteActivos, a.SaldoCuenta, a.Diferencia
FROM #absorber a JOIN dbo.Clientes c ON c.CliIdCliente = a.CliIdCliente
ORDER BY a.Diferencia DESC;

IF @SoloVista = 0 AND @AplicarPaso2 = 1
BEGIN
    UPDATE pm SET pm.PlaCantidadUsada = pm.PlaCantidadUsada + a.Diferencia,
                  pm.PlaActivo = 1,
                  pm.PlaObservaciones = LEFT(ISNULL(pm.PlaObservaciones,'')
                      + ' | Absorbe ' + CONVERT(varchar(20), a.Diferencia)
                      + ' mts de arrastre (transicion rollo-negativo '
                      + CONVERT(varchar(10), GETDATE(), 120) + ')', 500)
    FROM dbo.PlanesMetros pm JOIN #absorber a ON a.PlaIdPlan = pm.PlaIdPlan;
    PRINT CONCAT('PASO 2: ajustados ', @@ROWCOUNT, ' plan(es).');
END
ELSE
    PRINT 'PASO 2: NO aplicado (vista previa solamente).';

-- ── PASO 3: costo 0 a órdenes rollo YA cubiertas por el libro (sin pago, sin retiro) ──
IF OBJECT_ID('tempdb..#estampar') IS NOT NULL DROP TABLE #estampar;
SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.CliIdCliente, od.OrdCantidad,
       od.OrdCostoFinal, o.OrdenID, mts.MetrosLibro
INTO #estampar
FROM dbo.OrdenesDeposito od
JOIN #rollo r ON r.CliIdCliente = od.CliIdCliente
JOIN dbo.Ordenes o ON o.CodigoOrden = od.OrdCodigoOrden
CROSS APPLY (
    SELECT ISNULL(SUM(-m.MovImporte), 0) AS MetrosLibro
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.OrdIdOrden = o.OrdenID
      AND cc.CliIdCliente = od.CliIdCliente
      AND cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU')
      AND m.MovTipo = 'ENTREGA'
      AND ISNULL(m.MovAnulado, 0) = 0
) mts
WHERE od.OrdCostoFinal > 0
  AND od.PagIdPago IS NULL
  AND od.OReIdOrdenRetiro IS NULL
  AND od.OrdCantidad > 0
  AND mts.MetrosLibro >= od.OrdCantidad - 0.005;

SELECT 'PASO 3 — órdenes rollo a costo 0 (libro las muestra cubiertas)' AS Paso,
       e.OrdCodigoOrden, c.IDCliente, e.OrdCantidad, e.MetrosLibro, e.OrdCostoFinal AS CostoViejo
FROM #estampar e JOIN dbo.Clientes c ON c.CliIdCliente = e.CliIdCliente
ORDER BY e.OrdCostoFinal DESC;

IF @SoloVista = 0 AND @AplicarPaso3 = 1
BEGIN
    UPDATE od SET od.OrdCostoFinal = 0
    FROM dbo.OrdenesDeposito od JOIN #estampar e ON e.OrdIdOrden = od.OrdIdOrden;
    PRINT CONCAT('PASO 3a: ', @@ROWCOUNT, ' orden(es) de depósito a costo 0.');

    UPDATE o SET o.CostoTotal = 0
    FROM dbo.Ordenes o JOIN #estampar e ON e.OrdenID = o.OrdenID;
    PRINT CONCAT('PASO 3b: ', @@ROWCOUNT, ' orden(es) ERP a costo 0.');
END
ELSE
    PRINT 'PASO 3: NO aplicado (vista previa solamente).';

IF @SoloVista = 1 OR (@AplicarPaso1 = 0 AND @AplicarPaso2 = 0 AND @AplicarPaso3 = 0)
BEGIN
    PRINT 'Nada quedó escrito — revisar los 3 SELECT y decidir qué interruptor prender.';
    ROLLBACK TRAN;
END
ELSE
    COMMIT TRAN;
