const { getPool } = require('./backend/config/db');
(async () => {
  try {
    const pool = await getPool();
    const res = await pool.request().query(`
      SELECT m.MovIdMovimiento, m.OrdIdOrden, m.MovTipo, m.DocIdDocumento, d.DocSerie, d.DocNumero, od.OrdCodigoOrden as CodD
      FROM MovimientosCuenta m
      LEFT JOIN DocumentosContables d ON m.DocIdDocumento = d.DocIdDocumento
      LEFT JOIN OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
      WHERE od.OrdCodigoOrden = 'DF-101347' OR m.MovConcepto LIKE '%DF-101347%'
    `);
    console.dir(res.recordset);
  } catch(e){ console.error(e) }
  process.exit(0);
})();
