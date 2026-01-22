const { getPool } = require('../config/db');

async function addModoRetiroColumn() {
    try {
        const pool = await getPool();
        console.log("🛠️ Intentando agregar columna 'ModoRetiro' a la tabla 'Ordenes'...");

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'ModoRetiro')
            BEGIN
                ALTER TABLE Ordenes ADD ModoRetiro VARCHAR(100);
                PRINT 'Columna ModoRetiro agregada exitosamente.';
            END
            ELSE
            BEGIN
                PRINT 'La columna ModoRetiro ya existe.';
            END
        `);

        console.log("✅ Proceso finalizado.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error agregando columna:", error);
        process.exit(1);
    }
}

addModoRetiroColumn();
