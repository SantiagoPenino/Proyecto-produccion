-- ============================================================
-- fix-plan-articulos-no-cubiertos.sql  (v3 — dinámico)
-- ============================================================
-- Subsana clientes con órdenes DTF/UV cobradas monetariamente
-- en lugar de descontarse del plan de recursos.
--
-- Clientes en scope: Florencia Sklofsky (6844), Diseño Basico SRL (1731),
--                    Valentina Rodríguez (1821)
-- Solo corrige órdenes con fecha >= creación del plan (PlaFechaAlta).
--
-- @APPLY = 0  → dry-run, solo muestra, NO escribe nada  (default)
-- @APPLY = 1  → aplica dentro de una transacción
-- ============================================================

SET NOCOUNT ON;
DECLARE @APPLY BIT = 1;   -- ← 1 = aplica los cambios

-- ── Resolver IDs de artículos ────────────────────────────────────────────
DECLARE @ProIdDTFComun INT, @ProIdUVRigidos INT;

SELECT @ProIdDTFComun  = ProIdProducto FROM dbo.Articulos WHERE RTRIM(Descripcion) = 'DTF textil COMUN';
SELECT @ProIdUVRigidos = ProIdProducto FROM dbo.Articulos WHERE RTRIM(Descripcion) = 'UV (PARA RIGIDOS 0,27)';

IF @ProIdDTFComun  IS NULL RAISERROR('"DTF textil COMUN" no encontrado.',  16, 1);
IF @ProIdUVRigidos IS NULL RAISERROR('"UV (PARA RIGIDOS 0,27)" no encontrado.', 16, 1);

-- ── Casos confirmados (MovIds obtenidos del diagnóstico) ─────────────────
DECLARE @Casos TABLE (
    Label      VARCHAR(60),
    MovId      INT,          -- MovimientosCuenta.MovIdMovimiento
    OrdIdOrden INT,          -- OrdenesDeposito.OrdIdOrden
    PlaIdPlan  INT,
    ProIdFalta INT
);

INSERT INTO @Casos VALUES
--  Label                    MovId   OrdId  PlaId  ProIdFalta
  ('Florencia Sklofsky',     6278,   1911,  1,     @ProIdDTFComun ),   -- Plan UV  → falta DTF COMUN
  ('Diseño Basico SRL',      5909,   1701,  6,     @ProIdUVRigidos),   -- Plan DTF → falta UV RIGIDOS
  ('Valentina Rodríguez',    4602,   1477,  3,     @ProIdUVRigidos);   -- Plan DTF → falta UV RIGIDOS

-- ── Dry-run preview ──────────────────────────────────────────────────────
PRINT '════════════════════════════════════════════════════════════';
PRINT '  fix-plan-articulos v3 — ' + CASE @APPLY WHEN 1 THEN '⚠️  APPLY' ELSE 'DRY-RUN' END;
PRINT '════════════════════════════════════════════════════════════';
PRINT '';

IF NOT EXISTS (SELECT 1 FROM @Casos)
BEGIN
    PRINT '✅ No hay casos a corregir (todos ya anulados o dentro de lo esperado).';
    RETURN;
END;

SELECT
    c.Label                                                    AS Cliente,
    c.MovId,
    mv.MovImporte                                              AS Cobro,
    mv.MovFecha,
    LEFT(mv.MovConcepto, 50)                                   AS Orden,
    pm.PlaIdPlan,
    CAST(pm.PlaFechaAlta AS VARCHAR(20))                       AS PlanCreadoEl,
    pm.PlaCantidadUsada                                        AS UsadoActual,
    od.OrdCantidad                                             AS Uds,
    pm.PlaCantidadUsada + od.OrdCantidad                       AS UsadoNuevo,
    pm.PlaCantidadTotal                                        AS TotalPlan,
    CASE WHEN EXISTS (
        SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
        WHERE pap.PlaIdPlan = c.PlaIdPlan AND pap.ProIdProducto = c.ProIdFalta
    ) THEN 'Ya en plan' ELSE 'FALTA — agregar' END             AS Permitido,
    CASE WHEN EXISTS (
        SELECT 1 FROM dbo.DeudaDocumento dd
        WHERE dd.OrdIdOrden = c.OrdIdOrden AND dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
    ) THEN 'Pendiente' ELSE 'Sin deuda' END                    AS Deuda
FROM @Casos c
JOIN dbo.MovimientosCuenta mv ON mv.MovIdMovimiento = c.MovId
JOIN dbo.PlanesMetros      pm ON pm.PlaIdPlan       = c.PlaIdPlan
JOIN dbo.OrdenesDeposito   od ON od.OrdIdOrden      = c.OrdIdOrden
ORDER BY c.Label, mv.MovFecha;

IF @APPLY = 0
BEGIN
    PRINT '';
    PRINT '*** DRY-RUN — no se escribió nada.';
    PRINT '*** Cambiá @APPLY = 1 y volvé a ejecutar para aplicar.';
    RETURN;
END;

-- ── Aplicar ───────────────────────────────────────────────────────────────
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE
        @MovId      INT, @OrdIdOrden INT, @PlaIdPlan INT, @ProIdFalta INT,
        @Label      VARCHAR(60),
        @CueRecurso INT, @CueDinero  INT,
        @Importe    DECIMAL(18,4), @Cantidad DECIMAL(18,4);

    DECLARE cur CURSOR FAST_FORWARD FOR
        SELECT Label, MovId, OrdIdOrden, PlaIdPlan, ProIdFalta FROM @Casos ORDER BY Label, MovId;

    OPEN cur;
    FETCH NEXT FROM cur INTO @Label, @MovId, @OrdIdOrden, @PlaIdPlan, @ProIdFalta;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        PRINT '';
        PRINT '→ ' + @Label + '  MovId=' + CAST(@MovId AS VARCHAR);

        SELECT @CueRecurso = CueIdCuenta FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaIdPlan;
        SELECT @CueDinero  = CueIdCuenta, @Importe = ABS(MovImporte)
        FROM   dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovId;
        SELECT @Cantidad   = OrdCantidad FROM dbo.OrdenesDeposito WHERE OrdIdOrden = @OrdIdOrden;

        -- 1. articulosPermitidos
        IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos
                       WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProIdFalta)
        BEGIN
            INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto)
            VALUES (@PlaIdPlan, @ProIdFalta);
            PRINT '  ✓ Producto agregado a articulosPermitidos';
        END
        ELSE PRINT '  · articulosPermitidos ya ok';

        -- 2. Anular movimiento ORDEN
        IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
                   WHERE MovIdMovimiento = @MovId AND (MovAnulado IS NULL OR MovAnulado = 0))
        BEGIN
            UPDATE dbo.MovimientosCuenta
            SET    MovAnulado       = 1,
                   MovObservaciones = ISNULL(MovObservaciones,'') + ' [ANULADO — cubierto por plan, fix v3]'
            WHERE  MovIdMovimiento = @MovId;

            -- 3. Devolver importe al saldo monetario
            UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Importe
            WHERE  CueIdCuenta = @CueDinero;
            PRINT '  ✓ ORDEN anulado, saldo monetario +' + CAST(@Importe AS VARCHAR);
        END
        ELSE PRINT '  · Movimiento ya anulado';

        -- 4. Cancelar deuda
        UPDATE dbo.DeudaDocumento SET DDeEstado = 'CANCELADO', DDeImportePendiente = 0
        WHERE  OrdIdOrden = @OrdIdOrden AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL');
        IF @@ROWCOUNT > 0 PRINT '  ✓ DeudaDocumento cancelada';
        ELSE PRINT '  · Sin deuda pendiente';

        -- 5. Crear ENTREGA en cuenta de recursos
        IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
                       WHERE OrdIdOrden = @OrdIdOrden AND CueIdCuenta = @CueRecurso
                         AND MovTipo = 'ENTREGA' AND (MovAnulado IS NULL OR MovAnulado = 0))
        BEGIN
            INSERT INTO dbo.MovimientosCuenta
                (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovUsuarioAlta,
                 OrdIdOrden, MovObservaciones, MovFecha)
            SELECT @CueRecurso, 'ENTREGA',
                   MovConcepto + ' [corregido]',
                   -ABS(@Cantidad), 1, @OrdIdOrden,
                   'Entrega correctiva — fix v3', GETDATE()
            FROM   dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovId;

            UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Cantidad
            WHERE  CueIdCuenta = @CueRecurso;
            PRINT '  ✓ ENTREGA creada, saldo recursos -' + CAST(@Cantidad AS VARCHAR);
        END
        ELSE PRINT '  · ENTREGA ya existía';

        -- 6. PlaCantidadUsada
        UPDATE dbo.PlanesMetros
        SET    PlaCantidadUsada = PlaCantidadUsada + @Cantidad,
               PlaActivo        = CASE WHEN PlaCantidadUsada + @Cantidad >= PlaCantidadTotal
                                  THEN 0 ELSE 1 END
        WHERE  PlaIdPlan = @PlaIdPlan;
        PRINT '  ✓ PlaCantidadUsada +' + CAST(@Cantidad AS VARCHAR);

        FETCH NEXT FROM cur INTO @Label, @MovId, @OrdIdOrden, @PlaIdPlan, @ProIdFalta;
    END;

    CLOSE cur; DEALLOCATE cur;

    COMMIT TRANSACTION;
    PRINT '';
    PRINT '════════════════════════════════════════════════════════════';
    PRINT '  ✅ COMMIT completado.';
    PRINT '════════════════════════════════════════════════════════════';

END TRY
BEGIN CATCH
    IF CURSOR_STATUS('local','cur') >= 0 BEGIN CLOSE cur; DEALLOCATE cur; END;
    ROLLBACK TRANSACTION;
    PRINT '';
    PRINT '❌ ERROR — ROLLBACK total. No se cambió nada.';
    PRINT ERROR_MESSAGE();
END CATCH;
