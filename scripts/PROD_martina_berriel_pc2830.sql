/* ============================================================================
   PRODUCCION - MARTINA BERRIEL (IDCliente 'Martina Berriel', CodCliente 204101)
   Cierra el ultimo fleco: revierte el cruce del 28/07 y deja el PC-2830 con la
   deuda que realmente tiene.

   CORRER DESPUES de PROD_martina_berriel_pc2713.sql (ya corrido el 09-09-2026).

   QUE PASA HOY (medido en produccion el 09-09-2026, despues del otro script):
     cuenta US$ 507  : -201,35   <- el cruce, dolares que ella no tenia
     cuenta $  1121  : -378,40   <- el PC-2830 menos lo que tapo el cruce
     deuda viva      : 0 en las dos  <- caja no ve nada a cobrar

   SON DOS COSAS:

   1) EL CRUCE DEL 28/07. Al entrar la orden VEN-2322 ($ 8.217) el motor de cruce
      automatico saco US$ 201,35 de la cuenta de dolares para cubrirla. Dos
      movimientos PAGO_CRUZADO atados por el mismo OrdIdOrden:
          cuenta US$ : -201,3477  "Cruce automatico -> Orden VEN-2322"
          cuenta $   : +8.217,00  "Cobertura desde DINERO_USD"
      Esos dolares no existian: la cuenta estaba en cero. El motor decidia leyendo
      CueSaldoActual cacheado, que en ese momento marcaba un positivo inventado.
      El codigo ya esta arreglado (contabilidadService ~5455: la cuenta origen se
      elige por el LIBRO y no se cruza si el cliente tiene ciclo abierto), falta
      el deploy. Mismo caso que PROD_crsport_revertir_cruce_emb4353.sql.

   2) EL PC-2830 NUNCA SE COBRO Y AUN ASI NO FIGURA COMO DEUDA. Documento en pesos
      por $ 8.595,40 (DTF 378,40 + VEN-2322 8.217), sin transaccion de caja y sin
      un solo cobro en el libro. Tiene DOS DeudaDocumento, ninguna igual al total:
          8.432,31 = lo que creyo el ciclo 281, que conto el cruce como si fuera
                     una orden (TotalOrdenes 210,8077 = 9,46 real + 201,3477)
          9.189,40 = la version previa de la linea VEN-2322 (89 x 99 en vez de 83)
      Las dos quedaron COBRADO con pendiente 0, saldadas por dos Pagos
      ANTICIPO_APLICADO que consumieron el saldo a favor falso que dejaba el
      PC-2713. Ese saldo a favor ya no existe, asi que esos pagos tampoco.

   QUE HACE ESTE SCRIPT:
     A. Anula los dos movimientos del cruce (MovAnulado = 1, NO borra).
     B. Borra las imputaciones de los dos pagos fantasma - es lo mismo que hace el
        sistema al anular un cobro (cajaService ~2786): si la imputacion queda
        viva, toda consulta sigue creyendo que la deuda esta cubierta.
     C. Deja UNA sola deuda, la mas vieja, por el total real del documento, y
        cancela la otra.
     D. Recalcula saldo corrido, CueSaldoActual y los totales de los ciclos
        tocados, con la misma formula del backend.

   NO TOCA: el movimiento ORDEN de la orden DTF-11176 (es el cargo del trabajo),
   ni el CIERRE_CICLO de -8.595,40 (ese cargo esta bien, es el del documento), ni
   los dos registros de Pagos, que quedan sin imputacion y sin transaccion de
   caja, o sea inalcanzables. Se los nombra en la observacion de la deuda para
   que el rastro se pueda seguir.

   RESULTADO ESPERADO:
       cuenta US$ 507   -201,35  ->  0,00
       cuenta $  1121   -378,40  ->  -8.595,40
       deuda viva del PC-2830        0,00  ->  8.595,40
       ciclo 281: TotalOrdenes 210,8077 -> 9,46 ; TotalPagos 201,3477 -> 0
       ciclo 118: TotalPagos baja 8.217
   Es decir: debe el PC-2830 entero, que es lo que realmente paso.

   Se identifica por FORMA (cliente + concepto de la orden + serie/numero), no por
   ID. Es idempotente: si el cruce ya esta anulado y la deuda ya esta puesta,
   avisa y no toca nada.
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
DECLARE @Orden      VARCHAR(40) = 'VEN-2322';
DECLARE @Serie      VARCHAR(10) = 'PC';
DECLARE @Numero     VARCHAR(20) = '2830';

DECLARE @Cli INT, @N INT, @Ord INT, @Doc INT, @DocTotal DECIMAL(18,4),
        @MonDoc INT, @Cue INT, @CobroLibro DECIMAL(18,4),
        @DeudaVieja INT, @DeudaOtra INT, @Vence DATE, @Estado VARCHAR(20),
        @NImp INT, @NImpMalas INT, @PagosTexto VARCHAR(200);

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

/* -- 2 . El documento ----------------------------------------------------- */
SELECT TOP 1 @Doc = d.DocIdDocumento, @DocTotal = d.DocTotal, @MonDoc = d.MonIdMoneda
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = @Serie AND RTRIM(d.DocNumero) = @Numero
ORDER BY d.DocIdDocumento DESC;

IF @Doc IS NULL BEGIN RAISERROR('No se encontro el %s-%s de este cliente. No se toca nada.', 16, 1, @Serie, @Numero); RETURN; END
IF @MonDoc <> 1 BEGIN RAISERROR('El %s-%s no esta en pesos (MonIdMoneda = %d). No es el caso esperado. No se toca nada.', 16, 1, @Serie, @Numero, @MonDoc); RETURN; END

/* -- 3 . CANDADO: el documento no puede tener NINGUN cobro en el libro -----
        Si alguien lo cobro despues de que yo mire, esto ya no aplica.        */
SELECT @CobroLibro = ISNULL(SUM(m.MovImporte), 0)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = @Doc AND cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovImporte > 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

IF @CobroLibro > 0.01
BEGIN
    DECLARE @m1 VARCHAR(300) = 'El ' + @Serie + '-' + @Numero + ' tiene ' +
        CONVERT(varchar(20), CAST(@CobroLibro AS decimal(18,2))) +
        ' cobrados en el libro. Ya no es el caso "facturado y nunca cobrado". No se toca nada.';
    RAISERROR(@m1, 16, 1);
    RETURN;
END

/* -- 4 . El cruce: los dos lados, atados por el mismo OrdIdOrden ----------- */
SELECT TOP 1 @Ord = m.OrdIdOrden
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo = 'PAGO_CRUZADO'
  AND m.MovConcepto LIKE '%' + @Orden + '%'
  AND m.MovImporte < 0
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.MovIdMovimiento DESC;

IF OBJECT_ID('tempdb..#cruce') IS NOT NULL DROP TABLE #cruce;
CREATE TABLE #cruce (MovIdMovimiento INT, CueIdCuenta INT, MovTipo VARCHAR(30),
                     MovImporte DECIMAL(18,4), MovFecha DATETIME, CicIdCiclo INT,
                     MovConcepto VARCHAR(255));

IF @Ord IS NOT NULL
    INSERT INTO #cruce
    SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha,
           m.CicIdCiclo, LEFT(RTRIM(ISNULL(m.MovConcepto,'')),255)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
      AND m.OrdIdOrden = @Ord AND m.MovTipo = 'PAGO_CRUZADO'
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

SELECT @N = COUNT(*) FROM #cruce;

IF @N NOT IN (0, 2)
BEGIN
    SELECT 'FRENO - el cruce no tiene dos lados' AS Aviso, * FROM #cruce;
    RAISERROR('Se esperaban 2 movimientos de cruce (uno por moneda) o ninguno, y hay %d. No se toca nada.', 16, 1, @N);
    RETURN;
END

IF @N = 0 PRINT 'AVISO: el cruce de la orden ' + @Orden + ' ya estaba revertido. Se sigue con la deuda.';

/* -- 5 . Las deudas del documento ----------------------------------------- */
DECLARE @NVivas INT, @NImpQuedan INT;

SELECT @N = COUNT(*) FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;

SELECT @NVivas = COUNT(*) FROM dbo.DeudaDocumento
WHERE DocIdDocumento = @Doc AND DDeImportePendiente > 0.01
  AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

SELECT @NImpQuedan = COUNT(*)
FROM dbo.ImputacionPago ip
JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
WHERE dd.DocIdDocumento = @Doc;

/* Idempotencia: cruce ya revertido, sin imputaciones, y UNA sola deuda viva por
   el total del documento -> este script ya corrio. */
IF (SELECT COUNT(*) FROM #cruce) = 0 AND @NImpQuedan = 0 AND @NVivas = 1
   AND EXISTS (SELECT 1 FROM dbo.DeudaDocumento
               WHERE DocIdDocumento = @Doc
                 AND ABS(DDeImportePendiente - @DocTotal) <= 0.02
                 AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
BEGIN
    PRINT 'Ya esta hecho: el cruce esta revertido y el ' + @Serie + '-' + @Numero + ' tiene una sola deuda viva por su total. No se toca nada.';
    DROP TABLE #cruce;
    RETURN;
END

IF @N <> 2
BEGIN
    SELECT 'FRENO - deudas del documento' AS Aviso, * FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;
    RAISERROR('Se esperaban 2 deudas para el %s-%s y hay %d. No se toca nada.', 16, 1, @Serie, @Numero, @N);
    RETURN;
END

IF @NVivas > 0
BEGIN
    SELECT 'FRENO - hay deuda con pendiente' AS Aviso, * FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;
    RAISERROR('Alguna de las dos deudas del %s-%s ya tiene importe pendiente: o alguien la repuso a mano, o este script quedo a medias. Revisar antes de seguir. No se toca nada.', 16, 1, @Serie, @Numero);
    RETURN;
END

/* -- 6 . CANDADO: las imputaciones tienen que ser TODAS pagos fantasma -----
        Un ANTICIPO_APLICADO sin transaccion de caja no movio un peso. Si
        aparece una imputacion respaldada por un cobro real, esto no se toca.   */
SELECT @NImp = COUNT(*),
       @NImpMalas = SUM(CASE WHEN p.PagTcaIdTransaccion IS NULL
                              AND RTRIM(ISNULL(p.PagTipoMovimiento,'')) = 'ANTICIPO_APLICADO'
                             THEN 0 ELSE 1 END)
FROM dbo.ImputacionPago ip
JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE dd.DocIdDocumento = @Doc;

IF ISNULL(@NImpMalas, 0) > 0
BEGIN
    SELECT 'FRENO - imputacion con respaldo real' AS Aviso, ip.*, p.PagTipoMovimiento, p.PagTcaIdTransaccion
    FROM dbo.ImputacionPago ip
    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
    LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE dd.DocIdDocumento = @Doc;
    RAISERROR('Alguna imputacion del %s-%s viene de un cobro real de caja, no de un anticipo aplicado. No se toca nada.', 16, 1, @Serie, @Numero);
    RETURN;
END

/* La deuda que sobrevive es la mas vieja; la otra se cancela. */
SELECT @DeudaVieja = MIN(DDeIdDocumento), @DeudaOtra = MAX(DDeIdDocumento)
FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;

SELECT @Vence = DDeFechaVencimiento FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @DeudaVieja;
SET @Estado = CASE WHEN @Vence < CAST(GETDATE() AS DATE) THEN 'VENCIDO' ELSE 'PENDIENTE' END;

SELECT @PagosTexto = STUFF((SELECT ', ' + CONVERT(varchar(20), ip.PagIdPago)
                            FROM dbo.ImputacionPago ip
                            JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
                            WHERE dd.DocIdDocumento = @Doc
                            ORDER BY ip.PagIdPago FOR XML PATH('')), 1, 2, '');

/* -- VISTA PREVIA -------------------------------------------------------- */
SELECT Paso = 'A - MOVIMIENTOS DEL CRUCE A ANULAR', c.*,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END
FROM #cruce c JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta;

SELECT Paso = 'B - IMPUTACIONES A BORRAR',
       ip.ImpIdImputacion, ip.PagIdPago, ip.DDeIdDocumento,
       Imputado = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       p.PagTipoMovimiento, p.PagTcaIdTransaccion
FROM dbo.ImputacionPago ip
JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE dd.DocIdDocumento = @Doc;

SELECT Paso = 'C - DEUDAS',
       Que = CASE WHEN dd.DDeIdDocumento = @DeudaVieja
                  THEN 'QUEDA como la deuda del documento' ELSE 'SE CANCELA (duplicada)' END,
       dd.DDeIdDocumento,
       OriginalHoy  = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       PendienteHoy = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       EstadoHoy    = dd.DDeEstado,
       OriginalQueda  = CAST(CASE WHEN dd.DDeIdDocumento = @DeudaVieja THEN @DocTotal ELSE dd.DDeImporteOriginal END AS DECIMAL(18,2)),
       PendienteQueda = CAST(CASE WHEN dd.DDeIdDocumento = @DeudaVieja THEN @DocTotal ELSE 0 END AS DECIMAL(18,2)),
       EstadoQueda    = CASE WHEN dd.DDeIdDocumento = @DeudaVieja THEN @Estado ELSE 'CANCELADA' END
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @Doc;

SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       DeudaViva  = CAST(dv.Viva AS DECIMAL(18,2))
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
WHERE c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta aca no se escribio NADA.
   ========================================================================= */

BEGIN TRANSACTION;

    /* A . Los dos lados del cruce se anulan (no se borran) */
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' REVERTIDO_CRUCE_2026-09-09: el cruce automatico saco US$ 201,35 de la cuenta de'
            + ' dolares para cubrir la orden ' + @Orden + ', pero esa cuenta estaba en cero. El motor'
            + ' decidia leyendo CueSaldoActual cacheado, que marcaba un positivo inventado por el'
            + ' PC-2713 (cargo en dolares, cobro en pesos). Se revierte para que el ' + @Serie + '-'
            + @Numero + ' quede pendiente de cobro entero.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN #cruce x ON x.MovIdMovimiento = m.MovIdMovimiento;

    PRINT CONCAT('A) Movimientos del cruce anulados: ', @@ROWCOUNT, '.');

    /* B . Las imputaciones de los pagos fantasma dejan de existir.
           Mismo criterio que cajaService al anular un cobro: si quedan vivas,
           toda consulta que sume ImputacionPago sigue creyendo que esta cubierta. */
    DELETE ip
    FROM dbo.ImputacionPago ip
    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
    WHERE dd.DocIdDocumento = @Doc;

    PRINT CONCAT('B) Imputaciones borradas: ', @@ROWCOUNT, '.');

    /* C . Una sola deuda, por el total del documento */
    UPDATE dbo.DeudaDocumento
    SET DDeImporteOriginal  = @DocTotal,
        DDeImportePendiente = @DocTotal,
        DDeEstado    = @Estado,
        DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' | FIX_DEUDA_2026-09-09: el ' + @Serie + '-' + @Numero + ' nunca se cobro (sin'
            + ' transaccion de caja y sin cobro en el libro) y aun asi figuraba saldado. Esta deuda'
            + ' decia ' + CONVERT(varchar(20), CAST(DDeImporteOriginal AS decimal(18,2)))
            + ' (el ciclo conto el cruce como si fuera una orden) y se la lleva al total real del'
            + ' documento. Se borraron las imputaciones de los pagos ' + ISNULL(@PagosTexto,'?')
            + ', que eran ANTICIPO_APLICADO contra un saldo a favor que no existia. Esos dos'
            + ' registros de Pagos quedan sin imputacion y sin transaccion de caja.'), 500)
    WHERE DDeIdDocumento = @DeudaVieja;

    PRINT CONCAT('C) Deuda ', @DeudaVieja, ' puesta en ', CAST(@DocTotal AS DECIMAL(18,2)), ' (', @Estado, ').');

    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0,
        DDeEstado    = 'CANCELADA',
        DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' | FIX_DEUDA_2026-09-09: deuda duplicada del ' + @Serie + '-' + @Numero + '. Su importe'
            + ' era la version previa de la linea ' + @Orden + '. La deuda del documento es la '
            + CONVERT(varchar(20), @DeudaVieja) + '.'), 500)
    WHERE DDeIdDocumento = @DeudaOtra;

    PRINT CONCAT('C) Deuda ', @DeudaOtra, ' cancelada por duplicada.');

    /* D . Saldo corrido de las cuentas tocadas */
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

    /* Saldo guardado, con la misma formula que recomputarSaldoCuenta del backend */
    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

    /* Totales de los ciclos donde estaba imputado el cruce */
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

/* -- DESPUES ------------------------------------------------------------- */
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       DeudaViva  = CAST(dv.Viva AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','CANCELADO','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

SELECT Momento = 'DESPUES - deudas del documento', dd.DDeIdDocumento,
       Original  = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @Doc;

SELECT Momento = 'DESPUES - ciclos', c.CicIdCiclo, c.CueIdCuenta, c.CicEstado,
       CicTotalOrdenes = CAST(c.CicTotalOrdenes AS DECIMAL(18,4)),
       CicTotalPagos   = CAST(c.CicTotalPagos AS DECIMAL(18,4))
FROM dbo.CiclosCredito c
WHERE c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cruce WHERE CicIdCiclo IS NOT NULL);

DROP TABLE #cruce;
