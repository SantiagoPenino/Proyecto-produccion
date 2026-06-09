const sql = require('mssql');
const { getPool } = require('./config/db');

async function run() {
  try {
    const pool = await getPool();
    const movRes = await pool.request()
      .query(`
        SELECT TOP 10 MovIdMovimiento, MovTipo, MovConcepto, MovImporte, MovFecha, MovAnulado, MovObservaciones, DocIdDocumento, PagIdPago, OrdIdOrden, CueIdCuenta
        FROM dbo.MovimientosCuenta 
        WHERE MovConcepto LIKE '%DF-101367%' OR MovConcepto LIKE '%RL-10047%' OR OrdIdOrden = 138710
        ORDER BY MovIdMovimiento DESC
      `);
    console.log("Movimientos:", movRes.recordset);
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
