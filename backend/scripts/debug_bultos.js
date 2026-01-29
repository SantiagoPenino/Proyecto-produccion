const { sql, getPool } = require('../config/db');

async function debug() {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT RecepcionID, Cliente, ProximoServicio 
            FROM Recepciones 
            WHERE RecepcionID = 39
        `);
        console.log(r.recordset);
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
debug();
