const db = require('./config/db.js');
(async () => {
    try {
        const pool = await db.getPool();

        // 1. Ver que IDProdReact tienen los QR de XSB (que funcionan) vs XIMD/IMD
        console.log('=== QR_Producto en PedidosCobranza XSB vs XIMD/IMD ===');
        const r1 = await pool.request().query(`
            SELECT pc.NoDocERP, pc.QR_Producto, pc.Moneda,
                   a.IDProdReact, a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS ArtDescripcion, a.MonIdMoneda
            FROM dbo.PedidosCobranza pc
            LEFT JOIN dbo.Articulos a ON a.IDProdReact = TRY_CAST(pc.QR_Producto AS INT)
            WHERE pc.NoDocERP IN ('XSB-62341','XSB-62799','XIMD-113','XIMD-107','IMD-112','IMD-115')
            ORDER BY pc.NoDocERP
        `);
        console.dir(r1.recordset, { depth: null });

        // 2. Ver exactamente que articulo tiene IDProdReact=162 (el que viene en XIMD-113)
        console.log('\n=== Articulo IDProdReact=162 ===');
        const r2 = await pool.request().query(`
            SELECT ProIdProducto, IDProdReact, LTRIM(RTRIM(CodArticulo)) AS CodArticulo, 
                   LTRIM(RTRIM(Descripcion)) AS Descripcion, MonIdMoneda
            FROM dbo.Articulos WHERE IDProdReact = 162
        `);
        console.dir(r2.recordset, { depth: null });

        // 3. Ver que IDProdReact tienen los articulos de XSB (para entender que funciona)
        console.log('\n=== Articulos que usan XSB (por OrdenesDeposito) ===');
        const r3 = await pool.request().query(`
            SELECT DISTINCT od.OrdCodigoOrden, od.ProIdProducto, 
                   LTRIM(RTRIM(a.Descripcion)) AS ArtDesc, a.IDProdReact, a.MonIdMoneda,
                   pc.QR_Producto
            FROM dbo.OrdenesDeposito od
            JOIN dbo.Articulos a ON a.ProIdProducto = od.ProIdProducto
            LEFT JOIN dbo.PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
            WHERE od.OrdCodigoOrden IN ('XSB-62341','XSB-62799','XIMD-113','XIMD-107','IMD-112','IMD-115')
        `);
        console.dir(r3.recordset, { depth: null });

        // 4. Que pasa cuando el pistoleo/importacion busca el producto por IDProdReact
        // (funcion getProductoPorIDReact)
        console.log('\n=== Busqueda getProductoPorIDReact para IDProdReact=162,82,150 ===');
        const r4 = await pool.request().query(`
            SELECT p.ProIdProducto, p.IDProdReact, LTRIM(RTRIM(p.Descripcion)) AS Descripcion, 
                   p.MonIdMoneda, p.CodStock
            FROM dbo.Articulos p
            WHERE p.IDProdReact IN (162, 82, 150, 32, 9)
        `);
        console.dir(r4.recordset, { depth: null });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
})();
