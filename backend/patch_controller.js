const fs = require('fs');
const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/backend/controllers/contabilidadController.js';

let content = fs.readFileSync(path, 'utf8');

// Reemplazar solo la linea del SELECT que tiene todo en una linea
const oldLine = '                   SELECT d.ID AS DetalleID, a.CodArticulo, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.LogPrecioAplicado, a.Descripcion, pc.Moneda, a.CodStock, sa.Articulo AS ArticuloNombre\r\n                   FROM dbo.PedidosCobranza pc WITH(NOLOCK)\r\n                   JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID\r\n                   LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = d.ProIdProducto\r\n                   LEFT JOIN dbo.StockArt sa WITH(NOLOCK) ON a.CodStock = sa.CodStock\r\n                   WHERE LTRIM(RTRIM(pc.NoDocERP)) = oa.CodigoOrdenStr\r\n                   FOR JSON PATH\r\n                ) AS DetallesJSON';

const newBlock = `                   SELECT d.ID AS DetalleID,
                          ISNULL(a.CodArticulo, aod.CodArticulo) AS CodArticulo,
                          d.Cantidad, d.PrecioUnitario, d.Subtotal, d.LogPrecioAplicado,
                          COALESCE(
                              NULLIF(NULLIF(LTRIM(RTRIM(a.Descripcion)), 'Articulos User'), 'Articulos User USD'),
                              NULLIF(NULLIF(LTRIM(RTRIM(aod.Descripcion)), 'Articulos User'), 'Articulos User USD'),
                              NULLIF(LTRIM(RTRIM(odj.OrdMaterialPlanilla)), ''),
                              a.Descripcion,
                              aod.Descripcion
                          ) AS Descripcion,
                          pc.Moneda,
                          ISNULL(a.CodStock, aod.CodStock) AS CodStock,
                          ISNULL(sa.Articulo, saod.Articulo) AS ArticuloNombre
                   FROM dbo.PedidosCobranza pc WITH(NOLOCK)
                   JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
                   LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = d.ProIdProducto
                   LEFT JOIN dbo.StockArt sa WITH(NOLOCK) ON a.CodStock = sa.CodStock
                   LEFT JOIN dbo.OrdenesDeposito odj WITH(NOLOCK) ON LTRIM(RTRIM(odj.OrdCodigoOrden)) = LTRIM(RTRIM(pc.NoDocERP))
                   LEFT JOIN dbo.Articulos aod WITH(NOLOCK) ON aod.ProIdProducto = odj.ProIdProducto
                   LEFT JOIN dbo.StockArt saod WITH(NOLOCK) ON aod.CodStock = saod.CodStock
                   WHERE LTRIM(RTRIM(pc.NoDocERP)) = oa.CodigoOrdenStr
                   FOR JSON PATH
                ) AS DetallesJSON`;

if (content.includes(oldLine)) {
    content = content.replace(oldLine, newBlock);
    fs.writeFileSync(path, content, 'utf8');
    console.log('CAMBIO APLICADO OK');
} else {
    // Intentar con \n
    const oldLineN = oldLine.replace(/\r\n/g, '\n');
    if (content.replace(/\r\n/g, '\n').includes(oldLineN)) {
        const fixed = content.replace(/\r\n/g, '\n').replace(oldLineN, newBlock);
        fs.writeFileSync(path, fixed, 'utf8');
        console.log('CAMBIO APLICADO OK (con LF)');
    } else {
        console.log('AUN NO ENCONTRADO');
        // Mostrar los primeros 200 chars alrededor de DetalleID
        const idx = content.indexOf('SELECT d.ID AS DetalleID');
        console.log('Contexto:', JSON.stringify(content.substring(idx - 5, idx + 200)));
    }
}
