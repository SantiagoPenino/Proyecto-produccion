const { getPool, sql } = require('../config/db');

async function checkColumns() {
    try {
        const pool = await getPool();
        const resClientes = await pool.request().query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Clientes'
        `);
        console.log("CLIENTES COLUMNS:");
        console.log(resClientes.recordset.map(r => r.COLUMN_NAME).join(', '));

        const resDocs = await pool.request().query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'DocumentosContables'
        `);
        console.log("\nDOCUMENTOSCONTABLES COLUMNS:");
        console.log(resDocs.recordset.map(r => r.COLUMN_NAME).join(', '));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkColumns();
