/* =============================================================================
   add_DcdDescuentoPct.sql
   -----------------------------------------------------------------------------
   Guarda el % de descuento de cada línea de factura tal cual lo tipea el usuario.

   POR QUÉ:
   Hasta ahora solo se guardaba el IMPORTE descontado (DcdTotalDescuentos) y el PDF
   volvía a deducir el porcentaje dividiéndolo por el bruto. Como todos los importes
   se guardan redondeados a 2 decimales, un 10% cerrado salía impreso como 10,03%
   (y un 30% como 30,16%). Con la columna nueva el PDF imprime el número exacto.

   Es aditiva y opcional (NULL): los documentos viejos siguen funcionando; para ellos
   el PDF sigue deduciendo el % desde los importes como antes.

   Correr una sola vez en la base de PRODUCCIÓN.
   ============================================================================= */

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.DocumentosContablesDetalle')
      AND name = 'DcdDescuentoPct'
)
BEGIN
    ALTER TABLE dbo.DocumentosContablesDetalle
        ADD DcdDescuentoPct DECIMAL(9,4) NULL;

    PRINT 'OK: columna DcdDescuentoPct agregada a DocumentosContablesDetalle.';
END
ELSE
BEGIN
    PRINT 'La columna DcdDescuentoPct ya existía. No se hizo nada.';
END
GO

/* Verificación */
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DocumentosContablesDetalle'
  AND COLUMN_NAME = 'DcdDescuentoPct';
GO
