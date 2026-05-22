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

        const tables = ['MovimientosCuenta', 'DocumentosContables', 'Clientes', 'CuentasCliente', 'SecuenciaDocumentos', 'ConfiguracionPrecios'];
        for (const t of tables) {
            const count2205 = await pool2205.request().query(`SELECT COUNT(1) AS cnt FROM dbo.[${t}]`);
            const countProd = await poolProd.request().query(`SELECT COUNT(1) AS cnt FROM dbo.[${t}]`);
            console.log(`Table ${t} -> SecureAppDB2205: ${count2205.recordset[0].cnt} rows, SecureAppDB: ${countProd.recordset[0].cnt} rows`);
        }

        await pool2205.close();
        await poolProd.close();
    } catch (err) {
        console.error(err);
    }
}
run();
