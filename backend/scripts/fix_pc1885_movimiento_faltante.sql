/* =====================================================================================
   CORRECCIÓN — PC-1885 (doc 2938, Gerardo Mazzoni cliente 250, cuenta 381 DINERO_USD)

   Evidencia: la deuda #4689 (doc 2938) quedó COBRADO el 06/07/2026 a las 19:37:48.890 —
   63 milisegundos DESPUÉS de que el pago del anticipo RC-16 (Pago #51784, US$ 4.601,22)
   se procesara (19:37:48.827). No es coincidencia: ese anticipo pagó esta deuda, vía el
   mismo bug que se corrigió hoy en registrarPagoAnticipo (bajaba la deuda con un UPDATE
   y nunca dejaba el movimiento en el libro).

   Monto: US$ 580,55 — el importe ORIGINAL de la deuda en ese momento (no los 527,66
   actuales: eso es un re-etiquetado posterior del 13/07 vía fix_deudas_duplicadas, que
   ajustó el total de la factura pero no cambia lo que realmente se gastó el 06/07).
   El excedente (580,55-527,66=52,89) no se pierde: sigue en el libro como parte del
   remanente de RC-16 que no se pudo atribuir a ningún documento específico.

   Auto-commit: valida, escribe, autochequea, commitea o revierte solo. No corre en
   Section aparte -- una sola pasada.

   NO incluye a PC-1367 (doc 2108): esa deuda también tiene un gap (US$ 3.301,56) pero
   no se pudo confirmar con evidencia de horario a qué anticipo corresponde — se deja
   sin tocar hasta investigar más.
   ===================================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Cue INT = 381, @Usr INT = 70, @Doc INT = 2938, @Dde INT = 4689;
DECLARE @Monto DECIMAL(18,4) = 580.55;
DECLARE @Fecha DATETIME = '2026-07-06 19:37:48.890';   -- misma fecha que el cobro real
DECLARE @Marca NVARCHAR(50) = 'CORRECCION_HIST_RC16_DDE4689';
DECLARE @Err NVARCHAR(400) = NULL;

/* ── Precondiciones (no bloquean) ─────────────────────────────────────────── */
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @Cue AND MovConcepto LIKE '%' + @Marca + '%')
  SET @Err = 'Ya existe un movimiento de esta corrección: parece que ya se aplicó.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @Dde AND DocIdDocumento = @Doc AND DDeEstado = 'COBRADO' AND DDeImportePendiente = 0)
  SET @Err = 'La deuda #4689 no está en el estado esperado (COBRADO, pendiente 0) — revisar antes de seguir.';
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue AND CueTipo = 'DINERO_USD')
  SET @Err = 'La cuenta 381 no es la esperada (DINERO_USD).';

IF @Err IS NOT NULL
BEGIN
  RAISERROR('ABORTADO — %s', 16, 1, @Err);
  RETURN;
END

DECLARE @SumaLibroAntes DECIMAL(18,4) = (
  SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));

DECLARE @MovId INT, @Saldo DECIMAL(18,4), @MontoNeg DECIMAL(18,4) = -@Monto;

BEGIN TRY
  BEGIN TRAN;

    EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cue, @MovTipo = 'PAGO',
      @MovConcepto = 'CORRECCION_HIST_RC16_DDE4689 - RC-16 aplicado a deuda 4689 (PC-1885) el 06/07/2026 sin dejar movimiento',
      @MovImporte  = @MontoNeg,
      @MovUsuarioAlta = @Usr,
      @DocIdDocumento = @Doc,
      @MovFecha    = @Fecha,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

    DECLARE @SumaLibroDespues DECIMAL(18,4) = (
      SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
      WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));

    IF ABS((@SumaLibroAntes - @SumaLibroDespues) - @Monto) > 0.01
    BEGIN
      ROLLBACK TRAN;
      RAISERROR('ABORTADO Y REVERTIDO — el libro no bajó los US$ 580,55 esperados.', 16, 1);
      RETURN;
    END

  COMMIT TRAN;
  PRINT CONCAT('OK. Movimiento #', @MovId, ' insertado. Libro cta 381: ', @SumaLibroAntes, ' -> ', @SumaLibroDespues, '.');
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
        WHERE CueIdCuenta = 381 AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS DeudaPendiente
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 381 AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');
-- Esperado: SumaLibroCta381 baja en 580,55 respecto de lo que tenías antes. DeudaPendiente sigue en 243,44
-- (esta corrección no toca ninguna deuda, solo el libro).
