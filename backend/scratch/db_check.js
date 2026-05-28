const { getPool } = require('../config/db');

async function main() {
  try {
    const pool = await getPool();
    console.log("Connected to database successfully.\n");

    const res = await pool.request().query(`
      SELECT TOP 1 * FROM dbo.Usuarios
    `);
    console.log("User columns:", Object.keys(res.recordset[0] || {}));

  } catch (error) {
    console.error("Error executing script:", error);
  } finally {
    process.exit(0);
  }
}

main();
