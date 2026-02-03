const { getPool } = require('./config/db');

async function run() {
    try {
        console.log("Connecting...");
        const pool = await getPool();
        console.log("Querying...");
        const res = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
        console.log("TABLES FOUND:");
        console.log(res.recordset.map(r => r.TABLE_NAME).join('\n'));
    } catch (e) {
        console.error("ERROR:", e.message);
    }
    process.exit();
}

run();
