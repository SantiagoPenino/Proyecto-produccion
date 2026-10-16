-- ============================================================
-- Migración: Agregar columna FechaPronto
-- Tabla:     dbo.Ordenes
-- Fecha:     2026-06-26
-- Propósito: Registrar el momento exacto (fecha y hora) en que
--            una orden alcanza el estado PRONTO.
--            Se actualiza automáticamente desde stateManagerService.
-- ============================================================

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE Name      = N'FechaPronto'
      AND Object_ID = OBJECT_ID(N'dbo.Ordenes')
)
BEGIN
    ALTER TABLE dbo.Ordenes
        ADD FechaPronto DATETIME NULL;

    PRINT 'OK: Columna FechaPronto agregada a dbo.Ordenes';
END
ELSE
BEGIN
    PRINT 'INFO: La columna FechaPronto ya existe, no se realizaron cambios.';
END
