-- Flosky DTF-1986 - solo PASO 5 (ENTREGA faltante)
-- Pasos 1-4 y 6-7 ya estan aplicados.

DECLARE @Cantidad    DECIMAL(18,4) = 1;
DECLARE @CueRecurso  INT           = 780;
DECLARE @OrdMovim    INT           = 1911;
DECLARE @OrdDeposito INT           = 148427;
DECLARE @Concepto    VARCHAR(200)  = 'DTF-1986 Uruguay textil [corregido]';

SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta
    WHERE  CueIdCuenta = @CueRecurso
      AND  OrdIdOrden  IN (@OrdDeposito, @OrdMovim)
      AND  MovTipo     = 'ENTREGA'
      AND  (MovAnulado IS NULL OR MovAnulado = 0)
)
BEGIN
    -- MovSaldoPosterior = saldo actual de la cuenta (ya descontado por paso 6)
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         MovUsuarioAlta, OrdIdOrden, MovObservaciones, MovFecha)
    SELECT
        @CueRecurso,
        'ENTREGA',
        @Concepto,
        -@Cantidad,
        CueSaldoActual,
        1,
        @OrdMovim,
        'Entrega correctiva fix manual',
        GETDATE()
    FROM dbo.CuentasCliente
    WHERE CueIdCuenta = @CueRecurso;

    PRINT 'PASO 5: ENTREGA creada (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';
END
ELSE
    PRINT 'PASO 5: ENTREGA ya existia';

PRINT '== Flosky DTF-1986 COMPLETO ==';
