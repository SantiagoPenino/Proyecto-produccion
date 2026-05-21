const { getPool, sql } = require('../config/db');

async function checkDocs() {
    try {
        const pool = await getPool();
        const res = await pool.request().query(`
            SELECT TOP 10 d.DocIdDocumento, d.DocTipo, d.CliIdCliente, d.DocCliDireccion, d.DocCliNombre, d.DocCliDocumento, d.CfeEstado,
                           c.Nombre AS CliRazonSocial, c.CioRuc AS CliRUT, c.DireccionTrabajo AS CliDireccionTrabajo
            FROM DocumentosContables d
            LEFT JOIN Clientes c ON d.CliIdCliente = c.CliIdCliente
            ORDER BY d.DocIdDocumento DESC
        `);
        console.log(JSON.stringify(res.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkDocs();
