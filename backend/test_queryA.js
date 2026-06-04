const db = require('./config/db.js');
(async () => {
    try {
        const pool = await db.getPool();

        // IDProdReact=162 - que articulo es?
        const r1 = await pool.request().query("SELECT ProIdProducto, IDProdReact, CodArticulo, Descripcion, MonIdMoneda FROM dbo.Articulos WHERE IDProdReact = 162 OR ProIdProducto = 162");
        console.log('=== Articulo IDProdReact=162 ===');
        console.dir(r1.recordset, { depth: null });

        // Ver XIMD-113 en dbo.Ordenes (la tabla ERP)
        const r2 = await pool.request().query("SELECT OrdenID, CodigoOrden, NoDocERP, ProIdProducto, CodArticulo, Material, DescripcionTrabajo FROM dbo.Ordenes WHERE CodigoOrden = 'XIMD-113' OR LTRIM(RTRIM(NoDocERP)) = 'XIMD-113'");
        console.log('=== Ordenes ERP XIMD-113 ===');
        console.dir(r2.recordset, { depth: null });

        // Ver PedidosCobranzaDetalle actual para XIMD-113 (despues del reload)
        const r3 = await pool.request().query("SELECT pc.NoDocERP, pcd.*, a.Descripcion AS ArtDesc FROM dbo.PedidosCobranza pc JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.PedidoCobranzaID = pc.ID LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pcd.ProIdProducto WHERE pc.NoDocERP = 'XIMD-113'");
        console.log('=== PedidosCobranzaDetalle actual XIMD-113 ===');
        console.dir(r3.recordset, { depth: null });

        // Ver OrdenesDeposito actual XIMD-113
        const r4 = await pool.request().query("SELECT od.*, a.Descripcion AS ArtDesc FROM dbo.OrdenesDeposito od LEFT JOIN dbo.Articulos a ON a.ProIdProducto = od.ProIdProducto WHERE od.OrdCodigoOrden = 'XIMD-113'");
        console.log('=== OrdenesDeposito actual XIMD-113 ===');
        console.dir(r4.recordset, { depth: null });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
})();
