/* =====================================================================
   DIAGNÓSTICO PRE-MIGRACIÓN — configurador_productos.sql (secciones A–W)
   ---------------------------------------------------------------------
   100% LECTURA. No crea, no modifica, no borra nada.

   Correr esto en PRODUCCIÓN antes de aplicar configurador_productos.sql,
   para saber de antemano:
     1) si algo de lo que la migración va a crear ya existe (colisión),
     2) si los artículos reales que los seeds esperan existen en esta base,
     3) cuántas filas van a tocar los pasos de datos (backfill de Familia,
        corrección de Origen, alta de Sublimación/Corte/Costura),
     4) el estado actual de los códigos de StockArt que la migración
        crea/renombra/mueve.

   Leer los 6 bloques en orden; el bloque 6 da un semáforo resumen.
   ===================================================================== */

-- ── 1. Tablas NUEVAS que la migración va a crear — ¿alguna ya existe? ──
-- Esperado en un ambiente virgen: TABLA_EXISTE = 0 en TODAS.
-- Si alguna da 1, la sección correspondiente del script no la va a tocar
-- (todas son IF NOT EXISTS) — pero conviene saber por qué ya está antes
-- de asumir que la migración nunca corrió acá.
SELECT v.Tabla,
       CASE WHEN OBJECT_ID('dbo.' + v.Tabla, 'U') IS NOT NULL THEN 1 ELSE 0 END AS TABLA_EXISTE
FROM (VALUES
    ('ProductoTerminadoServicios'),   -- sección A (puede existir de agregar_producto_terminado_servicios.sql)
    ('TecnicaOpciones'),              -- B
    ('ProductoTecnicaOpciones'),      -- C
    ('ProductoVentaConfig'),          -- D
    ('ProductoOrigenVariantes'),      -- E
    ('ComponenteOpciones'),           -- H
    ('ProductoComponentes'),          -- I
    ('ProductoApliques'),             -- J
    ('ProductoComboItems'),           -- K
    ('ProductoComboItemServicios'),   -- L
    ('ComponenteOpcionPiezas'),       -- U
    ('ProductoVariantes'),            -- V
    ('CosturasISO'),                  -- W
    ('ProductoFichaDiseno'),          -- W
    ('ProductoFichaDisenoAnotaciones'),-- W
    ('ProductoFichaDisenoExtra'),     -- W
    ('ProductoFichaDisenoCosturas')   -- W
) v(Tabla)
ORDER BY v.Tabla;

-- ── 2. Columnas NUEVAS sobre tablas que YA existen — ¿alguna ya existe? ─
-- Solo tiene sentido si ProductoTerminadoServicios/ProductoVentaConfig ya
-- existían (bloque 1). Esperado: todo NULL (columna no existe todavía).
SELECT 'ProductoTerminadoServicios.Modo'        AS Columna, COL_LENGTH('dbo.ProductoTerminadoServicios', 'Modo')        AS Longitud_o_NULL_si_no_existe
UNION ALL SELECT 'ProductoTerminadoServicios.Cobro', COL_LENGTH('dbo.ProductoTerminadoServicios', 'Cobro')
UNION ALL SELECT 'ProductoVentaConfig.EsCombo',      COL_LENGTH('dbo.ProductoVentaConfig', 'EsCombo')
UNION ALL SELECT 'ProductoVentaConfig.Familia',      COL_LENGTH('dbo.ProductoVentaConfig', 'Familia')
UNION ALL SELECT 'ProductoVentaConfig.CodigoCorto',  COL_LENGTH('dbo.ProductoVentaConfig', 'CodigoCorto');

-- ── 3. Artículos reales que los SEEDS esperan (sección F) — ¿existen? ───
-- La sección F solo inserta la fila de TecnicaOpciones SI el artículo
-- existe (guard EXISTS) — si falta acá, no es un error, pero esa técnica
-- queda sin catálogo en prod hasta que se cargue el artículo. Revisar
-- ENCONTRADO=0 antes de asumir que el catálogo va a salir completo.
SELECT v.AreaID, v.NombreEsperado, v.CodArticulo,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.Articulos a
                          WHERE LTRIM(RTRIM(a.CodArticulo)) = v.CodArticulo AND ISNULL(a.borrar, 0) = 0)
            THEN 1 ELSE 0 END AS ENCONTRADO
FROM (VALUES
    ('EMB', N'Bordado sobre prenda con tafeta',          '107'),
    ('EMB', N'Bordado sobre prenda 100% hilo',           '108'),
    ('EMB', N'Parche adhesivo con tafeta',               '109'),
    ('EMB', N'Parche adhesivo 100% hilo',                '1630'),
    ('EMB', N'Relieve 3D (recargo)',                     '1631'),
    ('TPU', N'Parche hasta 4x4',                         '153'),
    ('TPU', N'Parche hasta 7,5x4',                       '155'),
    ('TPU', N'Parche hasta 10x8',                        '152'),
    ('TPU', N'Parche hasta 10x8 con estrellas (máx. 4)', '154'),
    ('DF',  N'DTF textil común',                         '48'),
    ('DF',  N'DTF textil dorado',                        '49')
) v(AreaID, NombreEsperado, CodArticulo)
ORDER BY v.AreaID, v.CodArticulo;

-- ── 4. StockArt — códigos que la migración crea / renombra / mueve ──────
-- Fila por fila, lo que la migración espera encontrar (o no) en cada uno:
--   2.2.1.4  → sección L la crea si falta ('Combos'); P la renombra a
--              'Combos y Promos'; Q le cambia el Grupo a 2.2.
--   2.2.1.16 → sección R la renombra a 2.2.3.1 (SOLO si 2.2.1.16 existe Y
--              2.2.3.1 todavía no) — revisar bien esta fila antes de correr.
--   2.2.3.1  → destino de la renumeración de arriba; si YA existe con otro
--              contenido, la sección R no hace nada (su guard lo protege),
--              pero conviene saber por qué ya está.
--   Productos del Local → si NO existe ninguna fila con ese nombre en
--              SupFlia=2, la sección P crea una nueva variante.
SELECT 'CodStock 2.2.1.4' AS Chequeo, SupFlia, Grupo, CodStock, Articulo, TipoStock
FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.4'
UNION ALL
SELECT 'CodStock 2.2.1.16', SupFlia, Grupo, CodStock, Articulo, TipoStock
FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.16'
UNION ALL
SELECT 'CodStock 2.2.3.1', SupFlia, Grupo, CodStock, Articulo, TipoStock
FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.3.1'
UNION ALL
SELECT 'Articulo = Productos del Local', SupFlia, Grupo, CodStock, Articulo, TipoStock
FROM dbo.StockArt WHERE LTRIM(RTRIM(SupFlia)) = '2' AND LTRIM(RTRIM(Articulo)) = 'Productos del Local';

-- Familias ya existentes bajo Grupo 2.1 (sirve para saber a partir de qué
-- Ref van a numerar las nuevas familias de las secciones N/O/P — el script
-- usa MAX(Ref)+1, no un número fijo).
SELECT SupFlia, Grupo, CodStock, Ref, Articulo, TipoStock
FROM dbo.StockArt WHERE LTRIM(RTRIM(Grupo)) = '2.1'
ORDER BY TRY_CAST(LTRIM(RTRIM(Ref)) AS INT);

-- ── 5. Volumetría — cuántas filas van a tocar los pasos de datos ────────
-- No son solo CREATE TABLE: las secciones M/N/S/T leen y escriben filas
-- reales de Articulos/ProductoVentaConfig. Esto da una idea de magnitud
-- ANTES de correr, para poder comparar con los números que la migración
-- va a reportar en su propia verificación al final.
SELECT 'Articulos en CodStock=2.2.1.3 (bucket genérico, candidatos a que M/N les asigne Familia real)' AS Chequeo,
       COUNT(*) AS Cantidad
FROM dbo.Articulos WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.3' AND ISNULL(borrar, 0) = 0
UNION ALL
SELECT 'ProductoVentaConfig ya existente (si > 0, la migración NO es la primera vez que corre acá)',
       COUNT(*) FROM dbo.ProductoVentaConfig
UNION ALL
SELECT 'Articulos confeccionados (StockArt Grupo 2.1, no combo, no Productos del Local) sin fila en ProductoVentaConfig — candidatos al backfill M',
       COUNT(*)
FROM dbo.Articulos a
INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
WHERE LTRIM(RTRIM(sa.Grupo)) = '2.1' AND ISNULL(a.borrar, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = a.ProIdProducto);

-- ── 6. RESUMEN — semáforo ────────────────────────────────────────────────
-- OK = no hay nada raro, la migración corre sobre terreno limpio.
-- REVISAR = hay algo que vale la pena mirar antes de correr (no bloquea,
-- los guards de la migración son idempotentes, pero mejor saber por qué).
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM sys.tables WHERE name IN (
            'ProductoVentaConfig','ProductoComboItems','ProductoVariantes','ProductoFichaDiseno'))
         THEN 'REVISAR: ya hay tablas del configurador en esta base — la migración NO sería la primera corrida acá.'
         ELSE 'OK: ninguna tabla nueva existe todavía.' END AS Chequeo_1_tablas,
    -- OJO: la sección R (desde el fix del 13-ago) ya NO busca por el código fijo
    -- '2.2.1.16' — busca "Productos del Local" por NOMBRE. Que ese código exista
    -- no significa nada por sí solo (puede ser cualquier otra familia real,
    -- como pasó en prod: '2.2.1.16' terminó siendo "Shorts"). Lo único que
    -- importa de verdad es el Chequeo_5 de más abajo.
    CASE WHEN EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.16' AND LTRIM(RTRIM(Articulo)) = 'Productos del Local')
              AND EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.3.1' AND LTRIM(RTRIM(Articulo)) <> 'Productos del Local')
         THEN 'REVISAR: "Productos del Local" sigue en 2.2.1.16 y ADEMÁS otra cosa distinta ya ocupa 2.2.3.1 — confirmar a mano antes de correr la sección R.'
         ELSE 'OK: sin conflicto real entre 2.2.1.16 y 2.2.3.1 (ver Chequeo_5 para el estado real de "Productos del Local").' END AS Chequeo_2_stockart,
    CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) IN ('107','108','109','1630','1631','152','153','154','155','48','49') AND ISNULL(borrar,0)=0)
         THEN 'REVISAR: NINGUNO de los artículos reales de los seeds (EMB/TPU/DF) existe en esta base — TecnicaOpciones va a quedar vacío.'
         ELSE 'OK: al menos algunos artículos de los seeds existen.' END AS Chequeo_3_articulos,
    -- Hallazgo real del 13-ago corriendo esto contra prod: ProductoVentaConfig
    -- puede existir vacía (0 filas) si M/N nunca corrieron con efecto — no es un
    -- error, la migración lo completa sola AHORA con los artículos reales de
    -- hoy, pero conviene saberlo antes (los Ref/CodStock que van a salir NO van
    -- a coincidir con los de otro entorno, y no tiene que coincidir).
    CASE WHEN EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProductoVentaConfig')
              AND (SELECT COUNT(*) FROM dbo.ProductoVentaConfig) = 0
              AND EXISTS (SELECT 1 FROM dbo.Articulos WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.3' AND ISNULL(borrar,0)=0)
         THEN 'REVISAR: ProductoVentaConfig existe pero está VACÍA y hay artículos en el bucket genérico 2.2.1.3 — las secciones M/N/S/T de la migración van a insertar/mover datos reales recién ahora (correcto, no es un error, pero los códigos de StockArt que van a salir no van a ser los mismos que en otro entorno).'
         ELSE 'OK: ProductoVentaConfig ya tiene datos o no hay nada pendiente de backfill.' END AS Chequeo_4_backfill_pendiente,
    -- Bug real encontrado y corregido 13-ago: "Productos del Local" puede
    -- nacer en cualquier CodStock (numeración dinámica) — si además todavía
    -- no está en su propio Grupo 2.3, la migración corregida (sección R
    -- reescrita para buscar por nombre, no por código fijo) lo va a mover recién
    -- al correr esta vez.
    CASE WHEN EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(SupFlia))='2' AND LTRIM(RTRIM(Articulo))='Productos del Local' AND LTRIM(RTRIM(Grupo)) <> '2.3')
         THEN 'REVISAR: "Productos del Local" existe pero NO está en Grupo 2.3 todavía — la sección R (ya corregida) lo va a mover recién al correr la migración completa.'
         WHEN EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(SupFlia))='2' AND LTRIM(RTRIM(Articulo))='Productos del Local' AND LTRIM(RTRIM(Grupo)) = '2.3')
         THEN 'OK: "Productos del Local" ya está en su propio Grupo 2.3.'
         ELSE 'OK: "Productos del Local" todavía no existe — la migración lo va a crear.' END AS Chequeo_5_productos_del_local;
GO
