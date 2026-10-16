/* ===========================================================================
   fix-entregas-mal-tipadas.sql
   ---------------------------------------------------------------------------
   Reclasifica a 'ENTREGA' los movimientos que son CONSUMOS sobre cuentas de
   RECURSO (MTS / KG, es decir CuentasCliente.ProIdProducto IS NOT NULL) pero
   que quedaron grabados con MovTipo = 'ORDEN' / 'ORDEN_ANTICIPO'.

   Origen del bug: la ruta POST /contabilidad/ordenes/insertar-manual
   ("Nueva orden" del panel de planes) insertaba 'ORDEN' en vez de 'ENTREGA'
   (corregido en commit afe2d3e). Esos movimientos descuentan bien el saldo,
   pero el reporte/PDF los oculta porque 'ORDEN' se trata como no visible
   (se consolida en ciclo). Reclasificarlos NO cambia ningún saldo; solo los
   vuelve visibles en el estado de cuenta.

   Seguridad:
     - @DryRun = 1  -> solo muestra qué tocaría, NO escribe (modo por defecto).
     - @DryRun = 0  -> aplica el UPDATE dentro de una transacción.
     - @CliFilter   -> NULL = todos los clientes; o un CliIdCliente concreto.
     - Solo toca movimientos en cuentas de recurso, no anulados, SIN documento
       (DocIdDocumento NULL) y SIN ciclo (CicIdCiclo NULL): la firma exacta de
       los insertados a mano. Nunca altera órdenes consolidadas en ciclo/doc.
     - Idempotente: re-ejecutarlo no hace nada si ya no quedan candidatos.

   Uso (SSMS / sqlcmd):
     1) Dejar @DryRun = 1 y ejecutar  -> revisar el listado.
     2) Cambiar @DryRun = 0 y ejecutar -> aplica los cambios.
   =========================================================================== */

SET NOCOUNT ON;

DECLARE @DryRun    BIT = 1;     -- <<< 1 = preview (no escribe) | 0 = aplicar
DECLARE @CliFilter INT = NULL;  -- <<< NULL = todos | o un CliIdCliente puntual

/* --- 1. Preview: candidatos a reclasificar ------------------------------ */
SELECT
    m.MovIdMovimiento  AS Id,
    m.CueIdCuenta      AS Cue,
    cc.CueTipo,
    cc.CliIdCliente    AS Cli,
    m.MovTipo          AS TipoActual,
    m.MovImporte       AS Imp,
    CONVERT(varchar(19), m.MovFecha, 120) AS Fecha,
    LEFT(m.MovConcepto, 60) AS Concepto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente   cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.ProIdProducto IS NOT NULL                  -- cuenta de recurso (MTS/KG)
  AND m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.DocIdDocumento IS NULL                       -- no atado a documento
  AND m.CicIdCiclo     IS NULL                       -- no consolidado en ciclo
  AND (@CliFilter IS NULL OR cc.CliIdCliente = @CliFilter)
ORDER BY m.MovFecha DESC;

PRINT '----------------------------------------------------------------';
PRINT 'Candidatos listados arriba.';

/* --- 2. Aplicar (solo si @DryRun = 0) ----------------------------------- */
IF @DryRun = 0
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE m
        SET m.MovTipo = 'ENTREGA'
        FROM dbo.MovimientosCuenta m
        JOIN dbo.CuentasCliente   cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE cc.ProIdProducto IS NOT NULL
          AND m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
          AND m.DocIdDocumento IS NULL
          AND m.CicIdCiclo     IS NULL
          AND (@CliFilter IS NULL OR cc.CliIdCliente = @CliFilter);

        DECLARE @n INT = @@ROWCOUNT;

        COMMIT TRANSACTION;

        PRINT '*** APLICADO: ' + CAST(@n AS varchar(10))
            + ' movimiento(s) reclasificado(s) a ''ENTREGA''. ***';
        PRINT 'Los saldos NO cambian; ahora aparecen en el estado de cuenta / PDF.';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        PRINT '*** ERROR: ' + ERROR_MESSAGE() + ' (se hizo ROLLBACK). ***';
        THROW;
    END CATCH
END
ELSE
BEGIN
    PRINT '*** DRY-RUN (@DryRun = 1): no se escribio nada. '
        + 'Pone @DryRun = 0 y volve a ejecutar para aplicar. ***';
END
