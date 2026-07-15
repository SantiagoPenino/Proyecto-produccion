// SOLO LECTURA — reproduce la query del resolver (MODO 1) para ver qué MonedaPC resuelve por línea.
// Uso:  node scripts/diagnostico_monedapc_resolver.js PC-1274
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const arg = process.argv[2] || 'PC-1274';
const [serie, numero] = arg.split('-');
const m = n => Number(n||0).toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2});

(async () => {
  try {
    const pool = await getPool();
    const docR = await pool.request().input('s', sql.VarChar(20), serie).input('n', sql.VarChar(30), numero)
      .query(`SELECT TOP 1 DocIdDocumento, TcaIdTransaccion, MonIdMoneda FROM dbo.DocumentosContables WHERE RTRIM(DocSerie)=@s AND RTRIM(DocNumero)=@n`);
    if (!docR.recordset.length) { console.error('No encontrado'); process.exit(1); }
    const { DocIdDocumento, TcaIdTransaccion, MonIdMoneda } = docR.recordset[0];
    console.log(`\nDoc ${arg} (DocId ${DocIdDocumento})  MonIdMoneda=${MonIdMoneda===2?'USD':'UYU'}  TcaId=${TcaIdTransaccion}\n`);
    if (!TcaIdTransaccion) { console.error('Sin TcaIdTransaccion — este doc no salió del resolver MODO 1.'); process.exit(0); }

    const res = await pool.request().input('tcaId', sql.Int, TcaIdTransaccion).query(`
      SELECT
        ISNULL(od.OrdCodigoOrden, td.TdeCodigoReferencia) AS OrdCodigoOrden,
        od.OrdIdOrden,
        od.MonIdMoneda AS Od_MonIdMoneda,
        pc.Moneda AS Pc_Moneda,
        pcd.Moneda AS Pcd_Moneda,
        COALESCE(pcd.Subtotal, NULLIF(od.OrdCostoFinal, 0), td.TdeImporteFinal, 0) AS Total,
        CASE WHEN od.MonIdMoneda = 2 THEN 'USD'
             WHEN od.MonIdMoneda = 1 THEN 'UYU'
             ELSE ISNULL(pc.Moneda, ISNULL(pcd.Moneda, 'UYU')) END AS MonedaPC
      FROM dbo.TransaccionDetalle td
      LEFT JOIN dbo.RelOrdenesRetiroOrdenes rel
        ON rel.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
      LEFT JOIN dbo.OrdenesDeposito od ON (
          (td.TdeTipoReferencia = 'ORDEN_RETIRO'   AND rel.OrdIdOrden IS NOT NULL AND od.OrdIdOrden = rel.OrdIdOrden)
       OR (td.TdeTipoReferencia = 'ORDEN_RETIRO'   AND rel.OrdIdOrden IS NULL     AND od.OReIdOrdenRetiro = td.TdeReferenciaId)
       OR (td.TdeTipoReferencia = 'ORDEN_DEPOSITO' AND od.OrdIdOrden = td.TdeReferenciaId)
      )
      LEFT JOIN dbo.PedidosCobranza pc ON CAST(pc.NoDocERP AS VARCHAR(100)) =
          LEFT(ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100))),
               CASE WHEN CHARINDEX(' ', ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100)))) > 0
                    THEN CHARINDEX(' ', ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100)))) - 1
                    ELSE LEN(ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100)))) END)
      LEFT JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.PedidoCobranzaID = pc.ID
      WHERE td.TcaIdTransaccion = @tcaId
        AND td.TdeTipoReferencia IN ('ORDEN_RETIRO', 'ORDEN_DEPOSITO')
    `);
    const docMon = MonIdMoneda === 2 ? 'USD' : 'UYU';
    console.log('  Orden          OrdId    od.Mon   pc.Moneda  pcd.Moneda  =>MonedaPC   Total       ¿convierte?');
    res.recordset.forEach(r => {
      const conv = ((r.MonedaPC||'UYU').toUpperCase().trim() !== docMon) ? 'SÍ (÷/×cot)' : 'NO (misma)';
      console.log(`  ${(''+(r.OrdCodigoOrden||'')).substring(0,14).padEnd(14)} ${(''+(r.OrdIdOrden||'')).padEnd(8)} ${(''+(r.Od_MonIdMoneda===null?'NULL':r.Od_MonIdMoneda)).padEnd(8)} ${(''+(r.Pc_Moneda||'null')).padEnd(10)} ${(''+(r.Pcd_Moneda||'null')).padEnd(11)} ${(''+r.MonedaPC).padEnd(6)} ${m(r.Total).padStart(12)}   ${conv}`);
    });
    console.log(`\n  Doc moneda = ${docMon}. Las líneas con "NO (misma)" NO se convierten. Si una orden en pesos aparece como MonedaPC=USD, ese es el bug.\n`);
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
