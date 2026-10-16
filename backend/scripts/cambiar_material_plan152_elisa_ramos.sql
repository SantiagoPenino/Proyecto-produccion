-- =====================================================================
-- Cambiar el MATERIAL del plan de recursos #152 (ELISA RAMOS, CliId 1041)
-- de "Dry Poroso" (ProIdProducto 217) a "Tela Cliente (Minimo 5mts)" (ProIdProducto 1)
-- SIN crear un plan nuevo: se conservan saldo, movimientos y consumos.
--
-- El material del plan vive en 4 lugares y los 4 tienen que quedar iguales:
--   1. PlanesMetros.ProIdProducto                 -> nombre de la tarjeta del plan + cobertura de órdenes
--   2. CuentasCliente.ProIdProducto (cuenta MTS)  -> nombre del "Estado de cuenta — ..."
--   3. PlanesMetrosArticulosPermitidos            -> cobertura de órdenes (OR con el punto 1)
--   4. CuentasClienteArticulosPermitidos          -> solo si la cuenta está restringida (hoy no lo está)
--
-- Correr en SecureAppDB. Queda en transacción abierta: revisar el resultado y
-- ejecutar COMMIT (o ROLLBACK) a mano al final.
-- =====================================================================
SET XACT_ABORT ON;

DECLARE @PlaIdPlan  INT = 152;
DECLARE @NuevoProId INT = 1;      -- Tela Cliente (Minimo 5mts). Cambiar acá si se decide otro material.

DECLARE @CueIdCuenta INT, @ProIdViejo INT, @CliIdCliente INT;
SELECT @CueIdCuenta = CueIdCuenta, @ProIdViejo = ProIdProducto, @CliIdCliente = CliIdCliente
FROM   dbo.PlanesMetros WHERE PlaIdPlan = @PlaIdPlan;

-- ---------- ANTES ----------
SELECT 'ANTES plan' AS q, pm.PlaIdPlan, pm.CliIdCliente, pm.CueIdCuenta, pm.ProIdProducto, RTRIM(a.Descripcion) Material,
       pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo
FROM   dbo.PlanesMetros pm LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pm.ProIdProducto
WHERE  pm.PlaIdPlan = @PlaIdPlan;

SELECT 'ANTES cuenta' AS q, cc.CueIdCuenta, cc.CueTipo, cc.ProIdProducto, RTRIM(a.Descripcion) Material, cc.CueSaldoActual, cc.CueRestringida
FROM   dbo.CuentasCliente cc LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
WHERE  cc.CueIdCuenta = @CueIdCuenta;

SELECT 'ANTES permitidos plan'   AS q, * FROM dbo.PlanesMetrosArticulosPermitidos   WHERE PlaIdPlan   = @PlaIdPlan;
SELECT 'ANTES permitidos cuenta' AS q, * FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @CueIdCuenta;
SELECT 'Nuevo material' AS q, ProIdProducto, RTRIM(Descripcion) Descripcion, UniIdUnidad FROM dbo.Articulos WHERE ProIdProducto = @NuevoProId;

-- Frenos: el plan tiene que existir, ser del cliente 1041 y el artículo nuevo tiene que existir.
IF @CueIdCuenta IS NULL OR @CliIdCliente <> 1041
    THROW 50001, 'Plan 152 no encontrado o no es de ELISA RAMOS (CliId 1041). No se cambió nada.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @NuevoProId)
    THROW 50002, 'El ProIdProducto nuevo no existe en Articulos. No se cambió nada.', 1;

BEGIN TRAN;

-- 1. Plan
UPDATE dbo.PlanesMetros
SET    ProIdProducto   = @NuevoProId,
       PlaObservaciones = CONCAT(ISNULL(PlaObservaciones + ' | ', ''),
                                 'Material cambiado de ProId ', @ProIdViejo, ' a ', @NuevoProId, ' el ', CONVERT(VARCHAR(10), GETDATE(), 103))
WHERE  PlaIdPlan = @PlaIdPlan;

-- 2. Cuenta MTS del plan
UPDATE dbo.CuentasCliente
SET    ProIdProducto = @NuevoProId
WHERE  CueIdCuenta = @CueIdCuenta AND CueTipo = 'MTS';

-- 3. Artículos permitidos del plan: sale el viejo, entra el nuevo
DELETE FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProIdViejo;
IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @NuevoProId)
    INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @NuevoProId);

-- 4. Artículos permitidos de la cuenta (solo si tenía filas)
IF EXISTS (SELECT 1 FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @CueIdCuenta)
BEGIN
    DELETE FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @CueIdCuenta AND ProIdProducto = @ProIdViejo;
    IF NOT EXISTS (SELECT 1 FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @CueIdCuenta AND ProIdProducto = @NuevoProId)
        INSERT INTO dbo.CuentasClienteArticulosPermitidos (CueIdCuenta, ProIdProducto) VALUES (@CueIdCuenta, @NuevoProId);
END

-- ---------- DESPUÉS ----------
SELECT 'DESPUES plan' AS q, pm.PlaIdPlan, pm.ProIdProducto, RTRIM(a.Descripcion) Material, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaObservaciones
FROM   dbo.PlanesMetros pm LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pm.ProIdProducto
WHERE  pm.PlaIdPlan = @PlaIdPlan;

SELECT 'DESPUES cuenta' AS q, cc.CueIdCuenta, cc.ProIdProducto, RTRIM(a.Descripcion) Material, cc.CueSaldoActual
FROM   dbo.CuentasCliente cc LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
WHERE  cc.CueIdCuenta = @CueIdCuenta;

SELECT 'DESPUES permitidos plan'   AS q, * FROM dbo.PlanesMetrosArticulosPermitidos   WHERE PlaIdPlan   = @PlaIdPlan;
SELECT 'DESPUES permitidos cuenta' AS q, * FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @CueIdCuenta;

-- Si todo se ve bien:
-- COMMIT;
-- Si no:
-- ROLLBACK;
