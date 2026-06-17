require('dotenv').config();
const { getPool, sql } = require('./config/db');

async function getMovimientos() {
    try {
        const pool = await getPool();
        const res = await pool.request().query(`
            SELECT m.MovIdMovimiento, c.CueTipo, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovFecha, m.DocIdDocumento
            FROM dbo.MovimientosCuenta m
            JOIN dbo.CuentasCliente c ON m.CueIdCuenta = c.CueIdCuenta
            WHERE m.DocIdDocumento = 6 OR m.MovConcepto LIKE '%UVDF-102227%' OR m.MovConcepto LIKE '%SB-64135%'
            ORDER BY m.MovFecha DESC
        `);
        console.table(res.recordset);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

getMovimientos();
