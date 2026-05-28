const { getPool, sql } = require('../config/db');

async function testQuery(term) {
  try {
    const pool = await getPool();
    console.log(`\n--- Testing search for: "${term}" ---`);
    
    const request = pool.request();
    const filtroNombre = `AND (
      c.Nombre LIKE @Q 
      OR c.NombreFantasia LIKE @Q 
      OR c.Email LIKE @Q 
      OR c.TelefonoTrabajo LIKE @Q 
      OR c.CioRuc LIKE @Q 
      OR CAST(c.CliIdCliente AS VARCHAR) = @Qexact
      OR CAST(c.CodCliente AS VARCHAR) = @Qexact
    )`;
    request.input('Q', sql.NVarChar(200), `%${term}%`);
    request.input('Qexact', sql.NVarChar(50), term);

    const queryStr = `
      SELECT TOP 5
        c.CliIdCliente,
        RTRIM(LTRIM(c.Nombre)) AS Nombre,
        RTRIM(LTRIM(c.NombreFantasia)) AS NombreFantasia,
        RTRIM(LTRIM(c.Email)) AS Email,
        c.CodCliente,
        RTRIM(LTRIM(c.CioRuc)) AS CioRuc,
        RTRIM(LTRIM(c.TelefonoTrabajo)) AS TelefonoTrabajo
      FROM dbo.Clientes c WITH(NOLOCK)
      WHERE 1=1 ${filtroNombre}
      ORDER BY RTRIM(LTRIM(c.Nombre))
    `;

    const result = await request.query(queryStr);
    console.log(`Found ${result.recordset.length} clients.`);
    console.log(JSON.stringify(result.recordset, null, 2));
  } catch (err) {
    console.error(`Query failed for "${term}":`, err.message);
  }
}

async function main() {
  // Test search by RUC
  await testQuery('58014687');
  
  // Test search by Email
  await testQuery('bordadospando1@hotmail.com');
  
  // Test search by Phone (let's check a partial search or list any phone number)
  try {
    const pool = await getPool();
    const phoneSample = await pool.request().query(`
      SELECT TOP 1 RTRIM(LTRIM(TelefonoTrabajo)) AS TelefonoTrabajo 
      FROM dbo.Clientes 
      WHERE TelefonoTrabajo IS NOT NULL AND RTRIM(LTRIM(TelefonoTrabajo)) <> ''
    `);
    if (phoneSample.recordset.length > 0) {
      const tel = phoneSample.recordset[0].TelefonoTrabajo;
      await testQuery(tel);
    } else {
      console.log("\nNo clients found with a non-empty TelefonoTrabajo to test search by phone.");
    }
  } catch (e) {
    console.error("Error finding sample phone:", e.message);
  }
  
  process.exit(0);
}

main();
