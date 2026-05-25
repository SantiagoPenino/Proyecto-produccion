const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../config/db');

async function run() {
  try {
    const sqlPath = path.resolve(__dirname, '../4-crear-articulos-permitidos.sql');
    const sqlQuery = fs.readFileSync(sqlPath, 'utf8');
    console.log("Reading SQL from:", sqlPath);
    console.log("Query content:\n", sqlQuery);

    const pool = await getPool();
    console.log("Executing query...");
    const result = await pool.request().query(sqlQuery);
    console.log("Migration executed successfully. Result:", result);
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    process.exit(0);
  }
}

run();
