const { getPool, sql } = require('./config/db');

async function checkFam2() {
    const pool = await getPool();
    const result = await pool.request().query(`
        SELECT COUNT(*) as total FROM Articulos WHERE SupFlia = '2'
    `);
    const resultWMS = await pool.request().query(`
        SELECT COUNT(*) as wms_total FROM Articulos WHERE SupFlia = '2' AND CodArticulo LIKE 'WMS-%'
    `);
    console.log('Total Fam 2:', result.recordset[0].total);
    console.log('Total Fam 2 with WMS- code:', resultWMS.recordset[0].wms_total);
    process.exit(0);
}
checkFam2();
