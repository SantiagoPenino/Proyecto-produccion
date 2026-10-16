/* ============================================================================
   add_PlaFechaBaja_PlanesMetros.sql
   ----------------------------------------------------------------------------
   El endpoint PATCH /api/contabilidad/planes/:PlaIdPlan/desactivar (el botón
   "Cerrar Plan" de la vista de Recursos) escribe PlaFechaBaja y PlaUsuarioBaja:

       UPDATE dbo.PlanesMetros
       SET PlaActivo = 0, PlaFechaBaja = GETDATE(), PlaUsuarioBaja = @UsuarioBaja
       WHERE PlaIdPlan = @PlaIdPlan

   Esas dos columnas NO existen en el esquema (verificado el 18-ago-2026 contra
   la réplica local: PlanesMetros tiene 15 columnas y ninguna es PlaFechaBaja).
   Mientras falten, el botón revienta con "Invalid column name 'PlaFechaBaja'"
   y NO cierra nada — el plan queda activo.

   Este script las agrega. Es aditivo (dos columnas NULL, sin default, sin
   índices) e idempotente: si ya existen, no hace nada.

   Verificá primero en producción qué hay:

       SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
       FROM   INFORMATION_SCHEMA.COLUMNS
       WHERE  TABLE_NAME = 'PlanesMetros'
       ORDER  BY ORDINAL_POSITION;
   ============================================================================ */

SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('dbo.PlanesMetros') AND name = 'PlaFechaBaja')
BEGIN
    ALTER TABLE dbo.PlanesMetros ADD PlaFechaBaja DATETIME NULL;
    PRINT 'Columna PlaFechaBaja agregada.';
END
ELSE
    PRINT 'PlaFechaBaja ya existía — sin cambios.';

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('dbo.PlanesMetros') AND name = 'PlaUsuarioBaja')
BEGIN
    ALTER TABLE dbo.PlanesMetros ADD PlaUsuarioBaja INT NULL;
    PRINT 'Columna PlaUsuarioBaja agregada.';
END
ELSE
    PRINT 'PlaUsuarioBaja ya existía — sin cambios.';

SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM   INFORMATION_SCHEMA.COLUMNS
WHERE  TABLE_NAME = 'PlanesMetros'
ORDER  BY ORDINAL_POSITION;
