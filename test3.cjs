const { getPool, sql } = require('./backend/config/db');
(async () => {
  try {
    const pool = await getPool();
    const res = await pool.request().query(`
      UPDATE m
      SET m.DocIdDocumento = d.DocIdDocumento
      FROM dbo.MovimientosCuenta m
      JOIN dbo.DeudaDocumento d ON d.OrdIdOrden = m.OrdIdOrden
      WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
        AND m.DocIdDocumento IS NULL
        AND d.DocIdDocumento IS NOT NULL
    `);
    console.log('Fixed', res.rowsAffected, 'movimientos de orden.');
  } catch(e){ console.error(e) }
  process.exit(0);
})();
