const { getPool } = require('./config/db');

async function checkDefault() {
    const pool = await getPool();
    const result = await pool.request().query(`
        SELECT TOP 1 * FROM Articulos WHERE SupFlia = '2'
    `);
    console.log(result.recordset[0]);
    process.exit(0);
}

checkDefault();
