// SOLO LECTURA (local). Diagnóstico: recurso (rollo por adelantado) que quedó vivo
// después de emitir una Nota de Crédito sobre la factura de compra del recurso.
// Cliente: Javier Burguez (DELBUR).
const { getPool, sql } = require('../config/db');

(async () => {
  const pool = await getPool();

  const cli = await pool.request().query(`
    SELECT CliIdCliente, RTRIM(Nombre) AS Nombre, IDCliente
    FROM dbo.Clientes WHERE IDCliente LIKE 'DELBUR%'
  `);
  console.log('--- CLIENTE ---'); console.table(cli.recordset);
  const cliId = cli.recordset[0]?.CliIdCliente;
  if (!cliId) { console.log('sin cliente'); process.exit(0); }

  const cuentas = await pool.request().input('c', sql.Int, cliId).query(`
    SELECT CueIdCuenta, CueTipo, CueSaldoActual, CueActiva, MonIdMoneda, ProIdProducto
    FROM dbo.CuentasCliente WHERE CliIdCliente = @c ORDER BY CueTipo
  `);
  console.log('--- CUENTAS ---'); console.table(cuentas.recordset);

  const planes = await pool.request().input('c', sql.Int, cliId).query(`
    SELECT p.PlaIdPlan, p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaActivo,
           p.PlaFechaAlta, p.PlaDescripcion, p.ProIdProducto, p.CueIdCuenta
    FROM dbo.PlanesMetros p
    LEFT JOIN dbo.Articulos pr ON pr.ProIdProducto = p.ProIdProducto
    WHERE p.CliIdCliente = @c ORDER BY p.PlaIdPlan DESC
  `);
  console.log('--- PLANES METROS ---'); console.table(planes.recordset);

  const movs = await pool.request().input('c', sql.Int, cliId).query(`
    SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo, m.MovTipo, m.MovImporte,
           m.MovFecha, m.MovConcepto, m.MovObservaciones, m.MovRefExterna,
           m.DocIdDocumento, m.PagIdPago, m.MovAnulado
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @c AND cc.CueTipo NOT LIKE 'DINERO%'
    ORDER BY m.MovIdMovimiento DESC
  `);
  console.log('--- MOVIMIENTOS DE RECURSO (no dinero) ---'); console.table(movs.recordset);

  const docs = await pool.request().input('c', sql.Int, cliId).query(`
    SELECT TOP 30 d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.DocFechaEmision,
           d.DocTotal, d.MonIdMoneda, d.DocAnulado, d.DocPagado, d.TcaIdTransaccion,
           d.DocIdDocumentoRef
    FROM dbo.Documentos d WHERE d.CliIdCliente = @c
    ORDER BY d.DocIdDocumento DESC
  `);
  console.log('--- DOCUMENTOS ---'); console.table(docs.recordset);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
