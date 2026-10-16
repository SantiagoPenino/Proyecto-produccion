/* ============================================================================
   fix_eliminar_compra_recurso.sql
   ----------------------------------------------------------------------------
   BORRA (revierte) UNA compra de recurso — rollo/metros por adelantado — que
   quedó viva después de anular la factura o de emitirle una Nota de Crédito.

   Hace exactamente lo mismo que contabilidadService.revertirRecursosPorTransaccion:
     1) resta los metros comprados de PlanesMetros.PlaCantidadTotal
        (y desactiva el plan si queda sin metros disponibles)
     2) anula el movimiento ENTRADA de la cuenta MTS (MovAnulado = 1, deja rastro)
     3) resta esos metros de CuentasCliente.CueSaldoActual

   NO toca plata: la NC / anulación ya arregló la cuenta corriente y el asiento.
   NO borra filas: el plan y el movimiento quedan como historia, sin metros.

   Si el movimiento ENTRADA ya venía anulado (la anulación de la factura lo anuló
   pero dejó el plan y el saldo vivos), igual corrige el plan y el saldo: no se
   re-anula, solo se le agrega la marca. Correr dos veces sobre la misma compra
   aborta (la marca en las observaciones es el freno), así que no se resta doble.

   ANTES DE CORRER: sacá PlaIdPlan y MovEntradaId de diag_recurso_vivo_tras_nc.sql
   ----------------------------------------------------------------------------
   PASO 1: correr con @SoloSimular = 1  → muestra el antes/después y NO guarda.
   PASO 2: si el "después" es el correcto, poner @SoloSimular = 0 y correr de nuevo.

   OJO: corré esto solo, NO adentro de otro BEGIN TRANSACTION (la simulación hace
   ROLLBACK y te tiraría abajo la transacción de afuera).
   ============================================================================ */
SET XACT_ABORT ON;

DECLARE @PlaIdPlan    INT           = 0;     -- ← plan a revertir  (obligatorio)
DECLARE @MovEntradaId INT           = 0;     -- ← movimiento ENTRADA de esa compra (obligatorio)
DECLARE @Metros       DECIMAL(18,4) = NULL;  -- ← dejar NULL = usa los metros del movimiento
DECLARE @SoloSimular  BIT           = 1;     -- 1 = simular (rollback) | 0 = aplicar de verdad
DECLARE @UsuarioId    INT           = 70;    -- usuario que queda en la observación

BEGIN TRANSACTION;

DECLARE @CueIdCuenta INT, @MovMetros DECIMAL(18,4), @MovAnulado BIT, @YaRevertido BIT;
DECLARE @Total DECIMAL(18,4), @Usada DECIMAL(18,4), @CuePlan INT;
DECLARE @Msg NVARCHAR(500);

/* Marca de idempotencia: si el movimiento ya la tiene, este script ya corrió sobre
   esta compra y no se vuelve a restar nada. */
DECLARE @MarcaRevertido NVARCHAR(100) = N'compra de recurso revertida';

SELECT @CueIdCuenta = CueIdCuenta, @MovMetros = ABS(MovImporte), @MovAnulado = ISNULL(MovAnulado, 0),
       @YaRevertido = CASE WHEN ISNULL(MovObservaciones, '') LIKE '%' + @MarcaRevertido + '%' THEN 1 ELSE 0 END
FROM dbo.MovimientosCuenta WITH (UPDLOCK)
WHERE MovIdMovimiento = @MovEntradaId AND MovTipo = 'ENTRADA';

SELECT @Total = PlaCantidadTotal, @Usada = PlaCantidadUsada, @CuePlan = CueIdCuenta
FROM dbo.PlanesMetros WITH (UPDLOCK)
WHERE PlaIdPlan = @PlaIdPlan;

SET @Metros = ISNULL(@Metros, @MovMetros);

/* ── Guardas: cualquiera de estas aborta sin tocar nada ──────────────────── */
IF @CueIdCuenta IS NULL
BEGIN
    ROLLBACK TRANSACTION;
    SET @Msg = CONCAT('No existe un movimiento ENTRADA con MovIdMovimiento = ', @MovEntradaId, '.');
    RAISERROR(@Msg, 16, 1);
    RETURN;
END
IF @Total IS NULL
BEGIN
    ROLLBACK TRANSACTION;
    SET @Msg = CONCAT('No existe el plan PlaIdPlan = ', @PlaIdPlan, '.');
    RAISERROR(@Msg, 16, 1);
    RETURN;
END
IF @CuePlan <> @CueIdCuenta
BEGIN
    ROLLBACK TRANSACTION;
    SET @Msg = CONCAT('El movimiento y el plan son de cuentas distintas (mov: cuenta ', @CueIdCuenta,
                      ', plan: cuenta ', @CuePlan, '). Revisa los IDs.');
    RAISERROR(@Msg, 16, 1);
    RETURN;
END
IF @YaRevertido = 1
BEGIN
    ROLLBACK TRANSACTION;
    SET @Msg = CONCAT('El movimiento ', @MovEntradaId, ' ya fue revertido por este script (tiene la marca "',
                      @MarcaRevertido, '" en las observaciones). No se resta nada de nuevo.');
    RAISERROR(@Msg, 16, 1);
    RETURN;
END
IF @Total - @Metros < @Usada - 0.0001
BEGIN
    ROLLBACK TRANSACTION;
    SET @Msg = CONCAT('NO se puede revertir: el recurso ya fue consumido (usados ',
                      CAST(@Usada AS VARCHAR(30)), ' de ', CAST(@Total AS VARCHAR(30)),
                      ' metros). Primero reverti los consumos desde el libro del plan.');
    RAISERROR(@Msg, 16, 1);
    RETURN;
END

/* ── ANTES ───────────────────────────────────────────────────────────────── */
SELECT 'ANTES' AS Momento, pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada,
       pm.PlaCantidadTotal - pm.PlaCantidadUsada AS MetrosVivos, pm.PlaActivo,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoMetrosCuenta,
       @Metros AS MetrosARevertir
FROM dbo.PlanesMetros pm
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
WHERE pm.PlaIdPlan = @PlaIdPlan;

/* ── 1) Restar los metros comprados del plan (desactivar si queda vacío) ── */
UPDATE dbo.PlanesMetros
SET PlaCantidadTotal = PlaCantidadTotal - @Metros,
    PlaActivo = CASE WHEN (PlaCantidadTotal - @Metros) <= PlaCantidadUsada THEN 0 ELSE PlaActivo END
WHERE PlaIdPlan = @PlaIdPlan;

/* ── 2) Anular el movimiento ENTRADA dejando rastro ───────────────────────
   Si el movimiento YA venía anulado (la anulación de la factura lo anuló pero
   no tocó el plan ni el saldo), no se re-anula: solo se le deja la marca. */
UPDATE dbo.MovimientosCuenta
SET MovAnulado = 1,
    MovObservaciones = ISNULL(MovObservaciones + ' | ', '')
        + CASE WHEN @MovAnulado = 1 THEN '' ELSE 'ANULADO: ' END
        + @MarcaRevertido + ' por NC/anulacion (usuario '
        + CAST(@UsuarioId AS VARCHAR(10)) + ', script fix_eliminar_compra_recurso)'
WHERE MovIdMovimiento = @MovEntradaId;

/* ── 3) Restar los metros del saldo de la cuenta MTS ────────────────────── */
UPDATE dbo.CuentasCliente
SET CueSaldoActual = ISNULL(CueSaldoActual, 0) - @Metros
WHERE CueIdCuenta = @CueIdCuenta;

/* ── DESPUÉS ─────────────────────────────────────────────────────────────── */
SELECT 'DESPUES' AS Momento, pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada,
       pm.PlaCantidadTotal - pm.PlaCantidadUsada AS MetrosVivos, pm.PlaActivo,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoMetrosCuenta,
       @Metros AS MetrosRevertidos
FROM dbo.PlanesMetros pm
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
WHERE pm.PlaIdPlan = @PlaIdPlan;

IF @SoloSimular = 1
BEGIN
    ROLLBACK TRANSACTION;
    PRINT 'SIMULACION: no se guardo nada. Poné @SoloSimular = 0 para aplicar.';
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT 'APLICADO: compra de recurso revertida.';
END
