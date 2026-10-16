/* ============================================================================
   PRODUCCIÓN — CR SPORT (CR-755, RUC 87454323)
   REVIERTE el cruce automático de monedas del 04/09 sobre la orden EMB-4353,
   para que esa orden quede PENDIENTE DE COBRO al facturar la semanal.

   QUÉ PASÓ: al registrarse la orden EMB-4353 ($ 3.300), el motor de cruce
   automático sacó US$ 80,80 de la cuenta de dólares del cliente (a 40,84) y los
   puso en la cuenta de pesos para cubrirla. Son dos movimientos PAGO_CRUZADO:
       cuenta US$ : -80,80    "Cruce automático -> Orden EMB-4353"
       cuenta $   : +3.300    "Cobertura desde DINERO_USD"
   El cruce corre ANTES de que el motor mire si el cliente tiene ciclo abierto
   (contabilidadService.js ~5266 contra ~5316), por eso le pre-paga una orden que
   se iba a facturar en la semanal.

   QUÉ HACE ESTE SCRIPT: anula los DOS movimientos (MovAnulado = 1, NO borra),
   recalcula el saldo corrido y el CueSaldoActual de las dos cuentas, y recalcula
   los totales de los ciclos donde estaban imputados, con la misma fórmula del
   backend.

   NO TOCA el movimiento ORDEN de -3.300: ese es el cargo del trabajo y tiene que
   quedar. El ciclo ya lo tiene en CicTotalOrdenes, así que la orden se factura
   igual — lo que se va es el "pago" que la tapaba.

   RESULTADO ESPERADO (medido en la réplica local, ANTES de correr el otro script):
       cuenta 477 $     3.300,12  ->  0,12      (su saldo propio real)
       cuenta 222 US$  25.302,09  ->  25.382,89 (le vuelven sus 80,80)
       ciclo 46 (pesos): CicTotalPagos baja 3.300; CicTotalOrdenes sigue en 3.300
       -> al cerrar la semanal, el EMB-4353 sale por $3.300 y queda a cobrar.

   Se identifica por FORMA (cliente + tipo + concepto de la orden), no por ID:
   los MovIdMovimiento de producción no son los de la réplica.
   Es idempotente: si ya están anulados, avisa y no toca nada.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   Para mirar sin escribir: correr hasta el "FIN DE LA VISTA PREVIA".
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

SELECT Servidor = @@SERVERNAME,
       Base     = DB_NAME(),
       Archivo  = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

DECLARE @Ruc VARCHAR(20) = '87454323';
DECLARE @Orden VARCHAR(40) = 'EMB-4353';
DECLARE @Cli INT, @Ord INT, @N INT;

SELECT @Cli = c.CliIdCliente FROM dbo.Clientes c WHERE RTRIM(ISNULL(c.CioRuc,'')) = @Ruc;
IF @Cli IS NULL BEGIN RAISERROR('No hay cliente con RUC %s en esta base.', 16, 1, @Ruc); RETURN; END

/* El lado débito lleva el código de la orden en el concepto; de ahí sale el OrdIdOrden
   que ata los dos lados del cruce. */
SELECT TOP 1 @Ord = m.OrdIdOrden
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo = 'PAGO_CRUZADO'
  AND m.MovConcepto LIKE '%' + @Orden + '%'
  AND m.MovImporte < 0
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.MovIdMovimiento DESC;

IF @Ord IS NULL
BEGIN
    PRINT 'No hay ningún cruce vivo para la orden ' + @Orden + ' de este cliente. O ya se revirtió, o no existe. No se tocó nada.';
    RETURN;
END

IF OBJECT_ID('tempdb..#cruce') IS NOT NULL DROP TABLE #cruce;
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha,
       m.CicIdCiclo, m.MovConcepto
INTO #cruce
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.OrdIdOrden = @Ord
  AND m.MovTipo = 'PAGO_CRUZADO'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

SELECT @N = COUNT(*) FROM #cruce;

IF @N <> 2
BEGIN
    SELECT 'FRENO - el cruce no tiene dos lados' AS Aviso, * FROM #cruce;
    RAISERROR('Se esperaban 2 movimientos (el débito en una moneda y el crédito en la otra) y hay %d. No se toca nada.', 16, 1, @N);
    RETURN;
END

/* ── VISTA PREVIA ────────────────────────────────────────────────────────── */
SELECT Paso = 'MOVIMIENTOS A ANULAR', c.*,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END
FROM #cruce c JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta;

SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

SELECT Momento = 'ANTES - ciclos tocados', c.CicIdCiclo, c.CueIdCuenta, c.CicEstado,
       CicTotalOrdenes = CAST(c.CicTotalOrdenes AS DECIMAL(18,2)),
       CicTotalPagos   = CAST(c.CicTotalPagos AS DECIMAL(18,2))
FROM dbo.CiclosCredito c
WHERE c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta acá no se escribió NADA.
   ========================================================================= */

BEGIN TRANSACTION;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' REVERTIDO_CRUCE_2026-09-04: el cruce automático de monedas pre-pagó la orden '
            + @Orden + ', que es de un cliente SEMANAL y se factura en el ciclo. Se revierte para'
            + ' que quede pendiente de cobro al facturar. El movimiento ORDEN no se toca.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN #cruce x ON x.MovIdMovimiento = m.MovIdMovimiento;

    PRINT CONCAT('Movimientos del cruce anulados: ', @@ROWCOUNT, ' (tienen que ser 2).');

    /* Saldo corrido de las cuentas tocadas */
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #cruce)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    /* Saldo guardado */
    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #cruce);

    /* Totales de los ciclos, con la MISMA fórmula del backend */
    UPDATE c
    SET c.CicTotalOrdenes = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta
            WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('ORDEN','ENTREGA','ORDEN_ANTICIPO')
              AND (MovAnulado IS NULL OR MovAnulado = 0)), 0),
        c.CicTotalPagos   = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta
            WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO','COBRO','SALDO_A_FAVOR')
              AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
    FROM dbo.CiclosCredito c
    WHERE c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

COMMIT TRANSACTION;

/* ── DESPUÉS ─────────────────────────────────────────────────────────────── */
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

SELECT Momento = 'DESPUES - ciclos', c.CicIdCiclo, c.CueIdCuenta, c.CicEstado,
       CicTotalOrdenes = CAST(c.CicTotalOrdenes AS DECIMAL(18,2)),
       CicTotalPagos   = CAST(c.CicTotalPagos AS DECIMAL(18,2))
FROM dbo.CiclosCredito c
WHERE c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

DROP TABLE #cruce;
