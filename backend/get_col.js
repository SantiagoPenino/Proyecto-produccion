const sql = require('mssql');
const { getPool } = require('./config/db');

getPool().then(pool => 
    pool.request().query(`SELECT c.COLUMN_NAME, c.IS_NULLABLE, c.COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = 'SesionesTurno' AND c.COLUMN_NAME = 'StuFechaApertura'`)
).then(res => {
    console.log(res.recordset);
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
