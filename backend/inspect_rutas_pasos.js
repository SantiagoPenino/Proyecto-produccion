const { getPool } = require('./config/db');

async function test() {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT * FROM RutasPasos");
        console.log(JSON.stringify(result.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}

test();
