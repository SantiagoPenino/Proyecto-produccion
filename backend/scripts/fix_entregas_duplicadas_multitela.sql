/* ============================================================================
   fix_entregas_duplicadas_multitela.sql
   ----------------------------------------------------------------------------
   PROBLEMA
   En el ingreso a DEPOSITO (logisticsController.receiveDispatch, bloque
   "LOGICA CONTABLE WMS") se recorrian TODAS las lineas de PedidosCobranzaDetalle
   del pedido para CADA orden hermana. En un pedido multitela hay 1 linea por
   tela y N ordenes hermanas, asi que cada tela se descontaba N veces:
   cada plan quedo con metros consumidos de mas.

   Ejemplo real (cliente 854):
     SUB-7185 (1/2) prod 56 -> mov -1,36 en Plan #43  (OK)
                             -> mov -0,10 en Plan #45  (SOBRA)
     SUB-7185 (2/2) prod 53 -> mov -1,36 en Plan #43  (SOBRA)
                             -> mov -0,10 en Plan #45  (OK)

   El codigo ya esta corregido (se filtra por d.OrdenID = L_OrdenID). Este script
   repara los datos historicos.

   QUE HACE
     1. Diagnostico (SELECT) de los movimientos sobrantes.
     2. Los marca MovAnulado = 1 (no los borra: quedan trazables).
     3. Devuelve los metros a PlanesMetros.PlaCantidadUsada y reactiva el plan
        si habia quedado cerrado por el consumo de mas.
     4. Recalcula CuentasCliente.CueSaldoActual y MovimientosCuenta.MovSaldoPosterior
        de las cuentas tocadas (la vista de estado de cuenta muestra esa columna).

   CRITERIO DE DETECCION (conservador, no hardcodea IDs)
     Un ENTREGA sobra cuando:
       a) fue generado por el flujo WMS  (MovObservaciones = 'Plan #<n>'), y
       b) el plan del movimiento NO cubre ningun articulo de las lineas de
          cobranza de ESA orden (PedidosCobranzaDetalle.OrdenID = MovimientosCuenta.OrdIdOrden), y
       c) existe una orden HERMANA del mismo pedido que si tiene ese plan/articulo
          y su propio movimiento por el mismo importe (o sea: es el duplicado).
     Las tres condiciones juntas evitan tocar consumos legitimos (excesos,
     coberturas retroactivas, ajustes manuales, ordenes de un solo material).

   COMO CORRERLO
     - Ejecutar PASO 0 y PASO 1 primero y revisar la salida.
     - Si la lista es la esperada, ejecutar el bloque de correccion (esta en una
       transaccion con ROLLBACK comentado: descomentar COMMIT para aplicar).
   ========================================================================== */

SET NOCOUNT ON;

/* ---------------------------------------------------------------------------
   PASO 0 — Universo candidato
   -------------------------------------------------------------------------*/
IF OBJECT_ID('tempdb..#Sobrantes') IS NOT NULL DROP TABLE #Sobrantes;

;WITH EntregasWMS AS (
    SELECT  m.MovIdMovimiento,
            m.CueIdCuenta,
            m.OrdIdOrden,
            m.MovImporte,
            m.MovConcepto,
            m.MovFecha,
            TRY_CAST(REPLACE(m.MovObservaciones, 'Plan #', '') AS INT) AS PlaIdPlan
    FROM    dbo.MovimientosCuenta m
    WHERE   m.MovTipo = 'ENTREGA'
      AND   (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND   m.MovObservaciones LIKE 'Plan #%'
      AND   m.MovObservaciones NOT LIKE '%Exceso%'
      AND   m.MovObservaciones NOT LIKE '%retroactiva%'
      AND   m.OrdIdOrden IS NOT NULL
),
/* la orden a la que pertenece el movimiento, y el pedido del que forma parte */
EntregasConPedido AS (
    SELECT  e.*,
            o.OrdenID,
            o.CodigoOrden,
            LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) AS NoDoc
    FROM    EntregasWMS e
    JOIN    dbo.Ordenes o ON o.OrdenID = e.OrdIdOrden
    /* solo ordenes que realmente tienen linea propia de cobranza:
       ancla que garantiza que OrdIdOrden es un Ordenes.OrdenID y no otro id */
    WHERE   EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = e.OrdIdOrden)
)
SELECT  ep.MovIdMovimiento,
        ep.CueIdCuenta,
        ep.OrdIdOrden,
        ep.CodigoOrden,
        ep.NoDoc,
        ep.PlaIdPlan,
        ep.MovImporte,
        ep.MovConcepto,
        ep.MovFecha
INTO    #Sobrantes
FROM    EntregasConPedido ep
WHERE
    /* (b) el plan del movimiento no cubre ningun articulo de ESTA orden */
    NOT EXISTS (
        SELECT 1
        FROM   dbo.PedidosCobranzaDetalle d
        JOIN   dbo.PlanesMetros pm ON pm.PlaIdPlan = ep.PlaIdPlan
        WHERE  d.OrdenID = ep.OrdIdOrden
          AND (
                pm.ProIdProducto = d.ProIdProducto
             OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                        WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = d.ProIdProducto)
          )
    )
    /* (c) existe la hermana legitima con el mismo plan y el mismo importe */
    AND EXISTS (
        SELECT 1
        FROM   EntregasConPedido her
        WHERE  her.NoDoc      = ep.NoDoc
          AND  her.OrdIdOrden <> ep.OrdIdOrden
          AND  her.PlaIdPlan  = ep.PlaIdPlan
          AND  ABS(her.MovImporte - ep.MovImporte) < 0.0001
          AND  EXISTS (
                 SELECT 1
                 FROM   dbo.PedidosCobranzaDetalle d
                 JOIN   dbo.PlanesMetros pm ON pm.PlaIdPlan = her.PlaIdPlan
                 WHERE  d.OrdenID = her.OrdIdOrden
                   AND (
                         pm.ProIdProducto = d.ProIdProducto
                      OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                                 WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = d.ProIdProducto)
                   )
               )
    );

/* ---------------------------------------------------------------------------
   PASO 1 — REVISAR ANTES DE APLICAR
   -------------------------------------------------------------------------*/
PRINT '--- Movimientos sobrantes detectados ---';
SELECT * FROM #Sobrantes ORDER BY NoDoc, MovIdMovimiento;

PRINT '--- Impacto por plan ---';
SELECT  s.PlaIdPlan,
        pm.CueIdCuenta,
        pm.CliIdCliente,
        pm.PlaCantidadTotal,
        pm.PlaCantidadUsada                         AS UsadaHoy,
        SUM(ABS(s.MovImporte))                      AS ADevolver,
        pm.PlaCantidadUsada - SUM(ABS(s.MovImporte)) AS UsadaCorregida,
        pm.PlaActivo
FROM    #Sobrantes s
JOIN    dbo.PlanesMetros pm ON pm.PlaIdPlan = s.PlaIdPlan
GROUP BY s.PlaIdPlan, pm.CueIdCuenta, pm.CliIdCliente, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo
ORDER BY s.PlaIdPlan;

PRINT '--- Impacto por cuenta de recursos ---';
SELECT  s.CueIdCuenta,
        cc.CliIdCliente,
        cc.CueTipo,
        cc.CueSaldoActual                        AS SaldoHoy,
        SUM(ABS(s.MovImporte))                   AS ADevolver,
        cc.CueSaldoActual + SUM(ABS(s.MovImporte)) AS SaldoCorregido
FROM    #Sobrantes s
JOIN    dbo.CuentasCliente cc ON cc.CueIdCuenta = s.CueIdCuenta
GROUP BY s.CueIdCuenta, cc.CliIdCliente, cc.CueTipo, cc.CueSaldoActual
ORDER BY s.CueIdCuenta;

/* ===========================================================================
   PASO 2 — CORRECCION
   Descomentar el COMMIT del final (y comentar el ROLLBACK) para aplicar.
   ======================================================================== */
BEGIN TRAN;

    /* 2.1 — Anular los movimientos sobrantes */
    UPDATE  m
    SET     m.MovAnulado        = 1,
            m.MovObservaciones  = LEFT(ISNULL(m.MovObservaciones,'') +
                                  ' [ANULADO fix multitela: consumo duplicado por orden hermana]', 500)
    FROM    dbo.MovimientosCuenta m
    JOIN    #Sobrantes s ON s.MovIdMovimiento = m.MovIdMovimiento;

    PRINT 'Movimientos anulados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    /* 2.2 — Devolver los metros al plan (y reabrirlo si habia quedado cerrado) */
    UPDATE  pm
    SET     pm.PlaCantidadUsada = CASE WHEN pm.PlaCantidadUsada - x.ADevolver < 0
                                       THEN 0 ELSE pm.PlaCantidadUsada - x.ADevolver END,
            pm.PlaActivo        = CASE WHEN pm.PlaCantidadTotal >
                                            CASE WHEN pm.PlaCantidadUsada - x.ADevolver < 0
                                                 THEN 0 ELSE pm.PlaCantidadUsada - x.ADevolver END
                                       THEN 1 ELSE pm.PlaActivo END
    FROM    dbo.PlanesMetros pm
    JOIN    (SELECT PlaIdPlan, SUM(ABS(MovImporte)) AS ADevolver
             FROM #Sobrantes GROUP BY PlaIdPlan) x ON x.PlaIdPlan = pm.PlaIdPlan;

    PRINT 'Planes corregidos: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    /* 2.3 — Recalcular el saldo de las cuentas tocadas desde los movimientos vivos */
    UPDATE  cc
    SET     cc.CueSaldoActual = ISNULL((
                SELECT SUM(m.MovImporte)
                FROM   dbo.MovimientosCuenta m
                WHERE  m.CueIdCuenta = cc.CueIdCuenta
                  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
            ), 0)
    FROM    dbo.CuentasCliente cc
    WHERE   cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #Sobrantes);

    PRINT 'Cuentas recalculadas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    /* 2.4 — Reencadenar MovSaldoPosterior de esas cuentas
             (la vista de estado de cuenta muestra saldo inicial/final desde ahi) */
    ;WITH Encadenado AS (
        SELECT  m.MovIdMovimiento,
                SUM(CASE WHEN (m.MovAnulado IS NULL OR m.MovAnulado = 0) THEN m.MovImporte ELSE 0 END)
                    OVER (PARTITION BY m.CueIdCuenta
                          ORDER BY m.MovFecha, m.MovIdMovimiento
                          ROWS UNBOUNDED PRECEDING) AS SaldoAcum
        FROM    dbo.MovimientosCuenta m
        WHERE   m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #Sobrantes)
    )
    UPDATE  m
    SET     m.MovSaldoPosterior = e.SaldoAcum
    FROM    dbo.MovimientosCuenta m
    JOIN    Encadenado e ON e.MovIdMovimiento = m.MovIdMovimiento;

    PRINT 'MovSaldoPosterior reencadenados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    /* 2.5 — Verificacion post-fix (dentro de la transaccion) */
    PRINT '--- Planes despues ---';
    SELECT  pm.PlaIdPlan, pm.CueIdCuenta, pm.PlaCantidadTotal, pm.PlaCantidadUsada,
            pm.PlaCantidadTotal - pm.PlaCantidadUsada AS Disponible, pm.PlaActivo
    FROM    dbo.PlanesMetros pm
    WHERE   pm.PlaIdPlan IN (SELECT DISTINCT PlaIdPlan FROM #Sobrantes);

    PRINT '--- Cuentas despues (saldo vs suma de movimientos vivos: deben coincidir) ---';
    SELECT  cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual,
            (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS SumaMovs,
            (SELECT pm.PlaCantidadTotal - pm.PlaCantidadUsada FROM dbo.PlanesMetros pm
              WHERE pm.CueIdCuenta = cc.CueIdCuenta AND pm.PlaActivo = 1) AS DisponiblePlan
    FROM    dbo.CuentasCliente cc
    WHERE   cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #Sobrantes);

ROLLBACK TRAN;   -- <<< comentar esta linea
-- COMMIT TRAN;  -- <<< y descomentar esta para aplicar

DROP TABLE #Sobrantes;
