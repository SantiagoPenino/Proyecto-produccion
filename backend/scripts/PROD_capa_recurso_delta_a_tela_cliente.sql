/* =============================================================================
   CAPA Indumentaria Deportiva - Recurso (plan de metros) Delta -> Tela Cliente
   Base: SecureAppDB (PRODUCCION)

   IDs tomados de la base LOCAL (replica al 01-oct). Verificar con la PARTE 1
   antes de correr la PARTE 2: en prod pueden haber cambiado saldos o IDs.
     Cliente  CliIdCliente = 854  (CodCliente 198401, IDCliente 'capa')
     Plan     PlaIdPlan    = 43   (Delta, activo)
     Cuenta   CueIdCuenta  = 978  (MTS, ProIdProducto 56)
     Delta         ProIdProducto = 56  (CodArticulo 1223, Grupo 1.1)
     Tela Cliente  ProIdProducto = 1   (CodArticulo 1,    Grupo 1.1)

   Que hace la PARTE 2:
     - PlanesMetros.ProIdProducto        56 -> 1   (material principal del plan)
     - PlanesMetrosArticulosPermitidos   agrega 1; 56 queda o se quita segun
                                         @MantenerViejoPermitido
     - CuentasCliente.ProIdProducto      56 -> 1   (nombre de la cuenta en 360 /
                                         estado de cuenta, y la cuenta que usa
                                         caja para futuras recargas)
     - Deja nota en PlaObservaciones y CueObservaciones.
   Que NO toca: metros (PlaCantidadTotal/Usada), CueSaldoActual,
   MovimientosCuenta (historial), TransaccionDetalle, ordenes ni cotizaciones.
   ============================================================================= */
USE SecureAppDB;
GO

/* =============================================================================
   PARTE 1 - DIAGNOSTICO (SOLO LECTURA)
   ============================================================================= */
SET NOCOUNT ON;

DECLARE @CliIdCliente INT = 854;
DECLARE @PlaIdPlan    INT = 43;
DECLARE @CueIdCuenta  INT = 978;
DECLARE @ProViejo     INT = 56;   -- Delta (1,68 m)
DECLARE @ProNuevo     INT = 1;    -- Tela Cliente (Minimo 5mts)

-- 1.1 Clientes que coinciden con "CAPA" (hay 2 en local: 854 Semanal y 1513 Comun sin planes)
SELECT c.CliIdCliente, c.CodCliente, RTRIM(c.IDCliente) AS IDCliente,
       RTRIM(c.Nombre) AS Nombre, RTRIM(c.NombreFantasia) AS NombreFantasia,
       RTRIM(tc.TClDescripcion) AS TipoCliente
FROM dbo.Clientes c
LEFT JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
WHERE c.Nombre LIKE '%CAPA%' OR c.IDCliente LIKE '%CAPA%' OR c.NombreFantasia LIKE '%CAPA%';

-- 1.2 Articulos involucrados (Delta / Tela Cliente) con precio base
SELECT a.ProIdProducto, RTRIM(a.CodArticulo) AS CodArticulo, a.IDProdReact,
       RTRIM(a.Grupo) AS Grupo, RTRIM(a.Descripcion) AS Descripcion,
       a.UniIdUnidad, a.MonIdMoneda, pb.Precio AS PrecioBase, pb.MonIdMoneda AS PrecioMonIdMoneda
FROM dbo.Articulos a
LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
WHERE a.ProIdProducto IN (@ProViejo, @ProNuevo)
   OR a.Descripcion LIKE '%Tela Cliente%'
   OR a.Descripcion LIKE '%Delta%';

-- 1.3 Planes del cliente, su cuenta y sus articulos permitidos
SELECT pm.PlaIdPlan, pm.CueIdCuenta, pm.ProIdProducto, RTRIM(a.Descripcion) AS MaterialPrincipal,
       pm.PlaCantidadTotal, pm.PlaCantidadUsada,
       pm.PlaCantidadTotal - pm.PlaCantidadUsada AS Disponible,
       pm.PlaActivo, pm.PlaFechaAlta, pm.PlaObservaciones,
       cc.CueTipo, cc.ProIdProducto AS CueProIdProducto, cc.CueSaldoActual, cc.CueActiva,
       Permitidos = STUFF((SELECT ',' + CAST(x.ProIdProducto AS VARCHAR(10))
                           FROM dbo.PlanesMetrosArticulosPermitidos x
                           WHERE x.PlaIdPlan = pm.PlaIdPlan
                           FOR XML PATH('')), 1, 1, '')
FROM dbo.PlanesMetros pm
LEFT JOIN dbo.Articulos a       ON a.ProIdProducto = pm.ProIdProducto
LEFT JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta  = pm.CueIdCuenta
WHERE pm.CliIdCliente = @CliIdCliente
ORDER BY pm.PlaActivo DESC, pm.PlaIdPlan;

-- 1.4 Cuentas MTS del cliente (no debe existir otra con ProIdProducto = Tela Cliente)
SELECT cc.CueIdCuenta, cc.CueTipo, cc.ProIdProducto, RTRIM(a.Descripcion) AS Material,
       cc.CueSaldoActual, cc.CueActiva, cc.CueObservaciones,
       (SELECT COUNT(*) FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta) AS PlanesEnLaCuenta
FROM dbo.CuentasCliente cc
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
WHERE cc.CliIdCliente = @CliIdCliente AND cc.CueTipo = 'MTS';

-- 1.5 Cuadre cuenta vs plan: suma del libro, saldo guardado y disponible del plan
SELECT SUM(m.MovImporte) AS SumaLibro,
       (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta) AS CueSaldoActual,
       (SELECT PlaCantidadTotal - PlaCantidadUsada FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaIdPlan) AS DisponiblePlan
FROM dbo.MovimientosCuenta m
WHERE m.CueIdCuenta = @CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0;

SELECT m.MovTipo, COUNT(*) AS Cant, SUM(m.MovImporte) AS Total, MIN(m.MovFecha) AS Desde, MAX(m.MovFecha) AS Hasta
FROM dbo.MovimientosCuenta m
WHERE m.CueIdCuenta = @CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0
GROUP BY m.MovTipo;

-- 1.6 Ultimos 20 movimientos de la cuenta del plan
SELECT TOP 20 m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovConcepto, m.MovImporte,
       m.MovSaldoPosterior, m.OrdIdOrden, m.MovAnulado, m.MovObservaciones
FROM dbo.MovimientosCuenta m
WHERE m.CueIdCuenta = @CueIdCuenta
ORDER BY m.MovIdMovimiento DESC;

-- 1.7 Ordenes ABIERTAS del cliente con Delta o Tela Cliente y como se cotizaron
SELECT o.OrdenID, o.CodigoOrden, o.Estado, o.ProIdProducto, RTRIM(o.Material) AS Material,
       o.Magnitud, o.CostoTotal, o.FechaIngreso,
       pcd.PrecioUnitario, pcd.Subtotal, pcd.PerfilAplicado, pcd.LogPrecioAplicado
FROM dbo.Ordenes o
LEFT JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.OrdenID = o.OrdenID
WHERE o.CliIdCliente = @CliIdCliente
  AND o.ProIdProducto IN (@ProViejo, @ProNuevo)
  AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Anulado', 'RECHAZADO')
ORDER BY o.OrdenID DESC;

-- 1.8 Otros planes ACTIVOS del cliente que ya cubran Tela Cliente (deberia dar vacio)
SELECT pm.PlaIdPlan, pm.ProIdProducto, pm.PlaActivo
FROM dbo.PlanesMetros pm
WHERE pm.CliIdCliente = @CliIdCliente
  AND pm.PlaActivo = 1
  AND pm.PlaIdPlan <> @PlaIdPlan
  AND (pm.ProIdProducto = @ProNuevo
       OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos x
                  WHERE x.PlaIdPlan = pm.PlaIdPlan AND x.ProIdProducto = @ProNuevo));
GO

/* =============================================================================
   PARTE 2 - CAMBIO
   @Aplicar = 0 -> corre todo dentro de la transaccion, muestra el antes/despues
                   y hace ROLLBACK (simulacion).
   @Aplicar = 1 -> COMMIT.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar                BIT = 0;
DECLARE @CliIdCliente           INT = 854;
DECLARE @PlaIdPlan              INT = 43;
DECLARE @CueIdCuenta            INT = 978;
DECLARE @ProViejo               INT = 56;   -- Delta (1,68 m)
DECLARE @ProNuevo               INT = 1;    -- Tela Cliente (Minimo 5mts)
-- 1 = Delta sigue permitido en el plan (las ordenes Delta abiertas ya cotizadas
--     "Cubierto por Plan #43" siguen descontando de este plan al ingresar).
-- 0 = el plan queda SOLO para Tela Cliente. Exige que no haya ordenes Delta abiertas.
DECLARE @MantenerViejoPermitido BIT = 1;

DECLARE @Err        NVARCHAR(2000);
DECLARE @DescViejo  NVARCHAR(100), @DescNuevo NVARCHAR(100);
DECLARE @GrupoViejo VARCHAR(20),   @GrupoNuevo VARCHAR(20);
DECLARE @Nota       NVARCHAR(300);
DECLARE @Cnt        INT;
DECLARE @SaldoAntes DECIMAL(18,4), @SaldoDespues DECIMAL(18,4);
DECLARE @DispAntes  DECIMAL(18,4), @DispDespues  DECIMAL(18,4);
DECLARE @PlaCli INT, @PlaPro INT, @PlaCue INT, @PlaAct BIT;
DECLARE @CueCli INT, @CueTipo VARCHAR(50), @CuePro INT, @CueAct BIT;

BEGIN TRY
    BEGIN TRAN;

    /* ---------- Precondiciones ---------- */
    SELECT @PlaCli = CliIdCliente, @PlaPro = ProIdProducto, @PlaCue = CueIdCuenta, @PlaAct = PlaActivo,
           @DispAntes = PlaCantidadTotal - PlaCantidadUsada
    FROM dbo.PlanesMetros WITH (UPDLOCK, HOLDLOCK)
    WHERE PlaIdPlan = @PlaIdPlan;

    IF @PlaCli IS NULL
    BEGIN SET @Err = CONCAT(N'No existe el plan #', @PlaIdPlan, N'.'); THROW 50001, @Err, 1; END;
    IF @PlaCli <> @CliIdCliente
    BEGIN SET @Err = CONCAT(N'El plan #', @PlaIdPlan, N' es del cliente ', @PlaCli, N', no del ', @CliIdCliente, N'.'); THROW 50002, @Err, 1; END;
    IF @PlaPro = @ProNuevo
    BEGIN SET @Err = CONCAT(N'El plan #', @PlaIdPlan, N' ya tiene material ', @ProNuevo, N'. Nada que hacer.'); THROW 50003, @Err, 1; END;
    IF @PlaPro <> @ProViejo
    BEGIN SET @Err = CONCAT(N'El plan #', @PlaIdPlan, N' tiene material ', @PlaPro, N', se esperaba ', @ProViejo, N'.'); THROW 50004, @Err, 1; END;
    IF @PlaCue IS NULL OR @PlaCue <> @CueIdCuenta
    BEGIN SET @Err = CONCAT(N'El plan #', @PlaIdPlan, N' apunta a la cuenta ', ISNULL(CAST(@PlaCue AS NVARCHAR(20)), N'NULL'), N', se esperaba ', @CueIdCuenta, N'.'); THROW 50005, @Err, 1; END;
    IF @PlaAct <> 1
    BEGIN SET @Err = CONCAT(N'El plan #', @PlaIdPlan, N' no esta activo.'); THROW 50006, @Err, 1; END;

    SELECT @CueCli = CliIdCliente, @CueTipo = CueTipo, @CuePro = ProIdProducto, @CueAct = CueActiva,
           @SaldoAntes = CueSaldoActual
    FROM dbo.CuentasCliente WITH (UPDLOCK, HOLDLOCK)
    WHERE CueIdCuenta = @CueIdCuenta;

    IF @CueCli IS NULL OR @CueCli <> @CliIdCliente OR @CueTipo <> 'MTS'
    BEGIN SET @Err = CONCAT(N'La cuenta ', @CueIdCuenta, N' no existe, no es del cliente o no es MTS.'); THROW 50007, @Err, 1; END;
    IF ISNULL(@CuePro, -1) <> @ProViejo
    BEGIN SET @Err = CONCAT(N'La cuenta ', @CueIdCuenta, N' tiene ProIdProducto ', ISNULL(CAST(@CuePro AS NVARCHAR(20)), N'NULL'), N', se esperaba ', @ProViejo, N'.'); THROW 50008, @Err, 1; END;
    IF @CueAct <> 1
    BEGIN SET @Err = CONCAT(N'La cuenta ', @CueIdCuenta, N' no esta activa.'); THROW 50009, @Err, 1; END;

    SELECT @DescViejo = RTRIM(Descripcion), @GrupoViejo = RTRIM(Grupo) FROM dbo.Articulos WHERE ProIdProducto = @ProViejo;
    SELECT @DescNuevo = RTRIM(Descripcion), @GrupoNuevo = RTRIM(Grupo) FROM dbo.Articulos WHERE ProIdProducto = @ProNuevo;

    IF @DescNuevo IS NULL OR @DescNuevo NOT LIKE N'%Tela Cliente%'
    BEGIN SET @Err = CONCAT(N'El articulo ', @ProNuevo, N' no es Tela Cliente (', ISNULL(@DescNuevo, N'no existe'), N').'); THROW 50010, @Err, 1; END;
    IF @DescViejo IS NULL OR @DescViejo NOT LIKE N'%Delta%'
    BEGIN SET @Err = CONCAT(N'El articulo ', @ProViejo, N' no es Delta (', ISNULL(@DescViejo, N'no existe'), N').'); THROW 50011, @Err, 1; END;
    IF ISNULL(@GrupoViejo, '') <> ISNULL(@GrupoNuevo, '')
    BEGIN SET @Err = CONCAT(N'Delta (Grupo ', @GrupoViejo, N') y Tela Cliente (Grupo ', @GrupoNuevo, N') no son del mismo grupo. Revisar antes de seguir.'); THROW 50012, @Err, 1; END;

    -- Otra cuenta MTS del cliente con Tela Cliente: caja no sabria cual recargar.
    SELECT @Cnt = COUNT(*) FROM dbo.CuentasCliente
    WHERE CliIdCliente = @CliIdCliente AND CueTipo = 'MTS' AND ProIdProducto = @ProNuevo AND CueIdCuenta <> @CueIdCuenta;
    IF @Cnt > 0
    BEGIN SET @Err = CONCAT(N'El cliente ya tiene ', @Cnt, N' cuenta(s) MTS de Tela Cliente. Unificar a mano.'); THROW 50013, @Err, 1; END;

    -- Otro plan activo que ya cubra Tela Cliente: el consumo se repartiria entre los dos.
    SELECT @Cnt = COUNT(*) FROM dbo.PlanesMetros pm
    WHERE pm.CliIdCliente = @CliIdCliente AND pm.PlaActivo = 1 AND pm.PlaIdPlan <> @PlaIdPlan
      AND (pm.ProIdProducto = @ProNuevo
           OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos x
                      WHERE x.PlaIdPlan = pm.PlaIdPlan AND x.ProIdProducto = @ProNuevo));
    IF @Cnt > 0
    BEGIN SET @Err = CONCAT(N'El cliente ya tiene ', @Cnt, N' plan(es) activo(s) que cubren Tela Cliente.'); THROW 50014, @Err, 1; END;

    -- La cuenta tiene que ser solo de este plan (si no, el cambio de material la afecta a otros).
    SELECT @Cnt = COUNT(*) FROM dbo.PlanesMetros WHERE CueIdCuenta = @CueIdCuenta AND PlaIdPlan <> @PlaIdPlan;
    IF @Cnt > 0
    BEGIN SET @Err = CONCAT(N'La cuenta ', @CueIdCuenta, N' tiene otros ', @Cnt, N' plan(es). Revisar a mano.'); THROW 50015, @Err, 1; END;

    -- Si Delta deja de estar permitido, no puede haber ordenes Delta abiertas (quedarian sin plan y a $0).
    IF @MantenerViejoPermitido = 0
    BEGIN
        SELECT @Cnt = COUNT(*) FROM dbo.Ordenes o
        WHERE o.CliIdCliente = @CliIdCliente AND o.ProIdProducto = @ProViejo
          AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Anulado', 'RECHAZADO');
        IF @Cnt > 0
        BEGIN SET @Err = CONCAT(N'Hay ', @Cnt, N' orden(es) Delta abiertas cotizadas contra el plan. Usar @MantenerViejoPermitido = 1 o recotizarlas antes.'); THROW 50016, @Err, 1; END;
    END;

    /* ---------- Antes ---------- */
    SELECT 'ANTES' AS Momento, pm.PlaIdPlan, pm.ProIdProducto, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo,
           cc.CueIdCuenta, cc.ProIdProducto AS CueProIdProducto, cc.CueSaldoActual,
           Permitidos = STUFF((SELECT ',' + CAST(x.ProIdProducto AS VARCHAR(10)) FROM dbo.PlanesMetrosArticulosPermitidos x
                               WHERE x.PlaIdPlan = pm.PlaIdPlan FOR XML PATH('')), 1, 1, '')
    FROM dbo.PlanesMetros pm JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
    WHERE pm.PlaIdPlan = @PlaIdPlan;

    /* ---------- Cambios ---------- */
    SET @Nota = CONCAT(N' | Material cambiado de ', @DescViejo, N' (', @ProViejo, N') a ', @DescNuevo, N' (', @ProNuevo,
                       N') el ', CONVERT(CHAR(10), GETDATE(), 23), N' (script manual, pedido del usuario)');

    -- 1) Material principal del plan
    UPDATE dbo.PlanesMetros
       SET ProIdProducto    = @ProNuevo,
           PlaObservaciones = LEFT(ISNULL(PlaObservaciones, N'') + @Nota, 500)
     WHERE PlaIdPlan = @PlaIdPlan AND CliIdCliente = @CliIdCliente AND ProIdProducto = @ProViejo;
    IF @@ROWCOUNT <> 1 THROW 50020, N'UPDATE PlanesMetros no afecto exactamente 1 fila.', 1;

    -- 2) Articulos permitidos: Tela Cliente siempre
    IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProNuevo)
        INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @ProNuevo);

    --    Delta: se mantiene (debe estar en la tabla, porque ya no es el principal) o se quita
    IF @MantenerViejoPermitido = 1
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProViejo)
            INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @ProViejo);
    END
    ELSE
        DELETE FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProViejo;

    -- 3) Cuenta MTS: producto de la cuenta (nombre en 360 y cuenta que usa caja para recargar)
    UPDATE dbo.CuentasCliente
       SET ProIdProducto    = @ProNuevo,
           CueObservaciones = LEFT(ISNULL(CueObservaciones, N'') + @Nota, 500)
     WHERE CueIdCuenta = @CueIdCuenta AND CliIdCliente = @CliIdCliente AND CueTipo = 'MTS' AND ProIdProducto = @ProViejo;
    IF @@ROWCOUNT <> 1 THROW 50021, N'UPDATE CuentasCliente no afecto exactamente 1 fila.', 1;

    /* ---------- Despues + controles ---------- */
    SELECT @DispDespues = PlaCantidadTotal - PlaCantidadUsada FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaIdPlan;
    SELECT @SaldoDespues = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta;
    IF @DispDespues <> @DispAntes OR @SaldoDespues <> @SaldoAntes
        THROW 50022, N'Cambiaron los metros o el saldo: no deberia pasar. Se aborta.', 1;

    SELECT 'DESPUES' AS Momento, pm.PlaIdPlan, pm.ProIdProducto, RTRIM(a.Descripcion) AS MaterialPrincipal,
           pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo, pm.PlaObservaciones,
           cc.CueIdCuenta, cc.ProIdProducto AS CueProIdProducto, cc.CueSaldoActual, cc.CueObservaciones,
           Permitidos = STUFF((SELECT ',' + CAST(x.ProIdProducto AS VARCHAR(10)) FROM dbo.PlanesMetrosArticulosPermitidos x
                               WHERE x.PlaIdPlan = pm.PlaIdPlan FOR XML PATH('')), 1, 1, '')
    FROM dbo.PlanesMetros pm
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
    LEFT JOIN dbo.Articulos a  ON a.ProIdProducto = pm.ProIdProducto
    WHERE pm.PlaIdPlan = @PlaIdPlan;

    -- Simulacion de cobertura: que plan encontraria el motor para cada material
    SELECT 'COBERTURA' AS Control, p.ProId,
           (SELECT TOP 1 pm.PlaIdPlan FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = @CliIdCliente AND pm.PlaActivo = 1
               AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
               AND (pm.ProIdProducto = p.ProId
                    OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos x
                               WHERE x.PlaIdPlan = pm.PlaIdPlan AND x.ProIdProducto = p.ProId))
             ORDER BY pm.PlaFechaAlta) AS PlanQueCubre
    FROM (VALUES (@ProNuevo), (@ProViejo)) AS p(ProId);

    IF @Aplicar = 1
    BEGIN
        COMMIT TRAN;
        PRINT 'APLICADO: plan y cuenta pasados a Tela Cliente.';
    END
    ELSE
    BEGIN
        ROLLBACK TRAN;
        PRINT 'SIMULACION (@Aplicar = 0): se hizo ROLLBACK, no quedo nada cambiado.';
    END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO
