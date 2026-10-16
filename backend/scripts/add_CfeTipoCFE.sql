/* =====================================================================
   Nueva columna: DocumentosContables.CfeTipoCFE
   ---------------------------------------------------------------------
   Guarda el tipo de CFE que se le pidió realmente a la DGI al emitir
   (101 e-Ticket, 111 e-Factura, 102/112 Nota de Crédito, 103/113 Nota de
   Débito), según el nomenclador de DGI.

   Por qué hace falta: hasta ahora ese dato no se guardaba en ningún lado.
   La bandeja solo podía RECALCULAR lo que debería emitirse, que no es lo
   mismo que lo emitido — y justamente por eso el bug de las notas de
   crédito (que salieron como venta) pasó meses sin verse.

   Con la columna, "lo emitido" pasa a ser un hecho grabado y la bandeja
   puede compararlo contra "lo correcto" y marcar la diferencia.

   Es aditiva y NULL-able: los documentos viejos quedan en NULL y la
   bandeja los reconstruye con la lógica vieja, marcándolos como inferidos.

   Ejecutar en PRODUCCIÓN antes (o junto con) el deploy.
   ===================================================================== */

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME   = 'DocumentosContables'
      AND COLUMN_NAME  = 'CfeTipoCFE'
)
BEGIN
    ALTER TABLE dbo.DocumentosContables ADD CfeTipoCFE INT NULL;
    PRINT 'Columna CfeTipoCFE agregada.';
END
ELSE
BEGIN
    PRINT 'La columna CfeTipoCFE ya existe, no se hace nada.';
END
GO

/* Verificación */
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'DocumentosContables' AND COLUMN_NAME = 'CfeTipoCFE';
