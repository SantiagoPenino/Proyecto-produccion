require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mssql = require('mssql');

async function run() {
  try {
    const dbName = process.env.DB_DATABASE || process.env.DB_NAME || 'SecureAppDB';
    await mssql.connect({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: dbName,
      options: { encrypt: false, trustServerCertificate: true }
    });

    const result = await mssql.query(`
      SELECT ProIdProducto, CodArticulo, Descripcion, SupFlia, Grupo
      FROM dbo.Articulos
      WHERE Descripcion LIKE '%DTF%' OR CodArticulo LIKE '%DTF%';
    `);
    console.log("DTF Articles:", result.recordset);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    mssql.close();
  }
}
run();
