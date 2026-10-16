/* =====================================================================================
   PASO 2 de 2 — APLICAR la corrección del anticipo RA-18 (Gerardo Mazzoni, cliente 250)
   Base: SecureAppDB (PRODUCCIÓN).

   Corré ra18_1_verificar.sql ANTES. Este script escribe y hace COMMIT solo: abre la
   transacción, valida, escribe y cierra de una. No se queda esperando que confirmes,
   así que no deja nada bloqueado. Si algo no cumple, revierte solo y dice por qué.
   Se puede correr una sola vez: la segunda aborta sola.

   ┌─ ÚNICA DECISIÓN QUE TENÉS QUE TOMAR ────────────────────────────────────────┐
   │  @Imputar = 0  → el anticipo queda como saldo a favor, las deudas siguen     │
   │                  vivas. (HABER del asiento: Anticipos de Clientes 2.3.1)     │
   │  @Imputar = 1  → los US$ 3.000 cancelan las deudas en US$ del cliente por    │
   │                  antigüedad. (HABER: Deudores por Ventas ME 1.2.2)           │
   │  Está abajo, en el bloque de variables. Ver la nota al final del archivo.    │
   └─────────────────────────────────────────────────────────────────────────────┘

   QUÉ HACE:
     · Recibo RA-18 y transacción → US$, y la transacción pasa a CAJA ADMINISTRATIVA
       (EsCajaAdmin = 1 + StuIdSesion = NULL: el cierre suma por sesión sin mirar la
       bandera, así que van las dos cosas).
     · El pago único de 3.000 se parte en 3 pagos de US$ 1.000, uno por cheque, amarrados.
     · El saldo se muda de la cuenta en pesos (2204) a la cuenta en dólares (381).
     · Contabilidad: contra-asiento del 19300 + asiento nuevo al TC, con el DEBE en
       VALORES A DEPOSITAR (1.1.5) y NO en Caja: se cobró con cheques y los cheques
       siguen en cartera, todavía no son plata en la caja. El asiento original los había
       mandado a Caja en pesos (1.1.1) — mal por partida doble.
     · Los 3 cheques quedan asignados al cliente 250.
   ===================================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- ⇩⇩ LA DECISIÓN ⇩⇩
DECLARE @Imputar BIT = 1;      -- 0 = queda como saldo a favor | 1 = cancela las deudas en US$

DECLARE @Doc    INT = 6090, @Tca INT = 5771, @Pago INT = 55440, @Mov INT = 26840;
DECLARE @CueUYU INT = 2204, @CueUSD INT = 381, @AsiMal INT = 19300;
DECLARE @Cli    INT = 250,  @Usr INT = 70;
DECLARE @Monto  DECIMAL(18,4) = 3000.00;
DECLARE @TC     DECIMAL(18,4) = (SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WHERE CotFecha = '2026-07-30');
DECLARE @Err    NVARCHAR(400) = NULL;

/* ── Precondiciones (fuera de la transacción: no bloquean) ───────────────────── */
IF @TC IS NULL OR @TC <= 1
  SET @Err = 'No hay cotización del 30/07/2026 en dbo.Cotizaciones. Cargala o poné @TC a mano.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc AND MonIdMoneda = 1)
  SET @Err = 'El documento 6090 no está en pesos: o ya se corrigió, o no es el que creemos.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca AND TcaMonedaBase = 'UYU')
  SET @Err = 'La transacción 5771 no está en UYU: probablemente ya se corrigió.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.Pagos WHERE PagIdPago = @Pago AND PagIdMonedaPago = 1 AND PagMontoPago = 3000)
  SET @Err = 'El pago 55440 no es el de $ 3.000 en moneda 1: revisá antes de seguir.';
ELSE IF (SELECT COUNT(*) FROM dbo.Pagos WHERE PagTcaIdTransaccion = @Tca) <> 1
  SET @Err = 'La transacción 5771 ya no tiene un solo pago: puede que el script ya se haya corrido.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Mov AND CueIdCuenta = @CueUYU AND ISNULL(MovAnulado,0) = 0)
  SET @Err = 'El movimiento 26840 no está vivo en la cuenta 2204.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUSD AND CueTipo = 'DINERO_USD')
  SET @Err = 'No existe la cuenta 381 DINERO_USD del cliente.';
ELSE IF (SELECT COUNT(*) FROM dbo.Cont_AsientosDetalle WHERE AsiId = @AsiMal) < 2
  SET @Err = 'El asiento 19300 no tiene las 2 líneas esperadas.';
ELSE IF (SELECT COUNT(*) FROM dbo.TesoreriaCheques WHERE NumeroCheque IN ('177807','177808','177809') AND IdMoneda = 2) <> 3
  SET @Err = 'No están los 3 cheques en US$ (177807/808/809).';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '1.1.5')
     OR NOT EXISTS (SELECT 1 FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '2.3.1')
     OR NOT EXISTS (SELECT 1 FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '1.2.2')
  SET @Err = 'Falta en el plan la 1.1.5 (Valores a Depositar), la 1.2.2 (Deudores ME) o la 2.3.1 (Anticipos).';

IF @Err IS NOT NULL
BEGIN
  RAISERROR('ABORTADO — %s', 16, 1, @Err);
  RETURN;
END

DECLARE @MontoUYU  DECIMAL(18,2) = ROUND(@Monto * @TC, 2);
DECLARE @SaldoUYU0 DECIMAL(18,4) = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUYU);
DECLARE @SaldoUSD0 DECIMAL(18,4) = (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUSD);
DECLARE @Ch1 INT = (SELECT IdCheque FROM dbo.TesoreriaCheques WHERE NumeroCheque = '177807');
DECLARE @CueValores   INT = (SELECT CueId FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '1.1.5');
DECLARE @CueDeudores  INT = (SELECT CueId FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '1.2.2');
DECLARE @CueAnticipos INT = (SELECT CueId FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '2.3.1');
DECLARE @AsiRev INT, @AsiOk INT;
DECLARE @Imputado DECIMAL(18,4) = 0, @Remanente DECIMAL(18,4) = @Monto;
DECLARE @Aplicaciones TABLE (DdeId INT, DocId INT, Pendiente DECIMAL(18,4), Aplicar DECIMAL(18,4));

PRINT CONCAT('TC ', @TC, ' -> US$ ', @Monto, ' = $ ', @MontoUYU, '   |   Imputar deudas: ', @Imputar);

BEGIN TRY
  BEGIN TRAN;

    /* 1 — Recibo a dólares */
    UPDATE dbo.DocumentosContables
    SET    MonIdMoneda      = 2,
           DocObservaciones = LEFT(ISNULL(DocObservaciones,'') + ' [CORREGIDO A US$ - TC ' + CONVERT(varchar(20), @TC) + ']', 200)
    WHERE  DocIdDocumento = @Doc;

    /* 2 — Transacción: dólares + CAJA ADMINISTRATIVA */
    UPDATE dbo.TransaccionesCaja
    SET    TcaMonedaBase    = 'USD',
           EsCajaAdmin      = 1,
           StuIdSesion      = NULL,
           TcaObservaciones = LEFT(ISNULL(TcaObservaciones,'') + ' [RECLASIFICADO A CAJA ADMINISTRATIVA]', 500)
    WHERE  TcaIdTransaccion = @Tca;

    /* 3 — Un pago por cheque, en US$ y al TC */
    UPDATE dbo.Pagos
    SET    PagIdMonedaPago    = 2,
           PagMontoPago       = 1000.00,
           PagCotizacion      = @TC,
           PagMontoConvertido = ROUND(1000.00 * @TC, 2),
           PagIdCheque        = @Ch1
    WHERE  PagIdPago = @Pago;

    INSERT INTO dbo.Pagos (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago,
                           PagFechaPago, PagUsuarioAlta, PagCotizacion, PagMontoConvertido,
                           PagTipoMovimiento, PagIdCheque)
    SELECT p.PagTcaIdTransaccion, p.MPaIdMetodoPago, 2, 1000.00,
           p.PagFechaPago, p.PagUsuarioAlta, @TC, ROUND(1000.00 * @TC, 2),
           p.PagTipoMovimiento, ch.IdCheque
    FROM   dbo.Pagos p
    CROSS  JOIN dbo.TesoreriaCheques ch
    WHERE  p.PagIdPago = @Pago AND ch.NumeroCheque IN ('177808','177809');

    /* 4 — El saldo se muda a la cuenta en dólares */
    UPDATE dbo.MovimientosCuenta
    SET    CueIdCuenta      = @CueUSD,
           MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' [CORREGIDO: estaba en la cuenta en pesos]', 500)
    WHERE  MovIdMovimiento = @Mov;

    UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Monto WHERE CueIdCuenta = @CueUYU;
    UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Monto WHERE CueIdCuenta = @CueUSD;

    /* 5 — (opcional) Imputar el anticipo a las deudas en US$, más viejas primero ── */
    IF @Imputar = 1
    BEGIN
      ;WITH d AS (
        SELECT DDeIdDocumento, DocIdDocumento, DDeImportePendiente,
               SUM(DDeImportePendiente) OVER (ORDER BY DDeFechaEmision, DDeIdDocumento
                                              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS Acum
        FROM   dbo.DeudaDocumento
        WHERE  CueIdCuenta = @CueUSD
          AND  DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
          AND  DDeImportePendiente > 0
      )
      INSERT INTO @Aplicaciones (DdeId, DocId, Pendiente, Aplicar)
      SELECT DDeIdDocumento, DocIdDocumento, DDeImportePendiente,
             CASE WHEN Acum <= @Monto THEN DDeImportePendiente
                  WHEN Acum - DDeImportePendiente < @Monto THEN @Monto - (Acum - DDeImportePendiente)
                  ELSE 0 END
      FROM   d;

      DELETE FROM @Aplicaciones WHERE Aplicar <= 0.009;
      SELECT @Imputado = ISNULL(SUM(Aplicar), 0) FROM @Aplicaciones;
      SET @Remanente = @Monto - @Imputado;

      UPDATE dd
      SET    dd.DDeImportePendiente = dd.DDeImportePendiente - a.Aplicar,
             dd.DDeEstado  = CASE WHEN dd.DDeImportePendiente - a.Aplicar < 0.01 THEN 'COBRADO' ELSE 'PARCIAL' END,
             dd.DDeFechaCobro = CASE WHEN dd.DDeImportePendiente - a.Aplicar < 0.01 THEN GETDATE() ELSE dd.DDeFechaCobro END
      FROM   dbo.DeudaDocumento dd
      JOIN   @Aplicaciones a ON a.DdeId = dd.DDeIdDocumento;

      UPDATE doc
      SET    doc.DocPagado = 1
      FROM   dbo.DocumentosContables doc
      JOIN   @Aplicaciones a ON a.DocId = doc.DocIdDocumento
      JOIN   dbo.DeudaDocumento dd ON dd.DDeIdDocumento = a.DdeId
      WHERE  dd.DDeEstado = 'COBRADO';
    END

    /* 6a — Contra-asiento del 19300 (la contabilidad no se corrige editando el viejo) */
    INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, UsuarioId, TcaIdTransaccion, SysOrigen, AsiEstado)
    VALUES (GETDATE(), CONCAT('ANULACIÓN asiento ', @AsiMal, ' - Anticipo #', @Cli, ' registrado en $ y en Caja siendo US$ en cheques'), @Usr, @Tca, 'ANTICIPO', 'REGISTRADO');
    SET @AsiRev = SCOPE_IDENTITY();

    INSERT INTO dbo.Cont_AsientosDetalle (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
    SELECT @AsiRev, d.CueId, d.DetHaberUYU, d.DetDebeUYU, d.DetImporteOriginal, d.DetCotizacion, d.DetMonedaId, d.DetEntidadId, d.DetEntidadTipo
    FROM   dbo.Cont_AsientosDetalle d WHERE d.AsiId = @AsiMal;

    /* 6b — Asiento correcto:
            DEBE  1.1.5 Valores a Depositar  (son cheques en cartera, no plata en caja)
            HABER 1.2.2 Deudores ME          por lo que cancela deuda
            HABER 2.3.1 Anticipos            por lo que queda a favor                      */
    INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, UsuarioId, TcaIdTransaccion, SysOrigen, AsiEstado)
    VALUES (GETDATE(), CONCAT('Anticipo #', @Cli, ' - PAGO ANTICIPADO en cheques (corregido: US$ ', @Monto, ' TC ', @TC, ')'), @Usr, @Tca, 'ANTICIPO', 'REGISTRADO');
    SET @AsiOk = SCOPE_IDENTITY();

    INSERT INTO dbo.Cont_AsientosDetalle (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
    VALUES (@AsiOk, @CueValores, @MontoUYU, 0, @Monto, @TC, 2, @Cli, 'CLIENTE');

    IF @Imputado > 0.009
      INSERT INTO dbo.Cont_AsientosDetalle (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
      VALUES (@AsiOk, @CueDeudores, 0, ROUND(@Imputado * @TC, 2), @Imputado, @TC, 2, @Cli, 'CLIENTE');

    IF @Remanente > 0.009
      INSERT INTO dbo.Cont_AsientosDetalle (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
      VALUES (@AsiOk, @CueAnticipos, 0, @MontoUYU - ROUND(@Imputado * @TC, 2), @Remanente, @TC, 2, @Cli, 'CLIENTE');

    /* 7 — Los cheques quedan con el cliente que los entregó */
    UPDATE dbo.TesoreriaCheques
    SET    IdClienteOrigen = @Cli
    WHERE  NumeroCheque IN ('177807','177808','177809') AND IdClienteOrigen IS NULL;

    /* 8 — Control final. Si algo no cuadra, no se confirma nada. */
    IF (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUYU) <> @SaldoUYU0 - @Monto
       SET @Err = 'El saldo de la cuenta en pesos no quedó como se esperaba.';
    ELSE IF (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUSD) <> @SaldoUSD0 + @Monto
       SET @Err = 'El saldo de la cuenta en dólares no quedó como se esperaba.';
    ELSE IF (SELECT SUM(PagMontoPago) FROM dbo.Pagos WHERE PagTcaIdTransaccion = @Tca) <> @Monto
       SET @Err = 'Los 3 pagos no suman US$ 3.000.';
    ELSE IF EXISTS (SELECT 1 FROM dbo.Pagos WHERE PagTcaIdTransaccion = @Tca AND PagIdCheque IS NULL)
       SET @Err = 'Quedó algún pago sin cheque amarrado.';
    ELSE IF @Imputado + @Remanente <> @Monto
       SET @Err = 'Lo imputado más el remanente no da US$ 3.000.';
    ELSE IF (SELECT SUM(DetDebeUYU) - SUM(DetHaberUYU) FROM dbo.Cont_AsientosDetalle WHERE AsiId IN (@AsiRev, @AsiOk)) <> 0
       SET @Err = 'Los asientos nuevos no cuadran (debe <> haber).';

    IF @Err IS NOT NULL
    BEGIN
      ROLLBACK TRAN;
      RAISERROR('ABORTADO Y REVERTIDO — %s', 16, 1, @Err);
      RETURN;
    END

  COMMIT TRAN;
  PRINT CONCAT('OK. Contra-asiento ', @AsiRev, ' + asiento correcto ', @AsiOk,
               '. Imputado a deudas: US$ ', @Imputado, ' | queda a favor: US$ ', @Remanente, '.');
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRAN;
  DECLARE @M NVARCHAR(2000) = ERROR_MESSAGE();
  RAISERROR('ERROR — no se aplicó nada: %s', 16, 1, @M);
  RETURN;
END CATCH
GO


/* =====================================================================================
   CONTROL POSTERIOR — ya con el COMMIT hecho, no bloquea nada.
   ===================================================================================== */
SELECT 'DOCUMENTO' AS Tabla, DocSerie + '-' + DocNumero AS Doc, DocTotal, MonIdMoneda
FROM dbo.DocumentosContables WHERE DocIdDocumento = 6090;                 -- MonIdMoneda = 2

SELECT 'TRANSACCION' AS Tabla, TcaIdTransaccion, TcaTotalNeto, TcaMonedaBase, EsCajaAdmin, StuIdSesion
FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = 5771;                 -- USD / 1 / NULL

SELECT 'PAGOS' AS Tabla, p.PagIdPago, p.PagMontoPago, p.PagIdMonedaPago, p.PagCotizacion,
       p.PagMontoConvertido, ch.NumeroCheque
FROM dbo.Pagos p LEFT JOIN dbo.TesoreriaCheques ch ON ch.IdCheque = p.PagIdCheque
WHERE p.PagTcaIdTransaccion = 5771;                                      -- 3 × US$ 1.000

SELECT 'CUENTAS' AS Tabla, CueIdCuenta, CueTipo, MonIdMoneda, CueSaldoActual
FROM dbo.CuentasCliente WHERE CueIdCuenta IN (2204, 381);                 -- 0,00  |  -13.362,64

SELECT 'DEUDAS US$' AS Tabla, DDeIdDocumento, DocIdDocumento, DDeImporteOriginal,
       DDeImportePendiente, DDeEstado, DDeFechaEmision
FROM dbo.DeudaDocumento WHERE CueIdCuenta = 381 ORDER BY DDeFechaEmision;

SELECT 'ASIENTOS' AS Tabla, a.AsiId, a.AsiConcepto, pc.CueCodigo, pc.CueNombre,
       d.DetDebeUYU, d.DetHaberUYU, d.DetCotizacion, d.DetMonedaId
FROM dbo.Cont_AsientosCabecera a
JOIN dbo.Cont_AsientosDetalle  d  ON d.AsiId = a.AsiId
JOIN dbo.Cont_PlanCuentas      pc ON pc.CueId = d.CueId
WHERE a.TcaIdTransaccion = 5771 ORDER BY a.AsiId, pc.CueCodigo;

SELECT 'CHEQUES' AS Tabla, IdCheque, NumeroCheque, Monto, IdMoneda, IdClienteOrigen, Estado
FROM dbo.TesoreriaCheques WHERE NumeroCheque IN ('177807','177808','177809');


/* =====================================================================================
   NOTA SOBRE @Imputar
   -----------------------------------------------------------------------------
   Con @Imputar = 1 se cancelan, de la más vieja a la más nueva, las deudas en US$ de
   la cuenta 381 (PENDIENTE / PARCIAL / VENCIDO) hasta agotar los US$ 3.000:

       3411  26/06  605,57 → cancelada
       5911  13/07  528,98 → cancelada
       6928  17/07  450,92 → cancelada
       8130  27/07  798,57 → cancelada
       8132  27/07  859,05 → parcial, quedan US$ 243,44
       ------------------------------------------------
       imputado US$ 3.000,00   |   saldo a favor US$ 0,00

   Ojo con un detalle: la imputación automática del propio sistema
   (registrarPagoAnticipo) solo mira DDeEstado IN ('PENDIENTE','PARCIAL') — se saltea
   las VENCIDO. Este script SÍ las incluye, porque una deuda vencida es deuda igual.
   Si querés reproducir exactamente lo que habría hecho el sistema (dejando las dos
   vencidas vivas y US$ 736,46 a favor), sacá 'VENCIDO' del IN del paso 5.
   ===================================================================================== */
