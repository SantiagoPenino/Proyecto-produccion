const { getPool } = require('./backend/config/db');
(async () => {
  try {
    const pool = await getPool();
    const res = await pool.request().query(`
      SELECT m.MovIdMovimiento, m.OrdIdOrden, m.MovTipo, m.DocIdDocumento, d.DocSerie, d.DocNumero
      FROM MovimientosCuenta m
      LEFT JOIN DocumentosContables d ON m.DocIdDocumento = d.DocIdDocumento
      WHERE m.OrdIdOrden IN (
        SELECT OrdIdOrden FROM OrdenesDeposito WHERE OrdCodigoOrden = 'DF-101347'
      )
    `);
    console.dir(res.recordset);
  } catch(e){ console.error(e) }
  process.exit(0);
})();
