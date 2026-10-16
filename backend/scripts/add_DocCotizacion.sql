/* =============================================================================
   add_DocCotizacion.sql
   -----------------------------------------------------------------------------
   Guarda en CADA documento el tipo de cambio (USD → UYU) con el que se emitió.

   POR QUÉ:
   DocumentosContables solo guardaba MonIdMoneda. Cuando una factura se emite en una
   moneda distinta a la de las órdenes (cierre cross-moneda, y ahora la pre-factura
   mixta del Panel 360 que junta órdenes en pesos y en dólares), el tipo de cambio
   aplicado no quedaba en ninguna parte del documento: había que deducirlo del texto
   de un movimiento ("… @ 40"). Sin ese dato no se puede reconstruir después a qué
   dólar se facturó ni explicárselo al contador.

   QUÉ GUARDA:
   · Si hubo conversión → el tipo de cambio efectivamente aplicado.
   · Si no hubo         → la cotización vigente al momento de emitir (referencia).

   Es aditiva y opcional (NULL): los documentos viejos quedan en NULL y todo lo que
   existe hoy sigue funcionando igual. El código tolera que la columna no exista
   todavía (chequea una vez y, si falta, simplemente no la escribe), así que el
   orden entre este script y el deploy no rompe la facturación.

   Correr una sola vez en la base de PRODUCCIÓN.
   ============================================================================= */

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.DocumentosContables')
      AND name = 'DocCotizacion'
)
BEGIN
    ALTER TABLE dbo.DocumentosContables
        ADD DocCotizacion DECIMAL(18,4) NULL;

    PRINT 'OK: columna DocCotizacion agregada a DocumentosContables.';
END
ELSE
BEGIN
    PRINT 'La columna DocCotizacion ya existía. No se hizo nada.';
END
GO

/* Verificación */
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DocumentosContables'
  AND COLUMN_NAME = 'DocCotizacion';
GO
