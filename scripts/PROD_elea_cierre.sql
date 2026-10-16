/* ============================================================================
   PRODUCCION - elea (IDCliente 'ELEA', CodCliente 126101)
   Deja las dos cuentas cuadradas: el libro pasa a decir exactamente lo mismo
   que las deudas vivas.

   CORRER DESPUES del deploy del motor de cruce (09-09-2026). Antes no tenia
   sentido: el motor podia volver a disparar.

   COMO ESTA HOY (medido en produccion el 09-09-2026):
       cuenta US$ 75   : libro -3.419,83  y deudas vivas 3.353,99  -> sobran 65,84
       cuenta $  1444  : libro   +362,25  y deudas vivas     0,00  -> sobran 362,25
   Los 65,84 son tres cosas, y ninguna es deuda de la clienta:

   A) 8,86  EL CRUCE DEL 31/08. El motor le saco US$ 8,86 (a 40,89) de la cuenta
      de dolares para cubrir una orden en pesos, y puso 362,25 del otro lado. La
      cuenta de dolares estaba en negativo: esa plata no existia. Es el mismo
      caso de Martina Berriel y de CR SPORT. Al revertirlo, los 362,25 de la
      cuenta de pesos tambien se van, porque son el otro lado del mismo cruce.

   B) 51,18 EL PC-2687. El libro le cargo 762,56 y la factura salio por 711,38,
      que es lo que la clienta pago y ya esta cobrado entero. La diferencia quedo
      inflando el libro.

   C) 5,80  EL PC-3318. El libro le cargo 862,61 y el documento dice 856,81. La
      deuda viva es 856,81, o sea que la factura y la deuda coinciden y el que
      esta mal es el cargo del libro.

   B y C son el bug de "el cierre suma las ordenes a un precio y la factura sale
   a otro". El metodo de reparacion es el que decidio el usuario el 06-07-2026:
   NO se agregan lineas de ajuste ni deudas nuevas, se corrige el IMPORTE del
   movimiento de facturacion para que sea igual al total del documento, y el
   importe viejo queda escrito en MovObservaciones. Esta clienta ya tiene dos
   movimientos reparados asi (los de PC-1069 y PC-1483, marcados
   FIX_SALDO_DESFASAJE).

   QUE HACE ESTE SCRIPT:
     1. Anula los dos movimientos del cruce (MovAnulado = 1, NO borra).
     2. Lleva al total del documento el cargo de toda factura de esta clienta
        cuyo cargo no coincida. Son las dos de arriba; el script las lista en la
        vista previa antes de tocar nada y FRENA si el ajuste total no es 56,98.
     3. Recalcula saldo corrido y CueSaldoActual de las cuatro cuentas, con la
        formula del backend (recomputarSaldoCuenta, contabilidadController ~1574).
     4. Recalcula los totales de los ciclos tocados. El ciclo 210 hoy cuenta el
        cruce como si fuera una orden: dice 2.540,25 y las ordenes reales son
        2.178,00.

   RESULTADO ESPERADO EN PRODUCCION:
       cuenta US$ 75   : libro -3.419,83 -> -3.353,99  = deudas vivas 3.353,99
       cuenta $  1444  : libro   +362,25 ->      0,00  = deudas vivas     0,00
   Las dos verdades pasan a decir lo mismo. La clienta debe 3.353,99 dolares y
   nada en pesos.

   NO TOCA: las cinco deudas vivas (PC-3318, PC-3317, PC-3531, PC-3875, PC-4000),
   ninguna factura, ningun cobro, ni los movimientos ORDEN.

   Se identifica por FORMA, no por ID. Es idempotente: si ya corrio, avisa y no
   toca nada.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   Para mirar sin escribir: correr hasta el "FIN DE LA VISTA PREVIA".
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

SELECT Servidor = @@SERVERNAME,
       Base     = DB_NAME(),
       Archivo  = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

DECLARE @IDCliente  VARCHAR(60) = 'ELEA';
DECLARE @CodCliente VARCHAR(30) = '126101';
DECLARE @AjusteEsperado DECIMAL(18,4) = 56.98;   /* 51,18 del PC-2687 + 5,80 del PC-3318 */

DECLARE @Cli INT, @N INT, @NCruce INT, @NCargos INT, @AjusteTotal DECIMAL(18,4);

/* -- 1 . Cliente ---------------------------------------------------------- */
SELECT @N = COUNT(*), @Cli = MIN(c.CliIdCliente)
FROM dbo.Clientes c
WHERE RTRIM(ISNULL(c.IDCliente,'')) = @IDCliente
  AND RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')) = @CodCliente;

IF @N <> 1
BEGIN
    RAISERROR('Se esperaba UN cliente con IDCliente %s y CodCliente %s, y hay %d. No se toca nada.', 16, 1, @IDCliente, @CodCliente, @N);
    RETURN;
END

/* -- 2 . El cruce: los dos lados, vivos, atados por la misma orden --------- */
IF OBJECT_ID('tempdb..#cruce') IS NOT NULL DROP TABLE #cruce;
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, m.OrdIdOrden, m.CicIdCiclo,
       MovConcepto = LEFT(RTRIM(ISNULL(m.MovConcepto,'')), 100)
INTO #cruce
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo = 'PAGO_CRUZADO'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

SELECT @NCruce = COUNT(*) FROM #cruce;

IF @NCruce NOT IN (0, 2)
BEGIN
    SELECT 'FRENO - el cruce no tiene dos lados' AS Aviso, * FROM #cruce;
    RAISERROR('Se esperaban 2 movimientos de cruce vivos (uno por moneda) o ninguno, y hay %d. No se toca nada.', 16, 1, @NCruce);
    RETURN;
END

IF @NCruce = 2 AND (
     (SELECT COUNT(DISTINCT ISNULL(OrdIdOrden,-1)) FROM #cruce) <> 1
  OR (SELECT COUNT(*) FROM #cruce WHERE MovImporte > 0) <> 1
  OR (SELECT COUNT(*) FROM #cruce WHERE MovImporte < 0) <> 1 )
BEGIN
    SELECT 'FRENO - los dos lados no se corresponden' AS Aviso, * FROM #cruce;
    RAISERROR('Los dos PAGO_CRUZADO vivos no son las dos patas de un mismo cruce (misma orden, signos opuestos). No se toca nada.', 16, 1);
    RETURN;
END

/* -- 3 . Los cargos que no coinciden con su documento ---------------------
        Solo documentos vivos, con UN unico cargo vivo, y en una cuenta de la
        moneda del documento.                                                 */
IF OBJECT_ID('tempdb..#cargos') IS NOT NULL DROP TABLE #cargos;
SELECT d.DocIdDocumento,
       Doc = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocTotal,
       x.MovIdMovimiento,
       x.CueIdCuenta,
       ImporteHoy   = x.MovImporte,
       ImporteQueda = -d.DocTotal,
       Ajuste       = -d.DocTotal - x.MovImporte      /* positivo = le baja la deuda */
INTO #cargos
FROM dbo.DocumentosContables d
CROSS APPLY (
    SELECT TOP 2 m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte,
           Cuantos = COUNT(*) OVER ()
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.DocIdDocumento = d.DocIdDocumento AND cc.CliIdCliente = @Cli
      AND cc.CueTipo LIKE 'DINERO%' AND cc.MonIdMoneda = d.MonIdMoneda
      AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
      AND m.MovImporte < 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) x
WHERE d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) <> 'RC'
  AND RTRIM(ISNULL(d.DocEstado,'')) <> 'ANULADO'
  AND x.Cuantos = 1
  AND ABS(ABS(x.MovImporte) - d.DocTotal) > 0.01;

SELECT @NCargos = COUNT(*), @AjusteTotal = ISNULL(SUM(Ajuste), 0) FROM #cargos;

/* -- 4 . Idempotencia ----------------------------------------------------- */
IF @NCruce = 0 AND @NCargos = 0
BEGIN
    PRINT 'Ya esta hecho: no hay cruce vivo ni cargos desfasados. No se toca nada.';
    DROP TABLE #cruce; DROP TABLE #cargos;
    RETURN;
END

/* -- 5 . CANDADO: el ajuste tiene que ser el que se diagnostico ----------- */
IF @NCargos > 0 AND ABS(@AjusteTotal - @AjusteEsperado) > 0.01
BEGIN
    SELECT 'FRENO - el ajuste no es el esperado' AS Aviso, * FROM #cargos;
    DECLARE @msg VARCHAR(300) = 'Los cargos desfasados suman '
        + CONVERT(varchar(20), CAST(@AjusteTotal AS decimal(18,2)))
        + ' y se esperaban ' + CONVERT(varchar(20), CAST(@AjusteEsperado AS decimal(18,2)))
        + '. Aparecio algo nuevo desde el diagnostico. Revisar antes de seguir. No se toca nada.';
    RAISERROR(@msg, 16, 1);
    RETURN;
END

/* -- VISTA PREVIA -------------------------------------------------------- */
SELECT Paso = 'A - CRUCE A ANULAR', c.*,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END
FROM #cruce c JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta;

SELECT Paso = 'B - CARGOS A CORREGIR',
       Doc, DocIdDocumento, MovIdMovimiento, CueIdCuenta,
       DocTotal     = CAST(DocTotal AS DECIMAL(18,2)),
       ImporteHoy   = CAST(ImporteHoy AS DECIMAL(18,2)),
       ImporteQueda = CAST(ImporteQueda AS DECIMAL(18,2)),
       LeBajaLaDeuda = CAST(Ajuste AS DECIMAL(18,2))
FROM #cargos ORDER BY DocIdDocumento;

SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudaViva  = CAST(dv.Viva AS DECIMAL(18,2)),
       Sobra      = CAST(-s.Saldo - dv.Viva AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','CANCELADO','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

SELECT Momento = 'ANTES - ciclos tocados', c.CicIdCiclo, c.CueIdCuenta, c.CicEstado,
       CicTotalOrdenes = CAST(c.CicTotalOrdenes AS DECIMAL(18,4)),
       CicTotalPagos   = CAST(c.CicTotalPagos AS DECIMAL(18,4))
FROM dbo.CiclosCredito c
WHERE c.CliIdCliente = @Cli
  AND c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta aca no se escribio NADA.
   ========================================================================= */

BEGIN TRANSACTION;

    /* A . El cruce: los dos lados se anulan (no se borran) */
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' REVERTIDO_CRUCE_2026-09-09: el cruce automatico saco US$ 8,86 de la cuenta de'
            + ' dolares para cubrir una orden en pesos, pero esa cuenta estaba en negativo: la'
            + ' plata no existia. El motor decidia leyendo CueSaldoActual, que marcaba un'
            + ' positivo sin respaldo. El codigo ya se corrigio y se desplego el 09-09-2026.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN #cruce x ON x.MovIdMovimiento = m.MovIdMovimiento;

    PRINT CONCAT('A) Movimientos del cruce anulados: ', @@ROWCOUNT, '.');

    /* B . Los cargos pasan a valer el total de su documento */
    UPDATE m
    SET m.MovImporte = c.ImporteQueda,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' | FIX_SALDO_DESFASAJE_2026-09-09: corregido a '
            + CONVERT(varchar(20), CAST(c.ImporteQueda AS decimal(18,4)))
            + ' (=-DocTotal del ' + c.Doc + '), era '
            + CONVERT(varchar(20), CAST(c.ImporteHoy AS decimal(18,4)))
            + '. El cierre habia sumado las ordenes a un precio y la factura salio a otro; la'
            + ' diferencia quedaba inflando el libro. La factura y la deuda no se tocan.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN #cargos c ON c.MovIdMovimiento = m.MovIdMovimiento;

    PRINT CONCAT('B) Cargos llevados al total de su documento: ', @@ROWCOUNT, '.');

    /* C . Saldo corrido de todas las cuentas de dinero de la clienta */
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    /* Saldo guardado, con la formula del backend (suma TODO, ORDEN incluidos) */
    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

    PRINT 'C) Saldo corrido y saldo guardado recalculados.';

    /* D . Totales de los ciclos tocados por el cruce */
    UPDATE c
    SET c.CicTotalOrdenes = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta
            WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('ORDEN','ENTREGA','ORDEN_ANTICIPO')
              AND (MovAnulado IS NULL OR MovAnulado = 0)), 0),
        c.CicTotalPagos   = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta
            WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO','COBRO','SALDO_A_FAVOR')
              AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
    FROM dbo.CiclosCredito c
    WHERE c.CliIdCliente = @Cli
      AND c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

    PRINT CONCAT('D) Ciclos recalculados: ', @@ROWCOUNT, '.');

COMMIT TRANSACTION;

/* -- DESPUES ------------------------------------------------------------- */
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudaViva  = CAST(dv.Viva AS DECIMAL(18,2)),
       Sobra      = CAST(-s.Saldo - dv.Viva AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       Veredicto  = CASE WHEN ABS(-s.Saldo - dv.Viva) <= 0.02
                         THEN 'CUADRADA: el libro dice lo mismo que las deudas'
                         ELSE '>>> TODAVIA NO CIERRA <<<' END
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','CANCELADO','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

SELECT Momento = 'DESPUES - las deudas que quedan', dd.DDeIdDocumento,
       Doc = RTRIM(ISNULL(d.DocSerie,'')) + '-' + RTRIM(ISNULL(d.DocNumero,'')),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DeudaDocumento dd
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE cc.CliIdCliente = @Cli AND dd.DDeEstado NOT IN ('CANCELADA','CANCELADO','PAGADO','COBRADO')
ORDER BY dd.DDeIdDocumento;

SELECT Momento = 'DESPUES - ciclos', c.CicIdCiclo, c.CueIdCuenta, c.CicEstado,
       CicTotalOrdenes = CAST(c.CicTotalOrdenes AS DECIMAL(18,4)),
       CicTotalPagos   = CAST(c.CicTotalPagos AS DECIMAL(18,4))
FROM dbo.CiclosCredito c
WHERE c.CliIdCliente = @Cli
  AND c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

DROP TABLE #cruce;
DROP TABLE #cargos;
