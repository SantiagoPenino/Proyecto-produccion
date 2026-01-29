const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { getPool } = require('../config/db');

(async () => {
    try {
        console.log("Connecting to DB...");
        const pool = await getPool();
        console.log("Adding RutaLocal column if not exists...");
        await pool.query("IF COL_LENGTH('dbo.ArchivosOrden', 'RutaLocal') IS NULL ALTER TABLE dbo.ArchivosOrden ADD RutaLocal VARCHAR(500)");
        console.log("✅ Columna RutaLocal asegurada.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
})();
