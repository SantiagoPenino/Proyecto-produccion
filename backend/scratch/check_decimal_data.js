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

        console.log("=== MovimientosCuenta in SecureAppDB2205 ===");
        const mc2205 = await pool2205.request().query("SELECT TOP 5 MovImporte, MovSaldoPosterior FROM MovimientosCuenta WHERE MovImporte <> CAST(MovImporte AS INT)");
        console.dir(mc2205.recordset);

        console.log("=== MovimientosCuenta in SecureAppDB ===");
        const mcProd = await poolProd.request().query("SELECT TOP 5 MovImporte, MovSaldoPosterior FROM MovimientosCuenta WHERE MovImporte <> CAST(MovImporte AS INT)");
        console.dir(mcProd.recordset);

        console.log("=== DocumentosContables in SecureAppDB2205 ===");
        const dc2205 = await pool2205.request().query("SELECT TOP 5 DocSubtotal, DocTotal FROM DocumentosContables WHERE DocTotal <> CAST(DocTotal AS INT)");
        console.dir(dc2205.recordset);

        console.log("=== DocumentosContables in SecureAppDB ===");
        const dcProd = await poolProd.request().query("SELECT TOP 5 DocSubtotal, DocTotal FROM DocumentosContables WHERE DocTotal <> CAST(DocTotal AS INT)");
        console.dir(dcProd.recordset);

        await pool2205.close();
        await poolProd.close();
    } catch (err) {
        console.error(err);
    }
}
run();
