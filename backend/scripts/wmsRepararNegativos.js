/**
 * wmsRepararNegativos.js — reubica el stock que quedó mal imputado en el WMS externo.
 *
 * QUÉ PASÓ: hasta el fix de wmsStockService.js, cada venta mandaba UN movimiento de egreso
 * contra la etiqueta más vieja por la cantidad entera. Si esa etiqueta no alcanzaba, el
 * trigger del WMS (trg_StockMovimientos_AfterInsert) la restaba igual y la dejaba en
 * negativo, mientras las etiquetas nuevas — las que tenían la mercadería — quedaban
 * intactas. Como la tienda suma solo etiquetas con cantidad_actual > 0, el negativo queda
 * escondido y se sigue ofreciendo stock ya vendido.
 *
 * QUÉ HACE ESTE SCRIPT: por variante, lleva las etiquetas negativas a cero y le descuenta
 * esa misma cantidad, FIFO, a las etiquetas que sí tienen saldo. El total de la variante
 * NO cambia: cada venta ya se restó una vez y una sola. Lo que cambia es de qué etiqueta
 * sale, y por lo tanto lo que la tienda muestra como disponible (va a BAJAR).
 *
 * QUÉ NO HACE: las variantes cuyo total sigue siendo negativo después de sumar TODAS sus
 * etiquetas no se tocan. Ahí no hay nada que reubicar: el WMS registró menos ingresos de
 * los que se vendieron. Eso lo arregla el depósito, cargando la recepción que falta o
 * haciendo un conteo. El script las lista aparte.
 *
 * CÓMO LO HACE: no toca Stock_Etiquetas con UPDATE (ese camino está bloqueado por
 * trg_StockEtiquetas_PreventDirectDiscount). Inserta movimientos 'egreso_venta_web' — el
 * único tipo que el trigger procesa — con cantidad NEGATIVA para devolverle unidades a la
 * etiqueta que quedó en rojo, y con cantidad positiva para sacárselas a la que las tiene.
 * Todo queda asentado bajo un remito propio, así se puede auditar y revertir.
 *
 * Uso:
 *   node backend/scripts/wmsRepararNegativos.js            → SIMULACIÓN, no escribe nada
 *   node backend/scripts/wmsRepararNegativos.js --aplicar   → ejecuta de verdad
 *
 * Correrlo fuera de horario de ventas: si entra un pedido en el medio, el reparto se hace
 * sobre una foto vieja del stock. Volver a correr la simulación después para confirmar.
 */
const WMS_URL  = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
const DEPOSITO = parseInt(process.env.WMS_DEPOSITO_LOCAL_ID, 10) || 5;
const APLICAR  = process.argv.includes('--aplicar');

// Estado del remito de ajuste. Se deja el mismo valor que usan los egresos de venta para
// no meter un estado nuevo en la tabla de ellos; la observación aclara qué es.
const ESTADO_REMITO = 'EGRESO_WEB';

async function wms(query, escribe = false) {
    if (escribe && !APLICAR) throw new Error('intento de escritura en modo simulación');
    const r = await fetch(`${WMS_URL}/sql`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // El CREATE TABLE es la firma que exige trg_StockEtiquetas_PreventDirectDiscount.
        body: JSON.stringify({ query: `USE Ventas_Dev; CREATE TABLE #WmsSecureTx_v17 (id INT); ${query}` }),
        signal: AbortSignal.timeout(30000)
    });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error(`WMS no disponible (status ${r.status})`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'error de SQL en el WMS');
    return j.data || [];
}

async function fotoEtiquetas() {
    return wms(`
        SELECT variante_id, id AS etiqueta_id, cantidad_inicial, cantidad_actual, estado
        FROM Stock_Etiquetas
        WHERE deposito_id = ${DEPOSITO}
          AND variante_id IN (SELECT variante_id FROM Stock_Etiquetas WHERE deposito_id = ${DEPOSITO} AND cantidad_actual < 0)
        ORDER BY variante_id, id`);
}

// Arma, por variante, de qué etiqueta se saca y a cuál se le devuelve.
function armarPlan(etiquetas) {
    const porVariante = {};
    etiquetas.forEach(e => { (porVariante[e.variante_id] = porVariante[e.variante_id] || []).push(e); });

    const reubicables = [], sinRespaldo = [];
    for (const [varianteId, etis] of Object.entries(porVariante)) {
        const neto  = etis.reduce((s, e) => s + Number(e.cantidad_actual), 0);
        const deuda = etis.filter(e => Number(e.cantidad_actual) < 0)
                          .reduce((s, e) => s - Number(e.cantidad_actual), 0);
        if (neto < 0) { sinRespaldo.push({ varianteId: Number(varianteId), deuda, neto }); continue; }

        const movimientos = [];
        // 1. Devolverle a cada etiqueta en rojo justo lo que le falta para llegar a cero.
        etis.filter(e => Number(e.cantidad_actual) < 0).forEach(e => {
            movimientos.push({ etiquetaId: e.etiqueta_id, cantidad: Number(e.cantidad_actual), detalle: `etiqueta ${e.etiqueta_id}: ${e.cantidad_actual} → 0` });
        });
        // 2. Sacarle esa misma cantidad, FIFO, a las que sí tienen.
        let restante = deuda;
        for (const e of etis.filter(x => Number(x.cantidad_actual) > 0)) {
            if (restante <= 0) break;
            const toma = Math.min(restante, Number(e.cantidad_actual));
            movimientos.push({ etiquetaId: e.etiqueta_id, cantidad: toma, detalle: `etiqueta ${e.etiqueta_id}: ${e.cantidad_actual} → ${Number(e.cantidad_actual) - toma}` });
            restante -= toma;
        }
        reubicables.push({ varianteId: Number(varianteId), deuda, neto, movimientos });
    }
    return { reubicables, sinRespaldo };
}

async function aplicar(plan) {
    const codigo = 'AJU-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const obs = `Reubicacion de stock mal imputado (bug egreso a una sola etiqueta). Variante ${plan.varianteId}, ${plan.deuda} unidades.`;
    const inserts = plan.movimientos.map(m => `
        INSERT INTO Stock_Movimientos (etiqueta_id, tipo_movimiento, cantidad_afectada, deposito_origen_id, remito_id, usuario_id)
        VALUES (${m.etiquetaId}, 'egreso_venta_web', ${m.cantidad}, ${DEPOSITO}, @RemId, 'ajuste');`).join('');
    await wms(`
        INSERT INTO wms_remitos_internos (numeracion, deposito_origen_id, deposito_destino_id, creado_por, estado, observaciones_generales)
        VALUES ('${codigo}-V${plan.varianteId}', ${DEPOSITO}, ${DEPOSITO}, 'ajuste', '${ESTADO_REMITO}', '${obs.replace(/'/g, "''")}');
        DECLARE @RemId INT = SCOPE_IDENTITY();
        ${inserts}`, true);
    return `${codigo}-V${plan.varianteId}`;
}

(async () => {
    try {
        console.log(APLICAR
            ? '\n*** MODO APLICAR: esto ESCRIBE en el WMS de Johnson ***\n'
            : '\n=== SIMULACIÓN: no se escribe nada. Agregá --aplicar para ejecutar ===\n');

        const { reubicables, sinRespaldo } = armarPlan(await fotoEtiquetas());

        console.log(`── Se pueden reubicar: ${reubicables.length} variante(s), ${reubicables.reduce((s, p) => s + p.deuda, 0)} unidades`);
        for (const p of reubicables) {
            console.log(`\n  Variante ${p.varianteId} — ${p.deuda} unidades mal imputadas (total de la variante: ${p.neto}, no cambia)`);
            p.movimientos.forEach(m => console.log(`     ${m.detalle}`));
        }

        console.log(`\n── NO se pueden reubicar: ${sinRespaldo.length} variante(s), ${sinRespaldo.reduce((s, p) => s - p.neto, 0)} unidades`);
        console.log('   Se vendió más de lo que el WMS registró como ingresado. Lo tiene que resolver el depósito');
        console.log('   (cargar la recepción que falta o hacer conteo). Este script NO las toca.');
        console.table(sinRespaldo.map(p => ({ variante: p.varianteId, en_rojo: p.deuda, total_de_la_variante: p.neto })));

        if (!APLICAR) { console.log('\nSimulación terminada. Nada se escribió.'); process.exit(0); }

        for (const p of reubicables) {
            const rem = await aplicar(p);
            console.log(`  ✔ Variante ${p.varianteId} reubicada — remito ${rem}`);
        }

        console.log('\n── Verificación posterior');
        console.table(await wms(`
            SELECT COUNT(*) AS etiquetas_negativas, ISNULL(SUM(cantidad_actual), 0) AS unidades_en_negativo
            FROM Stock_Etiquetas WHERE deposito_id = ${DEPOSITO} AND cantidad_actual < 0`));
        console.log('Lo que siga en negativo es el grupo sin respaldo, que se arregla en el depósito.');
        process.exit(0);
    } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
