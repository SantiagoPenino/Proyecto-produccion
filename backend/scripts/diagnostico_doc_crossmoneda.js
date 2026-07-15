// SOLO LECTURA — anatomía de un documento cross-moneda (variante C).
// Compara: header (DocTotal/MonIdMoneda) vs suma de líneas vs órdenes vinculadas y su moneda.
// Uso:  node scripts/diagnostico_doc_crossmoneda.js <Serie-Numero>   ej: node scripts/diagnostico_doc_crossmoneda.js PC-1274
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const arg = process.argv[2];
if (!arg) { console.error('Falta el comprobante. Uso: node scripts/diagnostico_doc_crossmoneda.js PC-1274'); process.exit(1); }
const [serie, numero] = arg.split('-');
const m = n => Number(n||0).toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2});

(async () => {
  try {
    const pool = await getPool();
    const docR = await pool.request()
      .input('s', sql.VarChar(20), serie)
      .input('n', sql.VarChar(30), numero)
      .query(`SELECT TOP 1 dc.DocIdDocumento, RTRIM(dc.DocSerie) AS DocSerie, RTRIM(dc.DocNumero) AS DocNumero,
                 dc.DocTotal, dc.DocSubtotal, dc.DocImpuestos, dc.MonIdMoneda, dc.DocEstado, dc.CicIdCiclo, dc.CueIdCuenta
              FROM dbo.DocumentosContables dc
              WHERE RTRIM(dc.DocSerie)=@s AND RTRIM(dc.DocNumero)=@n`);
    if (!docR.recordset.length) { console.error('Documento no encontrado: '+arg); process.exit(1); }
    const doc = docR.recordset[0];
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`  DOC ${doc.DocSerie}-${doc.DocNumero}  (DocId ${doc.DocIdDocumento})  Moneda=${doc.MonIdMoneda===2?'USD':'UYU'}  Estado=${doc.DocEstado}`);
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  HEADER: DocTotal=${m(doc.DocTotal)}  Subtotal=${m(doc.DocSubtotal)}  Imp=${m(doc.DocImpuestos)}`);

    // Líneas almacenadas
    const linR = await pool.request().input('d', sql.Int, doc.DocIdDocumento).query(`
      SELECT RTRIM(DcdNomItem) AS Item, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal
      FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento=@d ORDER BY DcdIdDetalle`);
    let sumLin = 0;
    console.log(`\n  LÍNEAS (${linR.recordset.length}):`);
    linR.recordset.forEach(l => {
      sumLin += Number(l.DcdTotal)||0;
      console.log(`   · ${(l.Item||'').substring(0,40).padEnd(40)} cant=${l.DcdCantidad}  PU=${m(l.DcdPrecioUnitario)}  Total=${m(l.DcdTotal)}`);
    });
    console.log(`  SUMA LÍNEAS = ${m(sumLin)}   vs   DocTotal = ${m(doc.DocTotal)}   → ${Math.abs(sumLin-Number(doc.DocTotal))<=2 ? 'CONSISTENTE' : '*** DESFASAJE (variante C) ***'}`);

    // Órdenes / movimientos vinculados a este documento, con moneda de su cuenta
    const movR = await pool.request().input('d', sql.Int, doc.DocIdDocumento).query(`
      SELECT mc.MovIdMovimiento, RTRIM(mc.MovTipo) AS MovTipo, mc.MovImporte,
             mc.CueIdCuenta, RTRIM(cc.CueTipo) AS CueTipo, cc.MonIdMoneda AS CtaMon,
             mc.OrdIdOrden
      FROM dbo.MovimientosCuenta mc
      JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = mc.CueIdCuenta
      WHERE mc.DocIdDocumento=@d AND (mc.MovAnulado IS NULL OR mc.MovAnulado=0)
      ORDER BY mc.MovTipo, mc.MovIdMovimiento`);
    console.log(`\n  MOVIMIENTOS VINCULADOS (${movR.recordset.length}):`);
    movR.recordset.forEach(v => {
      console.log(`   · Mov ${v.MovIdMovimiento}  ${(''+v.MovTipo).padEnd(16)} Imp=${m(v.MovImporte).padStart(14)}  Cta=${v.CueIdCuenta} ${(''+v.CueTipo).padEnd(12)} Mon=${v.CtaMon===2?'USD':'UYU'}  Ord=${v.OrdIdOrden||''}`);
    });

    // Órdenes del ciclo (si aplica) con su OrdMonIdMoneda (fuente del bug de líneas)
    if (doc.CicIdCiclo) {
      const ordR = await pool.request().input('c', sql.Int, doc.CicIdCiclo).query(`
        SELECT mc.MovIdMovimiento, RTRIM(mc.MovTipo) AS MovTipo, mc.MovImporte, mc.OrdIdOrden,
               cc.MonIdMoneda AS CtaMon, RTRIM(cc.CueTipo) AS CueTipo,
               od.OrdMonIdMoneda
        FROM dbo.MovimientosCuenta mc
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = mc.CueIdCuenta
        LEFT JOIN dbo.OrdenesDeposito od ON od.OrdenID = mc.OrdIdOrden
        WHERE mc.CicIdCiclo=@c AND mc.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND (mc.MovAnulado IS NULL OR mc.MovAnulado=0)
        ORDER BY mc.MovIdMovimiento`);
      console.log(`\n  ÓRDENES DEL CICLO ${doc.CicIdCiclo} (${ordR.recordset.length}) — OrdMonIdMoneda es la fuente de conversión de líneas:`);
      ordR.recordset.forEach(o => {
        console.log(`   · Ord ${o.OrdIdOrden}  ${(''+o.MovTipo).padEnd(16)} Imp=${m(o.MovImporte).padStart(14)}  CtaMon=${o.CtaMon===2?'USD':'UYU'} ${(''+o.CueTipo).padEnd(12)} OrdMonIdMoneda=${o.OrdMonIdMoneda===null?'NULL':(o.OrdMonIdMoneda===2?'USD(2)':'UYU(1)')}`);
      });
    }
    console.log('');
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
