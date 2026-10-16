/* ============================================================================
   PRODUCCIÓN — GERARDO MAZZONI (CliIdCliente 250, cuenta US$ 381) — PC-3961 (doc 10997)
   El PC-3961 queda A CRÉDITO: el cliente debe 963,57 menos los 8,77 que tenía a
   favor = 954,80. Se anula el cobro contado que no correspondía y lo que dejó.

   SUPUESTO (confirmado por el usuario 07-09-2026): los US$ 963,57 del "cobro contado"
   de las 14:13 NO entraron en caja. Fue un error de la pre-factura que después se
   corrigió pasando el documento a Crédito. Si la plata SÍ entró, NO correr esto.

   QUÉ PASÓ (leído en producción con diag_mazzoni_pc3961_saldo_doble.sql):
     14:13:32  Pre-factura del ciclo 550 -> PC-3961 por US$ 963,57. El cierre aplicó los
               8,77 a favor a la deuda #12706 (Pago sintético #63212 + imputación #3898)
               -> pendiente 954,80.  ESTO ES LO CORRECTO Y SE CONSERVA.
               Después el modal cobró "contado" 963,57 (TCA #10277, Pago #63213):
               imputó 954,80 (#3899) + 8,77 de más (#3900, push duplicado), asentó un
               PAGO +954,80 y un ANTICIPO +8,77 "excedente" (MovId 46988), y dejó el
               asiento contable DEBE Caja 963,57.
     14:16:10  Se editó el PC a CRÉDITO: borró el PAGO (DELETE físico), DocPagado = 0,
               y creó una SEGUNDA deuda #12707 por 963,57 que se auto-consumió con los
               17,54 "a favor" (Pago #63214 + imputación #3901) -> pendiente 946,03.
               Como pago-deuda no estampa el TcaId en el PC, la transacción #10277 y
               su asiento siguieron COBRADO/REGISTRADO.
     Hoy: libro -946,03, deuda viva 946,03 (#12707), #12706 dice COBRADO, caja dice
     que cobró 963,57. Todo eso es el cobro fantasma y su excedente.

   QUÉ HACE (mismos pasos que cajaService.anularReciboInterno, acotados a este caso):
     1. TCA #10277 -> ANULADO; Pago #63213 -> ANULADO.
     2. Excedente 46988 (+8,77) -> MovAnulado = 1.
     3. Borra las imputaciones del cobro anulado (#3899 y #3900).
     4. Deuda #12706 vuelve a PARCIAL con pendiente = 963,57 - 8,77 = 954,80
        (conserva la imputación #3898 del cierre). Frena si no da 954,80.
     5. Deuda #12707 -> ANULADO / 0; borra su Pago sintético #63214 y la imputación #3901.
     6. Doc 10997: DocPagado = 0 (ya está), sin transacción de caja.
     7. Asiento contable de la TCA #10277 -> AsiEstado = 0 (como hace el sistema al anular).
     8. Recalcula MovSaldoPosterior y CueSaldoActual de la cuenta 381 con la fórmula
        del backend (recomputarSaldoCuenta; el SP de prod todavía suma las ORDEN).

   RESULTADO ESPERADO: libro SIN ORDEN de la cuenta 381 = -954,80. Una sola deuda
   viva: PC-3961 por 954,80. Ningún cobro en caja para este PC.

   @SoloVista = 1 (default): muestra todo y hace ROLLBACK. Poner 0 para aplicar.
   Idempotente: cada paso avisa y no repite si ya está hecho.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;

SELECT Servidor = @@SERVERNAME, Base = DB_NAME(), TransaccionesAbiertasEnEstaVentana = @@TRANCOUNT,
       ImplicitTransactions = CASE WHEN (@@OPTIONS & 2) = 2 THEN 1 ELSE 0 END;
-- GUARDIA: no arranca si la ventana ya tiene una transacción abierta o SSMS tiene
-- IMPLICIT_TRANSACTIONS activado (cualquiera de las dos deja transacciones colgadas).
IF @@TRANCOUNT > 0 OR (@@OPTIONS & 2) = 2 BEGIN RAISERROR('Esta ventana ya tiene una transacción abierta o IMPLICIT_TRANSACTIONS activado. Ejecutá:  ROLLBACK TRANSACTION;  SET IMPLICIT_TRANSACTIONS OFF;  y volvé a correr el script completo. No se hizo nada.', 16, 1); RETURN; END -- GUARD_TRANCOUNT

/* -- Identificadores leídos en producción (se verifican abajo) --------------- */
DECLARE @Cli        INT = 250;
DECLARE @Cue        INT = 381;
DECLARE @Doc        INT = 10997;
DECLARE @DdeReal    INT = 12706;   -- deuda del cierre: se conserva, vuelve a 954,80
DECLARE @DdeBogus   INT = 12707;   -- deuda creada por la edición: se anula
DECLARE @Tca        INT = 10277;   -- cobro contado fantasma
DECLARE @PagCobro   INT = 63213;   -- COBRO 963,57 de esa TCA
DECLARE @PagBogus   INT = 63214;   -- ANTICIPO_APLICADO 17,54 de la deuda duplicada
DECLARE @ImpKeep    INT = 3898;    -- 8,77 del cierre sobre #12706: SE CONSERVA
DECLARE @ImpBogus   INT = 3901;    -- 17,54 sobre #12707
DECLARE @MovCargo   INT = 46986;   -- cargo -963,57
DECLARE @MovExceso  INT = 46988;   -- ANTICIPO +8,77 "excedente"
DECLARE @Usuario    INT = 1;       -- sello de anulación (script)

DECLARE @DocTotal DECIMAL(18,4), @N INT, @Pend DECIMAL(18,4), @Msg VARCHAR(400);

/* -- 1 · Candados de identidad (aceptan el estado "antes" y el "después") -- */
IF NOT EXISTS (SELECT 1 FROM dbo.Clientes WHERE CliIdCliente = @Cli AND RTRIM(Nombre) LIKE 'Gerardo Mazzoni%')
BEGIN RAISERROR('El cliente %d no es Gerardo Mazzoni. No se toca nada.', 16, 1, @Cli); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue AND CliIdCliente = @Cli AND CueTipo = 'DINERO_USD')
BEGIN RAISERROR('La cuenta %d no es la cuenta US$ del cliente %d. No se toca nada.', 16, 1, @Cue, @Cli); RETURN; END

SELECT @DocTotal = DocTotal
FROM dbo.DocumentosContables
WHERE DocIdDocumento = @Doc AND CliIdCliente = @Cli AND MonIdMoneda = 2
  AND RTRIM(DocSerie) = 'PC' AND ABS(DocTotal - 963.57) < 0.005;
IF @DocTotal IS NULL
BEGIN RAISERROR('El doc %d no es el PC-3961 de Mazzoni por 963,57 en US$. No se toca nada.', 16, 1, @Doc); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento
               WHERE DDeIdDocumento = @DdeReal AND DocIdDocumento = @Doc AND CueIdCuenta = @Cue
                 AND ABS(DDeImporteOriginal - @DocTotal) < 0.005 AND DDeEstado IN ('COBRADO','PARCIAL','PENDIENTE'))
BEGIN RAISERROR('La deuda #%d no es la deuda del cierre (963,57) del doc %d. No se toca nada.', 16, 1, @DdeReal, @Doc); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
               WHERE ip.ImpIdImputacion = @ImpKeep AND ip.DDeIdDocumento = @DdeReal
                 AND ABS(ip.ImpImporte - 8.77) < 0.005 AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO')
BEGIN RAISERROR('La imputación #%d no es la aplicación de los 8,77 a favor hecha por el cierre. No se toca nada.', 16, 1, @ImpKeep); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.TransaccionesCaja
               WHERE TcaIdTransaccion = @Tca AND TcaClienteId = @Cli AND TcaTipoDocumento = 'PAGO_DEUDA'
                 AND ABS(TcaTotalCobrado - 963.57) < 0.005 AND TcaEstado IN ('COBRADO','ANULADO'))
BEGIN RAISERROR('La transacción %d no es el cobro contado de 963,57 de Mazzoni. No se toca nada.', 16, 1, @Tca); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.Pagos
               WHERE PagIdPago = @PagCobro AND PagTcaIdTransaccion = @Tca
                 AND ABS(PagMontoPago - 963.57) < 0.005 AND PagTipoMovimiento IN ('COBRO','ANULADO'))
BEGIN RAISERROR('El Pago #%d no es el COBRO de 963,57 de la transacción %d. No se toca nada.', 16, 1, @PagCobro, @Tca); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
               WHERE MovIdMovimiento = @MovCargo AND CueIdCuenta = @Cue AND DocIdDocumento = @Doc
                 AND MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO') AND ABS(MovImporte + @DocTotal) < 0.005
                 AND (MovAnulado IS NULL OR MovAnulado = 0))
BEGIN RAISERROR('El movimiento %d no es el cargo vivo de -963,57 del doc %d. No se toca nada.', 16, 1, @MovCargo, @Doc); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
               WHERE MovIdMovimiento = @MovExceso AND CueIdCuenta = @Cue AND MovTipo = 'ANTICIPO'
                 AND ABS(MovImporte - 8.77) < 0.005 AND MovConcepto LIKE 'Saldo a favor por pago excedente%')
BEGIN RAISERROR('El movimiento %d no es el excedente de +8,77. No se toca nada.', 16, 1, @MovExceso); RETURN; END

/* -- 2 · Qué hay hoy (vista previa) ---------------------------------------- */
PRINT '-- ANTES --';
SELECT Que = 'Cuenta 381 / doc / caja',
       LibroSinOrden = (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
                        WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       CueSaldoActual = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue),
       DeudaViva = (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento WHERE CueIdCuenta = @Cue AND DDeImportePendiente > 0.01),
       DocPagado = (SELECT DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc),
       TcaEstado = (SELECT TcaEstado FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca),
       PagoTipo  = (SELECT PagTipoMovimiento FROM dbo.Pagos WHERE PagIdPago = @PagCobro),
       ExcesoAnulado = (SELECT ISNULL(MovAnulado,0) FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovExceso),
       Asientos = (SELECT STRING_AGG(CAST(AsiId AS VARCHAR(20)) + ':' + ISNULL(CAST(AsiEstado AS VARCHAR(20)),''), ', ')
                   FROM dbo.Cont_AsientosCabecera WHERE TcaIdTransaccion = @Tca);

SELECT Que = 'Deudas del doc', DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado, DDeFechaCobro, DDeObservaciones
FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;

SELECT Que = 'Imputaciones', ip.ImpIdImputacion, ip.DDeIdDocumento, ip.PagIdPago, p.PagTipoMovimiento, p.PagTcaIdTransaccion, ip.ImpImporte
FROM dbo.ImputacionPago ip JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE ip.DDeIdDocumento IN (@DdeReal, @DdeBogus) ORDER BY ip.ImpIdImputacion;

/* -- 3 · Cambios ------------------------------------------------------------ */
BEGIN TRANSACTION;

/* 3.1 Transacción de caja y su pago -> ANULADO */
IF EXISTS (SELECT 1 FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca AND TcaEstado <> 'ANULADO')
BEGIN
    UPDATE dbo.TransaccionesCaja
    SET TcaEstado = 'ANULADO', TcaFechaAnulacion = GETDATE(), TcaUsuarioAnula = @Usuario,
        TcaObservaciones = ISNULL(TcaObservaciones, '') + ' | ANULADO: cobro contado que no correspondía, el PC-3961 quedó a crédito (script 07-09-2026)'
    WHERE TcaIdTransaccion = @Tca;
    PRINT '3.1 Transacción de caja #' + CAST(@Tca AS VARCHAR(20)) + ' -> ANULADO.';
END
ELSE PRINT '3.1 La transacción ya estaba anulada.';

UPDATE dbo.Pagos SET PagTipoMovimiento = 'ANULADO'
WHERE PagTcaIdTransaccion = @Tca AND PagTipoMovimiento <> 'ANULADO';
PRINT '3.1 Pagos de la transacción -> ANULADO (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.2 Excedente +8,77 -> anulado */
UPDATE dbo.MovimientosCuenta
SET MovAnulado = 1,
    MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | ANULADO 07-09-2026: excedente del cobro contado anulado (TCA ' + CAST(@Tca AS VARCHAR(20)) + ')', 500)
WHERE MovIdMovimiento = @MovExceso AND (MovAnulado IS NULL OR MovAnulado = 0);
PRINT '3.2 Excedente ' + CAST(@MovExceso AS VARCHAR(20)) + ' anulado (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.3 Imputaciones del cobro anulado (954,80 + 8,77 duplicado) */
DELETE FROM dbo.ImputacionPago WHERE PagIdPago = @PagCobro;
PRINT '3.3 Imputaciones del Pago #' + CAST(@PagCobro AS VARCHAR(20)) + ' borradas (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.4 La deuda del cierre vuelve a deber: original - lo que sigue imputado (los 8,77) */
SELECT @Pend = @DocTotal - ISNULL((SELECT SUM(ImpImporte) FROM dbo.ImputacionPago WHERE DDeIdDocumento = @DdeReal), 0);
IF ABS(@Pend - 954.80) > 0.005
BEGIN
    -- RAISERROR NO respeta XACT_ABORT: sin este ROLLBACK explícito la transacción quedaba
    -- abierta en la ventana de SSMS (con las filas de Mazzoni bloqueadas) después del RETURN.
    ROLLBACK TRANSACTION;
    SET @Msg = 'La deuda #' + CAST(@DdeReal AS VARCHAR(20)) + ' quedaría en ' + CONVERT(VARCHAR(30), @Pend) + ' y no en 954,80. Se deshizo todo, no se guardó nada.';
    RAISERROR(@Msg, 16, 1);
    RETURN;
END

UPDATE dbo.DeudaDocumento
SET DDeImportePendiente = @Pend,
    DDeEstado = 'PARCIAL',
    DDeFechaCobro = NULL,
    DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') + ' | Deuda repuesta al anular el cobro contado (TCA ' + CAST(@Tca AS VARCHAR(20)) + '), script 07-09-2026'), 200)
WHERE DDeIdDocumento = @DdeReal AND (ABS(DDeImportePendiente - @Pend) > 0.005 OR DDeEstado <> 'PARCIAL');
PRINT '3.4 Deuda #' + CAST(@DdeReal AS VARCHAR(20)) + ' -> PARCIAL, pendiente ' + CONVERT(VARCHAR(30), @Pend) + ' (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.5 Deuda duplicada -> ANULADO; su pago sintético e imputación fuera */
IF EXISTS (SELECT 1 FROM dbo.DeudaDocumento
           WHERE DDeIdDocumento = @DdeBogus AND DocIdDocumento = @Doc AND DDeIdDocumento <> @DdeReal
             AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
BEGIN
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0, DDeEstado = 'ANULADO',
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') + ' | ANULADA 07-09-2026: duplicada por la edición Contado a Crédito; la deuda real es #' + CAST(@DdeReal AS VARCHAR(20))), 200)
    WHERE DDeIdDocumento = @DdeBogus;
    PRINT '3.5 Deuda duplicada #' + CAST(@DdeBogus AS VARCHAR(20)) + ' -> ANULADO.';
END
ELSE PRINT '3.5 La deuda duplicada ya no está viva.';

DELETE FROM dbo.ImputacionPago WHERE ImpIdImputacion = @ImpBogus AND DDeIdDocumento = @DdeBogus AND PagIdPago = @PagBogus;
PRINT '3.5 Imputación #' + CAST(@ImpBogus AS VARCHAR(20)) + ' borrada (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

IF EXISTS (SELECT 1 FROM dbo.Pagos WHERE PagIdPago = @PagBogus AND PagTipoMovimiento = 'ANTICIPO_APLICADO' AND PagTcaIdTransaccion IS NULL AND ABS(PagMontoPago - 17.54) < 0.005)
   AND NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago WHERE PagIdPago = @PagBogus)
   AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE PagIdPago = @PagBogus)
   AND NOT EXISTS (SELECT 1 FROM dbo.OrdenesDeposito WHERE PagIdPago = @PagBogus)
   AND NOT EXISTS (SELECT 1 FROM dbo.OrdenesRetiro WHERE PagIdPago = @PagBogus)
BEGIN
    DELETE FROM dbo.Pagos WHERE PagIdPago = @PagBogus;
    PRINT '3.5 Pago sintético #' + CAST(@PagBogus AS VARCHAR(20)) + ' (ANTICIPO_APLICADO 17,54) borrado.';
END

/* 3.6 Documento: impago y sin transacción de caja */
UPDATE dbo.DocumentosContables
SET DocPagado = 0, TcaIdTransaccion = NULL
WHERE DocIdDocumento = @Doc AND (ISNULL(DocPagado,0) <> 0 OR TcaIdTransaccion IS NOT NULL);
PRINT '3.6 Doc: DocPagado = 0, sin TcaId (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.7 Asiento contable del cobro -> anulado (igual que anularReciboInterno) */
UPDATE dbo.Cont_AsientosCabecera
SET AsiEstado = 0
WHERE TcaIdTransaccion = @Tca AND ISNULL(SysOrigen,'') <> 'CAJA_EGRESOS'
  AND ISNULL(CAST(AsiEstado AS VARCHAR(20)),'') <> '0';
PRINT '3.7 Asiento(s) de la TCA -> anulado(s) (' + CAST(@@ROWCOUNT AS VARCHAR(5)) + ' fila).';

/* 3.8 Recalcular saldo corrido y CueSaldoActual (misma fórmula que recomputarSaldoCuenta) */
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
PRINT '3.8 Saldo corrido y CueSaldoActual de la cuenta ' + CAST(@Cue AS VARCHAR(20)) + ' recalculados.';

/* -- 4 · Cómo queda --------------------------------------------------------- */
PRINT '-- DESPUES --';
SELECT Que = 'Cuenta 381 / doc / caja  -> esperado libro -954,80 y deuda viva 954,80',
       LibroSinOrden = (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
                        WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       CueSaldoActual = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue),
       DeudaViva = (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento WHERE CueIdCuenta = @Cue AND DDeImportePendiente > 0.01),
       DocPagado = (SELECT DocPagado FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc),
       TcaEstado = (SELECT TcaEstado FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca),
       PagoTipo  = (SELECT PagTipoMovimiento FROM dbo.Pagos WHERE PagIdPago = @PagCobro),
       ExcesoAnulado = (SELECT ISNULL(MovAnulado,0) FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovExceso),
       ImputadoDeudaReal = (SELECT ISNULL(SUM(ImpImporte),0) FROM dbo.ImputacionPago WHERE DDeIdDocumento = @DdeReal),
       Asientos = (SELECT STRING_AGG(CAST(AsiId AS VARCHAR(20)) + ':' + ISNULL(CAST(AsiEstado AS VARCHAR(20)),''), ', ')
                   FROM dbo.Cont_AsientosCabecera WHERE TcaIdTransaccion = @Tca);

SELECT Que = 'Movimientos 07/09 cuenta 381', MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovSaldoPosterior, MovAnulado, MovConcepto, DocIdDocumento, PagIdPago
FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @Cue AND MovFecha >= '2026-09-07'
ORDER BY MovFecha, MovIdMovimiento;

SELECT Que = 'Deudas del doc', DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado, DDeFechaCobro, DDeObservaciones
FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;

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
