const { getPool } = require('./backend/config/db');
getPool().then(async p => {
  const r = await p.request().query(`
    SELECT CodigoOrden, o.ProIdProducto, a.Descripcion
    FROM dbo.Ordenes o
    LEFT JOIN dbo.Articulos a ON a.ProIdProducto = o.ProIdProducto
    WHERE CodigoOrden IN ('DF-199','DF-195','UVDF-102189')
  `);
  console.log('Ordenes:', JSON.stringify(r.recordset, null, 2));

  const r2 = await p.request().query(`
    SELECT pm.PlaIdPlan, pm.CliIdCliente, pm.ProIdProducto, a.Descripcion,
           pm.PlaCantidadTotal - pm.PlaCantidadUsada AS Saldo, pm.PlaActivo
    FROM dbo.PlanesMetros pm
    LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pm.ProIdProducto
    WHERE pm.PlaActivo = 1
  `);
  console.log('Planes activos:', JSON.stringify(r2.recordset, null, 2));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
