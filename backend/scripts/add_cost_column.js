const { getPool } = require('../config/db');
require('dotenv').config();

(async () => {
    try {
        const pool = await getPool();
        console.log("🔌 Conectando a Base de Datos...");

        // 1. Verificar si la columna ya existe
        const check = await pool.request().query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'CostoTotal'
        `);

        if (check.recordset.length > 0) {
            console.log("✅ La columna 'CostoTotal' ya existe en la tabla Ordenes. No se requieren cambios.");
        } else {
            console.log("🛠️ Agregando columna 'CostoTotal' (DECIMAL 18,2)...");
            // Agregar columna con valor por defecto 0
            await pool.request().query(`
                ALTER TABLE Ordenes 
                ADD CostoTotal DECIMAL(18, 2) DEFAULT 0 WITH VALUES;
            `);
            console.log("✅ Columna 'CostoTotal' agregada exitosamente.");
        }

        process.exit(0);
    } catch (e) {
        console.error("❌ Error al modificar la tabla:", e);
        process.exit(1);
    }
})();
