const {getPool, sql} = require('./config/db');
getPool().then(pool => {
  return pool.request().query(
    "SELECT c.CodDocumento, c.Detalle, c.SecIdSecuencia, c.Codigo_Efact, " +
    "s.SecSerie, s.SecPrefijo, s.SecUltimoNumero " +
    "FROM Config_TiposDocumento c " +
    "LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia " +
    "ORDER BY c.CodDocumento"
  );
}).then(r => { console.log(JSON.stringify(r.recordset, null, 2)); process.exit(0); })
.catch(e => { console.error(e.message); process.exit(1); });
