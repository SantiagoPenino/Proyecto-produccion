// backend-externo/config/db.config.js

const sql = require('mssql');
require('dotenv').config(); 

const config = { 
    // PROPIEDADES REQUERIDAS POR MSSQL (EN INGLÉS)
    server: process.env.DB_SERVER, 
    database: process.env.DB_DATABASE,
    
    // Autenticación de SQL Server (SA)
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD,

    // El puerto está comentado para usar el puerto dinámico de la instancia nombrada
    // puerto: 1433, 
    
    // Propiedades del pool en inglés (Corregido: maximo -> max, etc.)
    pool: {
        max: 10,                 
        min: 0,                  
        idleTimeoutMillis: 30000 
    },
    
    options: {
        encrypt: false, 
        trustServerCertificate: true, 
        enableArithAbort: true
    }
};

let pool;

const getPool = async () => {
    try {
        if (pool && pool.connected) {
            return pool;
        }

        // Conecta usando la configuración estandarizada
        pool = await sql.connect(config); 
        
        console.log("✅ Conexión a MSSQL exitosa.");
        return pool;
    } catch (err) {
        console.error('❌ Error de conexión SQL:', err.message);
        process.exit(1); 
    }
};

module.exports = { sql, getPool };