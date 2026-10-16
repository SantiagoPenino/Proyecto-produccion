/* ============================================================================
   PRODUCCIÓN — MARTINA BERRIEL (IDCliente 'Martina Berriel', CodCliente 204101)
   Lleva el cargo del PC-2713 a la cuenta y la moneda del documento.

   QUÉ PASÓ: las mismas CINCO órdenes quedaron cargadas en dólares y cobradas en
   pesos.
     · El ciclo 35 (cuenta DINERO_USD) cerró el 17/06 16:05 con SB-64364, SB-64351,
       SB-64439, SB-64538 y SB-64363 = US$ 2.680,50, y asentó ese cargo en dólares.
     · Dos horas después, 17/06 18:12, la caja emitió el PC-2713 por $ 78.557,41 con
       ESAS MISMAS cinco órdenes (líneas a $293,07/m) y cobró en pesos.
   Resultado: la cuenta de pesos tiene un cobro de 78.557,41 SIN cargo (la infla) y
   la de dólares un cargo de 2.680,50 SIN cobro (la endeuda). Es el mismo trabajo
   partido entre dos monedas.

   REGLA: manda el documento. El PC-2713 es un documento EN PESOS por $ 78.557,41,
   así que su cargo va en la cuenta de pesos y por ese importe.

   NO ES UN BUG DE DISEÑO: tener el ciclo en una moneda y facturar en otra es una
   función del sistema, y funciona. Martina tiene SEIS ciclos resueltos bien; este
   es del 17/06 y el traspaso a UYU aparece recién el 07/07 — quedó con la forma
   vieja, de antes de que esa función existiera.

   LA FORMA CORRECTA (PC-1937, ciclo 173, movimientos 14918 y 14917):
     cuenta US$ : CIERRE_CICLO importe 0, concepto "traspasada a UYU",
                  MovObservaciones 'Cross-moneda: ...'   <- MARCADOR
     cuenta $   : CIERRE_CICLO por el importe real del documento
   El marcador en 0 es lo que cierra el ciclo del lado dólares sin mover el saldo,
   y su observación 'Cross-moneda:' es lo que protege al movimiento de que
   editarFactura lo pise.

   QUÉ HACE ESTE SCRIPT: deja el PC-2713 con esa misma forma.
     1. El movimiento en dólares pasa a ser el MARCADOR: importe 0, tipo
        CIERRE_CICLO, concepto de traspaso y observación 'Cross-moneda:'.
        Se queda en la cuenta de dólares y conserva su CicIdCiclo (el ciclo 35 ES
        de esa cuenta).
     2. Se INSERTA en la cuenta de pesos el CIERRE_CICLO por el total del
        documento, con el mismo ciclo y el mismo documento.
   Después recalcula el saldo corrido y el CueSaldoActual de LAS DOS cuentas.

   RESULTADO ESPERADO (medido en la réplica local):
       cuenta pesos    +78.179,01 a favor  ->  -378,40 debe
       cuenta dólares   -2.881,85 debe     ->  -201,35 debe
   Los -378,40 que quedan son el PC-2830 (cargo de 8.595,40 sin cobro) menos el
   cruce automático de +8.217. Los -201,35 son ese mismo cruce del lado dólares.

   NO TOCA los 5 movimientos ORDEN del ciclo 35: son el detalle del trabajo y la
   fórmula del saldo los excluye. El ciclo 35 tampoco cambia: sus totales se
   calculan sobre ORDEN/PAGO, no sobre VTA_CAJA.

   OJO — EL RUC NO SIRVE PARA IDENTIFICARLA: el 00000007 lo comparten 3 clientes
   (Nicolas Rodriguez, Martina Berriel y MATEO ROSTAN). Se resuelve por IDCliente
   con CodCliente de control cruzado.

   Es idempotente: si el cargo ya está en pesos por el total del documento, avisa
   y no toca nada.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   Para mirar sin escribir: correr hasta el "FIN DE LA VISTA PREVIA".
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

SELECT Servidor = @@SERVERNAME,
       Base     = DB_NAME(),
       Archivo  = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

DECLARE @IDCliente  VARCHAR(60) = 'Martina Berriel';
DECLARE @CodCliente VARCHAR(30) = '204101';
DECLARE @Serie      VARCHAR(10) = 'PC';
DECLARE @Numero     VARCHAR(20) = '2713';

DECLARE @Cli INT, @N INT, @Doc INT, @DocTotal DECIMAL(18,4), @MonDoc INT,
        @Mov INT, @CueOrigen INT, @ImpOrigen DECIMAL(18,4), @CueDestino INT, @Ciclo INT,
        @Usuario INT = 1,
        @CobroDestino DECIMAL(18,4);

/* ── 1 · Cliente ─────────────────────────────────────────────────────────── */
SELECT @N = COUNT(*), @Cli = MIN(c.CliIdCliente)
FROM dbo.Clientes c
WHERE RTRIM(ISNULL(c.IDCliente,'')) = @IDCliente
  AND RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')) = @CodCliente;

IF @N <> 1
BEGIN
    SELECT Coincidencias = RTRIM(c.Nombre), IDCliente = RTRIM(ISNULL(c.IDCliente,'')),
           CodCliente = RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')), c.CliIdCliente
    FROM dbo.Clientes c WHERE RTRIM(ISNULL(c.IDCliente,'')) = @IDCliente;
    RAISERROR('Se esperaba UN cliente con IDCliente %s y CodCliente %s, y hay %d. No se toca nada.', 16, 1, @IDCliente, @CodCliente, @N);
    RETURN;
END

/* ── 2 · Documento ───────────────────────────────────────────────────────── */
SELECT TOP 1 @Doc = d.DocIdDocumento, @DocTotal = d.DocTotal, @MonDoc = d.MonIdMoneda
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = @Serie AND RTRIM(d.DocNumero) = @Numero
ORDER BY d.DocIdDocumento DESC;

IF @Doc IS NULL BEGIN RAISERROR('No se encontró el %s-%s de este cliente. No se toca nada.', 16, 1, @Serie, @Numero); RETURN; END
IF @MonDoc <> 1 BEGIN RAISERROR('El documento no está en pesos (MonIdMoneda = %d). Este script es específico para el caso del PC-2713 en pesos. No se toca nada.', 16, 1, @MonDoc); RETURN; END

/* ── 3 · El cargo (tiene que ser UNO solo y estar en una cuenta de DÓLARES) ─ */
SELECT @N = COUNT(*), @Mov = MIN(m.MovIdMovimiento), @CueOrigen = MIN(m.CueIdCuenta),
       @ImpOrigen = MIN(m.MovImporte), @Ciclo = MIN(m.CicIdCiclo)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = @Doc AND cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
  AND m.MovImporte < 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

IF @N <> 1
BEGIN
    RAISERROR('Se esperaba UN cargo vivo para el documento y hay %d. No se toca nada.', 16, 1, @N);
    RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueOrigen AND CueTipo = 'DINERO_USD')
BEGIN
    PRINT 'El cargo ya NO está en una cuenta de dólares. Nada para mover.';
    RETURN;
END

/* ── 4 · La cuenta destino: la principal en pesos ────────────────────────── */
SELECT TOP 1 @CueDestino = cc.CueIdCuenta
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo = 'DINERO_UYU' AND cc.CueActiva = 1
ORDER BY cc.CueEsPrincipal DESC, cc.CueIdCuenta ASC;

IF @CueDestino IS NULL BEGIN RAISERROR('El cliente no tiene cuenta activa en pesos. No se toca nada.', 16, 1); RETURN; END

/* ── 5 · CANDADO: el cobro del documento tiene que estar YA en la cuenta destino.
        Si no está, esto no es el caso "cargo y cobro en monedas distintas" y no
        corresponde mover nada. ─────────────────────────────────────────────── */
SELECT @CobroDestino = ISNULL(SUM(m.MovImporte), 0)
FROM dbo.MovimientosCuenta m
WHERE m.DocIdDocumento = @Doc AND m.CueIdCuenta = @CueDestino
  AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO','COBRO')
  AND m.MovImporte > 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

IF ABS(@CobroDestino - @DocTotal) > 0.02
BEGIN
    DECLARE @msg VARCHAR(300) = 'El cobro que hay en la cuenta de pesos ('
        + CONVERT(varchar(20), CAST(@CobroDestino AS decimal(18,2)))
        + ') no coincide con el total del documento ('
        + CONVERT(varchar(20), CAST(@DocTotal AS decimal(18,2)))
        + '). No es el caso esperado. No se toca nada.';
    RAISERROR(@msg, 16, 1);
    RETURN;
END

/* ── VISTA PREVIA ────────────────────────────────────────────────────────── */
SELECT Paso = 'LO QUE SE VA A HACER',
       Documento    = @Serie + '-' + @Numero,
       DocTotal     = CAST(@DocTotal AS DECIMAL(18,2)),
       CobroEnPesos = CAST(@CobroDestino AS DECIMAL(18,2)),
       MovEnDolares = @Mov,
       CuentaUSD    = @CueOrigen,
       ImporteUSD_hoy      = CAST(@ImpOrigen AS DECIMAL(18,2)),
       ImporteUSD_queda_en = CAST(0 AS DECIMAL(18,2)),
       CuentaPesos  = @CueDestino,
       CargoNuevoEnPesos   = CAST(-@DocTotal AS DECIMAL(18,2));

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

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta acá no se escribió NADA.
   ========================================================================= */

BEGIN TRANSACTION;

    /* 1 · el movimiento en dólares pasa a ser el MARCADOR (importe 0) */
    UPDATE dbo.MovimientosCuenta
    SET MovTipo    = 'CIERRE_CICLO',
        MovImporte = 0,
        MovConcepto = 'Cierre ciclo → Factura ' + @Serie + '-' + @Numero + ' traspasada a UYU ('
                    + CONVERT(varchar(20), CAST(@DocTotal AS decimal(18,2))) + ')',
        MovObservaciones = 'Cross-moneda: Ordenes '
                    + CONVERT(varchar(20), CAST(ABS(@ImpOrigen) AS decimal(18,2))) + ' USD → Factura '
                    + CONVERT(varchar(20), CAST(@DocTotal AS decimal(18,2)))
                    + ' | FIX_CARGO_MONEDA_2026-09-05: el cargo había quedado con el importe real en'
                    + ' DÓLARES y el cobro de las MISMAS 5 órdenes en PESOS. Se le da la forma de los'
                    + ' otros ciclos de este cliente: marcador en 0 acá y el cargo real en pesos.'
    WHERE MovIdMovimiento = @Mov;

    PRINT CONCAT('1) Movimiento en dólares convertido en marcador (', @@ROWCOUNT, ' fila).');

    /* 2 · el cargo real, en la cuenta de pesos, con el mismo ciclo y documento */
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, CicIdCiclo, MovObservaciones)
    SELECT @CueDestino, 'CIERRE_CICLO',
           'Venta Pedidos Caja: ' + @Serie + '-' + @Numero + ' (traspaso desde el ciclo en US$)',
           -@DocTotal, 0,
           @Doc, d.DocFechaEmision, @Usuario, 0, @Ciclo,
           'FIX_CARGO_MONEDA_2026-09-05: cargo que faltaba en pesos. El ciclo cerró en US$ y la'
           + ' factura salió en UYU; el traspaso no se hizo porque este cierre (17/06) es anterior'
           + ' a que existiera esa función. Importe = total del documento.'
    FROM dbo.DocumentosContables d WHERE d.DocIdDocumento = @Doc;

    PRINT CONCAT('2) Cargo asentado en la cuenta de pesos (', @@ROWCOUNT, ' fila).');

    /* Saldo corrido de LAS DOS cuentas */
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (@CueOrigen, @CueDestino)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    /* Saldo guardado de todas las cuentas de dinero del cliente */
    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

COMMIT TRANSACTION;

/* ── DESPUÉS ─────────────────────────────────────────────────────────────── */
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda      = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro  = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Guardado    = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;
