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
        // Cómo interpretar las columnas `datetime` (no guardan zona horaria). Depende del reloj
        // del SQL Server, que NO es el mismo en los dos entornos:
        //   - PRODUCCIÓN: el server está en UTC, así que GETDATE() escribe UTC → useUTC = true
        //     (el default de la librería, y el correcto: el navegador lo pasa a local solo).
        //   - LOCAL: el SQL está en hora de Uruguay, GETDATE() escribe hora local → useUTC = false,
        //     si no el driver la etiqueta como UTC y el navegador le resta 3 horas más.
        // Se controla con DB_USE_UTC en el .env; sin la variable queda el comportamiento de
        // producción. Para verificar en qué está parado un server: SELECT GETDATE(), GETUTCDATE().
        useUTC: process.env.DB_USE_UTC !== 'false'
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