/* =====================================================================================
   CORRECCIÓN — a mi propio error en ra18_2_aplicar.sql (Gerardo Mazzoni, cliente 250)
   Base: SecureAppDB (PRODUCCIÓN).

   El paso 5 (imputar a deudas) de ra18_2_aplicar.sql bajó DDeImportePendiente con un
   UPDATE pero NUNCA insertó el movimiento de contrapartida en MovimientosCuenta. Por
   eso el Panel 360 muestra US$ 1.621,32 "a favor" al mismo tiempo que US$ 243,44 de
   deuda viva: el cheque (+3.000) sigue entero en el libro como si nada se hubiera
   gastado, mientras la deuda ya bajó por el UPDATE. La misma plata cuenta dos veces.

   Corrige agregando los 5 movimientos que debieron entrar junto con la imputación:
   uno por cada deuda afectada, vía dbo.SP_RegistrarMovimiento (el mismo SP que usa
   TODO el sistema para escribir en MovimientosCuenta) — no un INSERT a mano, porque
   el SP también calcula MovSaldoPosterior y actualiza CuentasCliente.CueSaldoActual.
   Mismo criterio que usa "Imputar anticipo" del Estado de Cuenta (imputarAnticipoADeuda):
   MovTipo 'PAGO', atado al DocIdDocumento de cada factura. Total: US$ 3.000,00
   (4 completas + 1 parcial de 8132).

   Auto-commit: valida, escribe, autochequea, commitea o revierte solo.
   ===================================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Cue INT = 381, @Usr INT = 70;
DECLARE @Err NVARCHAR(400) = NULL;

/* ── Precondiciones ───────────────────────────────────────────────────────── */
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
           WHERE CueIdCuenta = @Cue AND MovConcepto LIKE 'Imputación anticipo RA-18%')
  SET @Err = 'Ya existe un movimiento de esta corrección: parece que ya se aplicó.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 3411 AND DDeImportePendiente = 0)
     OR NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 5911 AND DDeImportePendiente = 0)
     OR NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 6928 AND DDeImportePendiente = 0)
     OR NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 8130 AND DDeImportePendiente = 0)
  SET @Err = 'Alguna de las 4 deudas que deberían estar canceladas no lo está: revisar antes de seguir.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 8132 AND ABS(DDeImportePendiente - 243.44) < 0.01)
  SET @Err = 'La deuda 8132 no tiene el pendiente esperado (US$ 243,44).';

IF @Err IS NOT NULL
BEGIN
  RAISERROR('ABORTADO — %s', 16, 1, @Err);
  RETURN;
END

DECLARE @SumaLibroAntes DECIMAL(18,4) = (
  SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));

DECLARE @MovId INT, @Saldo DECIMAL(18,4);

BEGIN TRY
  BEGIN TRAN;

    EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cue, @MovTipo = 'PAGO',
      @MovConcepto = 'Imputación anticipo RA-18 a deuda #3411 (corrección — faltaba el movimiento)',
      @MovImporte = -605.92, @MovUsuarioAlta = @Usr, @DocIdDocumento = 2108,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

    EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cue, @MovTipo = 'PAGO',
      @MovConcepto = 'Imputación anticipo RA-18 a deuda #5911 (corrección — faltaba el movimiento)',
      @MovImporte = -528.98, @MovUsuarioAlta = @Usr, @DocIdDocumento = 3783,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

    EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cue, @MovTipo = 'PAGO',
      @MovConcepto = 'Imputación anticipo RA-18 a deuda #6928 (corrección — faltaba el movimiento)',
      @MovImporte = -450.92, @MovUsuarioAlta = @Usr, @DocIdDocumento = 4535,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

    EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cue, @MovTipo = 'PAGO',
      @MovConcepto = 'Imputación anticipo RA-18 a deuda #8130 (corrección — faltaba el movimiento)',
      @MovImporte = -798.57, @MovUsuarioAlta = @Usr, @DocIdDocumento = 5555,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

    -- Parcial: de 859,05 solo se imputaron 615,61; quedan 243,44 pendientes.
    EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cue, @MovTipo = 'PAGO',
      @MovConcepto = 'Imputación anticipo RA-18 a deuda #8132, parcial (corrección — faltaba el movimiento)',
      @MovImporte = -615.61, @MovUsuarioAlta = @Usr, @DocIdDocumento = 5560,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

    /* Control: el libro tiene que haber bajado exactamente los US$ 3.000 imputados */
    DECLARE @SumaLibroDespues DECIMAL(18,4) = (
      SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
      WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));

    IF ABS((@SumaLibroAntes - @SumaLibroDespues) - 3000.00) > 0.01
    BEGIN
      ROLLBACK TRAN;
      RAISERROR('ABORTADO Y REVERTIDO — el libro no bajó los US$ 3.000 esperados.', 16, 1);
      RETURN;
    END

  COMMIT TRAN;
  PRINT CONCAT('OK. Libro cta 381: ', @SumaLibroAntes, ' -> ', @SumaLibroDespues, ' (bajó 3.000,00).');
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRAN;
  DECLARE @M NVARCHAR(2000) = ERROR_MESSAGE();
  RAISERROR('ERROR — no se aplicó nada: %s', 16, 1, @M);
  RETURN;
END CATCH
GO

/* Control posterior (fuera de la transacción, no bloquea) */
SELECT ISNULL(SUM(MovImporte),0) AS SumaLibroCta381,
       (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento
        WHERE CueIdCuenta = 381 AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS DeudaPendiente,
       (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 381) AS ColumnaGuardada
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 381 AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');
--  Esperado: SumaLibroCta381 ≈ -1.378,68 (vuelve a la base previa a este anticipo,
--  porque los US$ 3.000 se gastaron enteros en deuda) | DeudaPendiente = 243,44.
--  El Panel 360 NO debería mostrar más "A favor" para esta cuenta.
