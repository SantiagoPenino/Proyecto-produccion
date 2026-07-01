const { getPool } = require('./config/db');

async function checkIdentity() {
    const pool = await getPool();
    const result = await pool.request().query(`
        SELECT OBJECT_NAME(object_id) AS TableName, name AS ColumnName
        FROM sys.columns
        WHERE is_identity = 1 AND OBJECT_NAME(object_id) = 'Articulos'
    `);
    console.log('Identity:', result.recordset);
    process.exit(0);
}

checkIdentity();
