/* ============================================================================
   fix_pago_mal_aplicado_pc2220.sql
   ----------------------------------------------------------------------------
   Palmero, 19/07/2026: la especialista cobró $19.583,46 contra PC-2220
   (DocId 4462, deuda real #6846), pero el sistema aplicó el pago a la deuda
   FANTASMA duplicada de PC-1982 (DocId 3418, deuda #5439) en vez de a la de
   PC-2220. No es un cobro de más ni de menos — es el mismo pago archivado en
   el documento equivocado (MovIdMovimiento 20997, sin DocIdDocumento estampado
   y con Obs que referencia "DeudaDoc #5439").

   CONTEXTO YA DIAGNOSTICADO:
     - PC-1982 (3418) tiene su deuda REAL ya saldada por completo en la fila
       #5438 (COBRADO, otros pagos, nada que ver con este). La fila #5439 es
       puramente la duplicada fantasma — antes de este pago mal aplicado no
       tenía nada propio.
     - PC-2220 (4462) sigue con su deuda real (#6846) mostrando el total
       completo sin bajar, porque el pago nunca llegó ahí.

   EL FIX (3 pasos, misma cuenta UYU, sin conversión de moneda):
     1. Mover el movimiento 20997 al documento correcto (DocIdDocumento 4462).
     2. Revertir el efecto en la deuda fantasma #5439 y cancelarla (ya no le
        queda ningún pago propio real).
     3. Aplicar el pago a la deuda real de PC-2220 (#6846): pendiente baja de
        $33.479,61 a $13.896,15.

   Identifica todo por señas (MovId + importe + referencia en Obs), no a
   ciegas — si algo no matchea exactamente lo esperado, aborta sin tocar nada.

   NOTA: esto NO incluye el cheque 629303 ($6.600, "en cartera", sin aplicar)
   — eso se carga aparte, por el flujo normal de pago con cheque existente.
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. PREVIEW — verificar que todo esté como se espera antes de tocar nada ──
SELECT
    m.MovIdMovimiento, m.MovImporte, m.DocIdDocumento AS DocId_ACTUAL,
    LEFT(ISNULL(m.MovObservaciones,''),150) AS Obs
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = 20997;

SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
FROM dbo.DeudaDocumento WHERE DDeIdDocumento IN (5439, 6846);

-- Si la primera consulta no muestra MovImporte=19583.46 y DocId_ACTUAL=NULL,
-- o la segunda no muestra 5439 en PARCIAL (Pendiente ~4714.87) y 6846 en
-- PENDIENTE (33479.61), ALGO CAMBIÓ desde el diagnóstico — revisar antes de seguir.
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @MovId INT = 20997, @Importe DECIMAL(18,2) = 19583.46;
DECLARE @DDeFantasma INT = 5439, @DDeReal INT = 6846, @DocIdReal INT = 4462;
DECLARE @OK BIT = 1;

-- Guard: el movimiento existe, con el importe esperado, sin doc asignado
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovId AND MovImporte = @Importe AND DocIdDocumento IS NULL)
    SET @OK = 0;
-- Guard: la fantasma sigue viva (PARCIAL) — su Pendiente YA refleja este pago aplicado (91257.14 -> 4714.87), no hay que sumarle nada
IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @DDeFantasma AND DDeEstado = 'PARCIAL')
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @DDeReal AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] El estado actual no coincide con lo esperado. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- 2a. Mover el movimiento al documento correcto (PC-2220)
    UPDATE dbo.MovimientosCuenta
    SET DocIdDocumento = @DocIdReal,
        MovObservaciones = 'Reclasificado: este pago era para PC-2220 (deuda #' + CAST(@DDeReal AS VARCHAR(20))
                          + '), había quedado aplicado por error a la deuda fantasma duplicada de PC-1982 (#'
                          + CAST(@DDeFantasma AS VARCHAR(20)) + '). fix_pago_mal_aplicado_pc2220.sql'
    WHERE MovIdMovimiento = @MovId;

    -- 2b. Revertir el efecto en la fantasma de PC-1982 y cancelarla (ya sin pagos propios)
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0,
        DDeEstado = 'CANCELADA',
        DDeObservaciones = LEFT(ISNULL(DDeObservaciones + ' | ','')
                          + 'CANCELADA: el pago que tenía aplicado (' + CAST(@Importe AS VARCHAR(20))
                          + ') en realidad era de PC-2220, reclasificado. fix_pago_mal_aplicado_pc2220.sql', 500)
    WHERE DDeIdDocumento = @DDeFantasma;

    -- 2c. Aplicar el pago a la deuda real de PC-2220
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = CASE WHEN DDeImportePendiente - @Importe < 0.01 THEN 0 ELSE DDeImportePendiente - @Importe END,
        DDeEstado = CASE WHEN DDeImportePendiente - @Importe < 0.01 THEN 'COBRADO' ELSE 'PARCIAL' END,
        DDeObservaciones = LEFT(ISNULL(DDeObservaciones + ' | ','')
                          + 'Pago de ' + CAST(@Importe AS VARCHAR(20)) + ' reclasificado desde la fantasma de PC-1982 (#'
                          + CAST(@DDeFantasma AS VARCHAR(20)) + '). fix_pago_mal_aplicado_pc2220.sql', 500)
    WHERE DDeIdDocumento = @DDeReal;

    PRINT '[OK] Pago reclasificado de PC-1982 (fantasma) a PC-2220 (real).';

    -- Verificación
    SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
    FROM dbo.DeudaDocumento WHERE DDeIdDocumento IN (5439, 6846);

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
GO
