/* =====================================================================================
   REVERSA — Gerardo Mazzoni (cliente 250, cuenta 381 DINERO_USD)
   Objetivo explícito del usuario: que la cuenta quede en US$ 1.621,32 A FAVOR, SIN DEUDA.

   VERSIÓN 2 — la primera versión insertaba un movimiento de reversa Y ADEMÁS marcaba
   el original MovAnulado=1: las dos cosas juntas restan DOBLE (marcar Anulado ya excluye
   el movimiento de la suma; agregar encima una reversa lo resta otra vez). Resultado real:
   dio 5.201,87 en vez de 1.621,32. Corregido: se sigue el patrón ya establecido en el
   código (`contabilidadService.anularMovimiento`) — SOLO marcar MovAnulado=1, sin
   insertar nada nuevo. Nada se borra: el movimiento queda, marcado y con el motivo.

   Qué hace:
     1) Marca MovAnulado=1 en los movimientos agregados hoy (los 5 de "Imputación
        anticipo RA-18%" + el de "CORRECCION_HIST_RC16_DDE4689" si corrió), y ajusta
        CueSaldoActual de la cuenta 381 en la misma medida (mismo criterio que
        anularMovimiento).
     2) Cierra del todo la deuda #8132 (PC-2650, doc 5560): pendiente a 0, COBRADO.

   Resultado esperado: Libro cta 381 = 1.621,32 | DeudaPendiente cta 381 = 0.

   Auto-commit: valida, escribe, autochequea, commitea o revierte solo.
   ===================================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Cue INT = 381, @Usr INT = 70;
DECLARE @Dde8132 INT = 8132, @Doc5560 INT = 5560;
DECLARE @Err NVARCHAR(400) = NULL;

/* ── Precondiciones (no bloquean) ─────────────────────────────────────────── */
DECLARE @NMovs INT = (
  SELECT COUNT(*) FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0
    AND (MovConcepto LIKE 'Imputación anticipo RA-18%' OR MovConcepto LIKE '%CORRECCION_HIST_RC16_DDE4689%'));

IF @NMovs NOT IN (5, 6)
  SET @Err = CONCAT('Se esperaban 5 o 6 movimientos para anular y se encontraron ', @NMovs, '. Revisar antes de seguir.');
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @Dde8132 AND DocIdDocumento = @Doc5560 AND DDeImportePendiente > 0)
  SET @Err = 'La deuda #8132 ya no tiene pendiente (¿ya se cerró antes?) — revisar antes de seguir.';

IF @Err IS NOT NULL
BEGIN
  RAISERROR('ABORTADO — %s', 16, 1, @Err);
  RETURN;
END

DECLARE @SumaLibroAntes DECIMAL(18,4) = (
  SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));

BEGIN TRY
  BEGIN TRAN;

    /* ── 1) Anular los movimientos de hoy (mismo patrón que anularMovimiento) ─── */
    UPDATE dbo.CuentasCliente
    SET    CueSaldoActual = CueSaldoActual - (
             SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
             WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0
               AND (MovConcepto LIKE 'Imputación anticipo RA-18%' OR MovConcepto LIKE '%CORRECCION_HIST_RC16_DDE4689%'))
    WHERE  CueIdCuenta = @Cue;

    UPDATE dbo.MovimientosCuenta
    SET    MovAnulado = 1,
           MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ', '') + 'ANULADO: el anticipo queda entero como billetera, sin restar por deuda cubierta (corrección 30/07/2026)', 500)
    WHERE  CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0
      AND (MovConcepto LIKE 'Imputación anticipo RA-18%' OR MovConcepto LIKE '%CORRECCION_HIST_RC16_DDE4689%');

    /* ── 2) Cerrar del todo la deuda #8132 (PC-2650) ─────────────────────────── */
    UPDATE dbo.DeudaDocumento
    SET    DDeImportePendiente = 0,
           DDeEstado = 'COBRADO',
           DDeFechaCobro = GETDATE(),
           DDeObservaciones = LEFT(ISNULL(DDeObservaciones + ' | ', '') + 'Cerrada sin remanente: el anticipo RA-18 cubre todo, sin descontar del libro.', 500)
    WHERE  DDeIdDocumento = @Dde8132;

    UPDATE dbo.DocumentosContables SET DocPagado = 1 WHERE DocIdDocumento = @Doc5560;

    /* ── 3) Control final ─────────────────────────────────────────────────────── */
    DECLARE @SumaLibroDespues DECIMAL(18,4) = (
      SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
      WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'));
    DECLARE @DeudaPendDespues DECIMAL(18,4) = (
      SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento
      WHERE CueIdCuenta = @Cue AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL'));

    DECLARE @SumaTxt VARCHAR(20) = CAST(@SumaLibroDespues AS VARCHAR(20));
    DECLARE @DeudaTxt VARCHAR(20) = CAST(@DeudaPendDespues AS VARCHAR(20));

    IF ABS(@SumaLibroDespues - 1621.32) > 0.01
    BEGIN
      ROLLBACK TRAN;
      RAISERROR('ABORTADO Y REVERTIDO — el libro no quedó en 1.621,32 (dio %s).', 16, 1, @SumaTxt);
      RETURN;
    END
    IF @DeudaPendDespues <> 0
    BEGIN
      ROLLBACK TRAN;
      RAISERROR('ABORTADO Y REVERTIDO — quedó deuda pendiente (%s).', 16, 1, @DeudaTxt);
      RETURN;
    END

  COMMIT TRAN;
  PRINT CONCAT('OK. Movimientos anulados: ', @NMovs, '. Libro cta 381: ', @SumaLibroAntes, ' -> ', @SumaLibroDespues, ' | Deuda pendiente: 0.');
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRAN;
  DECLARE @M NVARCHAR(2000) = ERROR_MESSAGE();
  RAISERROR('ERROR — no se aplicó nada: %s', 16, 1, @M);
  RETURN;
END CATCH
GO

/* Control posterior (fuera de la transacción, no bloquea) */
SELECT ISNULL(SUM(MovImporte),0) AS SumaLibroCta381
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 381 AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

SELECT DDeIdDocumento, DocIdDocumento, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento WHERE CueIdCuenta = 381 AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL');
-- Esperado: SumaLibroCta381 = 1621.32 | segunda consulta = 0 filas (sin deuda viva).
