// SOLO LECTURA — auditoría completa: clasifica TODOS los documentos con líneas ≠ DocTotal.
// Objetivo: ver qué queda por corregir y si los 3 scripts cubren todo (base impecable).
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));

(async () => {
  const p = await getPool();
  // Todos los docs no anulados, con detalle, cuya suma de líneas difiere del DocTotal.
  const r = await p.request().query(`
    SELECT dc.DocIdDocumento, RTRIM(dc.DocSerie) Serie, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) Doc,
           dc.MonIdMoneda DocMon, dc.DocTotal,
           (SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento) SumaLin,
           (SELECT COUNT(*) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento) NLin,
           -- suma de líneas cuya moneda de orden != moneda del doc (cross-moneda)
           (SELECT SUM(CASE WHEN ml.MonedaLinea IN ('USD','UYU') AND ml.MonedaLinea <> ml.DocMonStr
                    THEN d.DcdTotal ELSE 0 END)
             FROM dbo.DocumentosContablesDetalle d
             JOIN dbo.DocumentosContables dc2 ON dc2.DocIdDocumento = d.DocIdDocumento
             OUTER APPLY (SELECT TOP 1 od.MonIdMoneda FROM dbo.OrdenesDeposito od WHERE od.OrdCodigoOrden=d.OrdCodigoOrden) odx
             OUTER APPLY (SELECT TOP 1 pc.Moneda FROM dbo.PedidosCobranza pc WHERE CAST(pc.NoDocERP AS VARCHAR(100))=
                  LEFT(d.OrdCodigoOrden,CASE WHEN CHARINDEX(' ',d.OrdCodigoOrden)>0 THEN CHARINDEX(' ',d.OrdCodigoOrden)-1 ELSE LEN(ISNULL(d.OrdCodigoOrden,'')) END)) pcx
             CROSS APPLY (SELECT CASE WHEN odx.MonIdMoneda=2 THEN 'USD' WHEN odx.MonIdMoneda=1 THEN 'UYU'
                                      ELSE UPPER(LTRIM(RTRIM(ISNULL(pcx.Moneda,'?')))) END AS MonedaLinea,
                                 CASE WHEN dc2.MonIdMoneda=2 THEN 'USD' ELSE 'UYU' END AS DocMonStr) ml
             WHERE d.DocIdDocumento=dc.DocIdDocumento) SumaOtraMoneda,
           -- suma de líneas de reposición sin cargo
           (SELECT SUM(CASE WHEN d.OrdCodigoOrden LIKE '%-R[0-9]%' THEN d.DcdTotal ELSE 0 END)
             FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento) SumaRework,
           (SELECT SUM(CASE WHEN d.OrdCodigoOrden NOT LIKE '%-R[0-9]%' OR d.OrdCodigoOrden IS NULL THEN d.DcdTotal ELSE 0 END)
             FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento) SumaNoRework
    FROM dbo.DocumentosContables dc
    WHERE (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
      AND EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento)
      AND ABS(dc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=dc.DocIdDocumento),0)) > 2.0
  `);

  const buckets = { RC:[], rounding:[], crossmoneda:[], rework:[], hybrid:[], other:[] };
  for (const x of r.recordset) {
    const total = Number(x.DocTotal), suma = Number(x.SumaLin||0);
    const ratio = total ? suma/total : 0;
    const otra = Number(x.SumaOtraMoneda||0), rew = Number(x.SumaRework||0), noRew = Number(x.SumaNoRework||0);
    const U = total - (otra); // líneas de misma moneda aprox (suma - otra)
    if (x.Serie === 'RC') { buckets.RC.push(x); continue; }
    if (ratio >= 0.95 && ratio <= 1.05) { buckets.rounding.push(x); continue; }
    // Rework puro: no-rework ya cierra y sobra rework
    if (rew > 0.05 && Math.abs(noRew - total) <= 0.05) { buckets.rework.push(x); continue; }
    // Cross-moneda limpio: hay líneas de otra moneda y cot implícita 30-55
    const impliedCot = otra > 0 ? (x.DocMon===2 ? otra/(total-(suma-otra)) : (total-(suma-otra))/otra) : null;
    if (otra > 0.05 && impliedCot && impliedCot >= 30 && impliedCot <= 55) { buckets.crossmoneda.push(x); continue; }
    if (['PC-1373','PC-1559'].includes(x.Doc)) { buckets.hybrid.push(x); continue; }
    buckets.other.push({ ...x, ratio: ratio.toFixed(2), impliedCot: impliedCot?impliedCot.toFixed(1):'-' });
  }
  const f = n => Number(n).toFixed(2);
  console.log('\n=== AUDITORÍA DE INTEGRIDAD — docs con suma(líneas) != DocTotal ===');
  console.log('Total flagueados:', r.recordset.length);
  console.log('  RC (recibos, por diseño):        ', buckets.RC.length, '  -> ignorar');
  console.log('  Redondeo IVA ~1% (ratio .95-1.05):', buckets.rounding.length, '  -> inofensivo');
  console.log('  CROSS-MONEDA (script 1):         ', buckets.crossmoneda.length, '  -> fix_lineas_crossmoneda_legacy.sql');
  console.log('  REWORK duplicado (script 2):     ', buckets.rework.length, '  -> fix_lineas_rework_duplicadas.sql');
  console.log('  HÍBRIDO (script 3):              ', buckets.hybrid.length, '  -> fix_lineas_overcount_crossmoneda.sql');
  console.log('  *** OTHER (SIN cubrir) ***:      ', buckets.other.length, buckets.other.length? '  <-- REVISAR':'  -> nada suelto ✓');
  if (buckets.other.length) {
    console.log('\n  Docs OTHER (no encajan en ningún script):');
    buckets.other.slice(0,40).forEach(x=>console.log('    ',x.Doc.padEnd(11),(x.DocMon===2?'USD':'UYU'),'DocTotal='+f(x.DocTotal).padStart(10),'Suma='+f(x.SumaLin).padStart(11),'nLin='+x.NLin,'ratio='+x.ratio,'cot='+x.impliedCot));
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
