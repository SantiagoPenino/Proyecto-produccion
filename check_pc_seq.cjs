const sql = require('mssql');
const cfg = require('./backend/config/database');
sql.connect(cfg).then(pool => {
  return pool.request().query(
    "SELECT c.CodDocumento, c.Detalle, c.SecIdSecuencia, s.SecSerie, s.SecPrefijo, s.SecUltimoNumero, s.SecTipoDoc " +
    "FROM Config_TiposDocumento c " +
    "LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia " +
    "WHERE c.CodDocumento IN ('PC','ET','EF','RI','RC','AN') " +
    "ORDER BY c.CodDocumento"
  );
}).then(r => { console.log(JSON.stringify(r.recordset, null, 2)); process.exit(0); })
.catch(e => { console.error(e.message); process.exit(1); });
