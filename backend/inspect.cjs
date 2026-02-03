const { getPool } = require('./config/db');
require('dotenv').config();

(async () => {
    try {
        const pool = await getPool();
        console.log("Conectado. Buscando columnas de Ordenes...");

        // Consultar metadata de tabla directamente
        const meta = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Ordenes'");
        console.log("COLUMNAS ACTUALES:", meta.recordset.map(r => r.COLUMN_NAME));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
