// Backfill de DocIdDocumento en los movimientos de COBRO/PAGO "Sin referencia" (vista 360).
// Dos vías de vínculo, en orden:
//   1) CONTADO: el PAGO tiene una VTA_CAJA hermana (misma cuenta, misma fecha, mismo importe)
//      que YA está linkeada al documento -> se copia su DocIdDocumento. (Es el caso PC-2505.)
//   2) PAGO-DEUDA: el concepto trae el código de la orden ("Pago: SUB-7127 (...)"); se busca el
//      documento (no RC, no anulado, mismo cliente) que factura esa orden via OrdCodigoOrden.
// Solo estampa cuando el match es ÚNICO. Solo escribe donde DocIdDocumento hoy es NULL.
// NO toca importes, saldos ni deuda (es lo mismo que ya estampa procesarPagoDeuda para los nuevos).
//
//   DRY-RUN (default):  node scripts/fix_referencia_cobros.js
//   APLICAR:            node scripts/fix_referencia_cobros.js --apply
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const APPLY = process.argv.includes('--apply');
const RX = /\b(XECOUV|XDTF|XSB|UVDF|ECOUV|SUB|DTF|VEN|EUV|DIR|PC|ET|SB|DF)-?\s?(\d+)/i;

(async () => {
  const p = await getPool();
  const movs = (await p.request().query(`
    SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CliIdCliente,
           CONVERT(varchar(10), m.MovFecha, 23) AS F,
           CAST(ABS(m.MovImporte) AS decimal(18,2)) AS Imp,
           LTRIM(RTRIM(ISNULL(m.MovConcepto,''))) AS Concepto
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.MovTipo IN ('PAGO','COBRO')
      AND m.DocIdDocumento IS NULL AND m.OrdIdOrden IS NULL
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  `)).recordset;

  let porVenta = 0, porConcepto = 0, ambiguos = 0, sinCodigo = 0, sinDoc = 0;
  const aplicar = [];

  for (const m of movs) {
    // ── Vía 1: VTA_CAJA hermana (contado) ──
    const herm = (await p.request()
      .input('cue', sql.Int, m.CueIdCuenta)
      .input('f', sql.VarChar(10), m.F)
      .input('imp', sql.Decimal(18, 2), m.Imp)
      .query(`
        SELECT DISTINCT v.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) AS Doc
        FROM dbo.MovimientosCuenta v
        JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = v.DocIdDocumento
        WHERE v.CueIdCuenta = @cue
          AND v.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
          AND v.DocIdDocumento IS NOT NULL
          AND (v.MovAnulado IS NULL OR v.MovAnulado = 0)
          AND CAST(v.MovFecha AS DATE) = @f
          AND ABS(CAST(ABS(v.MovImporte) AS decimal(18,2)) - @imp) <= 0.5
          AND RTRIM(dc.DocSerie) <> 'RC'
      `)).recordset;
    if (herm.length === 1) { porVenta++; aplicar.push({ MovId: m.MovIdMovimiento, DocId: herm[0].DocIdDocumento, Doc: herm[0].Doc, via: 'contado' }); continue; }

    // ── Vía 2: código del concepto -> documento que factura la orden ──
    const mm = (m.Concepto || '').match(RX);
    if (!mm) { sinCodigo++; continue; }
    const code = mm[1].toUpperCase() + '-' + mm[2];
    const docs = (await p.request()
      .input('c', sql.VarChar(40), code + '%')
      .input('cli', sql.Int, m.CliIdCliente)
      .query(`
        SELECT DISTINCT dc.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) AS Doc
        FROM dbo.DocumentosContablesDetalle d
        JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = d.DocIdDocumento
        WHERE dc.CliIdCliente = @cli AND RTRIM(dc.DocSerie) <> 'RC'
          AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
          AND (LTRIM(RTRIM(d.OrdCodigoOrden)) = LEFT(@c, LEN(@c)-1) OR LTRIM(RTRIM(d.OrdCodigoOrden)) LIKE @c)
      `)).recordset;
    if (docs.length === 0) { sinDoc++; continue; }
    if (docs.length > 1)   { ambiguos++; continue; }
    porConcepto++;
    aplicar.push({ MovId: m.MovIdMovimiento, DocId: docs[0].DocIdDocumento, Doc: docs[0].Doc, via: 'concepto' });
  }

  console.log(`\n=== BACKFILL REFERENCIA COBROS — ${APPLY ? '*** APLICAR ***' : 'DRY-RUN'} ===`);
  console.log(`Cobros sin referencia analizados: ${movs.length}`);
  console.log(`  Resueltos por VENTA hermana (contado): ${porVenta}`);
  console.log(`  Resueltos por CÓDIGO del concepto:     ${porConcepto}`);
  console.log(`  TOTAL a estampar:                      ${aplicar.length}`);
  console.log(`  --`);
  console.log(`  Ambiguos (código en >1 doc):           ${ambiguos}`);
  console.log(`  Con código pero sin doc que lo facture: ${sinDoc}`);
  console.log(`  Sin código ni venta hermana:            ${sinCodigo}`);
  console.log('\nMuestra:');
  aplicar.slice(0, 12).forEach(a => console.log(`   Mov ${a.MovId}: -> ${a.Doc} (${a.via})`));

  if (APPLY && aplicar.length) {
    console.log(`\nAplicando ${aplicar.length} en transacción...`);
    const tx = p.transaction(); await tx.begin();
    try {
      for (const a of aplicar) {
        await new sql.Request(tx)
          .input('doc', sql.Int, a.DocId).input('mov', sql.Int, a.MovId)
          .query('UPDATE dbo.MovimientosCuenta SET DocIdDocumento=@doc WHERE MovIdMovimiento=@mov AND DocIdDocumento IS NULL');
      }
      await tx.commit();
      console.log(`✓ Estampados ${aplicar.length} movimientos.`);
    } catch (e) { await tx.rollback(); console.error('ROLLBACK por error:', e.message); }
  } else if (!APPLY) {
    console.log('\n(DRY-RUN — no se escribió nada. Para aplicar: --apply)');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
