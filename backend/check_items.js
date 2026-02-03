const { getPool } = require('./config/db');

async function run() {
    try {
        const pool = await getPool();
        console.log("🔍 Verificando Items...");

        const res3 = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'PreciosEspecialesItems'
        `);
        console.table(res3.recordset);

        // Test query with subquery
        console.log("Testing subquery execution...");
        await pool.request().query(`
             SELECT TOP 1 (SELECT COUNT(*) FROM PreciosEspecialesItems WHERE ClienteID = PE.ClienteID) 
             FROM PreciosEspeciales PE
        `);
        console.log("✅ Subquery OK");

        process.exit(0);
    } catch (e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

run();
