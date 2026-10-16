-- ============================================================
-- Migración: Agregar columna EsCajaAdmin
-- Tablas:    dbo.TransaccionesCaja / dbo.EgresosCaja
-- Fecha:     2026-06-22
-- Propósito: Distinguir registros originados en Caja Normal (0)
--            de los originados en Caja Administrativa (1),
--            necesario para el filtrado de resúmenes de turno.
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE Name      = N'EsCajaAdmin'
      AND Object_ID = OBJECT_ID(N'dbo.TransaccionesCaja')
)
BEGIN
    ALTER TABLE dbo.TransaccionesCaja
        ADD EsCajaAdmin BIT NOT NULL DEFAULT 0;
    PRINT 'OK: EsCajaAdmin agregado a TransaccionesCaja';
END
ELSE
    PRINT 'INFO: EsCajaAdmin ya existe en TransaccionesCaja, sin cambios.';

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE Name      = N'EsCajaAdmin'
      AND Object_ID = OBJECT_ID(N'dbo.EgresosCaja')
)
BEGIN
    ALTER TABLE dbo.EgresosCaja
        ADD EsCajaAdmin BIT NOT NULL DEFAULT 0;
    PRINT 'OK: EsCajaAdmin agregado a EgresosCaja';
END
ELSE
    PRINT 'INFO: EsCajaAdmin ya existe en EgresosCaja, sin cambios.';
