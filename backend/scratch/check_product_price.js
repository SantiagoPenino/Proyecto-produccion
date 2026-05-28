const { getPool, sql } = require('../config/db');

async function main() {
  try {
    const pool = await getPool();
    
    console.log('PreciosListaPublica distinct Moneda values:');
    const plRes = await pool.request().query('SELECT DISTINCT Moneda FROM dbo.PreciosListaPublica');
    console.table(plRes.recordset);

    console.log('PreciosBase distinct Moneda values:');
    const pbRes = await pool.request().query('SELECT DISTINCT Moneda FROM dbo.PreciosBase');
    console.table(pbRes.recordset);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
