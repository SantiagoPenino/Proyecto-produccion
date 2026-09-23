// Rellena el DESGLOSE (PrecioLista, Descuento*, Recargo*) de las líneas de pedido que ya
// existían antes del cambio, leyéndolo del texto que dejó el motor en LogPrecioAplicado:
//   "Base: USD 22.00 | Descuento: -USD 8.00 (Desc. 36% [Excepción Cliente]) | Recargo: +USD 5.50 (Recargo 25% [Recargo por Urgencias ]) | Total Unit. Calculado: USD 27.50"
//   "Base: USD 1.25 | Override: USD 1.25 (Bordado por Puntadas (0 p.)) | ..."
// Regla (INV-PRE.03): lista − descuento + Σrecargos = PrecioUnitario (2 dec). El % se
// recalcula exacto desde los importes (8/22 = 36,36 %, no el "36%" impreso); el importe
// del descuento absorbe el redondeo. Solo se completan filas con PrecioLista NULL.
// Se SALTEAN (quedan sin desglose): líneas con precio editado a mano después del cálculo
// ("[Ajuste manual]"), cubiertas por prepago, sin "Base:" en el texto, o donde
// lista − desc + rec no cierra contra PrecioUnitario (±0,02).
//
//   DRY-RUN (default):  node scripts/backfill_desglose_pcd.js
//   APLICAR:            node scripts/backfill_desglose_pcd.js --apply
//   UN SOLO CLIENTE:    node scripts/backfill_desglose_pcd.js --cliente=PALMERO [--apply]
//                       (acepta IdCliente, código, CliIdCliente numérico o nombre exacto;
//                        sirve para probar con un cliente antes de correrlo para todos)
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const APPLY = process.argv.includes('--apply');
const CLIENTE = (process.argv.find(a => a.startsWith('--cliente=')) || '').split('=').slice(1).join('=').trim() || null;
const r2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const r4 = n => Math.round((Number(n || 0) + Number.EPSILON) * 10000) / 10000;
const num = s => parseFloat(String(s).replace(',', '.'));
// "nombre + %": si el nombre del perfil ya termina con ese % ("Descuento Trabajadores 10%")
// no se repite (misma regla que el motor).
// El % del TEXTO va con 2 decimales como máximo (igual que el motor); la columna
// DescuentoPct/RecargoPct conserva los 4.
const fmtPct = v => { const n = Number(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); };
const conPct = (nombre, pct) => {
  const n = String(nombre || '').trim();
  if (pct == null) return n;
  if (n.replace(/\s+/g, '').toLowerCase().endsWith(fmtPct(pct) + '%')) return n;
  return `${n} ${fmtPct(pct)} %`;
};

function parsear(log, pu) {
  const t = String(log || '');
  if (/Ajuste manual|Prepago|Cubierto/i.test(t)) return { skip: 'manual/prepago' };
  const mBase = t.match(/Base:\s*[A-Z]{3}\s*([\d.]+)/);
  if (!mBase) return { skip: 'sin Base' };
  const mOver = t.match(/Override:\s*[A-Z]{3}\s*([\d.]+)\s*\(([^)]*)\)/);
  const lista = r4(mOver ? num(mOver[1]) : num(mBase[1]));
  if (!(lista > 0)) return { skip: 'lista 0 (sin catálogo)' };   // sin lista real no hay desglose
  const mDesc = t.match(/Descuento:\s*-[A-Z]{3}\s*([\d.]+)\s*\(Desc\.\s*([\d.]+)(%?)\s*\[([^\]]*)\]\)/);
  const recs = [...t.matchAll(/Recargo:\s*\+[A-Z]{3}\s*([\d.]+)\s*\(Recargo\s*([\d.]*)(%?)\s*\[([^\]]*)\]\)/g)];
  const descImp0 = mDesc ? r4(num(mDesc[1])) : 0;
  const recImp = r4(recs.reduce((a, m) => a + num(m[1]), 0));
  const cierraCon = r4(lista - descImp0 + recImp);
  if (Math.abs(cierraCon - pu) > 0.0201) return { skip: `no cierra (${cierraCon} vs ${pu})` };
  // Precio fijo ganador: el texto lo marca como Override "Precio Fijo [...]"
  const esFijo = mOver && /Precio Fijo/i.test(mOver[2]);
  let descuento = null;
  if (mDesc) {
    const origenTxt = (mDesc[4] || '').trim();
    const esExc = /Excepci/i.test(origenTxt);
    const esPct = mDesc[3] === '%';
    const importe = r4(lista + recImp - pu);              // absorbe el redondeo
    const pct = esPct && lista > 0 ? r4((descImp0 / lista) * 100) : null;
    descuento = { tipo: esPct ? 'PCT' : 'IMPORTE', pct, importe, origen: esExc ? 'Precio especial' + (pct != null ? ` ${fmtPct(pct)} %` : '') : conPct(origenTxt, pct), esExc, perfilNombre: esExc ? null : origenTxt };
  } else if (esFijo) {
    const importe = r4(lista + recImp - pu);
    descuento = importe > 0 ? { tipo: 'FIJO', pct: null, importe, origen: 'Precio especial (precio pactado)', esExc: true, perfilNombre: null } : null;
    // la lista de una línea con precio fijo es la Base (el override es el fijo)
  }
  const listaFinal = esFijo ? r4(num(mBase[1])) : lista;
  if (esFijo && descuento) descuento.importe = r4(listaFinal + recImp - pu);
  let recargos = recs.map(m => ({ importe: r4(num(m[1])), pct: m[3] === '%' && m[2] ? r4(num(m[2])) : null, nombre: (m[4] || '').trim() }));
  let recargoImp = recImp, recargoPct = recargos.length && recargos.every(x => x.pct != null) ? r4(recargos.reduce((a, x) => a + x.pct, 0)) : null;
  if (!descuento && recargos.length) recargoImp = r4(pu - listaFinal);   // sin descuento absorbe el recargo
  const recargoTxt = recargos.map(x => conPct(x.nombre, x.pct)).join(' + ') || null;
  return { lista: listaFinal, override: mOver && !esFijo ? mOver[2] : null, descuento, recargoImp: recargos.length ? recargoImp : null, recargoPct, recargoTxt, recargos };
}

(async () => {
  const pool = await getPool();
  const perf = await pool.request().query(`SELECT ID, LTRIM(RTRIM(Nombre)) AS Nombre FROM PerfilesPrecios`);
  const perfilPorNombre = {}; perf.recordset.forEach(p => { perfilPorNombre[p.Nombre] = p.ID; });
  // Filtro por cliente (opcional): se busca la ficha por IdCliente / código / CliIdCliente /
  // nombre y se toman sus pedidos (PedidosCobranza.ClienteID puede guardar cualquiera de
  // esos identificadores, por eso se comparan todos como texto).
  let filtroPedidos = '';
  if (CLIENTE) {
    const cli = await pool.request().input('C', sql.NVarChar(100), CLIENTE).query(`
      SELECT CliIdCliente, CodCliente, IDCliente, Nombre FROM dbo.Clientes WITH(NOLOCK)
      WHERE CAST(IDCliente AS NVARCHAR(100)) = @C OR CAST(CodCliente AS NVARCHAR(100)) = @C
         OR CAST(CliIdCliente AS NVARCHAR(100)) = @C OR LTRIM(RTRIM(Nombre)) = @C`);
    if (!cli.recordset.length) { console.error(`No se encontró el cliente "${CLIENTE}" (IdCliente, código, CliIdCliente o nombre exacto).`); process.exit(1); }
    const ids = [...new Set(cli.recordset.flatMap(r => [r.CliIdCliente, r.CodCliente, r.IDCliente]).filter(v => v != null).map(v => String(v).trim()).filter(Boolean))];
    filtroPedidos = ` AND PedidoCobranzaID IN (SELECT ID FROM dbo.PedidosCobranza WITH(NOLOCK) WHERE LTRIM(RTRIM(CAST(ClienteID AS NVARCHAR(100)))) IN (${ids.map(v => `'${v.replace(/'/g, "''")}'`).join(',')}))`;
    console.log(`Cliente: ${cli.recordset.map(r => `${(r.Nombre || '').trim()} (CliIdCliente ${r.CliIdCliente}, IdCliente ${(r.IDCliente || '-').trim()})`).join(' | ')}`);
  }
  const res = await pool.request().query(`
    SELECT ID, PedidoCobranzaID, PrecioUnitario, LogPrecioAplicado FROM dbo.PedidosCobranzaDetalle WITH(NOLOCK)
    WHERE PrecioLista IS NULL AND LogPrecioAplicado LIKE 'Base:%' AND PrecioUnitario IS NOT NULL${filtroPedidos}`);
  const st = { candidatas: res.recordset.length, ok: 0, skip: {} };
  if (CLIENTE) console.log(`Pedidos del cliente con líneas sin desglose: ${new Set(res.recordset.map(r => r.PedidoCobranzaID)).size}`);
  const updates = [];
  for (const row of res.recordset) {
    const p = parsear(row.LogPrecioAplicado, Number(row.PrecioUnitario));
    if (p.skip) { st.skip[p.skip.replace(/\(.*\)/, '').trim()] = (st.skip[p.skip.replace(/\(.*\)/, '').trim()] || 0) + 1; continue; }
    st.ok++;
    const perfilId = p.descuento && !p.descuento.esExc && p.descuento.perfilNombre ? (perfilPorNombre[p.descuento.perfilNombre] || null) : null;
    updates.push({ id: row.ID, lista: p.lista, dTipo: p.descuento ? p.descuento.tipo : null, dPct: p.descuento ? p.descuento.pct : null,
      dImp: p.descuento ? p.descuento.importe : null, dOrig: p.descuento ? p.descuento.origen : null, dPerfil: perfilId,
      rPct: p.recargoPct, rImp: p.recargoImp, rOrig: p.recargoTxt,
      json: JSON.stringify({ origen: 'backfill', precioLista: p.lista, override: p.override, descuento: p.descuento, recargos: p.recargos }) });
  }
  console.log(`\n=== BACKFILL DESGLOSE — ${APPLY ? '*** APLICAR ***' : 'DRY-RUN (no escribe)'} ===`);
  console.log(`Candidatas: ${st.candidatas} | completables: ${st.ok} | salteadas:`, st.skip);
  console.log('Ejemplos:', JSON.stringify(updates.slice(0, 3), null, 1));
  if (APPLY && updates.length) {
    let n = 0;
    for (const u of updates) {
      await pool.request()
        .input('ID', sql.Int, u.id).input('PLista', sql.Decimal(18, 4), u.lista)
        .input('DTipo', sql.VarChar(12), u.dTipo).input('DPct', sql.Decimal(9, 4), u.dPct).input('DImp', sql.Decimal(18, 4), u.dImp)
        .input('DOrig', sql.NVarChar(150), u.dOrig).input('DPerfil', sql.Int, u.dPerfil)
        .input('RPct', sql.Decimal(9, 4), u.rPct).input('RImp', sql.Decimal(18, 4), u.rImp).input('ROrig', sql.NVarChar(200), u.rOrig)
        .input('J', sql.NVarChar(sql.MAX), u.json)
        .query(`UPDATE dbo.PedidosCobranzaDetalle SET PrecioLista=@PLista, DescuentoTipo=@DTipo, DescuentoPct=@DPct, DescuentoImporte=@DImp, DescuentoOrigen=@DOrig,
                DescuentoPerfilId=@DPerfil, RecargoPct=@RPct, RecargoImporte=@RImp, RecargoOrigen=@ROrig, DesgloseJSON=@J WHERE ID=@ID AND PrecioLista IS NULL`);
      n++;
      if (n % 2000 === 0) console.log(`  ... ${n} filas`);
    }
    console.log(`✓ Actualizadas ${n} filas.`);
  } else if (!APPLY) {
    console.log('(DRY-RUN — no se escribió nada. Para aplicar: --apply)');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
