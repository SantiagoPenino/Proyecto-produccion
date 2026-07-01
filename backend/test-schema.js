const { getPool, sql } = require('./config/db');

async function checkArticulosSchema() {
    const pool = await getPool();
    const result = await pool.request().query(`
        SELECT TOP 1 * FROM Articulos
    `);
    console.log(Object.keys(result.recordset[0]));
    process.exit(0);
}

checkArticulosSchema();
