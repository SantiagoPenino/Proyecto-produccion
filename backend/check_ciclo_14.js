require('dotenv').config();
const { getPool, sql } = require('./config/db');

async function query() {
    try {
        const pool = await getPool();
        const res = await pool.request().query(`
            SELECT * FROM dbo.CiclosCredito WHERE CicIdCiclo = 14
        `);
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
query();
