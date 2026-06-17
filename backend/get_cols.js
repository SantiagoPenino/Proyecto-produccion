require('dotenv').config();
const { getPool } = require('./config/db');
async function query() {
    const pool = await getPool();
    const res = await pool.request().query("SELECT TOP 1 * FROM dbo.OrdenesDeposito");
    console.log(Object.keys(res.recordset[0]));
    process.exit(0);
}
query();
