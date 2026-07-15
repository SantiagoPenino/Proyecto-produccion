// Regenera las líneas (DocumentosContablesDetalle) de docs rotos corriendo el RESOLVER ACTUAL
// (ya corregido: excluye reposiciones, convierte cross-moneda). Solo reemplaza cuando la suma
// regenerada cierra contra el DocTotal ("la factura manda"). NO toca docs aceptados por DGI (con CAE).
//
//   DRY-RUN (default):  node scripts/regenerar_lineas_docs.js
//   APLICAR:            node scripts/regenerar_lineas_docs.js --apply
//
// NO toca DocTotal, ledger, deuda ni saldo. Solo las líneas de presentación.
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const core = require(path.resolve(__dirname, '../services/contabilidadCore.js'));
const APPLY = process.argv.includes('--apply');
const TOL = 0.5;
const f = n => Number(n||0).toFixed(2);

(async () => {
  const p = await getPool();
  // Docs candidatos: no anulados, con detalle, SIN CAE (no aceptados DGI), suma(líneas) != DocTotal,
  // y con TcaIdTransaccion (los que pasan por el resolver MODO 1). Excluye recibos RC y ruido ~1%.
  const docs = await p.request().query(`
    SELECT dc.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) Doc, dc.TcaIdTransaccion,
           dc.DocTotal, dc.MonIdMoneda, RTRIM(ISNULL(dc.CfeEstado,'-')) Cfe,
           (SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento) SumaLin
    FROM dbo.DocumentosContables dc
    WHERE (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
      AND dc.CfeCAE IS NULL
      AND RTRIM(dc.DocSerie) <> 'RC'
      AND dc.TcaIdTransaccion IS NOT NULL
      AND EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento)
      AND ABS(dc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento),0)) > 2.0
    ORDER BY dc.DocFechaEmision
  `);
  // Excluir ruido de redondeo ~1%
  const rotos = docs.recordset.filter(x => {
    const r = Number(x.DocTotal) ? Number(x.SumaLin)/Number(x.DocTotal) : 0;
    return !(r >= 0.95 && r <= 1.05);
  });

  const cierran = [], noCierran = [];
  for (const x of rotos) {
    const mon = x.MonIdMoneda === 2 ? 'USD' : 'UYU';
    let L;
    try { L = await core.resolverLineasDetalle({ tcaIdTransaccion: x.TcaIdTransaccion, monedaFactura: mon }); }
    catch (e) { noCierran.push({ ...x, err: e.message, suma: null }); continue; }
    const suma = L.reduce((a, b) => a + (Number(b.total)||0), 0);
    const rec = { ...x, suma, nLin: L.length, lineas: L };
    if (Math.abs(suma - Number(x.DocTotal)) <= TOL) cierran.push(rec); else noCierran.push(rec);
  }

  console.log(`\n=== REGENERAR LÍNEAS — ${APPLY ? '*** MODO APLICAR ***' : 'DRY-RUN (no escribe)'} ===`);
  console.log(`Docs rotos (sin CAE, con TcaId, fuera de ruido): ${rotos.length}`);
  console.log(`  Resolver REGENERA y CIERRA (se pueden arreglar): ${cierran.length}`);
  console.log(`  NO cierran con el resolver (cross-moneda por cotización o caso raro): ${noCierran.length}`);

  console.log('\n-- CIERRAN (se arreglarían) --');
  cierran.forEach(x => console.log(`   ${x.Doc.padEnd(11)} ${x.MonIdMoneda===2?'USD':'UYU'} Cfe=${x.Cfe.padEnd(9)} DocTotal=${f(x.DocTotal).padStart(9)} viejo=${f(x.SumaLin).padStart(10)} -> nuevo=${f(x.suma).padStart(9)} (${x.nLin} líneas)`));

  console.log('\n-- NO CIERRAN (revisar: cross-moneda usa fix_lineas_crossmoneda_legacy.sql, o caso raro) --');
  noCierran.forEach(x => console.log(`   ${x.Doc.padEnd(11)} ${x.MonIdMoneda===2?'USD':'UYU'} Cfe=${x.Cfe.padEnd(9)} DocTotal=${f(x.DocTotal).padStart(9)} viejo=${f(x.SumaLin).padStart(10)} -> resolver=${x.suma==null?'ERR':f(x.suma).padStart(9)}${x.err?' ('+x.err+')':''}`));

  if (APPLY && cierran.length) {
    console.log('\nAplicando (borra líneas viejas + inserta las regeneradas, en transacción)...');
    const tx = p.transaction(); await tx.begin();
    try {
      for (const x of cierran) {
        await new sql.Request(tx).input('d', sql.Int, x.DocIdDocumento)
          .query('DELETE FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento=@d');
        for (const l of x.lineas) {
          await new sql.Request(tx)
            .input('d', sql.Int, x.DocIdDocumento)
            .input('ord', sql.VarChar(50), l.ordCodigoOrden || null)
            .input('nom', sql.VarChar(255), (l.nomItem||'').substring(0,255))
            .input('dsc', sql.VarChar(1000), (l.dscItem||'').substring(0,1000))
            .input('cant', sql.Decimal(18,4), l.cantidad)
            .input('pu', sql.Decimal(18,4), l.precioUnitario)
            .input('sub', sql.Decimal(18,4), l.subtotal)
            .input('imp', sql.Decimal(18,4), l.impuestos)
            .input('tot', sql.Decimal(18,4), l.total)
            .query(`INSERT INTO dbo.DocumentosContablesDetalle
              (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
              VALUES (@d, @ord, @nom, @dsc, @cant, @pu, @sub, @imp, @tot)`);
        }
      }
      await tx.commit();
      console.log(`✓ Aplicado a ${cierran.length} documentos.`);
    } catch (e) { await tx.rollback(); console.error('ROLLBACK por error:', e.message); }
  } else if (!APPLY) {
    console.log('\n(DRY-RUN — no se escribió nada. Para aplicar: --apply)');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
