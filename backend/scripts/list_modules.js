const { getPool, sql } = require('../config/db');

async function listModules() {
    try {
        const pool = await getPool();
        console.log("Connected to DB. Listing Top Level Modules...");
        const result = await pool.request().query("SELECT IdModulo, Titulo, Ruta FROM Modulos WHERE IdPadre IS NULL OR IdPadre = 0");
        console.table(result.recordset);
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

listModules();
