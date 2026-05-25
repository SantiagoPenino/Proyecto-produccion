const { getPool, sql } = require('../backend/config/db');

async function test() {
  try {
    const pool = await getPool();
    console.log("=== Config_TiposDocumento ===");
    const resDocs = await pool.request().query("SELECT * FROM dbo.Config_TiposDocumento");
    console.table(resDocs.recordset);

    console.log("=== Cont_EventosContables ===");
    const resEvts = await pool.request().query("SELECT * FROM dbo.Cont_EventosContables");
    console.table(resEvts.recordset);

    console.log("=== Cont_ReglasAsiento ===");
    const resReglas = await pool.request().query("SELECT * FROM dbo.Cont_ReglasAsiento");
    console.table(resReglas.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

test();
