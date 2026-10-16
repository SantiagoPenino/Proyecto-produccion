-- ============================================================
-- MIGRACIÓN: Sistema de Excepciones al Recargo de Urgencia
-- Fecha: 2026-07-03
-- NOTA: La tabla UrgenciaExcepciones ya existe en producción.
--       Este script solo ajusta el constraint y las configs.
-- IMPACTO: NINGUNO en tablas existentes.
-- ============================================================

-- 1. Corregir UNIQUE constraint a 3 columnas (CliIdCliente, ProIdProducto, CodArea)
--    Por si quedó el viejo de 2 columnas que causaba error al agregar varias áreas.
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_UrgExc'
      AND parent_object_id = OBJECT_ID('dbo.UrgenciaExcepciones')
)
BEGIN
    IF (
        SELECT COUNT(*) FROM sys.index_columns ic
        JOIN sys.key_constraints kc
            ON ic.object_id = kc.parent_object_id
           AND ic.index_id  = kc.unique_index_id
        WHERE kc.name = 'UQ_UrgExc'
          AND kc.parent_object_id = OBJECT_ID('dbo.UrgenciaExcepciones')
    ) < 3
    BEGIN
        ALTER TABLE dbo.UrgenciaExcepciones DROP CONSTRAINT UQ_UrgExc;
        ALTER TABLE dbo.UrgenciaExcepciones
            ADD CONSTRAINT UQ_UrgExc UNIQUE (CliIdCliente, ProIdProducto, CodArea);
        PRINT 'UQ_UrgExc actualizado a 3 columnas.';
    END
    ELSE
        PRINT 'UQ_UrgExc ya tiene 3 columnas — sin cambios.';
END
ELSE
BEGIN
    ALTER TABLE dbo.UrgenciaExcepciones
        ADD CONSTRAINT UQ_UrgExc UNIQUE (CliIdCliente, ProIdProducto, CodArea);
    PRINT 'UQ_UrgExc creado con 3 columnas.';
END
GO

-- 2. Registrar ID del perfil de urgencia en ConfiguracionGlobal
--    VERIFICAR: SELECT ID, Nombre FROM PerfilesPrecios WHERE Nombre LIKE '%urgencia%'
--    Si el ID no es 2, cambiar el valor abajo antes de ejecutar.
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'ID_PERFIL_URGENCIA')
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, Valor) VALUES ('ID_PERFIL_URGENCIA', '2');
    PRINT 'ID_PERFIL_URGENCIA insertado.';
END
ELSE
    PRINT 'ID_PERFIL_URGENCIA ya existe — sin cambios.';
GO

-- 3. Áreas excluidas de urgencia cuando el perfil tiene Categoría = Todos
--    (ignorado automáticamente si el perfil tiene áreas específicas configuradas)
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_SIN_URGENCIA')
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, Valor) VALUES ('AREAS_SIN_URGENCIA', 'BOR,EMB,COR,TWC,COS,TWT');
    PRINT 'AREAS_SIN_URGENCIA insertado.';
END
ELSE
    PRINT 'AREAS_SIN_URGENCIA ya existe — sin cambios.';
GO

PRINT 'Migración completada sin errores.';
GO
