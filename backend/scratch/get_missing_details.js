const sql = require('mssql');

async function run() {
    try {
        const config = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB2205',
            options: { encrypt: false, trustServerCertificate: true }
        };
        const pool = await new sql.ConnectionPool(config).connect();
        
        console.log("=== DETALLE DE TABLA Config_CFE ===");
        const cfeCols = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'Config_CFE'
            ORDER BY ORDINAL_POSITION
        `);
        console.dir(cfeCols.recordset);

        console.log("\n=== DETALLE DE COLUMNAS EN DocumentosContables ===");
        const docCols = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'DocumentosContables' AND COLUMN_NAME IN ('DocCaeNumero', 'DocCodSeguridad', 'DocDiasVencimiento', 'DocVendedorId')
        `);
        console.dir(docCols.recordset);

        console.log("\n=== DETALLE DE COLUMNAS EN SecuenciaDocumentos ===");
        const secCols = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'SecuenciaDocumentos' AND COLUMN_NAME IN ('SecFechaVencimientoCAE', 'SecNroResolucion', 'SecRangoDesde', 'SecRangoHasta')
        `);
        console.dir(secCols.recordset);

        await pool.close();
    } catch (err) {
        console.error(err);
    }
}
run();
