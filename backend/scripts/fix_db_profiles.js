const { getPool, sql } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        console.log("Conectado a DB.");

        // 1. Agregar PerfilID a PreciosEspeciales
        try {
            await pool.request().query("ALTER TABLE PreciosEspeciales ADD PerfilID INT NULL");
            console.log("✅ Columna PerfilID agregada a PreciosEspeciales.");
        } catch (e) {
            console.log("⚠️  PerfilID en PreciosEspeciales ya existía o error:", e.message);
        }

        // 2. Agregar CantidadMinima a PerfilesItems
        try {
            await pool.request().query("ALTER TABLE PerfilesItems ADD CantidadMinima INT DEFAULT 1 WITH VALUES");
            console.log("✅ Columna CantidadMinima agregada a PerfilesItems.");
        } catch (e) {
            console.log("⚠️  CantidadMinima en PerfilesItems ya existía o error:", e.message);
        }

        console.log("Script finalizado.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Error CRÍTICO:", e);
        process.exit(1);
    }
}

run();
