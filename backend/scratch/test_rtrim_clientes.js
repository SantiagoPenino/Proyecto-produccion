const { getPool, sql } = require('../config/db');

async function main() {
  try {
    const pool = await getPool();
    console.log('Testing SQL query inside getClientesActivos with RTRIM/LTRIM...');
    
    const q = 'Joaquin';
    const request = pool.request();
    const filtroNombre = `AND (c.Nombre LIKE @Q OR c.NombreFantasia LIKE @Q OR CAST(c.CliIdCliente AS VARCHAR) = @Qexact)`;
    request.input('Q', sql.NVarChar(200), `%${q}%`);
    request.input('Qexact', sql.NVarChar(50), q);

    const queryStr = `
      SELECT TOP 50
        c.CliIdCliente,
        RTRIM(LTRIM(c.Nombre)) AS Nombre,
        RTRIM(LTRIM(c.NombreFantasia)) AS NombreFantasia,
        RTRIM(LTRIM(c.Email)) AS Email,
        c.CodCliente,
        c.TClIdTipoCliente,
        RTRIM(LTRIM(c.CioRuc)) AS CioRuc,
        RTRIM(LTRIM(c.DireccionTrabajo)) AS DireccionTrabajo,
        c.DepartamentoID
      FROM dbo.Clientes c WITH(NOLOCK)
      WHERE 1=1 ${filtroNombre}
      ORDER BY RTRIM(LTRIM(c.Nombre))
    `;

    console.log('Running query...');
    const result = await request.query(queryStr);
    console.log(`Query succeeded with ${result.recordset.length} rows.`);
    console.log('Clients returned:', JSON.stringify(result.recordset, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('SQL Query failed:', err);
    process.exit(1);
  }
}

main();
