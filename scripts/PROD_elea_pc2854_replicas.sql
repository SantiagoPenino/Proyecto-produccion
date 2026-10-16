/* ============================================================================
   PRODUCCION - elea (IDCliente 'ELEA', CodCliente 126101)
   Anula las dos REPLICAS del cobro del 02-09 y le devuelve al PC-2854 los
   US$ 159,75 que nunca se cobraron, para que se puedan cobrar de verdad.

   QUE PASO (confirmado con el usuario el 09-09-2026: fue UNA sola transferencia):
   ese dia entraron $ 40.000 por transferencia, que a 40,8397 son US$ 979,44, y se
   aplicaron bien a dos deudas:
       16:13:56  RC-000652  $ 13.244,69  ->  US$ 324,31  al PC-2687  (queda saldado)
       16:14:18  RC-000654  $ 26.755,31  ->  US$ 655,13  al PC-2854  (quedaban 159,75)
   Y despues el mismo envio se grabo DOS VECES MAS, con el importe en pesos de la
   segunda repetido al centavo:
       16:14:21  RC-000656  $ 26.755,31  ->  US$ 159,75  al PC-2854  <- REPLICA
       16:14:22  RC-000658  $ 26.755,31  ->  US$   0,00  a nada      <- REPLICA
   La tercera encontro los 159,75 pendientes y los tapo con plata que no existia.
   La cuarta no encontro nada y dejo un recibo en 0 con un pago de $ 26.755,31.

   Resultado: el PC-2854 figura COBRADO entero, pero solo 655,13 tuvieron plata
   atras. Y la caja del 02/09 quedo con $ 93.510,62 de esta clienta cuando
   entraron $ 40.000.

   LA CAUSA YA ESTA ARREGLADA Y DESPLEGADA (09-09-2026): los botones de los
   banners de pago parcial / pago en exceso no se deshabilitaban al enviar
   (CajaPagoDeudaTab.jsx), y ademas se agrego el candado anti-doble-cobro del
   backend (cajaController, VENTANA_DOBLE_COBRO_SEG = 90). Este script solo
   repara el dato que quedo.

   COMO SE IDENTIFICAN LAS REPLICAS: con la MISMA regla del candado que hoy esta
   desplegado. Una Tca es replica si existe otra Tca viva del mismo cliente, con
   un pago del mismo importe y la misma moneda, dentro de los 90 segundos
   anteriores. Aplicada a esta clienta marca exactamente la 9779 y la 9780, y
   ninguna otra (sus dos cobros de $ 20.000 no se tocan: estan a 16 segundos de
   reloj pero en DIAS distintos).

   QUE HACE, copiando paso por paso lo que hace el sistema al anular un recibo
   (cajaService.anularReciboInterno ~2672):
     1. Marca las dos Tca como ANULADO.
     2. Marca sus Pagos como ANULADO.
     3. Anula los movimientos de la cuenta corriente que colgaban de esos pagos.
     4. LE DEVUELVE LA DEUDA AL PC-2854: repone el pendiente, deja el estado en
        PARCIAL y borra la fecha de cobro, para que vuelva a figurar en cobranzas
        y se pueda cobrar por caja como cualquier otra.
     5. Borra las imputaciones de esos pagos.
     6. Pone el documento como impago (DocPagado = 0).
     7. Anula los asientos contables de esas transacciones (si los hubiera; estas
        dos no llegaron a generar ninguno).
     8. Anula los recibos de respaldo (RC-000656, RC-657 y RC-000658).
     9. Recalcula saldo corrido y CueSaldoActual con la formula del backend.

   RESULTADO ESPERADO:
       deuda del PC-2854 :  0,00 COBRADO  ->  159,75 PARCIAL (de 814,88)
       cuenta US$ 75     :  baja 159,75   ->  y la deuda viva sube 159,75
   Las dos se mueven juntas, asi que la cuenta sigue cuadrando.

   CONVIVE CON PROD_elea_cierre.sql, en cualquier orden: no tocan las mismas
   filas. Corriendo los dos, la cuenta 75 queda en -3.513,74 contra una deuda
   viva de 3.513,74.

   DESPUES DE ESTO: el PC-2854 vuelve a estar cobrable. Los 159,75 se cobran por
   caja como cualquier deuda, cuando la clienta pague.

   Es idempotente: si ya corrio, avisa y no toca nada.
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
DECLARE @Serie      VARCHAR(10) = 'PC';
DECLARE @Numero     VARCHAR(20) = '2854';
DECLARE @VentanaSeg INT = 90;                       /* la misma del candado del backend */
DECLARE @ReponerEsperado DECIMAL(18,4) = 159.75;    /* lo que las replicas taparon */
DECLARE @Usuario INT = 1;
DECLARE @Motivo VARCHAR(300) =
    'Replica del cobro del 02-09-2026: el mismo envio se grabo tres veces (botones sin'
  + ' deshabilitar). Entro UNA transferencia de $ 40.000 = US$ 979,44, ya aplicada en'
  + ' RC-000652 y RC-000654. Esta transaccion no tuvo plata atras.';

DECLARE @Cli INT, @N INT, @Doc INT, @DDe INT, @NRep INT, @Repone DECIMAL(18,4),
        @PendHoy DECIMAL(18,4), @OrigDeuda DECIMAL(18,4);

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

/* -- 2 . El documento y su deuda ------------------------------------------ */
SELECT TOP 1 @Doc = d.DocIdDocumento
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = @Serie AND RTRIM(d.DocNumero) = @Numero
ORDER BY d.DocIdDocumento DESC;

IF @Doc IS NULL BEGIN RAISERROR('No se encontro el %s-%s de este cliente. No se toca nada.', 16, 1, @Serie, @Numero); RETURN; END

SELECT @N = COUNT(*), @DDe = MIN(dd.DDeIdDocumento)
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @Doc;

IF @N <> 1
BEGIN
    SELECT 'FRENO - deudas del documento' AS Aviso, * FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;
    RAISERROR('Se esperaba UNA deuda para el %s-%s y hay %d. No se toca nada.', 16, 1, @Serie, @Numero, @N);
    RETURN;
END

SELECT @PendHoy = DDeImportePendiente, @OrigDeuda = DDeImporteOriginal
FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @DDe;

/* -- 3 . Las replicas, con la regla del candado desplegado ---------------- */
IF OBJECT_ID('tempdb..#rep') IS NOT NULL DROP TABLE #rep;
SELECT t.TcaIdTransaccion,
       Recibo = RTRIM(ISNULL(t.TcaSerieDoc,'')) + '-' + RTRIM(ISNULL(t.TcaNumeroDoc,'')),
       t.TcaFecha,
       p.PagIdPago,
       PagoPesos = p.PagMontoPago,
       ReplicaDe = r.TcaIdTransaccion,
       ReplicaDeRecibo = RTRIM(ISNULL(r.TcaSerieDoc,'')) + '-' + RTRIM(ISNULL(r.TcaNumeroDoc,''))
INTO #rep
FROM dbo.TransaccionesCaja t
JOIN dbo.Pagos p ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
CROSS APPLY (
    SELECT TOP 1 t2.TcaIdTransaccion, t2.TcaSerieDoc, t2.TcaNumeroDoc
    FROM dbo.TransaccionesCaja t2
    JOIN dbo.Pagos p2 ON p2.PagTcaIdTransaccion = t2.TcaIdTransaccion
    WHERE t2.TcaClienteId = t.TcaClienteId
      AND t2.TcaIdTransaccion <> t.TcaIdTransaccion
      AND ISNULL(t2.TcaEstado,'') NOT IN ('ANULADO','ANULADA')
      AND ABS(p2.PagMontoPago - p.PagMontoPago) <= 0.005
      AND p2.PagIdMonedaPago = p.PagIdMonedaPago
      AND t2.TcaFecha <  t.TcaFecha
      AND t2.TcaFecha >= DATEADD(SECOND, -@VentanaSeg, t.TcaFecha)
    ORDER BY t2.TcaFecha DESC) r
WHERE t.TcaClienteId = @Cli
  AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA');

SELECT @NRep = COUNT(*) FROM #rep;

/* Lo que esas replicas taparon (hay que leerlo ANTES de borrar las imputaciones) */
SELECT @Repone = ISNULL(SUM(ip.ImpImporte), 0)
FROM dbo.ImputacionPago ip
WHERE ip.PagIdPago IN (SELECT PagIdPago FROM #rep);

/* -- 4 . Idempotencia ----------------------------------------------------- */
IF @NRep = 0
BEGIN
    PRINT 'Ya esta hecho: no quedan replicas vivas de este cobro. Estado actual de la deuda del '
        + @Serie + '-' + @Numero + ': pendiente '
        + CONVERT(varchar(20), CAST(@PendHoy AS decimal(18,2))) + ' de '
        + CONVERT(varchar(20), CAST(@OrigDeuda AS decimal(18,2))) + '.';
    DROP TABLE #rep;
    RETURN;
END

/* -- 5 . CANDADOS --------------------------------------------------------- */
IF @NRep <> 2
BEGIN
    SELECT 'FRENO - cantidad de replicas inesperada' AS Aviso, * FROM #rep;
    RAISERROR('Se esperaban 2 replicas y hay %d. Cambio algo desde el diagnostico. No se toca nada.', 16, 1, @NRep);
    RETURN;
END

IF ABS(@Repone - @ReponerEsperado) > 0.01
BEGIN
    SELECT 'FRENO - lo que taparon no es lo esperado' AS Aviso, * FROM #rep;
    DECLARE @m1 VARCHAR(300) = 'Las replicas taparon '
        + CONVERT(varchar(20), CAST(@Repone AS decimal(18,2))) + ' y se esperaban '
        + CONVERT(varchar(20), CAST(@ReponerEsperado AS decimal(18,2))) + '. No se toca nada.';
    RAISERROR(@m1, 16, 1);
    RETURN;
END

IF @PendHoy > 0.01
BEGIN
    RAISERROR('La deuda del %s-%s ya tiene importe pendiente. O alguien la repuso a mano, o esto ya corrio. No se toca nada.', 16, 1, @Serie, @Numero);
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.DocumentosContables d
           WHERE d.TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM #rep)
             AND d.CfeEstado = 'ACEPTADO_DGI')
BEGIN
    RAISERROR('Alguna de las replicas tiene un CFE aceptado por DGI. Eso se resuelve con Nota de Credito, no con este script. No se toca nada.', 16, 1);
    RETURN;
END

/* -- VISTA PREVIA -------------------------------------------------------- */
SELECT Paso = 'TRANSACCIONES A ANULAR',
       r.TcaIdTransaccion, r.Recibo, Hora = CONVERT(varchar(8), r.TcaFecha, 108),
       r.PagIdPago, PagoPesos = CAST(r.PagoPesos AS DECIMAL(18,2)),
       EsReplicaDe = r.ReplicaDeRecibo,
       ImputoUSD = CAST(ISNULL((SELECT SUM(ip.ImpImporte) FROM dbo.ImputacionPago ip
                                WHERE ip.PagIdPago = r.PagIdPago), 0) AS DECIMAL(18,2))
FROM #rep r ORDER BY r.TcaFecha;

SELECT Paso = 'RECIBOS A ANULAR',
       Doc = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), d.DocIdDocumento,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocEstado, d.TcaIdTransaccion
FROM dbo.DocumentosContables d
WHERE d.TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM #rep);

SELECT Paso = 'MOVIMIENTOS A ANULAR',
       m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Fecha = CONVERT(varchar(16), m.MovFecha, 120), m.PagIdPago,
       Obs = LEFT(RTRIM(ISNULL(m.MovObservaciones,'')), 70)
FROM dbo.MovimientosCuenta m
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND ( m.PagIdPago IN (SELECT PagIdPago FROM #rep)
     OR m.DocIdDocumento IN (SELECT DocIdDocumento FROM dbo.DocumentosContables
                             WHERE TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM #rep)) );

SELECT Paso = 'LA DEUDA DEL ' + @Serie + '-' + @Numero,
       DDeIdDocumento = @DDe,
       Original    = CAST(@OrigDeuda AS DECIMAL(18,2)),
       PendienteHoy = CAST(@PendHoy AS DECIMAL(18,2)),
       SeRepone     = CAST(@Repone AS DECIMAL(18,2)),
       PendienteQueda = CAST(@PendHoy + @Repone AS DECIMAL(18,2)),
       EstadoQueda = CASE WHEN @PendHoy + @Repone >= @OrigDeuda - 0.01 THEN 'PENDIENTE' ELSE 'PARCIAL' END;

SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda     = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
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

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta aca no se escribio NADA.
   ========================================================================= */

BEGIN TRANSACTION;

    /* 1 . Las transacciones quedan ANULADO */
    UPDATE t
    SET t.TcaEstado         = 'ANULADO',
        t.TcaFechaAnulacion = GETDATE(),
        t.TcaUsuarioAnula   = @Usuario,
        t.TcaObservaciones  = LEFT(ISNULL(t.TcaObservaciones,'') + ' | ANULADO: ' + @Motivo, 500)
    FROM dbo.TransaccionesCaja t
    JOIN #rep r ON r.TcaIdTransaccion = t.TcaIdTransaccion;

    PRINT CONCAT('1) Transacciones anuladas: ', @@ROWCOUNT, ' (tienen que ser 2).');

    /* 2 . Sus pagos quedan ANULADO */
    UPDATE p SET p.PagTipoMovimiento = 'ANULADO'
    FROM dbo.Pagos p JOIN #rep r ON r.PagIdPago = p.PagIdPago;

    PRINT CONCAT('2) Pagos anulados: ', @@ROWCOUNT, '.');

    /* 3 . Los movimientos de cuenta corriente que colgaban de esos pagos */
    UPDATE m SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' | ANULADO_REPLICA_2026-09-09: ' + @Motivo), 500)
    FROM dbo.MovimientosCuenta m
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND ( m.PagIdPago IN (SELECT PagIdPago FROM #rep)
         OR m.DocIdDocumento IN (SELECT DocIdDocumento FROM dbo.DocumentosContables
                                 WHERE TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM #rep)) );

    PRINT CONCAT('3) Movimientos anulados: ', @@ROWCOUNT, '.');

    /* 4 . LA DEUDA VUELVE. Sin esto la factura queda impaga y nadie se entera. */
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = CASE WHEN @PendHoy + @Repone > @OrigDeuda THEN @OrigDeuda
                                   ELSE @PendHoy + @Repone END,
        DDeEstado = CASE
              WHEN (CASE WHEN @PendHoy + @Repone > @OrigDeuda THEN @OrigDeuda ELSE @PendHoy + @Repone END) <= 0.01 THEN 'COBRADO'
              WHEN (CASE WHEN @PendHoy + @Repone > @OrigDeuda THEN @OrigDeuda ELSE @PendHoy + @Repone END) >= @OrigDeuda - 0.01 THEN 'PENDIENTE'
              ELSE 'PARCIAL' END,
        DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' | DEUDA_REPUESTA_2026-09-09: se anularon dos replicas del cobro del 02-09 que'
          + ' habian tapado ' + CONVERT(varchar(20), CAST(@Repone AS decimal(18,2)))
          + ' sin plata atras. Del total ' + CONVERT(varchar(20), CAST(@OrigDeuda AS decimal(18,2)))
          + ' se cobraron de verdad ' + CONVERT(varchar(20), CAST(@OrigDeuda - @Repone AS decimal(18,2)))
          + ' en el recibo RC-000654. Vuelve a figurar en cobranzas.'), 500)
    WHERE DDeIdDocumento = @DDe;

    PRINT CONCAT('4) Deuda repuesta en ', CAST(@Repone AS DECIMAL(18,2)), '.');

    /* 5 . Las imputaciones dejan de existir: el pago que las respaldaba esta anulado */
    DELETE ip FROM dbo.ImputacionPago ip WHERE ip.PagIdPago IN (SELECT PagIdPago FROM #rep);

    PRINT CONCAT('5) Imputaciones borradas: ', @@ROWCOUNT, '.');

    /* 6 . El documento vuelve a estar impago */
    UPDATE dbo.DocumentosContables
    SET DocPagado = 0
    WHERE DocIdDocumento = @Doc
      AND EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
                  WHERE dd.DocIdDocumento = @Doc
                    AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                    AND dd.DDeImportePendiente > 0.01);

    PRINT CONCAT('6) Documento marcado impago: ', @@ROWCOUNT, '.');

    /* 7 . Asientos contables de esas transacciones (estas dos no generaron ninguno) */
    UPDATE dbo.Cont_AsientosCabecera SET AsiEstado = 0
    WHERE TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM #rep)
      AND ISNULL(SysOrigen,'') <> 'CAJA_EGRESOS';

    PRINT CONCAT('7) Asientos anulados: ', @@ROWCOUNT, '.');

    /* 8 . Los recibos de respaldo */
    UPDATE dbo.DocumentosContables SET DocEstado = 'ANULADO'
    WHERE TcaIdTransaccion IN (SELECT TcaIdTransaccion FROM #rep)
      AND ISNULL(DocEstado,'') <> 'ANULADO';

    PRINT CONCAT('8) Recibos anulados: ', @@ROWCOUNT, '.');

    /* 9 . Saldo corrido y saldo guardado, con la formula del backend */
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

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

    PRINT '9) Saldo corrido y saldo guardado recalculados.';

COMMIT TRANSACTION;

/* -- DESPUES ------------------------------------------------------------- */
SELECT Momento = 'DESPUES - la deuda del ' + @Serie + '-' + @Numero,
       dd.DDeIdDocumento,
       Original  = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado, dd.DDeFechaCobro,
       DocPagado = (SELECT DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc),
       Veredicto = CASE WHEN dd.DDeImportePendiente > 0.01 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                        THEN 'COBRABLE: vuelve a figurar en cobranzas'
                        ELSE '>>> NO QUEDO COBRABLE <<<' END
FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = @DDe;

SELECT Momento = 'DESPUES - cuentas', cc.CueIdCuenta,
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

SELECT Momento = 'DESPUES - transacciones del 02-09', t.TcaIdTransaccion,
       Recibo = RTRIM(ISNULL(t.TcaSerieDoc,'')) + '-' + RTRIM(ISNULL(t.TcaNumeroDoc,'')),
       Hora = CONVERT(varchar(8), t.TcaFecha, 108),
       Neto = CAST(t.TcaTotalNeto AS DECIMAL(18,2)), t.TcaEstado
FROM dbo.TransaccionesCaja t
WHERE t.TcaClienteId = @Cli AND t.TcaFecha >= '2026-09-02' AND t.TcaFecha < '2026-09-03'
ORDER BY t.TcaFecha;

DROP TABLE #rep;
