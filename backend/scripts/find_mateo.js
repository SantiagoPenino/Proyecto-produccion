const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CuentasCliente'`);
        console.log(r.recordset.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
run();
