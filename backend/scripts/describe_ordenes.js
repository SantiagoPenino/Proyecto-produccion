const { sql, getPool } = require('../config/db');
async function run() {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Ordenes'");
        console.log("Columnas de Ordenes:", r.recordset.map(x => x.COLUMN_NAME).join(', '));
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
run();
