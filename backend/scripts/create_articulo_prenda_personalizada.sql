-- =====================================================================
-- Artículo genérico "Prenda Personalizada" (CodArticulo = 'PPERS')
-- Solución puente (4-sep-2026): permite que el modo "Producto personalizado
-- (cliente)" de /ventas/pedido-prenda cree la ORDEN MADRE PRO (nace y muere
-- el flujo en PRO) sin tener configurados los productos reales del catálogo.
--  · Cuelga de StockArt 2.2.1.3 ("Prendas", TipoStock=PRODUCTO_TERMINADO).
--  · Mostrar = 0: NO aparece en ningún selector de productos terminados
--    (el backend lo resuelve por CodArticulo='PPERS' en prendasOrdersController).
--  · PreciosBase = $0 UYU: la línea PRO cotiza 0 y el precio del pedido lo
--    definen los marcadores de la Nota ([FACTURA POR AREA] / [PRECIO ESTABLECIDO]).
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = 'PPERS' AND ISNULL(borrar, 0) = 0)
BEGIN
    INSERT INTO dbo.Articulos
        (CodArticulo, IDProdReact, Descripcion, CodStock, Grupo, SupFlia, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, borrar)
    VALUES
        ('PPERS', NULL, 'Prenda Personalizada (sin catálogo)', '2.2.1.3', '2.1', '1', 0, 0, 0, 1, 0);

    -- IDProdReact = ProIdProducto (misma convención que crearProductoTerminado)
    UPDATE dbo.Articulos SET IDProdReact = ProIdProducto
    WHERE LTRIM(RTRIM(CodArticulo)) = 'PPERS' AND IDProdReact IS NULL;
END;

-- Precio base $0 (ambas columnas de moneda consistentes — lección del bug
-- Moneda texto vs MonIdMoneda que cobraba pesos como USD)
IF NOT EXISTS (
    SELECT 1 FROM dbo.PreciosBase pb
    JOIN dbo.Articulos a ON a.ProIdProducto = pb.ProIdProducto
    WHERE LTRIM(RTRIM(a.CodArticulo)) = 'PPERS'
)
BEGIN
    INSERT INTO dbo.PreciosBase (CodArticulo, Precio, Moneda, UltimaActualizacion, MonIdMoneda, ProIdProducto)
    SELECT LTRIM(RTRIM(a.CodArticulo)), 0, 'UYU', GETDATE(), 1, a.ProIdProducto
    FROM dbo.Articulos a
    WHERE LTRIM(RTRIM(a.CodArticulo)) = 'PPERS' AND ISNULL(a.borrar, 0) = 0;
END;

SELECT a.ProIdProducto, a.CodArticulo, a.Descripcion, a.CodStock, a.Mostrar, pb.Precio, pb.Moneda, pb.MonIdMoneda
FROM dbo.Articulos a
LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
WHERE LTRIM(RTRIM(a.CodArticulo)) = 'PPERS';
