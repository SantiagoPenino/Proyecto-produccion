const { getPool } = require('../config/db');
require('dotenv').config();

(async () => {
    try {
        const pool = await getPool();
        console.log("🔌 Conectando a Base de Datos...");

        // Verificar si la columna ya existe
        const check = await pool.request().query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'CodArticulo'
        `);

        if (check.recordset.length > 0) {
            console.log("✅ Columna 'CodArticulo' ya existe.");
        } else {
            console.log("🛠️ Agregando columna 'CodArticulo' (VARCHAR 50)...");
            await pool.request().query(`
                ALTER TABLE Ordenes 
                ADD CodArticulo VARCHAR(50) NULL;
            `);
            console.log("✅ Columna 'CodArticulo' agregada.");
        }

        process.exit(0);
    } catch (e) {
        console.error("❌ Error al modificar tabla:", e);
        process.exit(1);
    }
})();
