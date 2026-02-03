const { getPool } = require('./config/db');

async function run() {
    try {
        const pool = await getPool();
        console.log("🔍 Verificando estructura de PreciosEspeciales...");

        const res = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'PreciosEspeciales'
        `);

        console.table(res.recordset);

        console.log("🔍 Verificando estructura de PerfilesPrecios...");
        const res2 = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'PerfilesPrecios'
        `);
        console.table(res2.recordset);

        process.exit(0);
    } catch (e) {
        console.error("❌ Error verificando DB:", e);
        process.exit(1);
    }
}

run();
