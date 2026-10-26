/**
 * diagWmsEgresos.js — SOLO LECTURA. Responde "¿este pedido VEN salió de verdad del WMS?"
 *
 * El paso "STOCK DESCONTADO" de la bandeja de Inventario NO es prueba de nada: se enciende
 * porque el pedido pasó a PREPARADO, y eso pasa igual aunque el descuento haya fallado
 * (ver wmsStockService.descontarStockWmsExterno — los errores se acumulan en wmsErrors y
 * el pedido igual se marca PREPARADO). La prueba real está del lado del WMS: un remito
 * 'WEB-xxxxx' (estado EGRESO_WEB, creado_por 'venta') y su movimiento 'egreso_venta_web'.
 *
 * Como el egreso NO guarda el número de VEN, el cruce es por momento + variante + cantidad:
 * el confirm dispara los egresos en el mismo segundo en que el pedido pasa a PREPARADO.
 *
 * Uso:  node backend/scripts/diagWmsEgresos.js VEN-2336 VEN-2329
 *       node backend/scripts/diagWmsEgresos.js --ultimos 20
 *       node backend/scripts/diagWmsEgresos.js --negativos     (foto del daño acumulado)
 */
const path = require('path');
const { getPool, sql } = require(path.join(__dirname, '..', 'config', 'db'));

const WMS_URL   = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
const DEPOSITO  = parseInt(process.env.WMS_DEPOSITO_LOCAL_ID, 10) || 5;
const VENTANA_S = 180; // margen de tolerancia al cruzar por hora (husos/reloj distinto)

async function wms(query) {
    const r = await fetch(`${WMS_URL}/sql`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `USE Ventas_Dev; ${query}` }),
        signal: AbortSignal.timeout(25000)
    });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error(`WMS no disponible (status ${r.status}, respuesta no-JSON)`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'error de SQL en el WMS');
    return j.data || [];
}

async function negativos() {
    console.log(`\n== Etiquetas en negativo en el depósito ${DEPOSITO} — unidades vendidas que nunca se bajaron de la etiqueta real`);
    console.table(await wms(`
        SELECT COUNT(*) AS etiquetas_negativas, SUM(cantidad_actual) AS unidades_en_negativo
        FROM Stock_Etiquetas WHERE deposito_id=${DEPOSITO} AND cantidad_actual < 0`));
    console.log('== Por variante: lo que muestra la tienda vs la suma real de todas sus etiquetas');
    console.table(await wms(`
        SELECT variante_id,
               SUM(CASE WHEN estado='activo' AND cantidad_actual>0 THEN cantidad_actual ELSE 0 END) AS muestra_la_tienda,
               SUM(cantidad_actual) AS suma_real,
               SUM(CASE WHEN cantidad_actual<0 THEN cantidad_actual ELSE 0 END) AS negativo_oculto
        FROM Stock_Etiquetas WHERE deposito_id=${DEPOSITO}
        GROUP BY variante_id
        HAVING SUM(CASE WHEN cantidad_actual<0 THEN cantidad_actual ELSE 0 END) < 0
        ORDER BY SUM(CASE WHEN cantidad_actual<0 THEN cantidad_actual ELSE 0 END) ASC`));
}

async function revisarPedidos(pool, codigos) {
    const lista = codigos.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
    const ped = await pool.request().query(`
        SELECT P.ID, P.NoDocERP, P.EstadoCobro,
               (SELECT MAX(E.Fecha) FROM PedidosCobranzaEventos E
                 WHERE E.PedidoCobranzaID = P.ID AND E.Estado IN ('PREPARADO','ENVIADO_PRODUCCION')) AS FechaDescuento
        FROM PedidosCobranza P WHERE P.NoDocERP IN (${lista}) ORDER BY P.ID`);

    for (const p of ped.recordset) {
        console.log(`\n────────── ${p.NoDocERP}  (estado: ${String(p.EstadoCobro).trim()})`);
        const det = await pool.request().input('ID', sql.Int, p.ID).query(`
            SELECT CodArticulo AS variante, Cantidad, ProIdProducto
            FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @ID`);

        const yaDescontado = ['PREPARADO','RECIBIDO_DEPOSITO','ENTREGADO','ENVIADO_PRODUCCION'].includes(String(p.EstadoCobro).trim().toUpperCase());
        if (!p.FechaDescuento) {
            console.log(yaDescontado
                ? '  El pedido figura descontado, pero NO hay evento con la hora (es anterior al historial de eventos): no se puede cruzar automáticamente contra el WMS.'
                : '  El sistema NUNCA intentó descontar (no llegó a PREPARADO). Nada tiene que haber salido del WMS.');
            console.table(det.recordset);
            continue;
        }
        console.log(`  El sistema dice que descontó el ${new Date(p.FechaDescuento).toLocaleString('es-UY')}`);

        const sinVinculo = det.recordset.filter(d => !/^\d+$/.test(String(d.variante || '').trim()));
        if (sinVinculo.length) {
            console.log(`  ⚠ ${sinVinculo.length} línea(s) SIN variante WMS (CodArticulo vacío o no numérico): imposible descontarlas.`);
            console.table(sinVinculo);
        }

        const variantes = det.recordset.map(d => parseInt(d.variante, 10)).filter(n => !isNaN(n));
        if (!variantes.length) { console.log('  Ninguna línea tiene variante WMS.'); continue; }

        // El reloj del ERP y el del WMS no son el mismo: buscamos el mismo minuto:segundo
        // dentro de una ventana de ±12 h y validamos por variante + cantidad.
        const f = new Date(p.FechaDescuento);
        const movs = await wms(`
            SELECT m.fecha, e.variante_id, m.cantidad_afectada, m.etiqueta_id,
                   e.cantidad_actual AS etiqueta_quedo_en, e.estado AS etiqueta_estado, r.numeracion AS remito
            FROM Stock_Movimientos m
            JOIN Stock_Etiquetas e ON e.id = m.etiqueta_id
            LEFT JOIN wms_remitos_internos r ON r.id = m.remito_id
            WHERE m.tipo_movimiento = 'egreso_venta_web'
              AND e.variante_id IN (${variantes.join(',')})
              AND m.fecha BETWEEN '${new Date(f.getTime() - 12*3600e3).toISOString().slice(0,19)}'
                              AND '${new Date(f.getTime() + 12*3600e3).toISOString().slice(0,19)}'
            ORDER BY m.fecha`);

        const seg = (d) => new Date(d).getMinutes() * 60 + new Date(d).getSeconds();
        const cerca = movs.filter(m => Math.abs(seg(m.fecha) - seg(p.FechaDescuento)) <= VENTANA_S
                                    || Math.abs(seg(m.fecha) - seg(p.FechaDescuento)) >= 3600 - VENTANA_S);

        const filas = det.recordset.map(d => {
            const v = parseInt(d.variante, 10);
            const hit = cerca.find(m => m.variante_id === v && Number(m.cantidad_afectada) === Number(d.Cantidad));
            const parcial = !hit && cerca.find(m => m.variante_id === v);
            return {
                variante: d.variante, pedido: d.Cantidad,
                salio_del_wms: hit ? 'SÍ' : parcial ? `PARCIAL (salió ${parcial.cantidad_afectada})` : 'NO',
                descontado_de_etiqueta: (hit || parcial)?.etiqueta_id ?? '',
                etiqueta_quedo_en: (hit || parcial)?.etiqueta_quedo_en ?? '',
                remito_wms: (hit || parcial)?.remito ?? '',
            };
        });
        console.table(filas);
        const neg = filas.filter(r => Number(r.etiqueta_quedo_en) < 0);
        if (neg.length) console.log(`  ⚠ ${neg.length} línea(s) dejaron la etiqueta EN NEGATIVO: se cargó todo a la etiqueta más vieja aunque no alcanzaba.`);
    }
}

(async () => {
    const args = process.argv.slice(2);
    try {
        if (args.includes('--negativos')) { await negativos(); process.exit(0); }
        const pool = await getPool();
        let codigos = args.filter(a => /^VEN-/i.test(a));
        const iU = args.indexOf('--ultimos');
        if (iU >= 0) {
            const n = parseInt(args[iU + 1], 10) || 20;
            const r = await pool.request().query(`SELECT TOP ${n} NoDocERP FROM PedidosCobranza WHERE NoDocERP LIKE 'VEN-%' ORDER BY ID DESC`);
            codigos = r.recordset.map(x => x.NoDocERP);
        }
        if (!codigos.length) {
            console.log('Uso: node backend/scripts/diagWmsEgresos.js VEN-2336 [VEN-...]   |   --ultimos 20   |   --negativos');
            process.exit(1);
        }
        await revisarPedidos(pool, codigos);
        await negativos();
        process.exit(0);
    } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
