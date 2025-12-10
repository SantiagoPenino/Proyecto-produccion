const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, 
    database: process.env.DB_DATABASE,
    port: 1433, // Aseguramos el puerto
    options: {
        // 👇 COPIADO DE TU TEST EXITOSO
        encrypt: false, 
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

const getPool = async () => {
    try {
        const pool = await sql.connect(config);
        return pool;
    } catch (err) {
        console.error('❌ Error Conexión SQL:', err);
        throw err;
    }
};

module.exports = { sql, getPool };