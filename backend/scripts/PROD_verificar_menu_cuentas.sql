-- =====================================================================================
-- PROD_verificar_menu_cuentas.sql  (16-oct-2026)  — SOLO LECTURA
--
-- La ventana vieja de Cuentas se sacó: la reemplazó el Panel 360 (/contabilidad/cliente-360).
-- Las dos entradas de menú que la abrían ("Cuentas" y "Recursos y Planes") ya redirigen al 360
-- desde el código; PROD_quitar_menu_cuentas.sql las borra del menú para que no queden repetidas.
-- Este script muestra lo que va a tocar. No modifica nada.
-- =====================================================================================
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

IF OBJECT_ID('tempdb..#Mods') IS NOT NULL DROP TABLE #Mods;
SELECT IdModulo INTO #Mods FROM dbo.Modulos WHERE Ruta IN ('/contabilidad/cuentas', '/contabilidad/recursos');

PRINT '== 1. Entradas que se borran (tienen que salir "Cuentas" y "Recursos y Planes") ==';
SELECT m.IdModulo, m.Titulo, m.Ruta, Padre = p.Titulo,
       Roles = STUFF((SELECT ', ' + r.NombreRol FROM dbo.PermisosRoles pr JOIN dbo.Roles r ON r.IdRol = pr.IdRol
                      WHERE pr.IdModulo = m.IdModulo FOR XML PATH('')), 1, 2, '')
FROM dbo.Modulos m LEFT JOIN dbo.Modulos p ON p.IdModulo = m.IdPadre
WHERE m.IdModulo IN (SELECT IdModulo FROM #Mods);

PRINT '== 2. El Panel 360 (tiene que salir 1 fila) ==';
SELECT m.IdModulo, m.Titulo, m.Ruta, Padre = p.Titulo,
       Roles = STUFF((SELECT ', ' + r.NombreRol FROM dbo.PermisosRoles pr JOIN dbo.Roles r ON r.IdRol = pr.IdRol
                      WHERE pr.IdModulo = m.IdModulo FOR XML PATH('')), 1, 2, '')
FROM dbo.Modulos m LEFT JOIN dbo.Modulos p ON p.IdModulo = m.IdPadre
WHERE m.Ruta = '/contabilidad/cliente-360';

PRINT '== 3. Roles que se quedarían SIN acceso a cuentas (tiene que salir VACÍO) ==';
SELECT DISTINCT r.IdRol, r.NombreRol
FROM dbo.PermisosRoles pr JOIN dbo.Roles r ON r.IdRol = pr.IdRol
WHERE pr.IdModulo IN (SELECT IdModulo FROM #Mods)
  AND NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles p2 JOIN dbo.Modulos m2 ON m2.IdModulo = p2.IdModulo
                  WHERE p2.IdRol = pr.IdRol AND m2.Ruta = '/contabilidad/cliente-360');

PRINT '== 4. Todo lo que apunta a esas entradas (solo PermisosRoles puede tener filas) ==';
DECLARE @q NVARCHAR(MAX) = N'';
SELECT @q = @q + CASE WHEN @q = N'' THEN N'' ELSE N' UNION ALL ' END
     + N'SELECT Tabla = N''' + OBJECT_SCHEMA_NAME(fk.parent_object_id) + N'.' + OBJECT_NAME(fk.parent_object_id)
     + N''', Columna = N''' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
     + N''', Filas = COUNT(*) FROM ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
     + N' WHERE ' + QUOTENAME(COL_NAME(fkc.parent_object_id, fkc.parent_column_id)) + N' IN (SELECT IdModulo FROM #Mods)'
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
WHERE fk.referenced_object_id = OBJECT_ID('dbo.Modulos');
IF NOT EXISTS (SELECT 1 FROM #Mods) PRINT '(no hay entradas: nada que revisar)';
ELSE EXEC sp_executesql @q;

DROP TABLE #Mods;
GO
