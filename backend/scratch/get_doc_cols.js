const { getPool } = require('../config/db');

async function run() {
  const pool = await getPool();

  const res = await pool.request().query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Cont_AsientosCabecera'
  `);
  console.log("COLUMNS in Cont_AsientosCabecera:", res.recordset.map(r => r.COLUMN_NAME).join(", "));
  
  process.exit(0);
}
run().catch(console.error);
