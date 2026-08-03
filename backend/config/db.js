const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const logger = require('../utils/logger');

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    // Si viene un puerto específico en el .env lo usamos, si no, dejamos que mssql lo maneje dinámicamente
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
    requestTimeout: 120000,
    options: {
        // Si viene el nombre de una instancia (ej. SQLEXPRESS2025), lo asignamos aquí
        instanceName: process.env.DB_INSTANCE || undefined,
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        // Las fechas se escriben con GETDATE(), o sea HORA LOCAL de Uruguay, en columnas `datetime`
        // que no guardan zona horaria. El default de mssql (`useUTC: true`) las lee como si fueran
        // UTC: el driver devolvía las 17:03 etiquetadas como 17:03Z y el navegador las volvía a
        // pasar a local, mostrando 14:03. Tres horas menos en TODA fecha del sistema.
        useUTC: false
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let poolPromise = null;

const getPool = async () => {
    try {
        if (poolPromise) {
            return await poolPromise;
        }

        poolPromise = new sql.ConnectionPool(config)
            .connect()
            .then(pool => {
                logger.info('✅ Conectado a MSSQL');
                return pool;
            })
            .catch(err => {
                logger.error('❌ Error conectando a MSSQL:', err);
                poolPromise = null; // Reset promise on error
                throw err;
            });

        return await poolPromise;
    } catch (err) {
        logger.error('❌ Error en getPool:', err);
        throw err;
    }
};

module.exports = { sql, getPool, poolPromise };