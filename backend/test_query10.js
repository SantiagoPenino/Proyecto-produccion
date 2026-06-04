const db = require('./config/db.js');
(async () => {
    try {
        const pool = await db.getPool();

        // Ver el DocumentosContables (cabecera)
        const r1 = await pool.request().query("SELECT * FROM dbo.DocumentosContables WHERE DocIdDocumento = 31");
        console.log('=== DocumentosContables #31 ===');
        console.dir(r1.recordset, { depth: null });

        // Ver Config_TiposDocumento
        const r2 = await pool.request().query("SELECT * FROM dbo.Config_TiposDocumento");
        console.log('=== Config_TiposDocumento ===');
        console.dir(r2.recordset, { depth: null });

        // Buscar donde se define IVA en el sisnet service
        // Ver la factura de Cierre de Ciclo y como genera los IVAs
        const r3 = await pool.request().query("SELECT TOP 5 * FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento IN (SELECT DocIdDocumento FROM dbo.DocumentosContables WHERE DocTipo LIKE '%Crédito%' OR DocTipo LIKE '%E-Ticket%') ORDER BY DcdIdDetalle DESC");
        console.log('=== Detalles de facturas credito/eticket ===');
        console.dir(r3.recordset, { depth: null });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
})();
