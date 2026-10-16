/* =====================================================================================
   PALLA Y PALLA (cliente 815) — rollo DTF textil COMUN, plan #112, cuenta de metros 2150.
   Pedido 08-oct-2026: sacar del rollo la orden DTF-29731 y poner en su lugar DTF-29519.

   Contexto: al ingresar, DTF-29731 se comió los metros que la cotización había reservado
   para DTF-29519 (UV, 0,44 m, cubierta 100% por el plan). DTF-29519 quedó sin recurso.

   Qué hace, SOLO en la cuenta de metros 2150 y el plan #112:
     1. BORRA los consumos de DTF-29731: 2 ENTREGA (0,21 + 0,39) y sus 2 RECARGO_URGENCIA
        (0,0525 + 0,0975) = 0,75 m. Devuelve esos metros a la cuenta y al plan. Antes de
        borrar guarda copia en dbo._bk_MovsRollo_Palla_DTF29731_20261008.
     2. AGREGA DTF-29519 "stickers fede": ENTREGA de 0,44 m + su RECARGO_URGENCIA del 25%
        (0,11 m), ligados a la orden (OrdIdOrden), igual que los graba el sistema al ingresar
        una orden urgente. Se registran con dbo.SP_RegistrarMovimiento (el mismo que usa
        el sistema: actualiza el saldo de la cuenta y el saldo posterior de cada línea).
     3. Recalcula PlaCantidadUsada y PlaActivo del plan #112.
   Resultado esperado (si prod está como el 07-oct): saldo −0,0975 → 0,1025 m (se ve 0,10).

   NO toca la plata: ni los movimientos ORDEN de DTF-29731 / DTF-29519 en la cuenta de
   dinero, ni la ET-10705, ni las órdenes.

   Frenos:
     - Si DTF-29731 tiene en la cuenta algo distinto de 2 entregas + 2 recargos = 0,75 m,
       no hace nada y avisa (mandame el bloque A_BORRAR).
     - Si DTF-29731 ya no está en la cuenta, saltea el paso 1.
     - Si DTF-29519 ya tiene consumos en la cuenta, saltea el paso 2 (no la duplica).

   @Aplicar = 0 → muestra qué haría y hace ROLLBACK.   @Aplicar = 1 → COMMIT.
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT           = 0;
DECLARE @Usuario     INT           = 2;      -- Yoania Rodriguez: autora de los movimientos nuevos
DECLARE @Cli         INT           = 815;    -- Palla y Palla
DECLARE @Cue         INT           = 2150;   -- cuenta de metros DTF textil COMUN
DECLARE @Plan        INT           = 112;
DECLARE @PctUrgencia DECIMAL(9,4)  = 25;     -- % de recargo de urgencia (el de Configuración)
DECLARE @Metros29519 DECIMAL(18,4) = 0.44;

DECLARE @Ord29731 INT = (SELECT TOP 1 OrdenID FROM dbo.Ordenes WHERE CodigoOrden = 'DTF-29731');
DECLARE @Ord29519 INT = (SELECT TOP 1 OrdenID FROM dbo.Ordenes WHERE CodigoOrden = 'DTF-29519');
DECLARE @Recargo29519 DECIMAL(18,4) = ROUND(@Metros29519 * @PctUrgencia / 100, 4);   -- 0,11

-- ── Controles previos ──────────────────────────────────────────────────────────────
IF @Ord29731 IS NULL OR @Ord29519 IS NULL
    THROW 50001, 'No se encontró DTF-29731 o DTF-29519 en dbo.Ordenes. No se tocó nada.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetros WHERE PlaIdPlan = @Plan AND CueIdCuenta = @Cue AND CliIdCliente = @Cli)
    THROW 50002, 'El plan #112 no es de la cuenta 2150 de Palla y Palla. No se tocó nada.', 1;

SELECT 'ANTES' AS Bloque, cc.CueSaldoActual AS SaldoCuenta,
       (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado, 0) = 0) AS SumaMovimientos,
       pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaCantidadTotal - pm.PlaCantidadUsada AS RestantePlan, pm.PlaActivo
FROM dbo.CuentasCliente cc
JOIN dbo.PlanesMetros pm ON pm.PlaIdPlan = @Plan
WHERE cc.CueIdCuenta = @Cue;

SELECT 'MOVIMIENTOS_DESDE_15_SEP' AS Bloque, MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovSaldoPosterior,
       OrdIdOrden, MovConcepto, MovObservaciones
FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado, 0) = 0 AND MovFecha >= '2026-09-15'
ORDER BY MovIdMovimiento;

-- ── 1. Consumos de DTF-29731 en la cuenta del rollo ───────────────────────────────
IF OBJECT_ID('tempdb..#Borrar') IS NOT NULL DROP TABLE #Borrar;
SELECT MovIdMovimiento, MovTipo, MovImporte, MovConcepto, MovObservaciones
INTO #Borrar
FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @Cue
  AND ISNULL(MovAnulado, 0) = 0
  AND MovTipo IN ('ENTREGA', 'RECARGO_URGENCIA')
  AND (OrdIdOrden = @Ord29731 OR MovConcepto LIKE '%DTF-29731%');

SELECT 'A_BORRAR' AS Bloque, * FROM #Borrar ORDER BY MovIdMovimiento;

DECLARE @CantBorrar   INT           = (SELECT COUNT(*) FROM #Borrar);
DECLARE @MetrosBorrar DECIMAL(18,4) = ISNULL((SELECT -SUM(MovImporte) FROM #Borrar), 0);

IF @CantBorrar > 0 AND (
       @CantBorrar <> 4
    OR ABS(@MetrosBorrar - 0.75) > 0.0001
    OR (SELECT COUNT(*) FROM #Borrar WHERE MovTipo = 'ENTREGA') <> 2
    OR EXISTS (SELECT 1 FROM #Borrar WHERE MovImporte >= 0))
    THROW 50003, 'DTF-29731 no tiene en la cuenta lo esperado (2 entregas + 2 recargos = 0,75 m). No se tocó nada: mandá el bloque A_BORRAR.', 1;

-- ── 2. ¿DTF-29519 ya tiene consumos en la cuenta? ─────────────────────────────────
IF OBJECT_ID('tempdb..#Ya29519') IS NOT NULL DROP TABLE #Ya29519;
SELECT MovIdMovimiento, MovTipo, MovImporte, MovConcepto
INTO #Ya29519
FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @Cue
  AND ISNULL(MovAnulado, 0) = 0
  AND MovTipo IN ('ENTREGA', 'RECARGO_URGENCIA')
  AND (OrdIdOrden = @Ord29519 OR MovConcepto LIKE '%DTF-29519%');

DECLARE @Ya29519 INT = (SELECT COUNT(*) FROM #Ya29519);
IF @Ya29519 > 0
    SELECT 'DTF-29519_YA_ESTA (no se agrega)' AS Bloque, * FROM #Ya29519;

-- Valores para el SP (EXEC no acepta expresiones)
DECLARE @ImpEntrega  DECIMAL(18,4) = -@Metros29519;
DECLARE @ImpRecargo  DECIMAL(18,4) = -@Recargo29519;
DECLARE @PctTxt      NVARCHAR(20)  = CAST(CAST(@PctUrgencia AS FLOAT) AS NVARCHAR(20));   -- '25'
DECLARE @ConEntrega  NVARCHAR(500) = N'DTF-29519 stickers fede';
DECLARE @ObsEntrega  NVARCHAR(500) = CONCAT(N'Plan #', @Plan);
DECLARE @ConRecargo  NVARCHAR(500) = CONCAT(N'Recargo urgencia ', @PctTxt, N'% — DTF-29519');
DECLARE @ObsRecargo  NVARCHAR(500) = CONCAT(N'Recargo de ', @PctTxt, N'% en metros por urgencia no cobrada en $ (Plan #', @Plan, N') — DTF-29519');
DECLARE @MovEntrega  INT, @MovRecargo INT;

BEGIN TRY
    BEGIN TRAN;

    -- 1. Borrar DTF-29731 (con copia de respaldo)
    IF @CantBorrar > 0
    BEGIN
        IF OBJECT_ID('dbo._bk_MovsRollo_Palla_DTF29731_20261008') IS NULL
            SELECT m.* INTO dbo._bk_MovsRollo_Palla_DTF29731_20261008
            FROM dbo.MovimientosCuenta m JOIN #Borrar b ON b.MovIdMovimiento = m.MovIdMovimiento;

        DELETE m FROM dbo.MovimientosCuenta m JOIN #Borrar b ON b.MovIdMovimiento = m.MovIdMovimiento;

        UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @MetrosBorrar WHERE CueIdCuenta = @Cue;

        UPDATE dbo.PlanesMetros
        SET PlaCantidadUsada = CASE WHEN PlaCantidadUsada - @MetrosBorrar < 0 THEN 0 ELSE PlaCantidadUsada - @MetrosBorrar END
        WHERE PlaIdPlan = @Plan;
    END

    -- 2. Agregar DTF-29519: primero la ENTREGA y después su recargo (el sistema liga cada
    --    recargo con la ENTREGA de la misma orden que lo precede)
    IF @Ya29519 = 0
    BEGIN
        EXEC dbo.SP_RegistrarMovimiento
             @CueIdCuenta = @Cue, @MovTipo = 'ENTREGA', @MovConcepto = @ConEntrega,
             @MovImporte = @ImpEntrega, @MovUsuarioAlta = @Usuario, @OrdIdOrden = @Ord29519,
             @MovObservaciones = @ObsEntrega, @MovIdGenerado = @MovEntrega OUTPUT;

        EXEC dbo.SP_RegistrarMovimiento
             @CueIdCuenta = @Cue, @MovTipo = 'RECARGO_URGENCIA', @MovConcepto = @ConRecargo,
             @MovImporte = @ImpRecargo, @MovUsuarioAlta = @Usuario, @OrdIdOrden = @Ord29519,
             @MovObservaciones = @ObsRecargo, @MovIdGenerado = @MovRecargo OUTPUT;

        UPDATE dbo.PlanesMetros
        SET PlaCantidadUsada = PlaCantidadUsada + @Metros29519 + @Recargo29519
        WHERE PlaIdPlan = @Plan;
    END

    -- 3. Plan activo / cerrado: misma regla que el sistema
    UPDATE pm
    SET pm.PlaActivo = CASE WHEN pm.PlaCantidadUsada < pm.PlaCantidadTotal THEN 1
                            WHEN EXISTS (SELECT 1 FROM dbo.Clientes c
                                         JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
                                         WHERE c.CliIdCliente = pm.CliIdCliente
                                           AND (UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
                                             OR UPPER(tc.TClDescripcion) LIKE '%SEMANAL%')) THEN 1
                            ELSE 0 END
    FROM dbo.PlanesMetros pm
    WHERE pm.PlaIdPlan = @Plan;

    -- Resultado
    SELECT 'DESPUES' AS Bloque, cc.CueSaldoActual AS SaldoCuenta,
           (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado, 0) = 0) AS SumaMovimientos,
           pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaCantidadTotal - pm.PlaCantidadUsada AS RestantePlan, pm.PlaActivo,
           @CantBorrar AS MovsBorrados_29731, @MetrosBorrar AS MetrosDevueltos,
           @MovEntrega AS MovEntrega_29519, @MovRecargo AS MovRecargo_29519
    FROM dbo.CuentasCliente cc
    JOIN dbo.PlanesMetros pm ON pm.PlaIdPlan = @Plan
    WHERE cc.CueIdCuenta = @Cue;

    SELECT 'MOVIMIENTOS_DESPUES' AS Bloque, MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovSaldoPosterior,
           OrdIdOrden, MovConcepto, MovObservaciones
    FROM dbo.MovimientosCuenta
    WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado, 0) = 0 AND MovFecha >= '2026-09-15'
    ORDER BY MovIdMovimiento;

    IF @Aplicar = 1
    BEGIN
        COMMIT;
        PRINT 'APLICADO.';
    END
    ELSE
    BEGIN
        ROLLBACK;
        PRINT 'PRUEBA (ROLLBACK): no se guardó nada. Poné @Aplicar = 1 para aplicar.';
    END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
