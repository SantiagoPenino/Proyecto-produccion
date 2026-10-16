/* =====================================================================================
   PORTAL ECOUV — "no me deja subir el pedido" en Productos Terminados
   15-sep-2026 · PRIMERO ESTE (solo lectura), después el de reparación.

   POR QUÉ SE TRABA
   ----------------
   Los artículos de Productos Terminados (roll ups, cuadros, pasacalles) tienen
   articulos.anchoimprimible = 0: NO son un rollo, son el producto. El portal lo sabe y
   NO aplica el tope de ancho... siempre que haya podido cargar la FICHA del producto
   (tabla ProductosTerminados vía /nomenclators/producto-terminado/:cod).

   Si la ficha NO está (fila inexistente, Activo = 0, o AnchoM en NULL), el portal cae al
   camino del material común y el tope le queda en 0 − 3 cm = -0,03 m, así que RECHAZA
   CUALQUIER archivo con:

       "El ancho del archivo (0.78m) excede el ancho imprimible del material
        "Roll up aluminio + (Banner Pet mate - 0,78)" (-0.03m)"

   Esta consulta dice, producto por producto, si está bien o si es de los que traban.
   NO modifica nada.
   ===================================================================================== */

SELECT
    LTRIM(RTRIM(a.CodArticulo))                      AS CodArticulo,
    LTRIM(RTRIM(a.Descripcion))                      AS Producto,
    a.anchoimprimible                                AS AnchoImprimibleArticulo,
    P.AnchoM, P.AltoM, P.BordeCm, P.Activo           AS FichaActiva,
    LTRIM(RTRIM(ISNULL(P.MaterialCodArticulo, '')))  AS MaterialDeImpresion,
    CASE
        WHEN P.ID IS NULL   THEN 'TRABA — no tiene ficha en ProductosTerminados'
        WHEN P.Activo = 0   THEN 'TRABA — la ficha está inactiva'
        WHEN P.AnchoM IS NULL THEN 'TRABA — la ficha no tiene AnchoM'
        WHEN P.AltoM  IS NULL THEN 'OK para subir, pero SIN control de medida (AltoM en NULL: entra cualquier arte)'
        ELSE 'OK'
    END                                              AS Diagnostico
FROM dbo.articulos a
LEFT JOIN dbo.ProductosTerminados P
       ON LTRIM(RTRIM(P.CodArticulo)) = LTRIM(RTRIM(a.CodArticulo))
WHERE LTRIM(RTRIM(a.CodStock)) IN (
        SELECT LTRIM(RTRIM(S.CodStock))
        FROM dbo.StockArt S
        INNER JOIN dbo.ConfigMapeoERP C ON C.CodigoERP = S.Grupo
        WHERE C.AreaID_Interno = 'ECOUV'
          AND ISNULL(S.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
          AND ISNULL(S.mostrar, 1) = 1)
  AND ISNULL(a.mostrar, 1) = 1
ORDER BY Diagnostico DESC, a.Descripcion;
