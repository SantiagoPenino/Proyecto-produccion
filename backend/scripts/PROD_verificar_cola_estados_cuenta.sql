-- =====================================================================================
-- PROD_verificar_cola_estados_cuenta.sql  (16-oct-2026)  — SOLO LECTURA
--
-- Bug 9 de la auditoría: la cola de estados de cuenta se sacó del sistema (la pantalla,
-- sus 8 rutas y la generación de los jueves). Nunca se mandó nada: todo quedó PENDIENTE.
-- Este script muestra lo que va a tocar PROD_quitar_cola_estados_cuenta.sql:
--   1. La tabla ColaEstadosCuenta (se VACÍA; la tabla queda, vacía).
--   2. La entrada de menú "/contabilidad/cola-estados" y sus permisos (se BORRAN).
-- No modifica nada.
-- =====================================================================================
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- ── 1. La cola ─────────────────────────────────────────────────────────────────────
PRINT '== 1. Cola: filas por estado (Enviados tiene que dar 0) ==';
SELECT ColEstado, ColTipoDisparo,
       Filas    = COUNT(*),
       Enviados = SUM(CASE WHEN ColFechaEnvio IS NOT NULL THEN 1 ELSE 0 END),
       Primera  = MIN(ColFechaGeneracion),
       Ultima   = MAX(ColFechaGeneracion)
FROM dbo.ColaEstadosCuenta
GROUP BY ColEstado, ColTipoDisparo
ORDER BY ColEstado, ColTipoDisparo;

SELECT TablaMB = CAST(SUM(a.total_pages) * 8 / 1024.0 AS DECIMAL(10,1))
FROM sys.partitions p
JOIN sys.allocation_units a ON a.container_id = p.partition_id
WHERE p.object_id = OBJECT_ID('dbo.ColaEstadosCuenta');

PRINT '== 1b. Lo que impediría vaciarla (las dos listas tienen que salir VACÍAS) ==';
SELECT Fk = name, DesdeTabla = OBJECT_NAME(parent_object_id)
FROM sys.foreign_keys
WHERE referenced_object_id = OBJECT_ID('dbo.ColaEstadosCuenta');

SELECT Objeto = o.name, o.type_desc
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%ColaEstadosCuenta%';

-- ── 2. El menú ─────────────────────────────────────────────────────────────────────
PRINT '== 2. Entrada de menú (tiene que salir 1 fila: "Estados de Cuenta", dentro de Cuenta Corriente) ==';
SELECT m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, Padre = p.Titulo, m.IndiceOrden
FROM dbo.Modulos m
LEFT JOIN dbo.Modulos p ON p.IdModulo = m.IdPadre
WHERE m.Ruta = '/contabilidad/cola-estados';

PRINT '== 2b. Roles que la tienen (se borran estos permisos) ==';
SELECT pr.IdRol, r.NombreRol, pr.IdModulo
FROM dbo.PermisosRoles pr
JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo
LEFT JOIN dbo.Roles r ON r.IdRol = pr.IdRol
WHERE m.Ruta = '/contabilidad/cola-estados';

PRINT '== 2c. Todo lo que apunta a esa entrada (solo PermisosRoles puede tener filas) ==';
DECLARE @IdModulo INT = (SELECT MIN(IdModulo) FROM dbo.Modulos WHERE Ruta = '/contabilidad/cola-estados');
DECLARE @q NVARCHAR(MAX) = N'';
SELECT @q = @q + CASE WHEN @q = N'' THEN N'' ELSE N' UNION ALL ' END
     + N'SELECT Tabla = N''' + OBJECT_SCHEMA_NAME(fk.parent_object_id) + N'.' + OBJECT_NAME(fk.parent_object_id)
     + N''', Columna = N''' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
     + N''', Filas = COUNT(*) FROM ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
     + N' WHERE ' + QUOTENAME(COL_NAME(fkc.parent_object_id, fkc.parent_column_id)) + N' = @Id'
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
WHERE fk.referenced_object_id = OBJECT_ID('dbo.Modulos');
IF @IdModulo IS NULL PRINT '(no hay entrada de menú: nada que revisar)';
ELSE EXEC sp_executesql @q, N'@Id INT', @Id = @IdModulo;
GO
