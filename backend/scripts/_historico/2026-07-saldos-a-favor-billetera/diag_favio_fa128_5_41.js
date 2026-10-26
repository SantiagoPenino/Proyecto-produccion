const { getPool, sql } = require('../config/db');

(async () => {
  const pool = await getPool();

  // 1) FA-128: total real del documento
  const doc = await pool.request().query(`
    SELECT DocIdDocumento, DocSerie, DocNumero, DocTotal, DocFechaEmision, TcaIdTransaccion
    FROM dbo.DocumentosContables
    WHERE DocSerie = 'FA' AND DocNumero = 128
  `);
  console.log('--- FA-128 documento ---');
  console.table(doc.recordset);

  const docId = doc.recordset[0]?.DocIdDocumento;
  if (!docId) { console.log('No se encontro FA-128'); process.exit(0); }

  // 2) Todos los movimientos de MovimientosCuenta que apuntan a este documento (DocIdDocumento)
  const movsPorDoc = await pool.request()
    .input('doc', sql.Int, docId)
    .query(`
      SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.PagIdPago,
             m.MovAnulado, m.MovConcepto, m.DocIdDocumento, m.CueIdCuenta
      FROM dbo.MovimientosCuenta m
      WHERE m.DocIdDocumento = @doc
      ORDER BY m.MovFecha, m.MovIdMovimiento
    `);
  console.log('--- Movimientos con DocIdDocumento = FA-128 ---');
  console.table(movsPorDoc.recordset);

  // 3) Movimientos de la cuenta de Favio (472) cerca de la fecha de FA-128, para encontrar
  //    los que la mencionan por CONCEPTO/observaciones pero sin el DocIdDocumento estampado
  //    (el "5.41 corto" podria venir de ahi).
  const cerca = await pool.request()
    .query(`
      SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.PagIdPago,
             m.MovAnulado, m.MovConcepto, m.MovObservaciones, m.DocIdDocumento
      FROM dbo.MovimientosCuenta m
      WHERE m.CueIdCuenta = 472
        AND (m.MovConcepto LIKE '%128%' OR m.MovObservaciones LIKE '%128%')
      ORDER BY m.MovFecha, m.MovIdMovimiento
    `);
  console.log('--- Movimientos cuenta 472 que mencionan "128" ---');
  console.table(cerca.recordset);

  // 4) PagIdPago(s) que aparecen en los movimientos de FA-128 -> traer TODO ese grupo
  const pagIds = [...new Set(movsPorDoc.recordset.map(r => r.PagIdPago).filter(Boolean))];
  if (pagIds.length) {
    const grupo = await pool.request().query(`
      SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.PagIdPago,
             m.DocIdDocumento, dc.DocSerie, dc.DocNumero
      FROM dbo.MovimientosCuenta m
      LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
      WHERE m.PagIdPago IN (${pagIds.join(',')})
      ORDER BY m.PagIdPago, m.MovIdMovimiento
    `);
    console.log('--- Grupo completo por PagIdPago ---');
    console.table(grupo.recordset);
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
