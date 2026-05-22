const sql = require('mssql');

async function run() {
    try {
        const config = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB2205',
            options: { encrypt: false, trustServerCertificate: true }
        };
        const pool = await new sql.ConnectionPool(config).connect();
        
        const identRes = await pool.request().query(`
            SELECT COLUMNPROPERTY(OBJECT_ID('Config_CFE'), 'CfeCfgId', 'IsIdentity') as is_identity
        `);
        console.log("IsIdentity:", identRes.recordset[0].is_identity);
        
        const dataRes = await pool.request().query(`
            SELECT * FROM Config_CFE
        `);
        console.log("Data in Config_CFE:");
        console.dir(dataRes.recordset);
        
        await pool.close();
    } catch (err) {
        console.error(err);
    }
}
run();
