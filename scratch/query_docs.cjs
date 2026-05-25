const { getPool, sql } = require('../backend/config/db');

async function test() {
  try {
    const pool = await getPool();
    console.log("=== Config_TiposDocumento ===");
    const resDocs = await pool.request().query("SELECT CodDocumento, Detalle, SecIdSecuencia FROM dbo.Config_TiposDocumento");
    console.table(resDocs.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

test();
