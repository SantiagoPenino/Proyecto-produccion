-- Flosky DTF-1986 - completar pasos 4-7
-- Pasos 1-3 ya estan aplicados y confirmados.

DECLARE @Cantidad    DECIMAL(18,4) = 1;
DECLARE @CueRecurso  INT           = 780;
DECLARE @OrdDeposito INT           = 148427;
DECLARE @OrdMovim    INT           = 1911;
DECLARE @PlaId       INT           = 1;
DECLARE @Concepto    VARCHAR(200)  = 'DTF-1986 Uruguay textil [corregido]';

SET NOCOUNT ON;

-- PASO 4: Cancelar DeudaDocumento
UPDATE dbo.DeudaDocumento
SET    DDeEstado           = 'CANCELADO',
       DDeImportePendiente = 0
WHERE  OrdIdOrden IN (@OrdDeposito, @OrdMovim)
  AND  DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL');
PRINT 'PASO 4: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' deuda(s) cancelada(s)';

-- PASO 5: Crear ENTREGA en cuenta de recursos
IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta
    WHERE  CueIdCuenta = @CueRecurso
      AND  OrdIdOrden  IN (@OrdDeposito, @OrdMovim)
      AND  MovTipo     = 'ENTREGA'
      AND  (MovAnulado IS NULL OR MovAnulado = 0)
)
BEGIN
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovUsuarioAlta,
         OrdIdOrden, MovObservaciones, MovFecha)
    VALUES
        (@CueRecurso, 'ENTREGA', @Concepto, -@Cantidad, 1,
         @OrdMovim, 'Entrega correctiva fix-orden-por-orden', GETDATE());
    PRINT 'PASO 5: ENTREGA creada (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';
END
ELSE
    PRINT 'PASO 5: ENTREGA ya existia, omitida';

-- PASO 6: Restar del saldo de la cuenta de recursos
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = CueSaldoActual - @Cantidad
WHERE  CueIdCuenta = @CueRecurso;
PRINT 'PASO 6: saldo recursos -' + CAST(@Cantidad AS VARCHAR) + ' (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

-- PASO 7: PlaCantidadUsada
UPDATE dbo.PlanesMetros
SET    PlaCantidadUsada = PlaCantidadUsada + @Cantidad,
       PlaActivo        = CASE
           WHEN PlaCantidadUsada + @Cantidad >= PlaCantidadTotal THEN 0
           ELSE 1 END
WHERE  PlaIdPlan = @PlaId;
PRINT 'PASO 7: PlaCantidadUsada +' + CAST(@Cantidad AS VARCHAR) + ' (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

PRINT '';
PRINT '== Flosky DTF-1986 COMPLETO ==';
