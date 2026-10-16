-- =====================================================================
-- PODIUM2024 (Ramos Dominguez Elisa): pasar los 250 mts del plan #185
-- ("Adis Deportivo new") a la cuenta de "Dry Pro New (1,83)" (ProId 411)
-- que el cliente YA tiene, y cerrar la cuenta de Adis Deportivo.
--
-- Se MUEVE el plan #185 (no se crea uno nuevo ni se recarga otro): la venta de
-- caja que lo originó apunta a él (TransaccionDetalle.TdeReferenciaId = 185),
-- así que anular esa venta o hacerle NC sigue revirtiendo los metros, ahora
-- desde la cuenta de Dry Pro.
--
-- Pasos:
--   1. ENTRADA del plan en la cuenta Adis -> se anula (saldo Adis -250)
--   2. Se recrea en la cuenta Dry Pro con la misma fecha y etiquetas
--      (MovRefExterna = TcaId de la venta, MovObservaciones = 'Plan #185')
--   3. Plan #185 -> CueIdCuenta = cuenta Dry Pro, ProIdProducto = 411,
--      materiales permitidos = solo 411
--   4. Sobregiro: si la cuenta Dry Pro venía consumida de más contra sus planes,
--      esos metros se descuentan del plan #185 (mismo criterio que planSobregiroService)
--   5. Cuenta Adis: si queda en 0 y sin planes activos -> se cierra (CueActiva = 0;
--      se puede reabrir desde el gestor de cuentas)
--
-- Correr en SecureAppDB. Queda en transacción abierta: revisar el resultado y
-- ejecutar COMMIT (o ROLLBACK) a mano al final.
-- =====================================================================
SET XACT_ABORT ON;

DECLARE @PlaIdPlan     INT           = 185;
DECLARE @CodCliente    VARCHAR(50)   = 'PODIUM2024';
DECLARE @ProIdNuevo    INT           = 411;   -- Dry Pro New (1,83). El 561 es un duplicado oculto.
DECLARE @MaterialNuevo NVARCHAR(200) = N'Dry Pro New (1,83)';
DECLARE @MaterialViejo NVARCHAR(200) = N'Adis Deportivo new';
DECLARE @Usr           INT           = 1;

DECLARE @CliIdCliente INT, @CueVieja INT, @ProIdViejo INT, @Total DECIMAL(18,4), @Usada DECIMAL(18,4), @Activo BIT;
DECLARE @CueNueva INT, @CantCuentas INT, @SumEntradas DECIMAL(18,4), @CantEntradas INT;
DECLARE @RestanteNueva DECIMAL(18,4), @SaldoNueva DECIMAL(18,4), @Sobregiro DECIMAL(18,4), @Absorber DECIMAL(18,4);
DECLARE @PlanTag NVARCHAR(50);

SELECT @CliIdCliente = CliIdCliente, @CueVieja = CueIdCuenta, @ProIdViejo = ProIdProducto,
       @Total = PlaCantidadTotal, @Usada = PlaCantidadUsada, @Activo = PlaActivo
FROM   dbo.PlanesMetros
WHERE  PlaIdPlan = @PlaIdPlan;

SET @PlanTag = CONCAT('Plan #', @PlaIdPlan);

-- Cuenta destino: la cuenta activa de Dry Pro New (411) del mismo cliente
SELECT @CantCuentas = COUNT(*), @CueNueva = MAX(CueIdCuenta)
FROM   dbo.CuentasCliente
WHERE  CliIdCliente = @CliIdCliente AND ProIdProducto = @ProIdNuevo AND CueActiva = 1 AND CueIdCuenta <> @CueVieja;

-- ENTRADA(s) del plan #185 en la cuenta Adis: etiquetadas 'Plan #185' o con "plan #185" en el concepto
DECLARE @Entradas TABLE (MovIdMovimiento INT PRIMARY KEY);
INSERT INTO @Entradas (MovIdMovimiento)
SELECT m.MovIdMovimiento
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @CueVieja
  AND  m.MovImporte > 0
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  (m.MovObservaciones = @PlanTag
        OR PATINDEX('%plan #' + CAST(@PlaIdPlan AS VARCHAR(20)) + '[^0-9]%', ISNULL(m.MovConcepto, '') + ' ') > 0);

SELECT @CantEntradas = COUNT(*), @SumEntradas = ISNULL(SUM(m.MovImporte), 0)
FROM   dbo.MovimientosCuenta m JOIN @Entradas e ON e.MovIdMovimiento = m.MovIdMovimiento;

-- Sobregiro de la cuenta Dry Pro ANTES de mover nada (mover plan + ENTRADA suma lo mismo a los dos lados)
SELECT @SaldoNueva = ISNULL(CueSaldoActual, 0) FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueNueva;
SELECT @RestanteNueva = ISNULL(SUM(PlaCantidadTotal - PlaCantidadUsada), 0)
FROM   dbo.PlanesMetros WHERE CueIdCuenta = @CueNueva AND PlaActivo = 1;
SET @Sobregiro = CASE WHEN @RestanteNueva - @SaldoNueva > 0 THEN @RestanteNueva - @SaldoNueva ELSE 0 END;
SET @Absorber  = CASE WHEN @Sobregiro > @Total - @Usada THEN @Total - @Usada ELSE @Sobregiro END;

-- ---------- ANTES ----------
SELECT 'ANTES plan 185' AS q, pm.PlaIdPlan, RTRIM(c.IDCliente) IDCliente, RTRIM(c.Nombre) Cliente, pm.CueIdCuenta,
       pm.ProIdProducto, RTRIM(a.Descripcion) Material, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo
FROM   dbo.PlanesMetros pm
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pm.ProIdProducto
LEFT JOIN dbo.Clientes  c ON c.CliIdCliente  = pm.CliIdCliente
WHERE  pm.PlaIdPlan = @PlaIdPlan;

SELECT 'ANTES cuentas' AS q, cc.CueIdCuenta, CASE cc.CueIdCuenta WHEN @CueVieja THEN 'ORIGEN (Adis)' ELSE 'DESTINO (Dry Pro)' END Rol,
       cc.CueTipo, cc.ProIdProducto, RTRIM(a.Descripcion) Material, cc.CueSaldoActual, cc.CueActiva
FROM   dbo.CuentasCliente cc LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
WHERE  cc.CueIdCuenta IN (@CueVieja, @CueNueva);

SELECT 'ANTES planes cuenta destino' AS q, pm.PlaIdPlan, pm.ProIdProducto, pm.PlaCantidadTotal, pm.PlaCantidadUsada,
       pm.PlaCantidadTotal - pm.PlaCantidadUsada AS Restante, pm.PlaActivo
FROM   dbo.PlanesMetros pm WHERE pm.CueIdCuenta = @CueNueva ORDER BY pm.PlaActivo DESC, pm.PlaIdPlan DESC;

SELECT 'ANTES movimientos cuenta origen' AS q, m.MovIdMovimiento, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovFecha,
       m.MovRefExterna, m.MovObservaciones, m.MovAnulado,
       CASE WHEN e.MovIdMovimiento IS NOT NULL THEN 'SE TRASPASA' ELSE '' END Accion
FROM   dbo.MovimientosCuenta m LEFT JOIN @Entradas e ON e.MovIdMovimiento = m.MovIdMovimiento
WHERE  m.CueIdCuenta = @CueVieja ORDER BY m.MovFecha;

SELECT 'ANTES permitidos plan' AS q, * FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan;

SELECT 'Sobregiro cuenta destino' AS q, @SaldoNueva SaldoCuenta, @RestanteNueva RestantePlanesActivos,
       @Sobregiro Sobregiro, @Absorber SeDescuentaDelPlan185;

-- ---------- Frenos ----------
IF @CueVieja IS NULL
    THROW 50001, 'Plan 185 no encontrado. No se cambió nada.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Clientes WHERE CliIdCliente = @CliIdCliente AND LTRIM(RTRIM(IDCliente)) = @CodCliente)
    THROW 50002, 'El plan 185 no es del cliente PODIUM2024. No se cambió nada.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @ProIdViejo AND LTRIM(RTRIM(Descripcion)) = @MaterialViejo)
    THROW 50003, 'El plan 185 ya no tiene "Adis Deportivo new" como material. No se cambió nada.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @ProIdNuevo AND LTRIM(RTRIM(Descripcion)) = @MaterialNuevo)
    THROW 50004, 'El ProId 411 no es "Dry Pro New (1,83)" en esta base. No se cambió nada.', 1;
IF @CantCuentas <> 1
    THROW 50005, 'El cliente no tiene exactamente UNA cuenta activa de Dry Pro New (411) para recibir los metros. No se cambió nada.', 1;
IF @Activo = 0 OR @Usada <> 0
    THROW 50006, 'El plan 185 está cerrado o ya tiene consumos: no se puede traspasar con este script. No se cambió nada.', 1;
IF @CantEntradas = 0 OR @SumEntradas <> @Total
    THROW 50007, 'Las ENTRADA del plan 185 en la cuenta Adis no suman el total del plan (ver "ANTES movimientos cuenta origen"). No se cambió nada.', 1;

BEGIN TRAN;

-- 1. Anular la(s) ENTRADA en la cuenta Adis y bajarle el saldo
UPDATE m
SET    m.MovAnulado       = 1,
       m.MovObservaciones = CONCAT(ISNULL(m.MovObservaciones, ''), ' [TRASPASADO a cuenta #', @CueNueva, ' ', @MaterialNuevo, ']')
FROM   dbo.MovimientosCuenta m JOIN @Entradas e ON e.MovIdMovimiento = m.MovIdMovimiento;

UPDATE dbo.CuentasCliente SET CueSaldoActual = ISNULL(CueSaldoActual, 0) - @SumEntradas WHERE CueIdCuenta = @CueVieja;

-- 2. Recrearla(s) en la cuenta Dry Pro, misma fecha y mismas etiquetas de la venta
UPDATE dbo.CuentasCliente SET CueSaldoActual = ISNULL(CueSaldoActual, 0) + @SumEntradas WHERE CueIdCuenta = @CueNueva;

INSERT INTO dbo.MovimientosCuenta
  (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, OrdIdOrden, OReIdOrdenRetiro,
   PagIdPago, DocIdDocumento, MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo, MovAnulado)
SELECT @CueNueva, m.MovTipo,
       LEFT(CONCAT(m.MovConcepto, ' (traspasado desde ', @MaterialViejo, ')'), 500),
       m.MovImporte,
       (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueNueva),
       NULL, NULL, m.PagIdPago, m.DocIdDocumento, m.MovRefExterna, m.MovFecha, @Usr,
       -- se conserva la etiqueta tal cual: la reversión de la venta busca MovObservaciones LIKE 'Plan #%'
       CASE WHEN m.MovObservaciones LIKE 'Plan #%' THEN @PlanTag ELSE m.MovObservaciones END,
       NULL, 0
FROM   dbo.MovimientosCuenta m JOIN @Entradas e ON e.MovIdMovimiento = m.MovIdMovimiento;

-- 3. Mover el plan a la cuenta Dry Pro con el material nuevo (+ sobregiro absorbido, paso 4)
UPDATE dbo.PlanesMetros
SET    CueIdCuenta      = @CueNueva,
       ProIdProducto    = @ProIdNuevo,
       PlaCantidadUsada = PlaCantidadUsada + @Absorber,
       PlaActivo        = CASE WHEN PlaCantidadUsada + @Absorber >= PlaCantidadTotal THEN 0 ELSE 1 END,
       PlaObservaciones = CONCAT(ISNULL(PlaObservaciones + ' | ', ''),
                                 'Traspasado de cuenta #', @CueVieja, ' (', @MaterialViejo, ') a cuenta #', @CueNueva,
                                 ' (', @MaterialNuevo, ') el ', CONVERT(VARCHAR(10), GETDATE(), 103),
                                 CASE WHEN @Absorber > 0 THEN CONCAT('; absorbe sobregiro de ', @Absorber, ' mts') ELSE '' END)
WHERE  PlaIdPlan = @PlaIdPlan;

DELETE FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan;
INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @ProIdNuevo);

-- 5. Cerrar la cuenta Adis si quedó en 0 y sin planes activos
UPDATE dbo.CuentasCliente
SET    CueActiva = 0, CueAutoConsumo = 0
WHERE  CueIdCuenta = @CueVieja
  AND  ABS(ISNULL(CueSaldoActual, 0)) <= 0.01
  AND  NOT EXISTS (SELECT 1 FROM dbo.PlanesMetros WHERE CueIdCuenta = @CueVieja AND PlaActivo = 1);

-- ---------- DESPUÉS ----------
SELECT 'DESPUES plan 185' AS q, pm.PlaIdPlan, pm.CueIdCuenta, pm.ProIdProducto, RTRIM(a.Descripcion) Material,
       pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo, pm.PlaObservaciones
FROM   dbo.PlanesMetros pm LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pm.ProIdProducto
WHERE  pm.PlaIdPlan = @PlaIdPlan;

SELECT 'DESPUES cuentas' AS q, cc.CueIdCuenta, CASE cc.CueIdCuenta WHEN @CueVieja THEN 'ORIGEN (Adis)' ELSE 'DESTINO (Dry Pro)' END Rol,
       RTRIM(a.Descripcion) Material, cc.CueSaldoActual, cc.CueActiva
FROM   dbo.CuentasCliente cc LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
WHERE  cc.CueIdCuenta IN (@CueVieja, @CueNueva);

SELECT 'DESPUES planes cuenta destino' AS q, pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada,
       pm.PlaCantidadTotal - pm.PlaCantidadUsada AS Restante, pm.PlaActivo
FROM   dbo.PlanesMetros pm WHERE pm.CueIdCuenta = @CueNueva AND pm.PlaActivo = 1;

SELECT TOP 5 'DESPUES movimientos cuenta destino' AS q, m.MovIdMovimiento, m.MovTipo, m.MovConcepto, m.MovImporte,
       m.MovFecha, m.MovRefExterna, m.MovObservaciones
FROM   dbo.MovimientosCuenta m WHERE m.CueIdCuenta = @CueNueva ORDER BY m.MovIdMovimiento DESC;

SELECT 'DESPUES permitidos plan' AS q, * FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan;

-- Si todo se ve bien:
-- COMMIT;
-- Si no:
-- ROLLBACK;
