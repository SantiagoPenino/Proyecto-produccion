-- =====================================================================
-- MEDICIÓN DE TIZADAS EN CORTE (portal /portal/order/corte)
-- =====================================================================
-- El portal ahora MIDE cada tizada al subirla (PDF / AI / DXF vectorial):
--   - Piezas: cantidad de contornos/piezas detectados
--   - MetrosCorte: recorrido real del láser en metros lineales
-- Si el archivo no se puede medir, el portal NO deja adjuntarlo.
--
-- Las tizadas entran como ARCHIVOS DE PRODUCCIÓN (ArchivosOrden, TipoArchivo
-- 'Impresion'): se descargan y manejan igual que los de impresión. Los totales
-- van además a la Nota de la orden como [DATOS TÉCNICOS] Bobina / Piezas /
-- Corte laser / Largo tela.
-- Qué se COTIZA lo define la UM del artículo de corte 1375 (Articulos.UniIdUnidad):
-- Metros -> Magnitud = metros de láser; Cantidades -> Magnitud = piezas.
-- El CONTROL de producción siempre cuenta PIEZAS.
-- Las dos columnas de ArchivosReferencia son para las órdenes viejas (primeras
-- pruebas, cuando las tizadas entraban como referencia tipo 'ARCHIVO_CORTE').

IF COL_LENGTH('dbo.ArchivosReferencia', 'Piezas') IS NULL
    ALTER TABLE dbo.ArchivosReferencia ADD Piezas INT NULL;

IF COL_LENGTH('dbo.ArchivosReferencia', 'MetrosCorte') IS NULL
    ALTER TABLE dbo.ArchivosReferencia ADD MetrosCorte DECIMAL(10,3) NULL;

-- Las tizadas del form de corte standalone viajan como ARCHIVOS DE PRODUCCIÓN
-- (ArchivosOrden, tipo 'Impresion': se descargan y manejan como los de impresión),
-- cada una con su medición. Ancho/Alto/Metros llevan la tela; Piezas/MetrosCorte el láser.
IF COL_LENGTH('dbo.ArchivosOrden', 'Piezas') IS NULL
    ALTER TABLE dbo.ArchivosOrden ADD Piezas INT NULL;

IF COL_LENGTH('dbo.ArchivosOrden', 'MetrosCorte') IS NULL
    ALTER TABLE dbo.ArchivosOrden ADD MetrosCorte DECIMAL(10,3) NULL;

-- Avance POR TIZADA en la bandeja de Corte: cuántas piezas de ESE archivo se
-- cortaron (trabajo) y cuántas se verificaron (control). La orden sigue llevando
-- el total en CantidadTerminada/CantidadControlada = suma de sus archivos.
IF COL_LENGTH('dbo.ArchivosOrden', 'PiezasTrabajadas') IS NULL
    ALTER TABLE dbo.ArchivosOrden ADD PiezasTrabajadas INT NULL;

IF COL_LENGTH('dbo.ArchivosOrden', 'PiezasControladas') IS NULL
    ALTER TABLE dbo.ArchivosOrden ADD PiezasControladas INT NULL;

-- Verificación
SELECT 'ArchivosReferencia' AS tabla, name, TYPE_NAME(system_type_id) AS tipo
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.ArchivosReferencia') AND name IN ('Piezas', 'MetrosCorte')
UNION ALL
SELECT 'ArchivosOrden', name, TYPE_NAME(system_type_id)
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.ArchivosOrden')
  AND name IN ('Piezas', 'MetrosCorte', 'PiezasTrabajadas', 'PiezasControladas');
