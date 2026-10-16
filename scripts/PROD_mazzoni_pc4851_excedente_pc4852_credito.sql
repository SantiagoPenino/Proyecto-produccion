/* ============================================================================
   PRODUCCIÓN — GERARDO MAZZONI (CliIdCliente 250, cuenta US$ 381) — 28-09-2026
   PC-4851 (Contado, ANULADO) dejó vivo un "saldo a favor por pago excedente" de
   US$ 1.009,86 que no existe; PC-4852 (Crédito) se dio por pagado con ese saldo.

   SUPUESTO (a confirmar por el usuario): los US$ 1.274,95 del "cobro contado" de
   PC-4851 NO entraron en caja: fue un error de la pre-factura, por eso se anuló
   el PC y se rehizo a crédito. Si la plata SÍ entró, NO correr esto.

   QUÉ PASÓ (mismo mecanismo que PC-3961 el 07-09-2026):
     1. Antes del cierre el cliente tenía US$ 1.009,86 a favor.
     2. Cierre de ciclo -> PC-4851 por 1.274,95 CONTADO. El sistema aplicó solo los
        1.009,86 a favor (deuda pendiente 265,09) pero el modal cobró "contado" los
        1.274,95 completos: PAGO 265,09 + "Saldo a favor por pago excedente" de
        1.009,86 (movimiento ANTICIPO atado al RECIBO del cobro, no al PC).
     3. Se anuló el PC-4851: la anulación revierte lo atado al PC (cargo y PAGO),
        pero NO alcanza al excedente (está atado al recibo) -> quedó un a favor
        fantasma de 1.009,86 (saldo 2.019,72 en vez de 1.009,86).
     4. PC-4852 por 1.274,94 CRÉDITO: se auto-consumió entero con el saldo inflado
        -> "Pagado", sin deuda viva, saldo 744,78 a favor.

   CÓMO DEBE QUEDAR: a favor real 1.009,86 aplicado a PC-4852 -> el cliente DEBE
   265,08 (libro sin ORDEN de la cuenta 381 = -265,08; deuda viva PC-4852 = 265,08).

   QUÉ HACE (mismos pasos que cajaService.anularReciboInterno, acotados):
     1. Transacción de caja del cobro contado de PC-4851 y sus pagos -> ANULADO;
        recibo de ese cobro -> ANULADO; asiento -> AsiEstado 0.
     2. Excedente +1.009,86 -> MovAnulado = 1.
     3. Imputaciones de ese cobro -> borradas (la deuda de PC-4851 ya está cancelada).
     4. PC-4852: la aplicación de saldo a favor baja de 1.274,94 a lo que había de
        verdad (1.009,86); la deuda queda PARCIAL con 265,08; DocPagado = 0.
     5. Recalcula saldo corrido y CueSaldoActual de la cuenta 381.

   Los identificadores se buscan por número de documento y se verifican; si algo
   no coincide, avisa y no toca nada. @SoloVista = 1 (default): muestra y hace
   ROLLBACK. Poner 0 para aplicar. Idempotente. ABRIR DESDE EL DISCO en SSMS.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;

SELECT Servidor = @@SERVERNAME, Base = DB_NAME(), TransaccionesAbiertasEnEstaVentana = @@TRANCOUNT,
       ImplicitTransactions = CASE WHEN (@@OPTIONS & 2) = 2 THEN 1 ELSE 0 END;
IF @@TRANCOUNT > 0 OR (@@OPTIONS & 2) = 2 BEGIN RAISERROR('Esta ventana ya tiene una transacción abierta o IMPLICIT_TRANSACTIONS activado. Ejecutá:  ROLLBACK TRANSACTION;  SET IMPLICIT_TRANSACTIONS OFF;  y volvé a correr el script completo. No se hizo nada.', 16, 1); RETURN; END

/* -- Identificadores ------------------------------------------------------- */
DECLARE @Cli      INT = 250;
DECLARE @Cue      INT = 381;
DECLARE @Usuario  INT = 1;
DECLARE @TotalA   DECIMAL(18,2) = 1274.95;   -- PC-4851 (anulado)
DECLARE @TotalB   DECIMAL(18,2) = 1274.94;   -- PC-4852 (crédito)
DECLARE @Exceso   DECIMAL(18,2) = 1009.86;   -- excedente fantasma
DECLARE @PendEsperado DECIMAL(18,2) = 265.08;

DECLARE @DocA INT, @DocB INT, @Tca INT, @MovExceso INT, @DdeB INT, @ImpB INT, @PagB INT,
        @AFavor DECIMAL(18,4), @NuevoImp DECIMAL(18,4), @Pend DECIMAL(18,4), @Msg VARCHAR(400), @N INT;

SELECT @DocA = DocIdDocumento FROM dbo.DocumentosContables
WHERE CliIdCliente = @Cli AND RTRIM(DocSerie) = 'PC' AND DocNumero = 4851 AND MonIdMoneda = 2 AND ABS(DocTotal - @TotalA) < 0.005;
SELECT @DocB = DocIdDocumento FROM dbo.DocumentosContables
WHERE CliIdCliente = @Cli AND RTRIM(DocSerie) = 'PC' AND DocNumero = 4852 AND MonIdMoneda = 2 AND ABS(DocTotal - @TotalB) < 0.005;

/* -- 1 · Candados ----------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM dbo.Clientes WHERE CliIdCliente = @Cli AND RTRIM(Nombre) LIKE 'Gerardo Mazzoni%')
BEGIN RAISERROR('El cliente %d no es Gerardo Mazzoni. No se toca nada.', 16, 1, @Cli); RETURN; END
IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue AND CliIdCliente = @Cli AND CueTipo = 'DINERO_USD')
BEGIN RAISERROR('La cuenta %d no es la cuenta US$ del cliente %d. No se toca nada.', 16, 1, @Cue, @Cli); RETURN; END
IF @DocA IS NULL BEGIN RAISERROR('No encuentro el PC-4851 de Mazzoni por US$ 1.274,95. No se toca nada.', 16, 1); RETURN; END
IF @DocB IS NULL BEGIN RAISERROR('No encuentro el PC-4852 de Mazzoni por US$ 1.274,94. No se toca nada.', 16, 1); RETURN; END
IF NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocA AND (UPPER(ISNULL(DocEstado,'')) LIKE '%ANUL%' OR UPPER(ISNULL(CfeEstado,'')) LIKE '%ANUL%'))
BEGIN RAISERROR('El PC-4851 (doc %d) no figura anulado. No se toca nada.', 16, 1, @DocA); RETURN; END

-- Cobro contado fantasma: la transacción PAGO_DEUDA cuya observación nombra al PC-4851
SELECT TOP 1 @Tca = TcaIdTransaccion FROM dbo.TransaccionesCaja
WHERE TcaClienteId = @Cli AND TcaTipoDocumento = 'PAGO_DEUDA' AND TcaFecha >= '2026-09-28'
  AND TcaObservaciones LIKE '%Cobro contado de PC-4851%'
ORDER BY TcaIdTransaccion DESC;
IF @Tca IS NULL BEGIN RAISERROR('No encuentro la transacción de caja "Cobro contado de PC-4851". No se toca nada.', 16, 1); RETURN; END

-- Excedente fantasma (atado al recibo del cobro, por eso la anulación del PC no lo alcanzó)
SELECT TOP 1 @MovExceso = MovIdMovimiento FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @Cue AND MovTipo = 'ANTICIPO' AND MovConcepto LIKE 'Saldo a favor por pago excedente%Cobro contado de PC-4851%'
ORDER BY MovIdMovimiento DESC;
IF @MovExceso IS NULL BEGIN RAISERROR('No encuentro el movimiento "Saldo a favor por pago excedente - Cobro contado de PC-4851". No se toca nada.', 16, 1); RETURN; END
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovExceso AND ABS(MovImporte - @Exceso) < 0.01)
BEGIN
    SELECT @Msg = 'El excedente ' + CAST(@MovExceso AS VARCHAR(20)) + ' es de ' + CONVERT(VARCHAR(30), MovImporte) + ', no de 1.009,86. Revisar antes de tocar.' FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovExceso;
    RAISERROR(@Msg, 16, 1); RETURN;
END

-- Deuda de PC-4852 y su aplicación de saldo a favor (Pago sintético ANTICIPO_APLICADO)
SELECT TOP 1 @DdeB = DDeIdDocumento FROM dbo.DeudaDocumento
WHERE DocIdDocumento = @DocB AND CueIdCuenta = @Cue AND ABS(DDeImporteOriginal - @TotalB) < 0.005
  AND DDeEstado NOT IN ('ANULADO','ANULADA')
ORDER BY DDeIdDocumento DESC;
IF @DdeB IS NULL BEGIN RAISERROR('No encuentro la deuda viva/cobrada del PC-4852 por 1.274,94. No se toca nada.', 16, 1); RETURN; END
SELECT @N = COUNT(*) FROM dbo.ImputacionPago WHERE DDeIdDocumento = @DdeB;
IF @N <> 1 BEGIN RAISERROR('La deuda del PC-4852 tiene %d imputaciones (esperaba 1: la aplicación del saldo a favor). Revisar antes de tocar.', 16, 1, @N); RETURN; END
SELECT TOP 1 @ImpB = ip.ImpIdImputacion, @PagB = ip.PagIdPago
FROM dbo.ImputacionPago ip JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE ip.DDeIdDocumento = @DdeB AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND ABS(ip.ImpImporte - @TotalB) < 0.005;
IF @ImpB IS NULL BEGIN RAISERROR('La imputación del PC-4852 no es una aplicación de saldo a favor (ANTICIPO_APLICADO) por 1.274,94. Revisar antes de tocar.', 16, 1); RETURN; END

-- Deuda VIEJA del mismo PC-4852 (la de 1.274,95 de las 14:09, antes de editarlo a crédito):
-- quedó "COBRADA" con otra aplicación de saldo a favor que ya no corresponde. Se anula.
DECLARE @DdeVieja INT;
SELECT @N = COUNT(*) FROM dbo.DeudaDocumento
WHERE DocIdDocumento = @DocB AND DDeIdDocumento <> @DdeB AND DDeEstado NOT IN ('ANULADO','ANULADA');
IF @N > 1 BEGIN RAISERROR('El PC-4852 tiene %d deudas viejas además de la vigente (esperaba 0 o 1). Revisar antes de tocar.', 16, 1, @N); RETURN; END
SELECT TOP 1 @DdeVieja = DDeIdDocumento FROM dbo.DeudaDocumento
WHERE DocIdDocumento = @DocB AND DDeIdDocumento <> @DdeB AND DDeEstado NOT IN ('ANULADO','ANULADA');
IF @DdeVieja IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.ImputacionPago ip JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
                                     WHERE ip.DDeIdDocumento = @DdeVieja AND p.PagTipoMovimiento <> 'ANTICIPO_APLICADO')
BEGIN RAISERROR('La deuda vieja #%d del PC-4852 tiene pagos que no son aplicación de saldo a favor (¿entró plata?). Revisar antes de tocar.', 16, 1, @DdeVieja); RETURN; END

/* -- 2 · Qué hay hoy (vista previa) ---------------------------------------- */
PRINT '-- ANTES --';
SELECT Que = 'Cuenta 381',
       LibroSinOrden = (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
                        WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       CueSaldoActual = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue),
       DeudaViva = (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento WHERE CueIdCuenta = @Cue AND DDeImportePendiente > 0.01),
       DocA = @DocA, DocB = @DocB, Tca = @Tca, MovExceso = @MovExceso, DdeB = @DdeB, ImpB = @ImpB, PagB = @PagB,
       TcaEstado = (SELECT TcaEstado FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca),
       TcaCobrado = (SELECT TcaTotalCobrado FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca),
       ExcesoAnulado = (SELECT ISNULL(MovAnulado,0) FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovExceso),
       DocBPagado = (SELECT DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocB),
       DdeVieja = @DdeVieja;

SELECT Que = 'Movimientos desde 20/09', MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovSaldoPosterior, MovAnulado, MovConcepto, DocIdDocumento, PagIdPago
FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @Cue AND MovFecha >= '2026-09-20' ORDER BY MovFecha, MovIdMovimiento;

SELECT Que = 'Deudas PC-4851 / PC-4852', DDeIdDocumento, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado, DDeFechaCobro
FROM dbo.DeudaDocumento WHERE DocIdDocumento IN (@DocA, @DocB);

/* -- 3 · Cambios ------------------------------------------------------------ */
BEGIN TRANSACTION;

/* 3.1 Cobro contado fantasma: transacción, pagos, recibo y asiento -> anulados */
IF EXISTS (SELECT 1 FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca AND TcaEstado <> 'ANULADO')
BEGIN
    UPDATE dbo.TransaccionesCaja
    SET TcaEstado = 'ANULADO', TcaFechaAnulacion = GETDATE(), TcaUsuarioAnula = @Usuario,
        TcaObservaciones = ISNULL(TcaObservaciones, '') + ' | ANULADO: cobro contado que no correspondía, PC-4851 anulado y rehecho a crédito como PC-4852 (script 28-09-2026)'
    WHERE TcaIdTransaccion = @Tca;
    PRINT '3.1 Transacción de caja #' + CAST(@Tca AS VARCHAR(20)) + ' -> ANULADO.';
END
ELSE PRINT '3.1 La transacción ya estaba anulada.';

UPDATE dbo.Pagos SET PagTipoMovimiento = 'ANULADO' WHERE PagTcaIdTransaccion = @Tca AND PagTipoMovimiento <> 'ANULADO';
PRINT '3.1 Pagos de la transacción -> ANULADO (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';

UPDATE dbo.DocumentosContables SET DocEstado = 'ANULADO'
WHERE TcaIdTransaccion = @Tca AND DocIdDocumento NOT IN (@DocA, @DocB) AND UPPER(ISNULL(DocEstado,'')) NOT LIKE '%ANUL%';
PRINT '3.1 Recibo del cobro -> ANULADO (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';

UPDATE dbo.Cont_AsientosCabecera SET AsiEstado = 0
WHERE TcaIdTransaccion = @Tca AND ISNULL(SysOrigen,'') <> 'CAJA_EGRESOS' AND ISNULL(CAST(AsiEstado AS VARCHAR(20)),'') <> '0';
PRINT '3.1 Asiento(s) de la transacción -> anulado(s) (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';

/* 3.2 Excedente +1.009,86 -> anulado */
UPDATE dbo.MovimientosCuenta
SET MovAnulado = 1,
    MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | ANULADO 28-09-2026: excedente del cobro contado anulado de PC-4851 (TCA ' + CAST(@Tca AS VARCHAR(20)) + ')', 500)
WHERE MovIdMovimiento = @MovExceso AND (MovAnulado IS NULL OR MovAnulado = 0);
PRINT '3.2 Excedente ' + CAST(@MovExceso AS VARCHAR(20)) + ' anulado (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* Cualquier otro movimiento vivo de ese cobro (PAGO atado a sus pagos) también se anula */
UPDATE dbo.MovimientosCuenta SET MovAnulado = 1
WHERE (MovAnulado IS NULL OR MovAnulado = 0) AND CueIdCuenta = @Cue
  AND PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @Tca);
PRINT '3.2 Otros movimientos del cobro anulados (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';

/* 3.3 Imputaciones del cobro anulado (la deuda de PC-4851 ya está cancelada por la anulación) */
DELETE FROM dbo.ImputacionPago WHERE PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @Tca);
PRINT '3.3 Imputaciones del cobro borradas (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';

/* 3.4a Deuda vieja del PC-4852 (versión de las 14:09) -> ANULADO; su pago sintético e imputación fuera */
IF @DdeVieja IS NOT NULL
BEGIN
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0, DDeEstado = 'ANULADO',
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') + ' | ANULADA 28-09-2026: deuda de la versión anterior del PC-4852; la vigente es #' + CAST(@DdeB AS VARCHAR(20))), 200)
    WHERE DDeIdDocumento = @DdeVieja;
    PRINT '3.4a Deuda vieja #' + CAST(@DdeVieja AS VARCHAR(20)) + ' del PC-4852 -> ANULADO.';
    DECLARE @PagosViejos TABLE (PagIdPago INT);
    INSERT INTO @PagosViejos SELECT DISTINCT PagIdPago FROM dbo.ImputacionPago WHERE DDeIdDocumento = @DdeVieja;
    DELETE FROM dbo.ImputacionPago WHERE DDeIdDocumento = @DdeVieja;
    PRINT '3.4a Imputaciones de la deuda vieja borradas (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';
    DELETE p FROM dbo.Pagos p
    WHERE p.PagIdPago IN (SELECT PagIdPago FROM @PagosViejos) AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago i WHERE i.PagIdPago = p.PagIdPago)
      AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WHERE m.PagIdPago = p.PagIdPago)
      AND NOT EXISTS (SELECT 1 FROM dbo.OrdenesDeposito od WHERE od.PagIdPago = p.PagIdPago)
      AND NOT EXISTS (SELECT 1 FROM dbo.OrdenesRetiro orr WHERE orr.PagIdPago = p.PagIdPago);
    PRINT '3.4a Pagos sintéticos de la deuda vieja borrados (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila/s).';
END
ELSE PRINT '3.4a El PC-4852 no tiene deuda vieja viva.';

/* 3.4 PC-4852: la aplicación de saldo a favor baja a lo que había de verdad ANTES del PC-4852
   (libro sin ORDEN hasta justo antes del cargo del PC-4852, ya con el excedente anulado) */
SELECT @AFavor = ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  AND MovIdMovimiento < (SELECT MIN(MovIdMovimiento) FROM dbo.MovimientosCuenta
                         WHERE DocIdDocumento = @DocB AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));
SET @NuevoImp = CASE WHEN @AFavor > 0 THEN (CASE WHEN @AFavor < @TotalB THEN @AFavor ELSE @TotalB END) ELSE 0 END;
SET @Pend = @TotalB - @NuevoImp;
IF ABS(@Pend - @PendEsperado) > 0.01
BEGIN
    ROLLBACK TRANSACTION;
    SET @Msg = 'Con el excedente anulado, el saldo a favor previo al PC-4852 da ' + CONVERT(VARCHAR(30), @AFavor) + ' y la deuda quedaría en ' + CONVERT(VARCHAR(30), @Pend) + ', no en 265,08. Se deshizo todo, no se guardó nada.';
    RAISERROR(@Msg, 16, 1); RETURN;
END

UPDATE dbo.ImputacionPago SET ImpImporte = @NuevoImp WHERE ImpIdImputacion = @ImpB AND ABS(ImpImporte - @NuevoImp) > 0.005;
PRINT '3.4 Imputación #' + CAST(@ImpB AS VARCHAR(20)) + ' -> ' + CONVERT(VARCHAR(30), @NuevoImp) + ' (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';
UPDATE dbo.Pagos SET PagMontoPago = @NuevoImp, PagMontoConvertido = @NuevoImp
WHERE PagIdPago = @PagB AND PagTipoMovimiento = 'ANTICIPO_APLICADO' AND ABS(PagMontoPago - @NuevoImp) > 0.005;
PRINT '3.4 Pago sintético #' + CAST(@PagB AS VARCHAR(20)) + ' -> ' + CONVERT(VARCHAR(30), @NuevoImp) + ' (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';
UPDATE dbo.DeudaDocumento
SET DDeImportePendiente = @Pend, DDeEstado = 'PARCIAL', DDeFechaCobro = NULL,
    DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') + ' | Pendiente repuesto: el saldo a favor real era ' + CONVERT(VARCHAR(30), @NuevoImp) + ' (script 28-09-2026)'), 200)
WHERE DDeIdDocumento = @DdeB AND (ABS(DDeImportePendiente - @Pend) > 0.005 OR DDeEstado <> 'PARCIAL');
PRINT '3.4 Deuda #' + CAST(@DdeB AS VARCHAR(20)) + ' -> PARCIAL, pendiente ' + CONVERT(VARCHAR(30), @Pend) + ' (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';
UPDATE dbo.DocumentosContables SET DocPagado = 0 WHERE DocIdDocumento = @DocB AND ISNULL(DocPagado,0) <> 0;
PRINT '3.4 PC-4852: DocPagado = 0 (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.4b PC-4852: el encabezado quedó con la cuenta 119 (es de OTRO cliente, el 417); la deuda y los
   movimientos están bien en la 381. Se corrige solo si la cuenta actual no es de Mazzoni. */
UPDATE dbo.DocumentosContables SET CueIdCuenta = @Cue
WHERE DocIdDocumento = @DocB AND CueIdCuenta <> @Cue
  AND NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente c WHERE c.CueIdCuenta = dbo.DocumentosContables.CueIdCuenta AND c.CliIdCliente = @Cli);
PRINT '3.4b PC-4852: cuenta del encabezado -> ' + CAST(@Cue AS VARCHAR(20)) + ' (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.5 Recalcular saldo corrido y CueSaldoActual (misma fórmula que recomputarSaldoCuenta) */
;WITH ord AS (
    SELECT MovIdMovimiento,
           SUM(MovImporte) OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
    FROM dbo.MovimientosCuenta
    WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0)
)
UPDATE m SET m.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

UPDATE dbo.CuentasCliente
SET CueSaldoActual = ISNULL((SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
                             WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
WHERE CueIdCuenta = @Cue;
PRINT '3.5 Saldo corrido y CueSaldoActual de la cuenta ' + CAST(@Cue AS VARCHAR(20)) + ' recalculados.';

/* -- 4 · Cómo queda --------------------------------------------------------- */
PRINT '-- DESPUES --';
SELECT Que = 'Cuenta 381 -> esperado libro sin ORDEN -265,08 y deuda viva 265,08 (PC-4852)',
       LibroSinOrden = (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
                        WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       CueSaldoActual = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue),
       DeudaViva = (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento WHERE CueIdCuenta = @Cue AND DDeImportePendiente > 0.01),
       TcaEstado = (SELECT TcaEstado FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca),
       ExcesoAnulado = (SELECT ISNULL(MovAnulado,0) FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovExceso),
       DocBPagado = (SELECT DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocB);

SELECT Que = 'Movimientos desde 20/09', MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovSaldoPosterior, MovAnulado, MovConcepto, DocIdDocumento, PagIdPago
FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @Cue AND MovFecha >= '2026-09-20' ORDER BY MovFecha, MovIdMovimiento;

SELECT Que = 'Deudas PC-4851 / PC-4852', DDeIdDocumento, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado, DDeFechaCobro, DDeObservaciones
FROM dbo.DeudaDocumento WHERE DocIdDocumento IN (@DocA, @DocB);

IF @SoloVista = 1
BEGIN
    ROLLBACK TRANSACTION;
    PRINT '*** VISTA PREVIA: no se guardó nada. Poné @SoloVista = 0 para aplicar. ***';
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT '*** APLICADO. ***';
END
