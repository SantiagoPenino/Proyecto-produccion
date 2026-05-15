const sql = require('mssql');
const { getPool } = require('./config/db');

getPool().then(pool => 
    pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('SP_AbrirSesionCaja')) AS def")
).then(res => {
    console.log(res.recordset[0].def);
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
