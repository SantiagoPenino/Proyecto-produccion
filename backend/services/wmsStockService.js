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
async function descontarStockWmsExterno(items) {
    // BYPASS LOCAL: evita pegarle a la API real del WMS (Johnson) mientras se prueba en
    // local — si no, cada "Confirmar Retiro"/"Confirmar Preparación" de prueba rebaja
    // stock FÍSICO real del depósito. Activar con WMS_DESCUENTO_SIMULADO=true en el
    // .env local. IMPORTANTE: desactivar (o borrar la variable) antes de deployar.
    if (String(process.env.WMS_DESCUENTO_SIMULADO || '').toLowerCase() === 'true') {
        logger.warn(`⚠️ [WMS SIMULADO] Descuento de stock BYPASSEADO (WMS_DESCUENTO_SIMULADO=true) — no se tocó el WMS real. Items: ${JSON.stringify(items)}`);
        return { wmsDisponible: true, wmsErrors: [] };
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

            // Crear remito de egreso vía INSERT (evita el trigger del UPDATE directo)
            const remitoCode = 'WEB-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
            await sqlFetch(`
                INSERT INTO wms_remitos_internos (numeracion, deposito_origen_id, deposito_destino_id, creado_por, estado)
                VALUES ('${remitoCode}', ${depositoId}, ${depositoId}, 'venta', 'EGRESO_WEB');
                DECLARE @RemId INT = SCOPE_IDENTITY();
                INSERT INTO Stock_Movimientos (etiqueta_id, tipo_movimiento, cantidad_afectada, deposito_origen_id, remito_id, usuario_id)
                SELECT TOP 1 id, 'egreso_venta_web', ${Math.min(cantidad, totalDisponible)}, ${depositoId}, @RemId, 'venta'
                FROM Stock_Etiquetas
                WHERE variante_id = ${varianteId} AND deposito_id = ${depositoId} AND estado = 'activo'
                ORDER BY id ASC;
            `);

            logger.info(`✅ Egreso registrado: variante ${varianteId} x ${cantidad} (dep.${depositoId}) | remito: ${remitoCode}`);

            if (totalDisponible < cantidad) {
                wmsErrors.push(`variante ${varianteId}: stock parcial (disponible: ${totalDisponible}, pedido: ${cantidad})`);
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

module.exports = { descontarStockWmsExterno };
