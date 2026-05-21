-- ============================================================================
-- SCRIPT DE MIGRACIÓN: POBLAR TABLAS DE ESTADOS DESDE SecureAppDB_Vieja
-- ============================================================================
-- Este script realiza un MERGE para las tablas de estados de órdenes desde 
-- la base de datos de origen (SecureAppDB_Vieja) hacia Producción (SecureAppDB).
-- 
-- Tablas migradas:
-- 1. EstadosOrdenes (ESTADOS PRINCIPALES)
-- 2. EstadosOrdenesRetiro
-- 3. ConfigEstados
-- ============================================================================

USE SecureAppDB;
GO

PRINT 'INICIANDO MIGRACIÓN DE TABLAS DE ESTADOS...';
GO

-- ============================================================================
-- 1. MIGRACIÓN DE: EstadosOrdenes
-- ============================================================================
PRINT '>>> Procesando tabla: EstadosOrdenes';

-- (Ninguna de las columnas es IDENTITY, por lo que no es necesario SET IDENTITY_INSERT)
MERGE INTO SecureAppDB.dbo.EstadosOrdenes AS Target
USING (
    SELECT 
        EOrIdEstadoOrden, 
        EOrNombreEstado
    FROM SecureAppDB_Vieja.dbo.EstadosOrdenes
) AS Source
ON Target.EOrIdEstadoOrden = Source.EOrIdEstadoOrden

WHEN MATCHED THEN 
    UPDATE SET 
        Target.EOrNombreEstado = Source.EOrNombreEstado

WHEN NOT MATCHED BY TARGET THEN 
    INSERT (EOrIdEstadoOrden, EOrNombreEstado) 
    VALUES (Source.EOrIdEstadoOrden, Source.EOrNombreEstado);

PRINT '    > EstadosOrdenes migrado exitosamente.';
GO

-- ============================================================================
-- 2. MIGRACIÓN DE: EstadosOrdenesRetiro (Por si acaso, también vinculada a estados)
-- ============================================================================
PRINT '>>> Procesando tabla: EstadosOrdenesRetiro';

MERGE INTO SecureAppDB.dbo.EstadosOrdenesRetiro AS Target
USING (
    SELECT 
        EORIdEstadoOrden, 
        EORNombreEstado
    FROM SecureAppDB_Vieja.dbo.EstadosOrdenesRetiro
) AS Source
ON Target.EORIdEstadoOrden = Source.EORIdEstadoOrden

WHEN MATCHED THEN 
    UPDATE SET 
        Target.EORNombreEstado = Source.EORNombreEstado

WHEN NOT MATCHED BY TARGET THEN 
    INSERT (EORIdEstadoOrden, EORNombreEstado) 
    VALUES (Source.EORIdEstadoOrden, Source.EORNombreEstado);

PRINT '    > EstadosOrdenesRetiro migrado exitosamente.';
GO

-- ============================================================================
-- 3. MIGRACIÓN DE: ConfigEstados (Si la utilizan en produccion actual)
-- ============================================================================
PRINT '>>> Procesando tabla: ConfigEstados';

-- Ajustar tamaño de columnas para evitar truncamientos
ALTER TABLE SecureAppDB.dbo.ConfigEstados ALTER COLUMN TipoEstado NVARCHAR(50);
ALTER TABLE SecureAppDB.dbo.ConfigEstados ALTER COLUMN AreaID NVARCHAR(255);

-- Revisamos si EstadoID es IDENTITY en ConfigEstados
IF OBJECTPROPERTY(OBJECT_ID('ConfigEstados'), 'TableHasIdentity') = 1
BEGIN
    SET IDENTITY_INSERT SecureAppDB.dbo.ConfigEstados ON;
END

MERGE INTO SecureAppDB.dbo.ConfigEstados AS Target
USING (
    SELECT 
        EstadoID, 
        AreaID, 
        Nombre, 
        ColorHex, 
        Orden, 
        EsFinal, 
        TipoEstado
    FROM SecureAppDB_Vieja.dbo.ConfigEstados
) AS Source
ON Target.EstadoID = Source.EstadoID

WHEN MATCHED THEN 
    UPDATE SET 
        Target.AreaID = Source.AreaID,
        Target.Nombre = Source.Nombre,
        Target.ColorHex = Source.ColorHex,
        Target.Orden = Source.Orden,
        Target.EsFinal = Source.EsFinal,
        Target.TipoEstado = Source.TipoEstado

WHEN NOT MATCHED BY TARGET THEN 
    INSERT (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado) 
    VALUES (Source.EstadoID, Source.AreaID, Source.Nombre, Source.ColorHex, Source.Orden, Source.EsFinal, Source.TipoEstado);

IF OBJECTPROPERTY(OBJECT_ID('ConfigEstados'), 'TableHasIdentity') = 1
BEGIN
    SET IDENTITY_INSERT SecureAppDB.dbo.ConfigEstados OFF;
END

PRINT '    > ConfigEstados migrado exitosamente.';
GO

PRINT 'MIGRACIÓN DE ESTADOS COMPLETADA CON ÉXITO.';
GO
