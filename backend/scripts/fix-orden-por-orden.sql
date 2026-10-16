-- ============================================================
-- fix-orden-por-orden.sql
-- Ejecutar UNA VEZ por cada fila de la lista.
-- Solo cambiar los 3 parámetros de abajo.
-- ============================================================

-- ╔══════════════════════════════════════════════════════════╗
-- ║  PARÁMETROS — cambiar por cada caso                      ║
-- ╠══════════════════════════════════════════════════════════╣
--   Caso 1: @MovId=6278, @PlaId=1, @EsUV=0   (Florencia  DTF-1986)
--   Caso 2: @MovId=5909, @PlaId=6, @EsUV=1   (Diseño Basico DTF-1781)
--   Caso 3: @MovId=4602, @PlaId=3, @EsUV=1   (Valentina  DTF-1562)
--   Caso 4: @MovId=3414, @PlaId=1, @EsUV=0   (Florencia  DTF-1090) ← verificar
--   Caso 5: @MovId=3749, @PlaId=3, @EsUV=1   (Valentina  DTF-1276) ← verificar
-- ╚══════════════════════════════════════════════════════════╝

DECLARE @MovId  INT = 6278;   -- MovIdMovimiento del cobro incorrecto
DECLARE @PlaId  INT = 1;      -- PlaIdPlan que debería haber cubierto la orden
DECLARE @EsUV   BIT = 0;      -- 0 = el producto FALTANTE es DTF COMUN
                               -- 1 = el producto FALTANTE es UV RIGIDOS

-- ── Resolver automáticamente lo demás ────────────────────────────────────
SET NOCOUNT ON;

DECLARE @OrdIdOrden  INT,
        @CueDinero   INT,
        @CueRecurso  INT,
        @Importe     DECIMAL(18,4),
        @Cantidad    DECIMAL(18,4),
        @ProIdFalta  INT,
        @Concepto    VARCHAR(200);

-- Producto faltante
SELECT @ProIdFalta = ProIdProducto
FROM   dbo.Articulos
WHERE  Descripcion = CASE @EsUV WHEN 1 THEN 'UV (PARA RIGIDOS 0,27)' ELSE 'DTF textil COMUN' END;

IF @ProIdFalta IS NULL
BEGIN
    PRINT 'ERROR: no se encontró el artículo en dbo.Articulos. Verificar descripción exacta.';
    RETURN;
END;

-- Datos del movimiento incorrecto
-- NOTA: OrdIdOrden en MovimientosCuenta es del ERP (dbo.Ordenes), NO de OrdenesDeposito
DECLARE @OrdDeposito INT;  -- OrdIdOrden real en OrdenesDeposito

SELECT @OrdIdOrden = OrdIdOrden,
       @CueDinero  = CueIdCuenta,
       @Importe    = ABS(MovImporte),
       @Concepto   = ISNULL(MovConcepto,'')
FROM   dbo.MovimientosCuenta
WHERE  MovIdMovimiento = @MovId;

IF @OrdIdOrden IS NULL
BEGIN
    PRINT 'ERROR: MovId ' + CAST(@MovId AS VARCHAR) + ' no existe en MovimientosCuenta.';
    RETURN;
END;

-- Extraer código de orden del Concepto ('DTF-1986 Uruguay textil' → 'DTF-1986')
-- y buscar en OrdenesDeposito por código (no por OrdIdOrden del ERP)
DECLARE @CodOrden VARCHAR(50) = LEFT(@Concepto, CHARINDEX(' ', @Concepto + ' ') - 1);

SELECT @OrdDeposito = OrdIdOrden,
       @Cantidad    = OrdCantidad
FROM   dbo.OrdenesDeposito
WHERE  OrdCodigoOrden = @CodOrden;

IF @Cantidad IS NULL
BEGIN
    PRINT 'ERROR: no se encontró OrdCantidad para ' + @CodOrden + ' en OrdenesDeposito.';
    RETURN;
END;

-- Cuenta de recursos del plan
SELECT @CueRecurso = CueIdCuenta FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaId;

IF @CueRecurso IS NULL
BEGIN
    PRINT 'ERROR: Plan ' + CAST(@PlaId AS VARCHAR) + ' no encontrado.';
    RETURN;
END;

PRINT '════════════════════════════════════════════';
PRINT '  MovId=' + CAST(@MovId AS VARCHAR) + '  Plan=' + CAST(@PlaId AS VARCHAR);
PRINT '  Importe=$' + CAST(@Importe AS VARCHAR) + '  Cantidad=' + CAST(@Cantidad AS VARCHAR);
PRINT '  CueDinero=' + CAST(@CueDinero AS VARCHAR) + '  CueRecurso=' + CAST(@CueRecurso AS VARCHAR);
PRINT '════════════════════════════════════════════';

-- ── PASO 1: articulosPermitidos ───────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos
    WHERE PlaIdPlan = @PlaId AND ProIdProducto = @ProIdFalta
)
BEGIN
    INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto)
    VALUES (@PlaId, @ProIdFalta);
    PRINT 'PASO 1 ✓  articulosPermitidos insertado (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';
END
ELSE
    PRINT 'PASO 1 –  articulosPermitidos ya existía, omitido';

-- ── PASO 2: Anular movimiento ORDEN ──────────────────────────────────────
UPDATE dbo.MovimientosCuenta
SET    MovAnulado       = 1,
       MovObservaciones = ISNULL(MovObservaciones,'') + ' [ANULADO fix-orden-por-orden]'
WHERE  MovIdMovimiento = @MovId
  AND  (MovAnulado IS NULL OR MovAnulado = 0);

PRINT 'PASO 2 ✓  MovAnulado=1 (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

-- ── PASO 3: Devolver saldo monetario ─────────────────────────────────────
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = CueSaldoActual + @Importe
WHERE  CueIdCuenta = @CueDinero;

PRINT 'PASO 3 ✓  CueSaldoActual monetario +' + CAST(@Importe AS VARCHAR) + ' (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

-- ── PASO 4: Cancelar DeudaDocumento ──────────────────────────────────────
UPDATE dbo.DeudaDocumento
SET    DDeEstado           = 'CANCELADO',
       DDeImportePendiente = 0
WHERE  OrdIdOrden IN (@OrdIdOrden, @OrdDeposito)
  AND  DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL');

PRINT 'PASO 4 ✓  DeudaDocumento cancelada (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

-- ── PASO 5: Crear ENTREGA en cuenta de recursos ───────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta
    WHERE  OrdIdOrden  IN (@OrdIdOrden, @OrdDeposito)
      AND  CueIdCuenta = @CueRecurso
      AND  MovTipo     = 'ENTREGA'
      AND  (MovAnulado IS NULL OR MovAnulado = 0)
)
BEGIN
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         MovUsuarioAlta, OrdIdOrden, MovObservaciones, MovFecha)
    SELECT
        @CueRecurso, 'ENTREGA', @Concepto + ' [corregido]', -ABS(@Cantidad),
        CueSaldoActual - ABS(@Cantidad),
        1, @OrdIdOrden, 'Entrega correctiva fix-orden-por-orden', GETDATE()
    FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueRecurso;

    PRINT 'PASO 5 ✓  ENTREGA creada (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';
END
ELSE
    PRINT 'PASO 5 –  ENTREGA ya existía, omitida';

-- ── PASO 6: Restar saldo cuenta de recursos ───────────────────────────────
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = CueSaldoActual - @Cantidad
WHERE  CueIdCuenta = @CueRecurso;

PRINT 'PASO 6 ✓  CueSaldoActual recursos -' + CAST(@Cantidad AS VARCHAR) + ' (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

-- ── PASO 7: Actualizar PlaCantidadUsada ───────────────────────────────────
UPDATE dbo.PlanesMetros
SET    PlaCantidadUsada = PlaCantidadUsada + @Cantidad,
       PlaActivo        = CASE
           WHEN PlaCantidadUsada + @Cantidad >= PlaCantidadTotal THEN 0
           ELSE 1 END
WHERE  PlaIdPlan = @PlaId;

PRINT 'PASO 7 ✓  PlaCantidadUsada +' + CAST(@Cantidad AS VARCHAR) + ' (' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila)';

PRINT '';
PRINT '══ FIN — verificá que todos los pasos muestren 1 fila ══';
