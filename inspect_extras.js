const { getPool } = require('./backend/config/db');
require('dotenv').config({ path: './backend/.env' });

(async () => {
    try {
        const pool = await getPool();
        console.log("Conectado. Consultando ServiciosExtraOrden...");
        const res = await pool.request().query("SELECT TOP 1 * FROM ServiciosExtraOrden");

        if (res.recordset.length > 0) {
            console.log("Columnas encontradas:", Object.keys(res.recordset[0]));
            console.log("Ejemplo:", res.recordset[0]);
        } else {
            console.log("La tabla ServiciosExtraOrden está vacía.");
            // Consultar metadata si está vacía
            const meta = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ServiciosExtraOrden'");
            console.log("Metadata:", meta.recordset.map(r => r.COLUMN_NAME));
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
