/* ============================================================================
   DIAGNÓSTICO FASE 0 — saneo del maestro de artículos (02-oct-2026)
   SOLO LECTURA: no crea, no modifica ni borra nada. Correr entero en SSMS.
   Devuelve primero el resumen y después el detalle de cada problema, para decidir
   caso por caso cómo se corrige antes de empezar con el maestro nuevo.
   ============================================================================ */
SET NOCOUNT ON;

-- 0) RESUMEN
SELECT 'Códigos de artículo repetidos' AS Problema,
       (SELECT COUNT(*) FROM (SELECT LTRIM(RTRIM(CodArticulo)) c FROM dbo.Articulos GROUP BY LTRIM(RTRIM(CodArticulo)) HAVING COUNT(*) > 1) x) AS Casos
UNION ALL SELECT 'Artículos sin familia (CodStock vacío)',
       (SELECT COUNT(*) FROM dbo.Articulos WHERE CodStock IS NULL OR LTRIM(RTRIM(CodStock)) = '')
UNION ALL SELECT 'Artículos con familia que no existe en StockArt',
       (SELECT COUNT(*) FROM dbo.Articulos a WHERE LTRIM(RTRIM(ISNULL(a.CodStock, ''))) <> ''
          AND NOT EXISTS (SELECT 1 FROM dbo.StockArt s WHERE LTRIM(RTRIM(s.CodStock)) = LTRIM(RTRIM(a.CodStock))))
UNION ALL SELECT 'Artículos cuyo Grupo no coincide con el de su familia',
       (SELECT COUNT(*) FROM dbo.Articulos a JOIN dbo.StockArt s ON LTRIM(RTRIM(s.CodStock)) = LTRIM(RTRIM(a.CodStock))
         WHERE LTRIM(RTRIM(ISNULL(a.Grupo, ''))) <> LTRIM(RTRIM(ISNULL(s.Grupo, ''))))
UNION ALL SELECT 'Familias (StockArt) sin TipoStock',
       (SELECT COUNT(*) FROM dbo.StockArt WHERE TipoStock IS NULL)
UNION ALL SELECT 'Artículos sin unidad',
       (SELECT COUNT(*) FROM dbo.Articulos WHERE UniIdUnidad IS NULL)
UNION ALL SELECT 'Precios con moneda en texto distinta de la moneda por id',
       (SELECT COUNT(*) FROM dbo.PreciosBase
         WHERE (UPPER(LTRIM(RTRIM(ISNULL(Moneda, '')))) IN ('USD', 'US$') AND ISNULL(MonIdMoneda, 0) <> 2)
            OR (UPPER(LTRIM(RTRIM(ISNULL(Moneda, '')))) IN ('UYU', '$') AND ISNULL(MonIdMoneda, 0) <> 1))
UNION ALL SELECT 'Artículos con moneda distinta a la de su precio',
       (SELECT COUNT(*) FROM dbo.Articulos a JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
         WHERE a.MonIdMoneda IS NOT NULL AND pb.MonIdMoneda IS NOT NULL AND a.MonIdMoneda <> pb.MonIdMoneda)
UNION ALL SELECT 'Precios duplicados (mismo artículo y moneda)',
       (SELECT COUNT(*) FROM (SELECT ProIdProducto, ISNULL(MonIdMoneda, -1) m FROM dbo.PreciosBase WHERE ProIdProducto IS NOT NULL
                              GROUP BY ProIdProducto, ISNULL(MonIdMoneda, -1) HAVING COUNT(*) > 1) x)
UNION ALL SELECT 'Precios sin artículo (ProIdProducto vacío)',
       (SELECT COUNT(*) FROM dbo.PreciosBase WHERE ProIdProducto IS NULL)
UNION ALL SELECT 'Artículos visibles sin precio base',
       (SELECT COUNT(*) FROM dbo.Articulos a WHERE ISNULL(a.Mostrar, 0) = 1
          AND NOT EXISTS (SELECT 1 FROM dbo.PreciosBase pb WHERE pb.ProIdProducto = a.ProIdProducto))
UNION ALL SELECT 'Insumos cuyo código de referencia no coincide con ningún artículo',
       (SELECT COUNT(*) FROM dbo.Insumos i WHERE NOT EXISTS (SELECT 1 FROM dbo.Articulos a WHERE LTRIM(RTRIM(a.CodArticulo)) = LTRIM(RTRIM(i.CodigoReferencia))));

-- 1) Códigos de artículo repetidos
SELECT 'CODIGO REPETIDO' AS Detalle, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       LTRIM(RTRIM(a.CodStock)) AS CodStock, a.Mostrar
FROM dbo.Articulos a
WHERE LTRIM(RTRIM(a.CodArticulo)) IN (SELECT LTRIM(RTRIM(CodArticulo)) FROM dbo.Articulos GROUP BY LTRIM(RTRIM(CodArticulo)) HAVING COUNT(*) > 1)
ORDER BY 2, 3;

-- 2) Artículos sin familia o con familia inexistente
SELECT CASE WHEN a.CodStock IS NULL OR LTRIM(RTRIM(a.CodStock)) = '' THEN 'SIN FAMILIA' ELSE 'FAMILIA INEXISTENTE' END AS Detalle,
       a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       LTRIM(RTRIM(a.CodStock)) AS CodStock, LTRIM(RTRIM(a.Grupo)) AS Grupo, a.Mostrar
FROM dbo.Articulos a
WHERE a.CodStock IS NULL OR LTRIM(RTRIM(a.CodStock)) = ''
   OR NOT EXISTS (SELECT 1 FROM dbo.StockArt s WHERE LTRIM(RTRIM(s.CodStock)) = LTRIM(RTRIM(a.CodStock)))
ORDER BY 1, 5, 4;

-- 3) Artículos cuyo Grupo no coincide con el de su familia
SELECT 'GRUPO DESFASADO' AS Detalle, a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       LTRIM(RTRIM(a.Grupo)) AS GrupoArticulo, LTRIM(RTRIM(s.Grupo)) AS GrupoFamilia, LTRIM(RTRIM(a.CodStock)) AS CodStock
FROM dbo.Articulos a JOIN dbo.StockArt s ON LTRIM(RTRIM(s.CodStock)) = LTRIM(RTRIM(a.CodStock))
WHERE LTRIM(RTRIM(ISNULL(a.Grupo, ''))) <> LTRIM(RTRIM(ISNULL(s.Grupo, '')));

-- 4) Familias sin TipoStock (no se sabe si son material, producto o terminación)
SELECT 'FAMILIA SIN TIPO' AS Detalle, LTRIM(RTRIM(s.CodStock)) AS CodStock, LTRIM(RTRIM(s.Articulo)) AS Familia, LTRIM(RTRIM(s.UM)) AS UM,
       (SELECT COUNT(*) FROM dbo.Articulos a WHERE LTRIM(RTRIM(a.CodStock)) = LTRIM(RTRIM(s.CodStock))) AS Articulos
FROM dbo.StockArt s WHERE s.TipoStock IS NULL ORDER BY 2;

-- 5) Monedas contradictorias
SELECT 'PRECIO: TEXTO vs ID' AS Detalle, pb.ID, pb.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion, pb.Precio,
       pb.Moneda AS MonedaTexto, pb.MonIdMoneda
FROM dbo.PreciosBase pb LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pb.ProIdProducto
WHERE (UPPER(LTRIM(RTRIM(ISNULL(pb.Moneda, '')))) IN ('USD', 'US$') AND ISNULL(pb.MonIdMoneda, 0) <> 2)
   OR (UPPER(LTRIM(RTRIM(ISNULL(pb.Moneda, '')))) IN ('UYU', '$') AND ISNULL(pb.MonIdMoneda, 0) <> 1)
ORDER BY 3;

SELECT 'ARTICULO vs PRECIO' AS Detalle, a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       a.MonIdMoneda AS MonedaArticulo, pb.MonIdMoneda AS MonedaPrecio, pb.Precio
FROM dbo.Articulos a JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
WHERE a.MonIdMoneda IS NOT NULL AND pb.MonIdMoneda IS NOT NULL AND a.MonIdMoneda <> pb.MonIdMoneda
ORDER BY 2;

-- 6) Artículos visibles sin precio base
SELECT 'VISIBLE SIN PRECIO' AS Detalle, a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
       LTRIM(RTRIM(a.CodStock)) AS CodStock
FROM dbo.Articulos a
WHERE ISNULL(a.Mostrar, 0) = 1 AND NOT EXISTS (SELECT 1 FROM dbo.PreciosBase pb WHERE pb.ProIdProducto = a.ProIdProducto)
ORDER BY 5, 4;

-- 7) Insumos y su artículo: los que hoy coinciden por código y los que no tienen par
SELECT CASE WHEN a.ProIdProducto IS NULL THEN 'INSUMO SIN ARTICULO' ELSE 'INSUMO = ARTICULO' END AS Detalle,
       i.InsumoID, LTRIM(RTRIM(i.Nombre)) AS Insumo, LTRIM(RTRIM(i.CodigoReferencia)) AS CodigoReferencia, i.UnidadDefault,
       a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Articulo
FROM dbo.Insumos i
OUTER APPLY (SELECT TOP 1 a.ProIdProducto, a.Descripcion FROM dbo.Articulos a
             WHERE LTRIM(RTRIM(a.CodArticulo)) = LTRIM(RTRIM(i.CodigoReferencia)) ORDER BY a.ProIdProducto) a
ORDER BY 1, 3;
