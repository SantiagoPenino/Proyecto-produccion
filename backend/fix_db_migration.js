const { getPool, sql } = require('./config/db');

async function fixDatabase() {
    try {
        const pool = await getPool();
        console.log("🛠️ Starting Database Fixes...");

        // 1. Fix BitacoraProduccion: Add UsuarioID if missing
        try {
            console.log("Checking BitacoraProduccion...");
            let checkCol = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'BitacoraProduccion' AND COLUMN_NAME = 'UsuarioID'");
            if (checkCol.recordset.length === 0) {
                console.log("Adding UsuarioID to BitacoraProduccion...");
                await pool.request().query("ALTER TABLE BitacoraProduccion ADD UsuarioID int NULL");
            } else {
                console.log("UsuarioID already exists in BitacoraProduccion.");
            }
        } catch (e) { console.error("Error fixing BitacoraProduccion:", e.message); }

        console.log("✅ Fixes applied.");
        process.exit(0);

    } catch (err) {
        console.error("❌ Critical Error:", err);
        process.exit(1);
    }
}

fixDatabase();
