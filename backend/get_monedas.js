require('dotenv').config();
const { getPool } = require('./config/db');
async function query() {
    const pool = await getPool();
    const res = await pool.request().query("SELECT * FROM dbo.Monedas");
    console.table(res.recordset);
    process.exit(0);
}
query();
