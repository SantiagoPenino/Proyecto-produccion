const logger = require('../utils/logger');

/**
 * [PRENDAS] Descuento de stock contra el WMS externo (Johnson) — extraído tal cual de
 * logisticaWmsController.confirmPreparation para reusarlo también desde el circuito de
 * "Comprar y personalizar" (prendasOrdersController: confirmar-retiro-wms), que ya no
 * pasa por PedidosCobranza sino por Ordenes.
 *
 * @param {Array<{wms_variante_id: number|string, Cantidad: number}>} items
 * @returns {Promise<{wmsDisponible: boolean, wmsErrors: string[]}>}
 */
async function descontarStockWmsExterno(items, ref = {}) {
    // BYPASS LOCAL: evita pegarle a la API real del WMS (Johnson) mientras se prueba en
    // local — si no, cada "Confirmar Retiro"/"Confirmar Preparación" de prueba rebaja
    // stock FÍSICO real del depósito. Activar con WMS_DESCUENTO_SIMULADO=true en el
    // .env local. IMPORTANTE: desactivar (o borrar la variable) antes de deployar.
    if (String(process.env.WMS_DESCUENTO_SIMULADO || '').toLowerCase() === 'true') {
        logger.warn(`⚠️ [WMS SIMULADO] Descuento de stock BYPASSEADO (WMS_DESCUENTO_SIMULADO=true) — no se tocó el WMS real. Items: ${JSON.stringify(items)}`);
        return { wmsDisponible: true, wmsErrors: [] };
    }

    // [CUTOVER WMS PROPIO] WMS_INTERNO=true → el descuento corre contra NUESTRAS tablas
    // Wms_* (transaccional, FIFO multi-etiqueta, idempotente por ref) en vez del WMS de
    // Johnson. Ver docs/wms-propio-plan.md; el import previo es scripts/wmsImportSnapshot.js.
    if (String(process.env.WMS_INTERNO || '').toLowerCase() === 'true') {
        const interno = require('./wmsInternoService');
        return interno.egresarVentaCompat(items, ref);
    }

    const wmsSqlUrl  = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
    const depositoId = parseInt(process.env.WMS_DEPOSITO_LOCAL_ID) || 5;
    const wmsErrors  = [];
    let wmsDisponible = true;

    const sqlFetch = async (query) => {
        const r = await fetch(`${wmsSqlUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `USE Ventas_Dev; CREATE TABLE #WmsSecureTx_v17 (id INT); ${query}` }),
            signal: AbortSignal.timeout(12000)
        });
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('WMS no disponible (respuesta HTML)');
        const json = await r.json();
        if (!json.success) throw new Error(json.error || 'SQL error');
        return json.data || [];
    };

    for (const item of items) {
        try {
            const varianteId = parseInt(item.wms_variante_id);
            const cantidad   = parseFloat(item.Cantidad);

            // Buscar etiquetas activas disponibles
            const etiquetas = await sqlFetch(`
                SELECT id, cantidad_actual FROM Stock_Etiquetas
                WHERE variante_id = ${varianteId}
                  AND deposito_id = ${depositoId}
                  AND estado = 'activo'
                  AND cantidad_actual > 0
                ORDER BY id ASC;
            `);

            const totalDisponible = etiquetas.reduce((s, e) => s + Number(e.cantidad_actual), 0);

            if (totalDisponible <= 0) {
                wmsErrors.push(`variante ${varianteId}: sin stock en depósito ${depositoId}`);
                logger.warn(`⚠️ Sin stock: variante ${varianteId}`);
                continue;
            }

            // Reparto FIFO entre las etiquetas que REALMENTE tienen saldo. Antes iba UN
            // solo movimiento contra la etiqueta más vieja (SELECT TOP 1) por la cantidad
            // entera: si esa etiqueta no alcanzaba, el trigger del WMS
            // (trg_StockMovimientos_AfterInsert) la restaba igual y la dejaba EN NEGATIVO,
            // mientras las etiquetas nuevas — las que tienen la mercadería de verdad —
            // quedaban intactas. Como la tienda suma solo las etiquetas con
            // cantidad_actual > 0, el negativo quedaba escondido y se seguía ofreciendo
            // stock ya vendido (10/09/2026: 42 etiquetas y 222 unidades así en el dep. 5).
            // Ahora se toma de cada etiqueta solo lo que tiene y se sigue con la siguiente.
            const plan = [];
            let restante = cantidad;
            for (const e of etiquetas) {
                if (restante <= 0) break;
                const toma = Math.min(restante, Number(e.cantidad_actual));
                if (toma > 0) { plan.push({ etiquetaId: e.id, toma }); restante -= toma; }
            }

            // Crear remito de egreso vía INSERT (evita el trigger del UPDATE directo).
            // La referencia del pedido viaja en observaciones_generales: sin eso el egreso
            // queda anónimo del lado del WMS (numeración 'WEB-123456', usuario 'venta') y
            // para auditar qué venta lo generó hay que cruzar por hora a mano.
            const remitoCode = 'WEB-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
            const refTxt = [ref.refDoc, ref.refTipo, ref.refId].filter(Boolean).join(' ') || 'sin referencia';
            await sqlFetch(`
                INSERT INTO wms_remitos_internos (numeracion, deposito_origen_id, deposito_destino_id, creado_por, estado, observaciones_generales)
                VALUES ('${remitoCode}', ${depositoId}, ${depositoId}, 'venta', 'EGRESO_WEB', '${String(refTxt).replace(/'/g, "''")}');
                DECLARE @RemId INT = SCOPE_IDENTITY();
                ${plan.map(p => `INSERT INTO Stock_Movimientos (etiqueta_id, tipo_movimiento, cantidad_afectada, deposito_origen_id, remito_id, usuario_id)
                VALUES (${p.etiquetaId}, 'egreso_venta_web', ${p.toma}, ${depositoId}, @RemId, 'venta');`).join('\n                ')}
            `);

            const descontado = cantidad - restante;
            logger.info(`✅ Egreso registrado: variante ${varianteId} x ${descontado} en ${plan.length} etiqueta(s) [${plan.map(p => `#${p.etiquetaId}:${p.toma}`).join(', ')}] (dep.${depositoId}) | remito: ${remitoCode} | ${refTxt}`);

            // Lo que no había NO se fuerza contra ninguna etiqueta: se avisa. Forzarlo era
            // exactamente lo que generaba los negativos.
            if (restante > 0) {
                wmsErrors.push(`variante ${varianteId}: stock parcial (disponible: ${totalDisponible}, pedido: ${cantidad}) — quedaron ${restante} SIN descontar`);
            }
        } catch (e) {
            if (e.message.includes('WMS no disponible')) {
                wmsDisponible = false;
                logger.error(`❌ WMS offline: ${e.message}`);
                break;
            }
            wmsErrors.push(`variante ${item.wms_variante_id}: ${e.message}`);
            logger.error(`❌ Error descuento variante ${item.wms_variante_id}: ${e.message}`);
        }
    }

    return { wmsDisponible, wmsErrors };
}

// [COMBOS] Explosión de combos del configurador: una línea de venta cuyo artículo tiene
// composición en ProductoComboItems no se descuenta a sí misma (el combo no existe en el
// WMS) sino como sus componentes — variante WMS del componente × (cantidad por combo ×
// cantidad vendida). Ej.: 3 × "Combo gorro y short" → 3 gorros + 3 shorts. Los artículos
// sin composición pasan tal cual. Best-effort: si ProductoComboItems no existe todavía
// (prod sin el configurador migrado), devuelve los items originales y no rompe la venta.
// items: [{ ProIdProducto, wms_variante_id, Cantidad }]
async function explotarCombos(pool, items) {
    try {
        const ids = [...new Set(items.map(i => parseInt(i.ProIdProducto)).filter(n => !isNaN(n)))];
        if (!ids.length) return items;
        const r = await pool.request().query(`
            SELECT ProIdProducto, WmsVarianteId, Cantidad
            FROM dbo.ProductoComboItems
            WHERE ProIdProducto IN (${ids.join(',')})
        `);
        if (!r.recordset.length) return items;
        const compPorCombo = {};
        r.recordset.forEach(c => { (compPorCombo[c.ProIdProducto] = compPorCombo[c.ProIdProducto] || []).push(c); });

        const out = [];
        for (const it of items) {
            const comps = compPorCombo[parseInt(it.ProIdProducto)];
            if (!comps) { out.push(it); continue; }
            for (const c of comps) {
                if (!c.WmsVarianteId) {
                    // Componente sin variante WMS mapeada: no hay qué descontar en el WMS.
                    logger.warn(`[COMBOS] Componente sin variante WMS en combo ${it.ProIdProducto} — no se descuenta`);
                    continue;
                }
                out.push({
                    ProIdProducto: it.ProIdProducto,
                    wms_variante_id: c.WmsVarianteId,
                    Cantidad: (parseFloat(it.Cantidad) || 0) * (parseInt(c.Cantidad, 10) || 1)
                });
            }
            logger.info(`[COMBOS] Combo ${it.ProIdProducto} x${it.Cantidad} explotado en ${comps.length} componente(s) para el descuento`);
        }
        return out;
    } catch (e) {
        logger.warn('[COMBOS] No se pudo explotar la composición (¿falta ProductoComboItems?): ' + e.message);
        return items;
    }
}

module.exports = { descontarStockWmsExterno, explotarCombos };
