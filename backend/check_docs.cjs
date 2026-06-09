const sql = require('mssql');
const { getPool } = require('./config/db');

async function run() {
  try {
    const pool = await getPool();
    const pag = await pool.request().query('SELECT * FROM dbo.Pagos WHERE PagIdPago = 46162');
    const tcaId = pag.recordset[0].PagTcaIdTransaccion;
    console.log("Transaccion:", tcaId);

    const docs = await pool.request().query(`SELECT DocIdDocumento, DocTipo, DocSerie, DocNumero FROM dbo.DocumentosContables WHERE TcaIdTransaccion = ${tcaId}`);
    console.log("Documentos para Tca:", docs.recordset);
    
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
