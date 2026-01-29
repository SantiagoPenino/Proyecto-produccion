const { sql, getPool } = require('../config/db');
async function run() {
    try {
        const pool = await getPool();
        // Bultos con ID pero sin match real
        console.log("Chequeando integridad referencial...");
        const r = await pool.request().query("SELECT b.BultoID, b.RecepcionID FROM Logistica_Bultos b LEFT JOIN Recepciones r ON b.RecepcionID = r.RecepcionID WHERE b.RecepcionID IS NOT NULL AND r.RecepcionID IS NULL");
        console.log("IDs Rotos (Bultos apuntando a Recepciones inexistentes):", r.recordset.length);
        if (r.recordset.length > 0) console.table(r.recordset);
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
run();
