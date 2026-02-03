const { getPool } = require('./config/db');

async function run() {
    try {
        console.log("Connecting...");
        const pool = await getPool();
        const res = await pool.request().query("SELECT TOP 5 * FROM DiccionarioDatos");
        console.log("SAMPLE DATA DD:", res.recordset);
    } catch (e) {
        console.error("ERROR:", e.message);
    }
    process.exit();
}

run();
