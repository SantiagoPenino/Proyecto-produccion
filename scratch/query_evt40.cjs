const { getPool, sql } = require('../backend/config/db');

async function test() {
  try {
    const pool = await getPool();
    console.log("=== Evento '40' ===");
    const res = await pool.request().query("SELECT * FROM dbo.Cont_EventosContables WHERE EvtCodigo = '40'");
    console.log(res.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

test();
