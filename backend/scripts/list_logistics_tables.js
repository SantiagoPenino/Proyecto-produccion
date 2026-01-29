const { sql, getPool } = require('../config/db');
async function run() {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'Logistica_%' OR TABLE_NAME LIKE '%Movimiento%'");
        console.log("Tablas encontradas:", r.recordset.map(x => x.TABLE_NAME).join(', '));
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
run();
