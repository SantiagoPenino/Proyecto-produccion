const { getPool, sql } = require('./config/db');

async function checkSpecificTables() {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME IN ('BitacoraProduccion', 'HistorialOrdenes', 'Auditoria')
            ORDER BY TABLE_NAME, COLUMN_NAME
        `);
        console.log(JSON.stringify(result.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

checkSpecificTables();
