/*
  Fix histórico: traspaso de excedente entre Plan #60 (cerrado, agotado) y
  Plan #82 (activo) del cliente Posse Gutierrez Santiago (CliIdCliente 51814799),
  producto DTF textil COMUN.

  Contexto: PlanesMetros.PlaCantidadUsada nunca puede superar PlaCantidadTotal
  (capado en el código). El excedente que el cliente consumió de más sobre el
  Plan #60 quedó registrado SOLO como movimiento negativo en MovimientosCuenta
  ("Exceso s/ Plan #60" / "Negativo retroactivo ... Plan #60"), sin reflejarse
  en el Plan #82 nuevo, que arrancó con PlaCantidadUsada = 0.

  Este script:
    1) Muestra (SELECT) el excedente detectado antes de tocar nada.
    2) Actualiza Plan #82 sumando ese excedente a PlaCantidadUsada (topeado a
       PlaCantidadTotal) y ajusta PlaActivo si corresponde.
    3) Marca los movimientos de excedente como absorbidos, para que el código
       nuevo (ya deployado) no los vuelva a heredar en el próximo plan.

  IMPORTANTE: correr primero el PASO 1 (solo SELECT) y verificar el monto antes
  de ejecutar los UPDATE de los pasos 2 y 3. No modifica CueSaldoActual — la
  cuenta corriente de metros ya está correcta y no se toca.
*/

-- ============================================================
-- PASO 1 — Verificación (solo lectura, correr primero)
-- ============================================================
SELECT
    mc.MovIdMovimiento,
    mc.CueIdCuenta,
    mc.MovImporte,
    mc.MovConcepto,
    mc.MovObservaciones,
    mc.MovFecha
FROM dbo.MovimientosCuenta mc WITH (NOLOCK)
JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
WHERE cc.CliIdCliente = 51814799
  AND mc.MovImporte < 0
  AND (
        mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
     OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
      )
  AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%'
ORDER BY mc.MovFecha;

-- Total de excedente sin absorber (revisar que coincida con lo esperado antes de seguir)
SELECT SUM(ABS(mc.MovImporte)) AS ExcedenteTotalSinAbsorber
FROM dbo.MovimientosCuenta mc WITH (NOLOCK)
JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
WHERE cc.CliIdCliente = 51814799
  AND mc.MovImporte < 0
  AND (
        mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
     OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
      )
  AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%';

-- Estado actual del Plan #82 (para comparar antes/después)
SELECT PlaIdPlan, PlaCantidadTotal, PlaCantidadUsada, PlaActivo
FROM dbo.PlanesMetros
WHERE PlaIdPlan = 82;


-- ============================================================
-- PASO 2 — Aplicar el traspaso al Plan #82 (correr solo después de validar el PASO 1)
-- ============================================================
BEGIN TRAN;

DECLARE @Exceso   DECIMAL(18,4);
DECLARE @Total    DECIMAL(18,4);
DECLARE @UsadaNva DECIMAL(18,4);

SELECT @Exceso = ISNULL(SUM(ABS(mc.MovImporte)), 0)
FROM dbo.MovimientosCuenta mc WITH (UPDLOCK)
JOIN dbo.CuentasCliente    cc WITH (NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
WHERE cc.CliIdCliente = 51814799
  AND mc.MovImporte < 0
  AND (
        mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
     OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
      )
  AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%';

SELECT @Total = PlaCantidadTotal FROM dbo.PlanesMetros WHERE PlaIdPlan = 82;

SET @UsadaNva = CASE WHEN @Exceso > @Total THEN @Total ELSE @Exceso END;

UPDATE dbo.PlanesMetros
SET PlaCantidadUsada = PlaCantidadUsada + @UsadaNva,
    PlaActivo         = CASE WHEN (PlaCantidadUsada + @UsadaNva) >= PlaCantidadTotal THEN 0 ELSE 1 END
WHERE PlaIdPlan = 82;

-- PASO 3 — Marcar los movimientos de excedente como absorbidos por el Plan #82
UPDATE mc
SET mc.MovObservaciones = CONCAT(mc.MovObservaciones, '_ABSORBIDO_PLAN_82')
FROM dbo.MovimientosCuenta mc
JOIN dbo.CuentasCliente    cc ON cc.CueIdCuenta = mc.CueIdCuenta
WHERE cc.CliIdCliente = 51814799
  AND mc.MovImporte < 0
  AND (
        mc.MovObservaciones LIKE 'Exceso s/ Plan #%'
     OR mc.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
      )
  AND mc.MovObservaciones NOT LIKE '%_ABSORBIDO_PLAN_%';

-- Verificar el resultado antes de confirmar
SELECT PlaIdPlan, PlaCantidadTotal, PlaCantidadUsada, PlaActivo
FROM dbo.PlanesMetros
WHERE PlaIdPlan = 82;

-- Si todo se ve correcto:
-- COMMIT TRAN;
-- Si algo no cuadra:
-- ROLLBACK TRAN;
