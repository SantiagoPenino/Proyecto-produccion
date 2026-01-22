const { getPool } = require('../config/db');

async function getSPDefinition() {
    try {
        const pool = await getPool();
        const result = await pool.request().query("sp_helptext 'sp_PredecirProximoServicio'");

        console.log("📜 Definición de sp_PredecirProximoServicio:");
        result.recordset.forEach(row => {
            process.stdout.write(row.Text);
        });
        process.exit(0);
    } catch (error) {
        console.error("❌ Error leyendo SP:", error);
        process.exit(1);
    }
}

getSPDefinition();
