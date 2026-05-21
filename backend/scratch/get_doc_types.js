const { getPool, sql } = require('../config/db');

async function getTypes() {
    try {
        const pool = await getPool();
        const res = await pool.request().query(`
            SELECT c.*, s.SecSerie, s.SecUltimoNumero 
            FROM Config_TiposDocumento c
            LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
        `);
        console.log(JSON.stringify(res.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

getTypes();
