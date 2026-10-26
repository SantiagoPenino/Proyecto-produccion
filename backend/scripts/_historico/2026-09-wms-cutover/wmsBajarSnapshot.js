/**
 * wmsBajarSnapshot.js — baja los snap_*.json del WMS externo a una carpeta local.
 * ─────────────────────────────────────────────────────────────────────────────
 * Para cuando el VPS no llega al proxy del WMS: se baja el backup desde una
 * máquina que sí llega, se copia por scp y el import corre offline con --dir=.
 *
 *   node scripts/wmsBajarSnapshot.js                 → ./wms-snap
 *   node scripts/wmsBajarSnapshot.js /ruta/destino   → carpeta a elección
 *
 * Mismas tablas y misma paginación que cargarOrigen() de wmsImportSnapshot.js
 * (Stock_Etiquetas de a 8000: son 54k+), así el backup sirve tal cual con:
 *   node scripts/wmsImportSnapshot.js --dir=<carpeta>
 *
 * Sacar la foto con el depósito quieto: es el corte del cutover.
 */
const fs = require('fs');
const path = require('path');

const DESTINO = process.argv[2] || path.join(process.cwd(), 'wms-snap');
const WMS_URL = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';

const TABLAS = ['Stock_Depositos', 'Stock_Categorias', 'Stock_Productos_Maestros', 'Stock_Variantes',
    'Stock_Proveedores', 'Stock_Compras', 'Stock_Compras_Detalle', 'Stock_Importaciones',
    'wms_remitos_internos', 'wms_remitos_internos_items', 'wms_solicitudes', 'wms_solicitudes_items',
    'Stock_Alertas_Depositos', 'Stock_Monedas', 'Stock_TiposFactura', 'Stock_Pagos_Motivos', 'Stock_Pagos',
    'Stock_Plantillas_Progreso', 'Stock_Plantillas_Progreso_Pasos',
    'Stock_Movimientos'];

async function wmsQuery(q) {
    const res = await fetch(`${WMS_URL}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `USE Ventas_Dev; CREATE TABLE #WmsSecureTx_v17 (id INT); ${q}` }),
        signal: AbortSignal.timeout(120000)
    });
    const json = await res.json();
    if (!json.success) throw new Error(`WMS: ${json.error}`);
    return json.data || [];
}

const guardar = (tabla, filas) => {
    const f = path.join(DESTINO, `snap_${tabla}.json`);
    fs.writeFileSync(f, JSON.stringify(filas));
    const kb = (fs.statSync(f).size / 1024).toFixed(0);
    console.log(`  ${tabla.padEnd(34)} ${String(filas.length).padStart(7)} filas   ${String(kb).padStart(7)} KB`);
    return filas.length;
};

(async () => {
    fs.mkdirSync(DESTINO, { recursive: true });
    console.log(`Origen : ${WMS_URL}`);
    console.log(`Destino: ${DESTINO}\n`);
    let total = 0;

    for (const t of TABLAS) {
        total += guardar(t, await wmsQuery(`SELECT * FROM ${t}`));
    }

    // etiquetas paginadas de a 8000 (son 54k+), igual que el import
    const etiquetas = [];
    let ultimo = 0;
    for (;;) {
        const lote = await wmsQuery(`SELECT TOP 8000 * FROM Stock_Etiquetas WHERE id > ${ultimo} ORDER BY id`);
        if (!lote.length) break;
        etiquetas.push(...lote);
        ultimo = lote[lote.length - 1].id;
    }
    total += guardar('Stock_Etiquetas', etiquetas);

    console.log(`\n${TABLAS.length + 1} archivos · ${total.toLocaleString('es-UY')} filas en total`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
