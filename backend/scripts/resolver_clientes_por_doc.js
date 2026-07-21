// SOLO LECTURA — resuelve CliIdCliente real a partir del documento (sin ambigüedad de nombre).
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));

const docs = ['PC-1906', 'PC-1165', 'ET-1330', 'FA-73', 'ET-2061', 'ET-2074'];

(async () => {
  try {
    const pool = await getPool();
    const out = [];
    for (const doc of docs) {
      const [serie, numero] = doc.split('-');
      const r = await pool.request()
        .input('serie', sql.VarChar(10), serie)
        .input('numero', sql.VarChar(20), numero)
        .query(`
          SELECT TOP 1 dc.DocIdDocumento, dc.CliIdCliente, RTRIM(cli.IDCliente) AS IDCliente, RTRIM(cli.NombreFantasia) AS NombreFantasia
          FROM dbo.DocumentosContables dc
          JOIN dbo.Clientes cli ON cli.CliIdCliente = dc.CliIdCliente
          WHERE RTRIM(dc.DocSerie) = @serie AND RTRIM(dc.DocNumero) = @numero
        `);
      out.push({ Doc: doc, ...(r.recordset[0] || { CliIdCliente: 'NO ENCONTRADO' }) });
    }
    console.table(out);
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
