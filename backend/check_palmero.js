require('dotenv').config();
const { getPool, sql } = require('./config/db');

async function query() {
    try {
        const pool = await getPool();
        const res = await pool.request().query(`
            SELECT m.MovIdMovimiento, m.MovTipo, m.MovConcepto, m.MovImporte, m.DocIdDocumento, m.CicIdCiclo, m.MovAnulado
            FROM dbo.MovimientosCuenta m
            JOIN dbo.CuentasCliente c ON m.CueIdCuenta = c.CueIdCuenta
            JOIN dbo.Clientes cli ON c.CliIdCliente = cli.CliIdCliente
            WHERE cli.CliIdCliente = 998 AND m.MovTipo = 'ORDEN'
            ORDER BY m.MovFecha DESC
        `);
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
query();
