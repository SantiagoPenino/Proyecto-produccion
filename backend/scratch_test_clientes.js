const { getPool, sql } = require('./config/db');

async function test() {
  try {
    console.log("Connecting to pool...");
    const pool = await getPool();
    const request = pool.request();
    
    console.log("Testing TODOS query...");
    const q = 'a';
    request.input('Q', sql.NVarChar(200), `%${q}%`);
    request.input('Qexact', sql.NVarChar(50), q);
    
    const result = await request.query(`
      SELECT TOP 50
        c.CliIdCliente,
        c.Nombre,
        c.NombreFantasia,
        c.Email,
        c.CodCliente,
        c.TClIdTipoCliente,
        c.CioRuc,
        c.DireccionTrabajo,
        c.DepartamentoID
      FROM dbo.Clientes c WITH(NOLOCK)
      WHERE 1=1 AND (c.Nombre LIKE @Q OR c.NombreFantasia LIKE @Q OR CAST(c.CliIdCliente AS VARCHAR) = @Qexact)
      ORDER BY c.Nombre
    `);
    console.log(`Success! Found ${result.recordset.length} clients.`);
    console.log("First 3 clients:", result.recordset.slice(0, 3));
    
    // Check if there are any clients where Nombre is empty/spaces or null
    const emptyNombre = result.recordset.filter(c => !c.Nombre || c.Nombre.trim() === '');
    console.log(`Found ${emptyNombre.length} clients with empty/spaces in Nombre out of the TOP 50.`);
    if (emptyNombre.length > 0) {
      console.log("Sample empty Nombre clients:", emptyNombre.slice(0, 3));
    }
  } catch (err) {
    console.error("Query failed with error:", err);
  } finally {
    process.exit(0);
  }
}

test();
