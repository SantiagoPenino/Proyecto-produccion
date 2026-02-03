const { getPool, sql } = require('./config/db');

async function addGlobalColumn() {
    try {
        const pool = await getPool();
        console.log("Connected to DB.");

        // Check EsGlobal column
        const check = await pool.request().query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'PerfilesPrecios' AND COLUMN_NAME = 'EsGlobal'
        `);

        if (check.recordset.length > 0) {
            console.log("✅ Column 'EsGlobal' already exists.");
        } else {
            console.log("⚠️ Column 'EsGlobal' missing. Adding it...");
            await pool.request().query("ALTER TABLE PerfilesPrecios ADD EsGlobal BIT DEFAULT 0");
            console.log("✅ Column 'EsGlobal' added successfully.");
        }

    } catch (e) {
        console.error("❌ Error:", e.message);
    }
    process.exit(0);
}

addGlobalColumn();
