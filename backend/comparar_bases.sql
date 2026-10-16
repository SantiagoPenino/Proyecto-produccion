-- ============================================================
-- SCRIPT DE COMPARACIÓN DE ESTRUCTURAS DE BASES DE DATOS
-- Base DESARROLLO : SecureAppDB   (tu base local actual)
-- Base PRODUCCIÓN : importa       (backup restaurada de producción)
--
-- INSTRUCCIONES:
--   1. Abre este script en SSMS conectado a localhost (sa / 2441)
--   2. Ejecuta TODO el script (F5)
--   3. Revisá los resultados en las pestañas de resultados
-- ============================================================

USE master;
GO

-- ============================================================
-- SECCIÓN 1: TABLAS NUEVAS EN DEV QUE FALTAN EN PRODUCCIÓN
--            → Hay que crearlas en producción
-- ============================================================
PRINT '=== SECCIÓN 1: TABLAS NUEVAS EN DEV (FALTAN EN PROD) ===';

SELECT
    d.TABLE_NAME       AS [Tabla_Nueva_en_DEV],
    'Hay que CREAR en PROD' AS [Accion]
FROM [SecureAppDB].INFORMATION_SCHEMA.TABLES d
LEFT JOIN [importa].INFORMATION_SCHEMA.TABLES p
       ON d.TABLE_NAME = p.TABLE_NAME
      AND d.TABLE_TYPE = p.TABLE_TYPE
WHERE p.TABLE_NAME IS NULL
  AND d.TABLE_TYPE = 'BASE TABLE'
ORDER BY d.TABLE_NAME;


-- ============================================================
-- SECCIÓN 2: TABLAS EN PROD QUE YA NO ESTÁN EN DEV
--            → Revisar si se pueden ignorar o eliminar
-- ============================================================
PRINT '=== SECCIÓN 2: TABLAS EN PROD QUE NO ESTÁN EN DEV ===';

SELECT
    p.TABLE_NAME       AS [Tabla_Solo_en_PROD],
    'Revisar si se elimina' AS [Accion]
FROM [importa].INFORMATION_SCHEMA.TABLES p
LEFT JOIN [SecureAppDB].INFORMATION_SCHEMA.TABLES d
       ON p.TABLE_NAME = d.TABLE_NAME
      AND p.TABLE_TYPE = d.TABLE_TYPE
WHERE d.TABLE_NAME IS NULL
  AND p.TABLE_TYPE = 'BASE TABLE'
ORDER BY p.TABLE_NAME;


-- ============================================================
-- SECCIÓN 3: COLUMNAS NUEVAS EN DEV QUE FALTAN EN PROD
--            → Hay que hacer ALTER TABLE ADD COLUMN en producción
-- ============================================================
PRINT '=== SECCIÓN 3: COLUMNAS NUEVAS EN DEV (FALTAN EN PROD) ===';

SELECT
    d.TABLE_NAME                   AS [Tabla],
    d.COLUMN_NAME                  AS [Columna_Nueva],
    d.DATA_TYPE                    AS [Tipo],
    d.CHARACTER_MAXIMUM_LENGTH     AS [Largo],
    d.NUMERIC_PRECISION            AS [Precision],
    d.NUMERIC_SCALE                AS [Escala],
    d.IS_NULLABLE                  AS [Permite_Null],
    d.COLUMN_DEFAULT               AS [Valor_Default],
    d.ORDINAL_POSITION             AS [Posicion]
FROM [SecureAppDB].INFORMATION_SCHEMA.COLUMNS d
-- Solo en tablas que existen en ambas bases
INNER JOIN [importa].INFORMATION_SCHEMA.TABLES pt
        ON d.TABLE_NAME = pt.TABLE_NAME
LEFT JOIN [importa].INFORMATION_SCHEMA.COLUMNS p
       ON d.TABLE_NAME  = p.TABLE_NAME
      AND d.COLUMN_NAME = p.COLUMN_NAME
WHERE p.COLUMN_NAME IS NULL
ORDER BY d.TABLE_NAME, d.ORDINAL_POSITION;


-- ============================================================
-- SECCIÓN 4: COLUMNAS CON TIPO O CONFIGURACIÓN DIFERENTE
--            → Hay que hacer ALTER TABLE ALTER COLUMN en producción
-- ============================================================
PRINT '=== SECCIÓN 4: COLUMNAS CON DIFERENCIAS DE TIPO/LARGO/NULL ===';

SELECT
    d.TABLE_NAME                       AS [Tabla],
    d.COLUMN_NAME                      AS [Columna],
    d.DATA_TYPE                        AS [Tipo_DEV],
    p.DATA_TYPE                        AS [Tipo_PROD],
    d.CHARACTER_MAXIMUM_LENGTH         AS [Largo_DEV],
    p.CHARACTER_MAXIMUM_LENGTH         AS [Largo_PROD],
    d.NUMERIC_PRECISION                AS [Precision_DEV],
    p.NUMERIC_PRECISION                AS [Precision_PROD],
    d.NUMERIC_SCALE                    AS [Escala_DEV],
    p.NUMERIC_SCALE                    AS [Escala_PROD],
    d.IS_NULLABLE                      AS [Nullable_DEV],
    p.IS_NULLABLE                      AS [Nullable_PROD],
    d.COLUMN_DEFAULT                   AS [Default_DEV],
    p.COLUMN_DEFAULT                   AS [Default_PROD]
FROM [SecureAppDB].INFORMATION_SCHEMA.COLUMNS d
INNER JOIN [importa].INFORMATION_SCHEMA.COLUMNS p
       ON d.TABLE_NAME  = p.TABLE_NAME
      AND d.COLUMN_NAME = p.COLUMN_NAME
WHERE (
       d.DATA_TYPE                              <> p.DATA_TYPE
    OR ISNULL(d.CHARACTER_MAXIMUM_LENGTH, -1)  <> ISNULL(p.CHARACTER_MAXIMUM_LENGTH, -1)
    OR ISNULL(d.NUMERIC_PRECISION, -1)         <> ISNULL(p.NUMERIC_PRECISION, -1)
    OR ISNULL(d.NUMERIC_SCALE, -1)             <> ISNULL(p.NUMERIC_SCALE, -1)
    OR d.IS_NULLABLE                           <> p.IS_NULLABLE
    OR ISNULL(CAST(d.COLUMN_DEFAULT AS NVARCHAR(500)), '_NULL_')
       <> ISNULL(CAST(p.COLUMN_DEFAULT AS NVARCHAR(500)), '_NULL_')
)
ORDER BY d.TABLE_NAME, d.COLUMN_NAME;


-- ============================================================
-- SECCIÓN 5: COLUMNAS EN PROD QUE YA NO ESTÁN EN DEV
--            → Columnas que se eliminaron en DEV (revisar)
-- ============================================================
PRINT '=== SECCIÓN 5: COLUMNAS EN PROD QUE NO ESTÁN EN DEV ===';

SELECT
    p.TABLE_NAME       AS [Tabla],
    p.COLUMN_NAME      AS [Columna_Solo_en_PROD],
    p.DATA_TYPE        AS [Tipo],
    p.IS_NULLABLE      AS [Permite_Null]
FROM [importa].INFORMATION_SCHEMA.COLUMNS p
INNER JOIN [SecureAppDB].INFORMATION_SCHEMA.TABLES dt
        ON p.TABLE_NAME = dt.TABLE_NAME
LEFT JOIN [SecureAppDB].INFORMATION_SCHEMA.COLUMNS d
       ON p.TABLE_NAME  = d.TABLE_NAME
      AND p.COLUMN_NAME = d.COLUMN_NAME
WHERE d.COLUMN_NAME IS NULL
ORDER BY p.TABLE_NAME, p.COLUMN_NAME;


-- ============================================================
-- SECCIÓN 6: STORED PROCEDURES / FUNCIONES EN DEV QUE FALTAN EN PROD
-- ============================================================
PRINT '=== SECCIÓN 6: SPs Y FUNCIONES EN DEV QUE FALTAN EN PROD ===';

SELECT
    d.ROUTINE_NAME     AS [Nombre],
    d.ROUTINE_TYPE     AS [Tipo],
    'Hay que CREAR en PROD' AS [Accion]
FROM [SecureAppDB].INFORMATION_SCHEMA.ROUTINES d
LEFT JOIN [importa].INFORMATION_SCHEMA.ROUTINES p
       ON d.ROUTINE_NAME = p.ROUTINE_NAME
      AND d.ROUTINE_TYPE = p.ROUTINE_TYPE
WHERE p.ROUTINE_NAME IS NULL
ORDER BY d.ROUTINE_TYPE, d.ROUTINE_NAME;


-- ============================================================
-- SECCIÓN 7: STORED PROCEDURES / FUNCIONES EN PROD QUE NO ESTÁN EN DEV
-- ============================================================
PRINT '=== SECCIÓN 7: SPs Y FUNCIONES EN PROD QUE NO ESTÁN EN DEV ===';

SELECT
    p.ROUTINE_NAME       AS [Nombre],
    p.ROUTINE_TYPE       AS [Tipo],
    'Revisar si se elimina' AS [Accion]
FROM [importa].INFORMATION_SCHEMA.ROUTINES p
LEFT JOIN [SecureAppDB].INFORMATION_SCHEMA.ROUTINES d
       ON p.ROUTINE_NAME = d.ROUTINE_NAME
      AND p.ROUTINE_TYPE = d.ROUTINE_TYPE
WHERE d.ROUTINE_NAME IS NULL
ORDER BY p.ROUTINE_TYPE, p.ROUTINE_NAME;

PRINT '=== COMPARACIÓN COMPLETA ===';
