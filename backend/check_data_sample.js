const { getPool } = require('./config/db');

async function run() {
    try {
        console.log("Connecting...");
        const pool = await getPool();
        const res = await pool.request().query("SELECT TOP 10 CodArticulo, Grupo, SupFlia, Descripcion FROM articulos");
        console.log("SAMPLE DATA:", res.recordset);
    } catch (e) {
        console.error("ERROR:", e.message);
    }
    process.exit();
}

run();
