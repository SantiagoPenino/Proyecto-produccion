/* ============================================================================
   fix_plan136_recarga_7996_anulada.sql
   ----------------------------------------------------------------------------
   CASO (18-ago-2026, cliente Florencia Amorín, plan #136 "DTF para rígidos UV"):

   El plan tiene DOS compras:
     · TcaId 7994 · PC-3320 · US$ 25,34 · 1,28 m  → REAL (≈ 19,80 el metro)
     · TcaId 7996 · PC-3321 · US$  0,13 · 1,28 m  → ERROR de caja (precio mal)

   La ENTRADA de la 7996 fue borrada desde el libro del plan con el 🗑, que sobre
   una compra hace lo contrario de lo que hace falta: borra la fila, SUMA los
   metros al saldo y deja PlaCantidadTotal entero. Estado al 18-ago-2026:

        PlaCantidadTotal 2,56 · CueSaldoActual 3,84 · movimientos vivos 1,28

   Es decir: el plan sigue habilitando 2,56 metros cuando solo 1,28 están
   comprados de verdad.

   ORDEN DE LOS PASOS — IMPORTANTE
     1) Anulá primero PC-3321 (TcaId 7996) desde la app. Eso resuelve la PLATA
        (los US$ 0,13) y deja el documento anulado.
        Ojo: la anulación NO va a poder revertir los metros sola, porque
        revertirRecursosPorTransaccion busca la ENTRADA de la 7996 y esa fila
        ya no existe (fue borrada físicamente). Va a dejar un warning en el log.
     2) Recién ahí corré este script, que es el que arregla los METROS.

   Este script exige que el paso 1 esté hecho: si la 7996 no está ANULADO,
   aborta sin tocar nada.

   CÓMO CORRERLO
     Dejá @APLICAR = 0 → muestra ANTES/DESPUÉS y hace ROLLBACK.
     Si el DESPUÉS es el esperado, poné @APLICAR = 1 y volvé a ejecutar.

   Esperado al final: plan #136 → total 1,28 · activo · saldo 1,28 · 1 ENTRADA.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @APLICAR   BIT = 0;        -- ← 0 = simulación (rollback) · 1 = aplicar
DECLARE @Plan136   INT = 136;
DECLARE @Tca7996   INT = 7996;     -- la recarga errónea (US$ 0,13)
DECLARE @MetrosErr DECIMAL(18,4) = 1.2800;
DECLARE @MARCA NVARCHAR(100) = N'fix_plan136_recarga_7996_anulada';

DECLARE @Cue136 INT;
SELECT @Cue136 = CueIdCuenta FROM dbo.PlanesMetros WHERE PlaIdPlan = @Plan136;

/* ── ANTES ───────────────────────────────────────────────────────────────── */
PRINT '===== ANTES =====';
SELECT  pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo,
        cc.CueIdCuenta, cc.CueSaldoActual AS SaldoCuenta,
        (SELECT ISNULL(SUM(m.MovImporte), 0) FROM dbo.MovimientosCuenta m
          WHERE m.CueIdCuenta = pm.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS SumaMovsVivos
FROM    dbo.PlanesMetros pm
JOIN    dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
WHERE   pm.PlaIdPlan = @Plan136;

/* ── PRECONDICIONES ──────────────────────────────────────────────────────── */
DECLARE @err NVARCHAR(500) = NULL;
DECLARE @total DECIMAL(18,4), @usada DECIMAL(18,4), @vivos DECIMAL(18,4);

SELECT @total = PlaCantidadTotal, @usada = PlaCantidadUsada
FROM   dbo.PlanesMetros WHERE PlaIdPlan = @Plan136;

SELECT @vivos = ISNULL(SUM(MovImporte), 0)
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = @Cue136 AND (MovAnulado IS NULL OR MovAnulado = 0);

IF @Cue136 IS NULL
    SET @err = N'No existe el plan #136.';

IF @err IS NULL AND @usada > 0
    SET @err = N'El plan #136 YA TIENE CONSUMO (PlaCantidadUsada > 0). Frená: hay que ver qué se consumió antes de bajarle el total.';

IF @err IS NULL AND @total <> 2.5600
    SET @err = N'El plan #136 no está en 2,56 (está en ' + CAST(@total AS NVARCHAR(20)) + N'). Alguien ya lo tocó: revisá antes de correr esto.';

IF @err IS NULL AND @vivos <> 1.2800
    SET @err = N'Los movimientos vivos de la cuenta no suman 1,28 (suman ' + CAST(@vivos AS NVARCHAR(20)) + N'). Revisá el libro antes de tocar el saldo.';

IF @err IS NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.TransaccionesCaja
        WHERE TcaIdTransaccion = @Tca7996 AND TcaEstado = 'ANULADO')
    SET @err = N'La transacción 7996 (PC-3321, US$ 0,13) TODAVÍA NO ESTÁ ANULADA. Anulala primero desde la app: este script arregla los metros, no la plata.';

IF @err IS NOT NULL
BEGIN
    RAISERROR('ABORTADO: %s', 16, 1, @err);
    RETURN;
END

BEGIN TRAN;

/* ── Los metros de la compra errónea salen del plan ──────────────────────── */
UPDATE dbo.PlanesMetros
SET    PlaCantidadTotal  = PlaCantidadTotal - @MetrosErr,
       PlaActivo         = CASE WHEN (PlaCantidadTotal - @MetrosErr) <= PlaCantidadUsada THEN 0 ELSE PlaActivo END,
       PlaObservaciones  = LEFT(ISNULL(PlaObservaciones + N' | ', N'')
                           + N'-1,28 m el ' + CONVERT(VARCHAR(10), GETDATE(), 103)
                           + N': la recarga de la venta TcaId 7996 (PC-3321, US$ 0,13) fue un error de caja, '
                           + N'quedó anulada y su ENTRADA había sido borrada desde el libro del plan. ['
                           + @MARCA + N']', 500)
WHERE  PlaIdPlan = @Plan136;

/* ── El saldo de la cuenta se alinea con los movimientos vivos (1,28) ─────── */
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

/* ── Saldo corrido, por las dudas ────────────────────────────────────────── */
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
          WHERE m.CueIdCuenta = pm.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS SumaMovsVivos
FROM    dbo.PlanesMetros pm
JOIN    dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
WHERE   pm.PlaIdPlan = @Plan136;

SELECT  m.MovIdMovimiento, m.MovTipo, m.MovImporte, m.MovSaldoPosterior,
        m.MovFecha, m.MovRefExterna, m.MovConcepto, m.MovObservaciones
FROM    dbo.MovimientosCuenta m
WHERE   m.CueIdCuenta = @Cue136
ORDER BY m.MovFecha, m.MovIdMovimiento;

/* Esperado: total 1,28 · usada 0 · activo 1 · saldo 1,28 · 1 ENTRADA de 1,28  */

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
