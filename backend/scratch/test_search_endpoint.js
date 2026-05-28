const { getPool, sql } = require('../config/db');

async function main() {
  try {
    const pool = await getPool();
    console.log('Testing SQL query inside getClientesActivos (tipo=TODOS)...');
    
    // Simulate query parameters
    const q = 'a';
    const request = pool.request();
    const filtroNombre = `AND (c.Nombre LIKE @Q OR c.NombreFantasia LIKE @Q OR CAST(c.CliIdCliente AS VARCHAR) = @Qexact)`;
    request.input('Q', sql.NVarChar(200), `%${q}%`);
    request.input('Qexact', sql.NVarChar(50), q);

    const queryStr = `
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
      WHERE 1=1 ${filtroNombre}
      ORDER BY c.Nombre
    `;

    console.log('Running query...');
    const result = await request.query(queryStr);
    console.log(`Query succeeded with ${result.recordset.length} rows.`);
    console.table(result.recordset.slice(0, 5));

    console.log('Testing normal query...');
    const request2 = pool.request();
    request2.input('Q', sql.NVarChar(200), `%${q}%`);
    request2.input('Qexact', sql.NVarChar(50), q);
    const queryNormal = `
      DECLARE @TC DECIMAL(18,4) = ISNULL((SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC), 40.0);

      SELECT
        c.CliIdCliente,
        c.Nombre,
        c.NombreFantasia,
        c.Email,
        c.CodCliente,
        c.TClIdTipoCliente,
        c.CioRuc,
        c.DireccionTrabajo,
        c.DepartamentoID,
        COUNT(DISTINCT cc.CueIdCuenta)                                                           AS TotalCuentas,
        ISNULL(SUM(CASE WHEN cc.MonIdMoneda = 2 THEN cc.CueSaldoActual * @TC ELSE cc.CueSaldoActual END), 0) AS SaldoTotal,
        ISNULL(SUM(CASE WHEN cc.MonIdMoneda = 2 THEN dd.DDeImportePendiente * @TC ELSE dd.DDeImportePendiente END), 0) AS DeudaTotal,
        SUM(CASE WHEN dd.DDeFechaVencimiento < GETDATE()
                  AND dd.DDeEstado IN ('PENDIENTE','VENCIDO') THEN 1 ELSE 0 END)                 AS DocsVencidos,
        MAX(CASE WHEN cc.CueDiasCiclo > 0 THEN 1 ELSE 0 END)                                    AS EsSemanal,
        MAX(CASE WHEN cic.CicEstado = 'ABIERTO' THEN 1 ELSE 0 END)                              AS TieneCicloAbierto
      FROM      dbo.CuentasCliente cc WITH(NOLOCK)
      JOIN      dbo.Clientes        c  WITH(NOLOCK) ON c.CliIdCliente  = cc.CliIdCliente
      LEFT JOIN dbo.DeudaDocumento  dd WITH(NOLOCK) ON dd.CueIdCuenta  = cc.CueIdCuenta
                                                    AND dd.DDeEstado   IN ('PENDIENTE','VENCIDO','PARCIAL')
      LEFT JOIN dbo.CiclosCredito  cic WITH(NOLOCK) ON cic.CueIdCuenta = cc.CueIdCuenta
                                                    AND cic.CicEstado  = 'ABIERTO'
      WHERE cc.CueActiva = 1
        AND (
            cc.CueSaldoActual <> 0 
            OR dd.DDeIdDocumento IS NOT NULL 
            OR cic.CicIdCiclo IS NOT NULL
            OR 1=1
        )
        ${filtroNombre}
      GROUP BY c.CliIdCliente, c.Nombre, c.NombreFantasia, c.Email, c.CodCliente, c.TClIdTipoCliente, c.CioRuc, c.DireccionTrabajo, c.DepartamentoID
      ORDER BY ABS(SUM(cc.CueSaldoActual)) DESC, c.Nombre
    `;
    const result2 = await request2.query(queryNormal);
    console.log(`Normal Query succeeded with ${result2.recordset.length} rows.`);

    process.exit(0);
  } catch (err) {
    console.error('SQL Query failed:', err);
    process.exit(1);
  }
}

main();
