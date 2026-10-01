// SOLO LECTURA — órdenes de pedidos PARTIDOS (multitela 1/2, 2/2…) que entraron a Depósito
// SIN cargo en la cuenta del cliente.
//
// Causa (arreglada en logisticsController, ver ordenHermanaSinCargo en utils/montoTotalPedido):
// la marca PedidosCobranza.MontoContabilizado es del PEDIDO y la dejaba la primera orden que
// pasaba; desde el 23/7/2026 cada orden asienta solo SUS líneas, así que las hermanas
// encontraban el pedido marcado y no asentaban nada.
//
// Uso:  node scripts/diagnostico_ordenes_hermanas_sin_cargo.js            (resumen + lista)
//       node scripts/diagnostico_ordenes_hermanas_sin_cargo.js --csv      (lista separada por ;)
const path = require('path');
const { getPool } = require(path.resolve(__dirname, '../config/db.js'));
const CSV = process.argv.includes('--csv');
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  try {
    const pool = await getPool();
    const cot = parseFloat((await pool.request().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC')).recordset[0]?.CotDolar) || 40;
    const req = pool.request(); req.timeout = 600000;
    const r = await req.query(`
      ;WITH multi AS (
        SELECT d.PedidoCobranzaID FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
        WHERE d.OrdenID IS NOT NULL GROUP BY d.PedidoCobranzaID HAVING COUNT(DISTINCT d.OrdenID) > 1
      ), lin AS (
        SELECT pc.ID AS PedId, LTRIM(RTRIM(pc.NoDocERP)) AS Ped, pc.MontoTotal, pc.Moneda AS PcMon, d.OrdenID,
               SUM(CASE WHEN ISNULL(d.EsFacturable,1) = 1 AND ISNULL(d.EsHermanaConsolidada,0) = 0
                        THEN CASE WHEN pc.Moneda = 'USD' AND d.Moneda = 'UYU' THEN d.Subtotal / ${cot}
                                  WHEN pc.Moneda = 'UYU' AND d.Moneda = 'USD' THEN d.Subtotal * ${cot}
                                  ELSE d.Subtotal END ELSE 0 END) AS Importe
        FROM multi JOIN dbo.PedidosCobranza pc WITH(NOLOCK) ON pc.ID = multi.PedidoCobranzaID
        JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON d.PedidoCobranzaID = pc.ID
        WHERE d.OrdenID IS NOT NULL
        GROUP BY pc.ID, pc.NoDocERP, pc.MontoTotal, pc.Moneda, d.OrdenID
      )
      SELECT l.PedId, l.Ped, l.MontoTotal, l.PcMon, l.OrdenID, l.Importe,
             o.CodigoOrden, cli.CliIdCliente, LTRIM(RTRIM(ISNULL(cli.Nombre, o.Cliente))) AS Cliente,
             UPPER(ISNULL(tc.TClDescripcion, '')) AS TipoCliente,
             od.OrdIdOrden AS DepId, od.OrdEstadoActual AS DepEstado, od.PagIdPago AS DepPago, od.OrdFechaIngresoOrden AS Ingreso,
             mv.Movs, mv.OrdenVivoUsd, mv.OrdenVivoUyu, mv.OrdenConDoc, mv.OrdenPendiente, mv.OtroAsiento
      FROM lin l
      JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = l.OrdenID
      OUTER APPLY (SELECT TOP 1 c.* FROM dbo.Clientes c WITH(NOLOCK)
                   WHERE c.CliIdCliente = o.CliIdCliente OR (ISNULL(o.CliIdCliente, 0) = 0 AND c.CodCliente = TRY_CAST(o.CodCliente AS INT))) cli
      LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = cli.TClIdTipoCliente
      OUTER APPLY (SELECT TOP 1 x.* FROM dbo.OrdenesDeposito x WITH(NOLOCK) WHERE x.OrdCodigoOrden = o.CodigoOrden) od
      OUTER APPLY (
        SELECT COUNT(*) AS Movs,
               -- cargos vivos por moneda de la cuenta (se llevan a la moneda del pedido en JS)
               SUM(CASE WHEN x.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ISNULL(x.MovAnulado,0) = 0 AND cx.MonIdMoneda = 2 THEN ABS(x.MovImporte) ELSE 0 END) AS OrdenVivoUsd,
               SUM(CASE WHEN x.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ISNULL(x.MovAnulado,0) = 0 AND ISNULL(cx.MonIdMoneda,1) <> 2 THEN ABS(x.MovImporte) ELSE 0 END) AS OrdenVivoUyu,
               SUM(CASE WHEN x.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ISNULL(x.MovAnulado,0) = 0 AND x.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END) AS OrdenConDoc,
               SUM(CASE WHEN x.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ISNULL(x.MovAnulado,0) = 0 AND x.DocIdDocumento IS NULL
                         AND ISNULL(x.MovObservaciones,'') NOT LIKE 'CUBIERTO%' THEN 1 ELSE 0 END) AS OrdenPendiente,
               SUM(CASE WHEN x.MovTipo IN ('ENTREGA','CONSUMO_CUENTA') THEN 1 ELSE 0 END) AS OtroAsiento
        FROM dbo.MovimientosCuenta x WITH(NOLOCK)
        JOIN dbo.CuentasCliente cx WITH(NOLOCK) ON cx.CueIdCuenta = x.CueIdCuenta
        WHERE cx.CliIdCliente = cli.CliIdCliente
          AND x.MovTipo IN ('ORDEN','ORDEN_ANTICIPO','ENTREGA','CONSUMO_CUENTA')
          AND x.OrdIdOrden IN (l.OrdenID, od.OrdIdOrden)
      ) mv
      ORDER BY l.PedId, l.OrdenID`);

    const peds = new Map();
    r.recordset.forEach(x => { if (!peds.has(x.PedId)) peds.set(x.PedId, []); peds.get(x.PedId).push(x); });
    const usd = (x) => (x.PcMon === 'USD' ? Number(x.Importe) : Number(x.Importe) / cot);
    const CAT = {
      PERDIDA:   'NUNCA FACTURADA — la hermana ya se facturó solo por su parte',
      PENDIENTE: 'Pendiente — entra si se factura desde la pre-factura del Panel 360 (trae el pedido entero)',
      PLAN:      'Revisar a mano — la hermana se cubrió con plan o billetera, esta quedó sin nada',
    };
    const out = [];
    for (const os of peds.values()) {
      const total = Number(os[0].MontoTotal) || 0;
      const enMonedaPedido = (o) => (o.PcMon === 'USD'
        ? (Number(o.OrdenVivoUsd) || 0) + (Number(o.OrdenVivoUyu) || 0) / cot
        : (Number(o.OrdenVivoUyu) || 0) + (Number(o.OrdenVivoUsd) || 0) * cot);
      const cargado = os.reduce((a, o) => a + enMonedaPedido(o), 0);
      for (const o of os) {
        if (/-[RF]\d+$/i.test(String(o.CodigoOrden || '').trim())) continue;   // reposición / falla: sin cargo por diseño
        if (!o.DepId || Number(o.Movs) > 0) continue;                           // no entró a depósito, o ya tiene asiento
        if (!(Number(o.Importe) > 0.005) || o.DepPago) continue;                // sin importe, o cobrada por caja
        if (cargado + Number(o.Importe) > total * 1.01 + 0.05) continue;        // los cargos del pedido ya la cubren (pedido viejo / sincronizado)
        const hnas = os.filter(h => h.OrdenID !== o.OrdenID);
        const cat = hnas.some(h => Number(h.OrdenPendiente) > 0) ? 'PENDIENTE'
          : hnas.some(h => Number(h.OrdenConDoc) > 0) ? 'PERDIDA' : 'PLAN';
        out.push({ cat, Pedido: o.Ped, Orden: o.CodigoOrden, CliId: o.CliIdCliente, Cliente: String(o.Cliente || '').slice(0, 28),
          Tipo: o.TipoCliente.slice(0, 10), Importe: r2(o.Importe), Moneda: o.PcMon, USD: r2(usd(o)),
          Ingreso: o.Ingreso ? new Date(o.Ingreso).toISOString().slice(0, 10) : '', DepEstado: o.DepEstado });
      }
    }
    out.sort((a, b) => a.cat.localeCompare(b.cat) || String(b.Ingreso).localeCompare(String(a.Ingreso)));

    if (CSV) {
      console.log(['Categoria', 'Pedido', 'Orden', 'CliId', 'Cliente', 'Tipo', 'Importe', 'Moneda', 'USD', 'Ingreso', 'DepEstado'].join(';'));
      out.forEach(x => console.log([x.cat, x.Pedido, x.Orden, x.CliId, x.Cliente, x.Tipo, x.Importe, x.Moneda, x.USD, x.Ingreso, x.DepEstado].join(';')));
    } else {
      console.log(`\nÓrdenes de pedidos partidos que entraron a depósito SIN cargo en la cuenta (cotización ${cot}):\n`);
      for (const k of Object.keys(CAT)) {
        const g = out.filter(x => x.cat === k);
        console.log(`■ ${CAT[k]}\n  ${g.length} órdenes · US$ ${r2(g.reduce((a, x) => a + x.USD, 0)).toLocaleString('es-UY')} (aprox.)`);
        const porCli = {};
        g.forEach(x => { const c = `${x.CliId} ${x.Cliente}`; porCli[c] = porCli[c] || { Ordenes: 0, USD: 0 }; porCli[c].Ordenes++; porCli[c].USD = r2(porCli[c].USD + x.USD); });
        console.table(porCli);
      }
      console.log('Detalle:'); console.table(out.map(({ cat, ...x }) => ({ Cat: cat, ...x })));
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
