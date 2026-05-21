-- Migración: agregar columnas de anticipo a OrdenesRetiro
-- Ejecutar UNA sola vez en la base de datos de producción

-- Verificar si ya existen antes de agregar
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'OrdenesRetiro' AND COLUMN_NAME = 'OReAprobadoPorAnticipo'
)
BEGIN
  ALTER TABLE dbo.OrdenesRetiro
    ADD OReAprobadoPorAnticipo BIT NOT NULL DEFAULT 0;
  PRINT 'Columna OReAprobadoPorAnticipo agregada.'
END
ELSE
  PRINT 'Columna OReAprobadoPorAnticipo ya existe — omitida.'

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'OrdenesRetiro' AND COLUMN_NAME = 'OReIdAnticipo'
)
BEGIN
  ALTER TABLE dbo.OrdenesRetiro
    ADD OReIdAnticipo INT NULL;
  PRINT 'Columna OReIdAnticipo agregada.'
END
ELSE
  PRINT 'Columna OReIdAnticipo ya existe — omitida.'

-- Verificar
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM   INFORMATION_SCHEMA.COLUMNS
WHERE  TABLE_NAME = 'OrdenesRetiro'
  AND  COLUMN_NAME IN ('OReAprobadoPorAnticipo', 'OReIdAnticipo');
