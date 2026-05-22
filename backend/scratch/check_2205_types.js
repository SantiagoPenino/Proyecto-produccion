const sql = require('mssql');

async function run() {
    try {
        const configS2205 = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB2205',
            options: { encrypt: false, trustServerCertificate: true }
        };
        const configProd = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB',
            options: { encrypt: false, trustServerCertificate: true }
        };

        const pool2205 = await new sql.ConnectionPool(configS2205).connect();
        const poolProd = await new sql.ConnectionPool(configProd).connect();

        const query = `
            SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'AjustesDocumento'
            ORDER BY COLUMN_NAME
        `;

        const res2205 = await pool2205.request().query(query);
        const resProd = await poolProd.request().query(query);

        console.log("=== SecureAppDB2205 ===");
        console.dir(res2205.recordset);

        console.log("=== SecureAppDB ===");
        console.dir(resProd.recordset);

        await pool2205.close();
        await poolProd.close();
    } catch (err) {
        console.error(err);
    }
}
run();
