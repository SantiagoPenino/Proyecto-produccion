/* ============================================================================
   fix_planes_135_136_entradas_borradas.sql
   ----------------------------------------------------------------------------
   CASO (18-ago-2026, cliente Florencia Amorín, planes #135 y #136):

   Alguien usó el tacho 🗑 del libro del plan sobre movimientos de ENTRADA (la
   COMPRA del rollo por adelantado). Ese endpoint (/contabilidad/ordenes/
   eliminar-metros) está escrito para deshacer CONSUMOS (movimientos negativos),
   así que sobre una compra hace lo contrario de lo que hace falta:
     · borra la fila FÍSICAMENTE (sin rastro),
     · le SUMA los metros a CueSaldoActual en vez de restarlos,
     · deja PlaCantidadTotal intacto (solo toca PlaCantidadUsada), y
     · reactiva el plan (PlaActivo = 1).

   Resultado en prod:
     Plan #135 (DTF textil COMUN)  · venta TcaId 7991 → ANULADA
        total 1,28 · ACTIVO · saldo cuenta 2,56 · 0 movimientos
        DEBERÍA: total 0 · inactivo · saldo 0
     Plan #136 (DTF para rígidos UV) · ventas TcaId 7994 y 7996 → COMPLETADAS
        total 2,56 (correcto) · saldo cuenta 3,84 · falta la ENTRADA de la 7994
        DEBERÍA: total 2,56 · activo · saldo 2,56 · 2 movimientos

   QUÉ HACE ESTE SCRIPT
     Plan #135: lo deja en 0 y lo desactiva, y pone la cuenta en 0.
     Plan #136: repone la ENTRADA borrada (la del alta, TcaId 7994) y corrige el
                saldo de la cuenta a 2,56. El plan NO se toca: sus 2,56 metros
                están legítimamente vendidos y pagos.
     Ningún plan se borra: quedan con la marca del arreglo en PlaObservaciones.

   CÓMO CORRERLO
     1) Dejá @APLICAR = 0 y ejecutá: muestra el antes/después y hace ROLLBACK.
     2) Si el "DESPUÉS" es el esperado, poné @APLICAR = 1 y volvé a ejecutar.
     Es idempotente: si la ENTRADA ya fue repuesta, no la duplica.

   El fix de código que impide que esto se repita va en
   backend/routes/contabilidadRoutes.js (CANDADO 2 en /ordenes/eliminar-metros).
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @APLICAR      BIT = 0;      -- ← 0 = simulación (rollback) · 1 = aplicar
DECLARE @UsuarioId    INT = 1;      -- usuario que queda como autor del arreglo

DECLARE @Plan135 INT = 135, @Plan136 INT = 136;
DECLARE @Tca7994 INT = 7994;        -- venta del alta del plan #136 (ENTRADA borrada)
DECLARE @MetrosEntrada DECIMAL(18,4) = 1.2800;
DECLARE @MARCA NVARCHAR(100) = N'fix_planes_135_136_entradas_borradas';

DECLARE @Cue135 INT, @Cue136 INT;
SELECT @Cue135 = CueIdCuenta FROM dbo.PlanesMetros WHERE PlaIdPlan = @Plan135;
SELECT @Cue136 = CueIdCuenta FROM dbo.PlanesMetros WHERE PlaIdPlan = @Plan136;

/* ── ANTES ───────────────────────────────────────────────────────────────── */
PRINT '===== ANTES =====';
SELECT  pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo,
        cc.CueIdCuenta, cc.CueSaldoActual AS SaldoCuenta,
        (SELECT ISNULL(SUM(m.MovImporte), 0) FROM dbo.MovimientosCuenta m
          WHERE m.CueIdCuenta = pm.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS SumaMovimientosVivos
FROM    dbo.PlanesMetros pm
JOIN    dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
WHERE   pm.PlaIdPlan IN (@Plan135, @Plan136);

/* ── PRECONDICIONES ──────────────────────────────────────────────────────────
   Si el estado ya no es el diagnosticado, el script NO toca nada. Preferimos
   abortar y volver a mirar antes que pisar datos que alguien ya corrigió.     */
DECLARE @err NVARCHAR(500) = NULL;

IF @Cue135 IS NULL OR @Cue136 IS NULL
    SET @err = N'No existe alguno de los planes #135 / #136.';

IF @err IS NULL AND EXISTS (
        SELECT 1 FROM dbo.PlanesMetros
        WHERE PlaIdPlan IN (@Plan135, @Plan136) AND PlaCantidadUsada > 0)
    SET @err = N'Alguno de los planes YA TIENE CONSUMO (PlaCantidadUsada > 0). Frená: hay que revisar a mano antes de tocar los totales.';

IF @err IS NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.TransaccionesCaja
        WHERE TcaIdTransaccion = 7991 AND TcaEstado = 'ANULADO')
    SET @err = N'La transacción 7991 (venta del plan #135) ya no figura ANULADO. El plan #135 no debería darse de baja sin revisar.';

IF @err IS NULL AND (
        SELECT COUNT(*) FROM dbo.TransaccionesCaja
        WHERE TcaIdTransaccion IN (7994, 7996) AND TcaEstado = 'COMPLETADA') <> 2
    SET @err = N'Las transacciones 7994 / 7996 (ventas del plan #136) ya no están COMPLETADA. Revisá antes de reponer la ENTRADA.';

IF @err IS NOT NULL
BEGIN
    RAISERROR('ABORTADO: %s', 16, 1, @err);
    RETURN;
END

BEGIN TRAN;

/* ── PLAN #135 · la venta está anulada: el plan tiene que morir ───────────── */
UPDATE dbo.PlanesMetros
SET    PlaCantidadTotal = 0,
       PlaActivo        = 0,
       PlaObservaciones = LEFT(ISNULL(PlaObservaciones + N' | ', N'')
                          + N'Dado de baja el ' + CONVERT(VARCHAR(10), GETDATE(), 103)
                          + N': la venta (TcaId 7991) fue anulada y su ENTRADA había sido borrada '
                          + N'desde el libro del plan. [' + @MARCA + N']', 500)
WHERE  PlaIdPlan = @Plan135;

UPDATE dbo.CuentasCliente
SET    CueSaldoActual = 0
WHERE  CueIdCuenta = @Cue135;

/* ── PLAN #136 · las ventas son válidas: se repone la ENTRADA borrada ─────── */
IF NOT EXISTS (
    SELECT 1 FROM dbo.MovimientosCuenta
    WHERE CueIdCuenta = @Cue136
      AND MovTipo = 'ENTRADA'
      AND MovRefExterna = CAST(@Tca7994 AS VARCHAR(100))
      AND (MovAnulado IS NULL OR MovAnulado = 0))
BEGIN
    DECLARE @Fecha7994 DATETIME =
        (SELECT TcaFecha FROM dbo.TransaccionesCaja WHERE TcaIdTransaccion = @Tca7994);

    INSERT INTO dbo.MovimientosCuenta
          (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
           MovFecha, MovUsuarioAlta, MovAnulado, MovRefExterna, MovObservaciones)
    VALUES
          (@Cue136, 'ENTRADA',
           N'Saldo inicial plan #136',
           @MetrosEntrada, @MetrosEntrada,
           ISNULL(@Fecha7994, GETDATE()), @UsuarioId, 0,
           CAST(@Tca7994 AS VARCHAR(100)),
           N'Plan #136 | REPUESTA: el movimiento original fue borrado desde el libro del plan ['
           + @MARCA + N']');

    UPDATE dbo.PlanesMetros
    SET    PlaObservaciones = LEFT(ISNULL(PlaObservaciones + N' | ', N'')
                              + N'ENTRADA del alta (TcaId 7994) repuesta el '
                              + CONVERT(VARCHAR(10), GETDATE(), 103)
                              + N': había sido borrada desde el libro del plan. [' + @MARCA + N']', 500)
    WHERE  PlaIdPlan = @Plan136;
END

/* Saldo de la cuenta del #136 = suma de sus movimientos vivos (queda en 2,56) */
UPDATE cc
SET    cc.CueSaldoActual = ISNULL(sm.Suma, 0)
FROM   dbo.CuentasCliente cc
CROSS APPLY (
    SELECT SUM(m.MovImporte) AS Suma
    FROM   dbo.MovimientosCuenta m
    WHERE  m.CueIdCuenta = cc.CueIdCuenta
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) sm
WHERE  cc.CueIdCuenta = @Cue136;

/* Saldo corrido (MovSaldoPosterior) de la cuenta del #136, en orden real */
UPDATE m
SET    m.MovSaldoPosterior = (
           SELECT SUM(m2.MovImporte)
           FROM   dbo.MovimientosCuenta m2
           WHERE  m2.CueIdCuenta = m.CueIdCuenta
             AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
             AND (m2.MovFecha < m.MovFecha
                  OR (m2.MovFecha = m.MovFecha AND m2.MovIdMovimiento <= m.MovIdMovimiento))
       )
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @Cue136
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

/* ── DESPUÉS ─────────────────────────────────────────────────────────────── */
PRINT '===== DESPUÉS =====';
SELECT  pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo,
        cc.CueIdCuenta, cc.CueSaldoActual AS SaldoCuenta,
        (SELECT ISNULL(SUM(m.MovImporte), 0) FROM dbo.MovimientosCuenta m
          WHERE m.CueIdCuenta = pm.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS SumaMovimientosVivos
FROM    dbo.PlanesMetros pm
JOIN    dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
WHERE   pm.PlaIdPlan IN (@Plan135, @Plan136);

SELECT  m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovSaldoPosterior,
        m.MovFecha, m.MovRefExterna, m.MovObservaciones
FROM    dbo.MovimientosCuenta m
WHERE   m.CueIdCuenta IN (@Cue135, @Cue136)
ORDER BY m.CueIdCuenta, m.MovFecha, m.MovIdMovimiento;

/* Esperado:
     Plan #135 → total 0,00 · activo 0 · saldo 0,00 · sin movimientos
     Plan #136 → total 2,56 · activo 1 · saldo 2,56 · 2 ENTRADAS de 1,28        */

IF @APLICAR = 1
BEGIN
    COMMIT;
    PRINT '>>> CAMBIOS APLICADOS (COMMIT).';
END
ELSE
BEGIN
    ROLLBACK;
    PRINT '>>> SIMULACIÓN: no se guardó nada. Poné @APLICAR = 1 para aplicar.';
END
