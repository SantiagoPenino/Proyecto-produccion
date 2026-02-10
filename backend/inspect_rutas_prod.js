const { getPool } = require('./config/db');

async function test() {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT TOP 20 * FROM RutasProduccion");
        console.log(JSON.stringify(result.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

test();
