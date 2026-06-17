require('dotenv').config();
const { getPool } = require('./config/db');
async function query() {
    try {
        const pool = await getPool();
        const res = await pool.request().query("SELECT TOP 1 * FROM dbo.Cotizaciones ORDER BY CotFecha DESC");
        console.table(res.recordset);
    } catch (e) {
        console.error("No Cotizaciones table or error");
    }
    process.exit(0);
}
query();
