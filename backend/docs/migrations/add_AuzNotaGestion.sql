-- ============================================================
-- Migración: Agregar columna AuzNotaGestion
-- Tabla:     dbo.AutorizacionesSinPago
-- Fecha:     2026-06-22
-- Propósito: Almacenar la nota de gestión cuando se cambia
--            el estado de una autorización sin pago
--            (Cobrado / Condonado) desde la vista de excepciones.
-- ============================================================

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE Name        = N'AuzNotaGestion'
      AND Object_ID   = OBJECT_ID(N'dbo.AutorizacionesSinPago')
)
BEGIN
    ALTER TABLE dbo.AutorizacionesSinPago
        ADD AuzNotaGestion NVARCHAR(500) NULL;

    PRINT 'OK: Columna AuzNotaGestion agregada a dbo.AutorizacionesSinPago';
END
ELSE
BEGIN
    PRINT 'INFO: La columna AuzNotaGestion ya existe, no se realizaron cambios.';
END
