USE [SecureAppDB];
GO

-- ============================================================
-- FIX: Agregar DEFAULT GETDATE() a SesionesTurno.StuFechaApertura
-- Ejecutar en producción para resolver el error al abrir caja.
-- Es seguro: solo agrega el constraint si no existe.
-- ============================================================

-- 1. Verificar el estado actual
SELECT 
    c.COLUMN_NAME,
    c.IS_NULLABLE,
    c.COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = 'SesionesTurno' AND c.COLUMN_NAME = 'StuFechaApertura';
GO

-- 2. Agregar el DEFAULT GETDATE() si no existe ya
IF NOT EXISTS (
    SELECT * FROM sys.default_constraints 
    WHERE parent_object_id = OBJECT_ID('SesionesTurno') 
      AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('SesionesTurno'), 'StuFechaApertura', 'ColumnId')
)
BEGIN
    ALTER TABLE [dbo].[SesionesTurno] 
    ADD CONSTRAINT DF_SesionesTurno_FechaApertura 
    DEFAULT (GETDATE()) FOR [StuFechaApertura];
    
    PRINT '✅ Constraint DEFAULT GETDATE() agregado correctamente a StuFechaApertura.';
END
ELSE
BEGIN
    PRINT '⚠️  El constraint DEFAULT ya existía. No se realizaron cambios.';
END
GO

-- 3. Verificar el resultado final
SELECT 
    c.COLUMN_NAME,
    c.IS_NULLABLE,
    c.COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = 'SesionesTurno' AND c.COLUMN_NAME = 'StuFechaApertura';
GO
