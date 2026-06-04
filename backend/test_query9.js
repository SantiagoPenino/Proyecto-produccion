const db = require('./config/db.js');
(async () => {
    try {
        const pool = await db.getPool();

        // Buscar el articulo de la orden XIMD-107
        const r1 = await pool.request().query("SELECT od.OrdCodigoOrden, od.ProIdProducto, od.OrdNombreTrabajo, od.OrdMaterialPlanilla, a.Descripcion AS ArtDescripcion, a.CodArticulo FROM dbo.OrdenesDeposito od LEFT JOIN dbo.Articulos a ON a.ProIdProducto = od.ProIdProducto WHERE od.OrdCodigoOrden LIKE '%XIMD%' ORDER BY od.OrdIdOrden DESC");
        console.log('=== OrdenesDeposito XIMD ===');
        console.dir(r1.recordset, { depth: null });

        // Ver PedidosCobranzaDetalle para esa orden
        const r2 = await pool.request().query("SELECT pc.NoDocERP, pcd.* FROM dbo.PedidosCobranza pc JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.PedidoCobranzaID = pc.ID WHERE pc.NoDocERP LIKE '%XIMD%'");
        console.log('=== PedidosCobranzaDetalle XIMD ===');
        console.dir(r2.recordset, { depth: null });

        // Ver DocumentosContablesDetalle para XIMD
        const r3 = await pool.request().query("SELECT * FROM dbo.DocumentosContablesDetalle WHERE OrdCodigoOrden LIKE '%XIMD%'");
        console.log('=== DocumentosContablesDetalle XIMD ===');
        console.dir(r3.recordset, { depth: null });

        // Ver articulo de nombre Articulos User o similar
        const r4 = await pool.request().query("SELECT TOP 5 * FROM dbo.Articulos WHERE Descripcion LIKE '%Articulo%' OR Descripcion LIKE '%User%'");
        console.log('=== Articulos con nombre generico ===');
        console.dir(r4.recordset, { depth: null });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
})();
