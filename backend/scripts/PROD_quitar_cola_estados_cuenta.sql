-- =====================================================================================
-- PROD_quitar_cola_estados_cuenta.sql  (16-oct-2026)
--
-- Bug 9 de la auditoría: la cola de estados de cuenta se sacó del sistema (la pantalla,
-- sus 8 rutas y la generación de los jueves; el job quedó solo con vencer deudas y abrir
-- ciclos semanales, en jobs/deudasVencidas.job.js). Este script limpia lo que quedó en la base:
--   1. VACÍA dbo.ColaEstadosCuenta (TRUNCATE). La tabla queda, vacía: el script viejo
--      "Para Migrar/05-LIMPIAR_CONTABILIDAD.sql" hace un DELETE sobre ella.
--   2. BORRA la entrada de menú "/contabilidad/cola-estados" ("Estados de Cuenta", dentro
--      de Cuenta Corriente) y sus permisos en PermisosRoles.
-- El "Estado de cuenta" de verdad (el PDF del cliente en Cuentas / 360) NO se toca.
--
-- Correr ANTES PROD_verificar_cola_estados_cuenta.sql y mirar que todo dé como dice.
-- Valida antes de abrir la transacción (si algo no cierra, no toca nada y lo muestra);
-- después de escribir se autochequea y commitea o revierte solo.
-- Idempotente: una segunda corrida no hace nada.
--
-- ⚠️ ORDEN: DESPUÉS del deploy. Si se corre antes, el job viejo vuelve a cargar la cola
-- el jueves siguiente (no rompe nada: se vuelve a correr este script después del deploy).
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Ruta NVARCHAR(200) = N'/contabilidad/cola-estados';
DECLARE @IdModulo INT, @CantModulos INT;
SELECT @CantModulos = COUNT(*), @IdModulo = MIN(IdModulo) FROM dbo.Modulos WHERE Ruta = @Ruta;

-- ── Validaciones (no se toca nada si alguna falla) ─────────────────────────────────
IF @CantModulos > 1
BEGIN
    PRINT '[ABORTADO] Hay más de una entrada de menú con la ruta ' + @Ruta + '. No se modificó nada.';
    SELECT IdModulo, Titulo, IdPadre, Ruta FROM dbo.Modulos WHERE Ruta = @Ruta;
    RETURN;
END

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID('dbo.ColaEstadosCuenta'))
BEGIN
    PRINT '[ABORTADO] Otra tabla tiene una FK hacia ColaEstadosCuenta (TRUNCATE no se puede). No se modificó nada.';
    SELECT Fk = name, DesdeTabla = OBJECT_NAME(parent_object_id)
    FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID('dbo.ColaEstadosCuenta');
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.ColaEstadosCuenta WHERE ColFechaEnvio IS NOT NULL OR ColEstado = 'ENVIADO')
BEGIN
    PRINT '[ABORTADO] La cola tiene estados de cuenta ENVIADOS (se esperaba ninguno). No se modificó nada: avisar antes de borrar.';
    SELECT ColIdCola, CliIdCliente, ColEstado, ColFechaEnvio, ColEmailDestino
    FROM dbo.ColaEstadosCuenta WHERE ColFechaEnvio IS NOT NULL OR ColEstado = 'ENVIADO';
    RETURN;
END

IF OBJECT_ID('tempdb..#Refs') IS NOT NULL DROP TABLE #Refs;
CREATE TABLE #Refs (Tabla NVARCHAR(300) NOT NULL, Columna NVARCHAR(200) NOT NULL, Filas INT NOT NULL);
IF @IdModulo IS NOT NULL
BEGIN
    -- Todo lo que apunta a la entrada de menú (sub-menús por IdPadre, permisos, y cualquier otra FK).
    DECLARE @q NVARCHAR(MAX) = N'';
    SELECT @q = @q + CASE WHEN @q = N'' THEN N'' ELSE N' UNION ALL ' END
         + N'SELECT Tabla = N''' + OBJECT_SCHEMA_NAME(fk.parent_object_id) + N'.' + OBJECT_NAME(fk.parent_object_id)
         + N''', Columna = N''' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
         + N''', Filas = COUNT(*) FROM ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
         + N' WHERE ' + QUOTENAME(COL_NAME(fkc.parent_object_id, fkc.parent_column_id)) + N' = @Id'
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    WHERE fk.referenced_object_id = OBJECT_ID('dbo.Modulos');
    IF @q <> N'' INSERT INTO #Refs EXEC sp_executesql @q, N'@Id INT', @Id = @IdModulo;

    IF EXISTS (SELECT 1 FROM #Refs WHERE Tabla <> N'dbo.PermisosRoles' AND Filas > 0)
    BEGIN
        PRINT '[ABORTADO] Hay algo más que apunta a la entrada de menú (sub-menús u otra tabla). No se modificó nada.';
        SELECT * FROM #Refs WHERE Filas > 0;
        DROP TABLE #Refs;
        RETURN;
    END
END

DECLARE @FilasCola INT = (SELECT COUNT(*) FROM dbo.ColaEstadosCuenta);
DECLARE @Permisos  INT = (SELECT COUNT(*) FROM dbo.PermisosRoles WHERE IdModulo = @IdModulo);

IF @FilasCola = 0 AND @IdModulo IS NULL
BEGIN
    PRINT '[SKIP] Nada que hacer: la cola ya está vacía y la entrada de menú ya no existe.';
    DROP TABLE #Refs;
    RETURN;
END

-- Para que quede a la vista lo que se borra del menú.
SELECT Se_borra = 'Modulos', m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, Padre = p.Titulo, m.IndiceOrden
FROM dbo.Modulos m LEFT JOIN dbo.Modulos p ON p.IdModulo = m.IdPadre
WHERE m.IdModulo = @IdModulo;
SELECT Se_borra = 'PermisosRoles', pr.IdRol, r.NombreRol, pr.IdModulo
FROM dbo.PermisosRoles pr LEFT JOIN dbo.Roles r ON r.IdRol = pr.IdRol
WHERE pr.IdModulo = @IdModulo;

-- ── Aplicación ─────────────────────────────────────────────────────────────────────
DECLARE @PermBorrados INT = 0, @ModBorrados INT = 0;
BEGIN TRY
    BEGIN TRAN;

    IF @FilasCola > 0 TRUNCATE TABLE dbo.ColaEstadosCuenta;

    IF @IdModulo IS NOT NULL
    BEGIN
        DELETE FROM dbo.PermisosRoles WHERE IdModulo = @IdModulo;
        SET @PermBorrados = @@ROWCOUNT;
        DELETE FROM dbo.Modulos WHERE IdModulo = @IdModulo;
        SET @ModBorrados = @@ROWCOUNT;
    END

    -- Autochequeo: cola vacía, entrada y permisos fuera, y se borró exactamente lo contado.
    IF (SELECT COUNT(*) FROM dbo.ColaEstadosCuenta) <> 0
       OR EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = @Ruta)
       OR EXISTS (SELECT 1 FROM dbo.PermisosRoles WHERE IdModulo = @IdModulo)
       OR @PermBorrados <> @Permisos
       OR @ModBorrados <> CASE WHEN @IdModulo IS NULL THEN 0 ELSE 1 END
    BEGIN
        ROLLBACK;
        PRINT '[REVERTIDO] El autochequeo no cerró. No se modificó nada.';
    END
    ELSE
    BEGIN
        COMMIT;
        PRINT '[OK] Cola vaciada (' + CAST(@FilasCola AS VARCHAR(10)) + ' filas). Menú: '
            + CAST(@ModBorrados AS VARCHAR(10)) + ' entrada y ' + CAST(@PermBorrados AS VARCHAR(10)) + ' permiso(s) borrados.';
    END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    PRINT '[REVERTIDO] Error: ' + ERROR_MESSAGE() + ' — No se modificó nada.';
END CATCH

DROP TABLE #Refs;
GO
