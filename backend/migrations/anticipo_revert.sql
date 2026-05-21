DECLARE @ConstraintName nvarchar(200)
SELECT @ConstraintName = Name FROM sys.default_constraints
WHERE parent_object_id = OBJECT_ID('OrdenesRetiro') AND parent_column_id = (
    SELECT column_id FROM sys.columns WHERE name = 'OReAprobadoPorAnticipo' AND object_id = OBJECT_ID('OrdenesRetiro')
)
IF @ConstraintName IS NOT NULL
    EXEC('ALTER TABLE dbo.OrdenesRetiro DROP CONSTRAINT ' + @ConstraintName)

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='OrdenesRetiro' AND COLUMN_NAME='OReAprobadoPorAnticipo')
BEGIN
    ALTER TABLE dbo.OrdenesRetiro DROP COLUMN OReAprobadoPorAnticipo;
    PRINT 'Dropped OReAprobadoPorAnticipo';
END

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='OrdenesRetiro' AND COLUMN_NAME='OReIdAnticipo')
BEGIN
    ALTER TABLE dbo.OrdenesRetiro DROP COLUMN OReIdAnticipo;
    PRINT 'Dropped OReIdAnticipo';
END
