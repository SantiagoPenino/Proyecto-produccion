/* ============================================================================
   PRODUCCIÓN — CR SPORT (CR-755, RUC 87454323)
   Dos arreglos en un solo archivo. Todo por RUC + serie + número: ningún ID local.

   PASO A · PC-2809: el cargo del libro dice 2.121,36 y el documento dice 2.109,61.
            Manda el documento -> se baja el cargo 11,75 y se recalcula el saldo.

   PASO B · PC-3830: tiene 1.814,50 de deuda viva contra un libro que está A FAVOR.
            El saldo a favor cubrió 1.781,83 al crearse la deuda y el sobrante nunca
            se imputó. Se aplica -> deuda en 0. NO agrega ningún movimiento al libro
            mayor: el cargo y el saldo ya están ahí, sumar algo lo descuadraría al
            revés. Solo escribe Pagos + ImputacionPago + baja el pendiente.

   NO SE TOCA (decisión del usuario, 04-09-2026, confirmado con Naty):
     · el AJUSTE_POS de US$ 9.620,62 del 15/06 — el saldo de 25.302,09 es correcto.
     · la cuenta en pesos: sus $3.300,12 son la cobertura automática de la orden
       EMB-4353 (US$ 80,80 tomados de su propia cuenta de dólares el 04/09 13:01).
       Se consumen solos cuando esa orden se facture. Saldo propio real: $0,12.
     · el cruce del 27/07 (-8.531,88 pesos -> +209,32 US$): los pesos eran reales
       (RC-8), en sustancia está bien hecho.

   RESULTADO ESPERADO (medido en la réplica local):
       cuenta 222 US$   25.302,09  ->  25.313,84 a favor
       deuda PC-3830     1.814,50  ->  0 (COBRADO)
       CueSaldoActual de las dos cuentas, recalculado contra el libro.

   Es idempotente: si el cargo ya coincide, o si no queda deuda para aplicar,
   cada paso avisa y no toca nada.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   Para mirar sin escribir: seleccionar desde la línea 1 hasta el "FIN DE LA VISTA
   PREVIA" y correr solo eso. Para aplicar: correr todo el archivo.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ── 0 · DÓNDE ESTOY ─────────────────────────────────────────────────────── */
SELECT Servidor = @@SERVERNAME,
       Base     = DB_NAME(),
       Archivo  = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

DECLARE @Ruc VARCHAR(20) = '87454323';
DECLARE @Usuario INT = 1;          -- usuario que queda en el pago sintético

DECLARE @Cli INT,
        @DocA INT, @CueA INT, @MovA INT, @CargoA DECIMAL(18,4), @EsperadoA DECIMAL(18,4),
        @DocB INT, @CueB INT, @DDeB INT, @MonB INT, @PendB DECIMAL(18,4),
        @SaldoB DECIMAL(18,4), @VivaB DECIMAL(18,4), @ExcesoB DECIMAL(18,4),
        @AplicarB DECIMAL(18,4), @PagB INT, @N INT;

SELECT @Cli = c.CliIdCliente FROM dbo.Clientes c WHERE RTRIM(ISNULL(c.CioRuc,'')) = @Ruc;
IF @Cli IS NULL BEGIN RAISERROR('No hay cliente con RUC %s en esta base.', 16, 1, @Ruc); RETURN; END

/* ── A · PC-2809: resolver el cargo ──────────────────────────────────────── */
SELECT TOP 1 @DocA = d.DocIdDocumento
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '2809'
ORDER BY d.DocIdDocumento DESC;

IF @DocA IS NOT NULL
BEGIN
    SELECT @N = COUNT(*), @MovA = MIN(m.MovIdMovimiento), @CueA = MIN(m.CueIdCuenta),
           @CargoA = ABS(MIN(m.MovImporte))
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento = @DocA
      AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
      AND m.MovImporte < 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

    IF @N <> 1 BEGIN SET @MovA = NULL; PRINT 'PASO A: el cargo del PC-2809 no es un solo movimiento. Se saltea (se resuelve a mano).'; END

    IF @MovA IS NOT NULL
        SELECT @EsperadoA = CASE
                WHEN d.MonIdMoneda = cc.MonIdMoneda THEN d.DocTotal
                WHEN d.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal / d.DocCotizacion
                WHEN d.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal * d.DocCotizacion
                ELSE NULL END
        FROM dbo.DocumentosContables d CROSS JOIN dbo.CuentasCliente cc
        WHERE d.DocIdDocumento = @DocA AND cc.CueIdCuenta = @CueA;

    IF @EsperadoA IS NULL OR ABS(@EsperadoA - @CargoA) <= 0.02
    BEGIN SET @MovA = NULL; PRINT 'PASO A: el cargo del PC-2809 ya coincide con el documento (o no se puede convertir). No se toca.'; END
END
ELSE PRINT 'PASO A: no se encontró el PC-2809 en esta base. Se saltea.';

/* ── B · PC-3830: resolver la deuda y el exceso ──────────────────────────── */
SELECT TOP 1 @DocB = d.DocIdDocumento
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '3830'
ORDER BY d.DocIdDocumento DESC;

IF @DocB IS NOT NULL
BEGIN
    SELECT @N = COUNT(*), @DDeB = MIN(dd.DDeIdDocumento), @CueB = MIN(dd.CueIdCuenta),
           @PendB = MIN(dd.DDeImportePendiente)
    FROM dbo.DeudaDocumento dd
    WHERE dd.DocIdDocumento = @DocB
      AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01;

    IF @N <> 1 BEGIN SET @DDeB = NULL; PRINT 'PASO B: el PC-3830 no tiene exactamente UNA deuda viva. Se saltea.'; END
END
ELSE PRINT 'PASO B: no se encontró el PC-3830 en esta base. Se saltea.';

/* ── VISTA PREVIA ────────────────────────────────────────────────────────── */
SELECT Paso = 'A - PC-2809 (cargo al documento)',
       CueIdCuenta = @CueA, MovIdMovimiento = @MovA,
       CargoLibro = CAST(@CargoA AS DECIMAL(18,2)),
       Esperado   = CAST(@EsperadoA AS DECIMAL(18,2)),
       Diferencia = CAST(@EsperadoA - @CargoA AS DECIMAL(18,2)),
       Accion     = CASE WHEN @MovA IS NULL THEN 'NO SE TOCA' ELSE 'se corrige' END;

SELECT Paso = 'B - PC-3830 (aplicar el saldo a favor)',
       CueIdCuenta = @CueB, DDeIdDocumento = @DDeB,
       PendienteHoy = CAST(@PendB AS DECIMAL(18,2)),
       Accion = CASE WHEN @DDeB IS NULL THEN 'NO SE TOCA' ELSE 'se aplica el exceso' END;

SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
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

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta acá no se escribió NADA. De acá para abajo, escribe.
   ========================================================================= */

BEGIN TRANSACTION;

    /* PASO A */
    IF @MovA IS NOT NULL
    BEGIN
        UPDATE dbo.MovimientosCuenta
        SET MovImporte = -@EsperadoA,
            MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
                ' FIX_CARGO_AL_DOCUMENTO_2026-09-04: el cargo decía ' +
                CONVERT(varchar(20), CAST(@CargoA AS decimal(18,2))) +
                ' y el documento dice ' + CONVERT(varchar(20), CAST(@EsperadoA AS decimal(18,2))) +
                '. Manda el documento.'), 500)
        WHERE MovIdMovimiento = @MovA;
        PRINT CONCAT('PASO A: cargo corregido (', @@ROWCOUNT, ' fila).');

        ;WITH ord AS (
            SELECT m.MovIdMovimiento,
                   run = SUM(m.MovImporte) OVER (ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
            FROM dbo.MovimientosCuenta m
            WHERE m.CueIdCuenta = @CueA AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
        )
        UPDATE m SET m.MovSaldoPosterior = ord.run
        FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;
    END

    /* PASO B — el exceso se mide DESPUÉS de corregir el cargo */
    IF @DDeB IS NOT NULL
    BEGIN
        SELECT @SaldoB = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                 WHERE m.CueIdCuenta = @CueB AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                   AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
               @VivaB  = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                 WHERE dd.CueIdCuenta = @CueB
                   AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                   AND dd.DDeImportePendiente > 0.01), 0),
               @MonB   = (SELECT MonIdMoneda FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueB);

        SET @ExcesoB  = @VivaB - CASE WHEN @SaldoB < 0 THEN -@SaldoB ELSE 0 END;
        SET @AplicarB = CASE WHEN @PendB < @ExcesoB THEN @PendB ELSE @ExcesoB END;

        IF @AplicarB > 0.01
        BEGIN
            INSERT INTO dbo.Pagos
                (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago,
                 PagUsuarioAlta, PagCotizacion, PagMontoConvertido, PagTipoMovimiento)
            VALUES (1, @MonB, @AplicarB, GETDATE(), @Usuario, 1, @AplicarB, 'ANTICIPO_APLICADO');
            SET @PagB = SCOPE_IDENTITY();

            INSERT INTO dbo.ImputacionPago
                (PagIdPago, DDeIdDocumento, CueIdCuenta, ImpImporte, ImpFecha, ImpUsuarioAlta)
            VALUES (@PagB, @DDeB, @CueB, @AplicarB, GETDATE(), @Usuario);

            UPDATE dbo.DeudaDocumento
            SET DDeImportePendiente = CASE WHEN DDeImportePendiente - @AplicarB < 0 THEN 0
                                           ELSE DDeImportePendiente - @AplicarB END,
                DDeEstado           = CASE WHEN DDeImportePendiente - @AplicarB <= 0.01 THEN 'COBRADO' ELSE 'PARCIAL' END,
                DDeFechaCobro       = CASE WHEN DDeImportePendiente - @AplicarB <= 0.01 THEN GETDATE() ELSE DDeFechaCobro END
            WHERE DDeIdDocumento = @DDeB;

            -- Sin deuda viva, el Estado de Cuenta cae a mirar DocumentosContables.DocPagado
            -- (columna distinta): sin esto la pantalla seguiría mostrando el pendiente.
            UPDATE dbo.DocumentosContables
            SET DocPagado = 1
            WHERE DocIdDocumento = @DocB
              AND NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento
                              WHERE DocIdDocumento = @DocB
                                AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                AND DDeImportePendiente > 0.01);

            PRINT CONCAT('PASO B: aplicados ', CONVERT(varchar(20), CAST(@AplicarB AS decimal(18,2))), ' a la deuda del PC-3830.');
        END
        ELSE PRINT 'PASO B: el libro ya respalda la deuda, no hay exceso para aplicar. No se toca.';
    END

    /* Saldo guardado de TODAS las cuentas de dinero del cliente, contra el libro */
    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

COMMIT TRANSACTION;

/* ── DESPUÉS ─────────────────────────────────────────────────────────────── */
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
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
