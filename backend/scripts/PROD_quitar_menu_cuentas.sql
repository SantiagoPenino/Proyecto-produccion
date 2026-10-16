-- =====================================================================================
-- PROD_quitar_menu_cuentas.sql  (16-oct-2026)
--
-- La ventana vieja de Cuentas se sacó: la reemplazó el Panel 360 (/contabilidad/cliente-360).
-- Este script BORRA del menú las dos entradas que la abrían, con sus permisos:
--   - "Cuentas"            (/contabilidad/cuentas, dentro de Contabilidad)
--   - "Recursos y Planes"  (/contabilidad/recursos, dentro de Cuenta Corriente)
-- Nadie pierde nada: el código ya manda esas direcciones al 360, y el script FRENA si algún
-- rol que tenía estas entradas no tiene el 360.
--
-- Correr ANTES PROD_verificar_menu_cuentas.sql y mirar que todo dé como dice.
-- Valida antes de abrir la transacción (si algo no cierra, no toca nada y lo muestra);
-- después de escribir se autochequea y commitea o revierte solo.
-- Idempotente: una segunda corrida no hace nada.
--
-- ORDEN: después del deploy (antes también funciona: el 360 ya existe; solo desaparecerían
-- del menú las entradas a la ventana vieja un poco antes).
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('tempdb..#Mods') IS NOT NULL DROP TABLE #Mods;
SELECT IdModulo, Titulo, Ruta INTO #Mods FROM dbo.Modulos WHERE Ruta IN ('/contabilidad/cuentas', '/contabilidad/recursos');

-- ── Validaciones (no se toca nada si alguna falla) ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM #Mods)
BEGIN
    PRINT '[SKIP] Nada que hacer: "Cuentas" y "Recursos y Planes" ya no están en el menú.';
    DROP TABLE #Mods;
    RETURN;
END

IF EXISTS (SELECT Ruta FROM #Mods GROUP BY Ruta HAVING COUNT(*) > 1)
BEGIN
    PRINT '[ABORTADO] Hay más de una entrada de menú con la misma ruta. No se modificó nada.';
    SELECT * FROM #Mods ORDER BY Ruta;
    DROP TABLE #Mods;
    RETURN;
END

IF (SELECT COUNT(*) FROM dbo.Modulos WHERE Ruta = '/contabilidad/cliente-360') <> 1
BEGIN
    PRINT '[ABORTADO] No hay exactamente UNA entrada de menú del Panel 360 (/contabilidad/cliente-360). No se modificó nada.';
    DROP TABLE #Mods;
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.PermisosRoles pr
           WHERE pr.IdModulo IN (SELECT IdModulo FROM #Mods)
             AND NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles p2 JOIN dbo.Modulos m2 ON m2.IdModulo = p2.IdModulo
                             WHERE p2.IdRol = pr.IdRol AND m2.Ruta = '/contabilidad/cliente-360'))
BEGIN
    PRINT '[ABORTADO] Estos roles se quedarían sin acceso a cuentas (no tienen el Panel 360). Darles el 360 primero. No se modificó nada.';
    SELECT DISTINCT r.IdRol, r.NombreRol
    FROM dbo.PermisosRoles pr JOIN dbo.Roles r ON r.IdRol = pr.IdRol
    WHERE pr.IdModulo IN (SELECT IdModulo FROM #Mods)
      AND NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles p2 JOIN dbo.Modulos m2 ON m2.IdModulo = p2.IdModulo
                      WHERE p2.IdRol = pr.IdRol AND m2.Ruta = '/contabilidad/cliente-360');
    DROP TABLE #Mods;
    RETURN;
END

-- Todo lo que apunta a esas entradas (sub-menús por IdPadre, permisos y cualquier otra FK).
IF OBJECT_ID('tempdb..#Refs') IS NOT NULL DROP TABLE #Refs;
CREATE TABLE #Refs (Tabla NVARCHAR(300) NOT NULL, Columna NVARCHAR(200) NOT NULL, Filas INT NOT NULL);
DECLARE @q NVARCHAR(MAX) = N'';
SELECT @q = @q + CASE WHEN @q = N'' THEN N'' ELSE N' UNION ALL ' END
     + N'SELECT Tabla = N''' + OBJECT_SCHEMA_NAME(fk.parent_object_id) + N'.' + OBJECT_NAME(fk.parent_object_id)
     + N''', Columna = N''' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
     + N''', Filas = COUNT(*) FROM ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
     + N' WHERE ' + QUOTENAME(COL_NAME(fkc.parent_object_id, fkc.parent_column_id)) + N' IN (SELECT IdModulo FROM #Mods)'
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
WHERE fk.referenced_object_id = OBJECT_ID('dbo.Modulos');
IF @q <> N'' INSERT INTO #Refs EXEC sp_executesql @q;
IF EXISTS (SELECT 1 FROM #Refs WHERE Tabla <> N'dbo.PermisosRoles' AND Filas > 0)
BEGIN
    PRINT '[ABORTADO] Hay algo más que apunta a estas entradas (sub-menús u otra tabla). No se modificó nada.';
    SELECT * FROM #Refs WHERE Filas > 0;
    DROP TABLE #Refs; DROP TABLE #Mods;
    RETURN;
END

DECLARE @CantMods INT = (SELECT COUNT(*) FROM #Mods);
DECLARE @Permisos INT = (SELECT COUNT(*) FROM dbo.PermisosRoles WHERE IdModulo IN (SELECT IdModulo FROM #Mods));

-- Para que quede a la vista lo que se borra.
SELECT Se_borra = 'Modulos', m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, Padre = p.Titulo, m.IndiceOrden
FROM dbo.Modulos m LEFT JOIN dbo.Modulos p ON p.IdModulo = m.IdPadre
WHERE m.IdModulo IN (SELECT IdModulo FROM #Mods);
SELECT Se_borra = 'PermisosRoles', pr.IdRol, r.NombreRol, pr.IdModulo
FROM dbo.PermisosRoles pr LEFT JOIN dbo.Roles r ON r.IdRol = pr.IdRol
WHERE pr.IdModulo IN (SELECT IdModulo FROM #Mods);

-- ── Aplicación ─────────────────────────────────────────────────────────────────────
DECLARE @PermBorrados INT = 0, @ModBorrados INT = 0;
BEGIN TRY
    BEGIN TRAN;

    DELETE FROM dbo.PermisosRoles WHERE IdModulo IN (SELECT IdModulo FROM #Mods);
    SET @PermBorrados = @@ROWCOUNT;
    DELETE FROM dbo.Modulos WHERE IdModulo IN (SELECT IdModulo FROM #Mods);
    SET @ModBorrados = @@ROWCOUNT;

    -- Autochequeo: las dos entradas y sus permisos fuera, el 360 intacto, y se borró exactamente lo contado.
    IF EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta IN ('/contabilidad/cuentas', '/contabilidad/recursos'))
       OR EXISTS (SELECT 1 FROM dbo.PermisosRoles WHERE IdModulo IN (SELECT IdModulo FROM #Mods))
       OR (SELECT COUNT(*) FROM dbo.Modulos WHERE Ruta = '/contabilidad/cliente-360') <> 1
       OR @ModBorrados <> @CantMods
       OR @PermBorrados <> @Permisos
    BEGIN
        ROLLBACK;
        PRINT '[REVERTIDO] El autochequeo no cerró. No se modificó nada.';
    END
    ELSE
    BEGIN
        COMMIT;
        PRINT '[OK] Menú: ' + CAST(@ModBorrados AS VARCHAR(10)) + ' entrada(s) y '
            + CAST(@PermBorrados AS VARCHAR(10)) + ' permiso(s) borrados. Las direcciones viejas llevan al Panel 360.';
    END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    PRINT '[REVERTIDO] Error: ' + ERROR_MESSAGE() + ' — No se modificó nada.';
END CATCH

DROP TABLE #Refs; DROP TABLE #Mods;
GO
