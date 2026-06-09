const { getPool, sql } = require('../../backend/config/db');
(async () => {
  try {
    const pool = await getPool();
    const docRes = await pool.request().query(`
      SELECT d.DocIdDocumento, d.DocTotal, d.CueIdCuenta, d.DocSerie, d.DocNumero, d.CicIdCiclo, d.DocTipo
      FROM dbo.DocumentosContables d
      WHERE d.DocSerie = 'PC' AND d.DocIdDocumento NOT IN (
          SELECT DocIdDocumento FROM dbo.MovimientosCuenta WHERE MovTipo = 'VTA_CAJA' AND DocIdDocumento IS NOT NULL
      )
    `);
    console.log('Docs sin VTA_CAJA:', docRes.recordset.length);
    const svc = require('../../backend/services/contabilidadService');
    for (const doc of docRes.recordset) {
        if (!doc.CueIdCuenta) continue;
        console.log('Fixing Doc:', doc.DocSerie, doc.DocNumero);
        await svc.registrarMovimiento({
            CueIdCuenta: doc.CueIdCuenta,
            MovTipo: 'VTA_CAJA',
            MovConcepto: 'Facturado (' + doc.DocTipo + ' ' + doc.DocSerie + '-' + doc.DocNumero + ')',
            MovImporte: -doc.DocTotal,
            MovUsuarioAlta: 1,
            DocIdDocumento: doc.DocIdDocumento,
            CicIdCiclo: doc.CicIdCiclo
        });
    }
    console.log('Done fixing PC documents.');
    process.exit(0);
  } catch (e) { console.error(e); process.exit(1); }
})();
