const { getPool, sql } = require('./backend/config/db');

async function checkTable() {
    try {
        console.log("Conectando a DB...");
        const pool = await getPool();

        console.log("Consultando esquema de dbo.Clientes...");
        const result = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Clientes' 
            AND COLUMN_NAME IN ('CodigoReact', 'IDReact', 'CodCliente')
        `);

        console.table(result.recordset);

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        process.exit();
    }
}

checkTable();
