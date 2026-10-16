-- ============================================================
-- MIGRACIÓN: Agregar columna EsCajaAdmin
-- ============================================================
-- Agrega la columna EsCajaAdmin (BIT NOT NULL DEFAULT 0) a las
-- tablas TransaccionesCaja y EgresosCaja.
--
-- SEGURIDAD:
--   - Idempotente: si la columna ya existe, no hace nada.
--   - Solo AGREGA columnas con default 0. No borra ni modifica
--     datos existentes. Registros viejos quedan con EsCajaAdmin = 0.
--
-- USO:
--   Abrir en SSMS, conectarse a la base de PRODUCCIÓN, verificar
--   en el dropdown que la base seleccionada es la correcta y
--   ejecutar (F5).
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE Name = N'EsCajaAdmin'
      AND Object_ID = OBJECT_ID(N'dbo.TransaccionesCaja')
)
BEGIN
    ALTER TABLE dbo.TransaccionesCaja
        ADD EsCajaAdmin BIT NOT NULL DEFAULT 0;
    PRINT 'OK: EsCajaAdmin agregado a TransaccionesCaja';
END
ELSE
    PRINT 'INFO: EsCajaAdmin ya existe en TransaccionesCaja';

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE Name = N'EsCajaAdmin'
      AND Object_ID = OBJECT_ID(N'dbo.EgresosCaja')
)
BEGIN
    ALTER TABLE dbo.EgresosCaja
        ADD EsCajaAdmin BIT NOT NULL DEFAULT 0;
    PRINT 'OK: EsCajaAdmin agregado a EgresosCaja';
END
ELSE
    PRINT 'INFO: EsCajaAdmin ya existe en EgresosCaja';
