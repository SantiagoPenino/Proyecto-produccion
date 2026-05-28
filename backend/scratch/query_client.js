const { getPool } = require('../config/db');

async function run() {
  try {
    const pool = await getPool();
    const res = await pool.request().query("SELECT CliIdCliente, CodCliente, IDCliente, Nombre FROM dbo.Clientes WHERE CliIdCliente = 2930");
    console.log("YOANIA DATA:", JSON.stringify(res.recordset, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
