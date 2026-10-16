-- ============================================================
-- INSERT Articulo: Gorros de lana con parches TPU
-- ProIdProducto se asigna automáticamente (IDENTITY)
-- ============================================================

INSERT INTO dbo.Articulos
    (CodArticulo, IDProdReact, SupFlia, Grupo, CodStock,
     Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda,
     ProCodigoOdooProducto, UniIdUnidad, borrar)
VALUES
    ('312', 312, '1', '1.10', '1.1.10.1',
     'Gorros de lana  con parches TPU', 1, 0, 0, 2,
     NULL, NULL, 0);

-- Verificación
SELECT ProIdProducto, LTRIM(RTRIM(CodArticulo)) AS CodArticulo,
       IDProdReact, Descripcion, MonIdMoneda
FROM dbo.Articulos
WHERE LTRIM(RTRIM(CodArticulo)) = '312';
