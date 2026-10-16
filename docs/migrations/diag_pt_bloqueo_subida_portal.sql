/* =====================================================================================
   PORTAL ECOUV — por qué el portal rechaza el arte de un Producto Terminado
   15-sep-2026 · SOLO LECTURA. No modifica nada.

   El form del portal aplica TRES controles a un producto terminado, en este orden.
   Esta consulta los reproduce con los datos reales y dice cuál de los tres traba.

     1) TOPE DE ANCHO DEL ARTÍCULO — solo se aplica si NO pudo cargar la ficha.
        Los productos terminados tienen anchoimprimible = 0, así que sin ficha el tope
        queda en -0,03 m y rechaza cualquier archivo.
        Cartel: "El ancho del archivo (X) excede el ancho imprimible del material ... (-0.03m)"

     2) MEDIDA DEL ARTE contra la ficha (±2 cm, se acepta girado).
        Arte exigido = Ancho + 2×Borde  ×  Alto + 2×Borde.
        Cartel: "El arte de ... debe medir A x B m, pero tu archivo mide X x Y m"

     3) ANCHO DEL MATERIAL DE IMPRESIÓN: el lado corto del arte tiene que entrar en
        (ancho del rollo − 3 cm de margen).
        Cartel: "El producto ... necesita A x B m, pero su material ... imprime hasta Z m"
   ===================================================================================== */

SELECT
    LTRIM(RTRIM(a.CodArticulo))                     AS CodArticulo,
    LTRIM(RTRIM(a.Descripcion))                     AS Producto,
    P.AnchoM, P.AltoM, ISNULL(P.BordeCm, 0)         AS BordeCm,
    -- (2) Lo que el portal le va a exigir al archivo
    CAST(P.AnchoM + 2 * ISNULL(P.BordeCm, 0) / 100.0 AS DECIMAL(9,2)) AS ArteExigidoAncho,
    CAST(P.AltoM  + 2 * ISNULL(P.BordeCm, 0) / 100.0 AS DECIMAL(9,2)) AS ArteExigidoAlto,
    -- (3) El rollo real
    LTRIM(RTRIM(ISNULL(M.Descripcion, '— sin material en la ficha —')))  AS MaterialImpresion,
    M.anchoimprimible                               AS AnchoRollo,
    CASE WHEN M.anchoimprimible > 0
         THEN CAST(M.anchoimprimible - 0.03 AS DECIMAL(9,2)) END        AS AnchoUtilDelRollo,
    CASE
        WHEN P.ID IS NULL OR P.Activo = 0 OR P.AnchoM IS NULL
            THEN 'BLOQUEA (1) — sin ficha usable: el tope queda en -0,03 m y rechaza todo'
        WHEN M.anchoimprimible > 0
         AND (CASE WHEN P.AnchoM < P.AltoM THEN P.AnchoM ELSE P.AltoM END)
             + 2 * ISNULL(P.BordeCm, 0) / 100.0 > M.anchoimprimible - 0.03 + 0.000000001
            THEN 'BLOQUEA (3) — el arte no entra en el ancho util del rollo'
        WHEN P.AltoM IS NULL
            THEN 'Deja subir, pero SIN control de medida (AltoM en NULL)'
        ELSE 'OK — si igual rechaza, es (2): el archivo no mide lo que pide la ficha'
    END                                             AS Veredicto
FROM dbo.articulos a
LEFT JOIN dbo.ProductosTerminados P
       ON LTRIM(RTRIM(P.CodArticulo)) = LTRIM(RTRIM(a.CodArticulo))
OUTER APPLY (
    SELECT TOP 1 A2.Descripcion, A2.anchoimprimible
    FROM dbo.articulos A2
    WHERE LTRIM(RTRIM(A2.CodArticulo)) = LTRIM(RTRIM(P.MaterialCodArticulo))
) M
WHERE LTRIM(RTRIM(a.CodStock)) IN (
        SELECT LTRIM(RTRIM(S.CodStock))
        FROM dbo.StockArt S
        INNER JOIN dbo.ConfigMapeoERP C ON C.CodigoERP = S.Grupo
        WHERE C.AreaID_Interno = 'ECOUV'
          AND ISNULL(S.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
          AND ISNULL(S.mostrar, 1) = 1)
  AND ISNULL(a.mostrar, 1) = 1
ORDER BY Veredicto DESC, a.Descripcion;
