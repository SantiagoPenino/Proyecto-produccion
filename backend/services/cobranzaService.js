/**
 * cobranzaService.js — Sincroniza PedidosCobranza con los pagos reales.
 *
 * PedidosCobranza es la vista de cobranza que leen la Caja (pendientes),
 * el portal (badge PAGADO en retiros) y el tótem (decide "pasar por caja").
 * Históricamente NINGÚN flujo de pago la actualizaba: todo quedaba
 * 'Pendiente' para siempre (riesgo de doble cobro, caso DTF-5728).
 *
 * marcarCobranzaPagada se llama desde los caminos vivos que registran pago:
 *   - cajaService.procesarTransaccion (Caja Central + webhooks Handy/MP)
 *   - retiroService.registrarPago (webRetiros)
 * marcarCobranzaPendiente es el inverso, para la anulación de transacciones.
 *
 * Ambas son best-effort: nunca lanzan (un fallo acá no debe tirar el pago).
 * IMPORTANTE: Siempre ejecutan contra el pool general de forma aislada,
 * con ROWLOCK y timeout de 5s, para NUNCA retener bloqueos de transacciones
 * financieras ni causar timeouts de 120s o deadlocks (1205) en la Caja.
 */
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// PedidosCobranza.NoDocERP guarda el código base (ej. SUB-4727); en
// OrdenesDeposito el código puede venir con sufijo multiparte (SUB-4727 (2/2)).
// Este fragmento normaliza el código de la orden al código base.
const SQL_CODIGO_BASE = `
    LTRIM(RTRIM(CASE WHEN CHARINDEX(' (', od.OrdCodigoOrden) > 0
        THEN LEFT(od.OrdCodigoOrden, CHARINDEX(' (', od.OrdCodigoOrden) - 1)
        ELSE od.OrdCodigoOrden END))`;

const soloIdsValidos = (ordIds) =>
    (ordIds || []).map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0);

/**
 * Marca 'Pagado' en PedidosCobranza los pedidos de las OrdenesDeposito dadas.
 * Solo pisa filas en 'Pendiente': no toca los estados del flujo WMS ecommerce
 * (EN_PREPARACION/PREPARADO/ENTREGADO/... de los pedidos VEN-) ni re-pisa Pagado.
 *
 * @param {Transaction|Pool|null} _db — ignorado; siempre usa el pool con timeout de 5s para evitar bloqueos
 * @param {Array<number>} ordIds     — OrdIdOrden de OrdenesDeposito recién pagadas
 */
async function marcarCobranzaPagada(_db, ordIds) {
    const ids = soloIdsValidos(ordIds);
    if (!ids.length) return;

    try {
        const pool = await getPool();

        // 1. Obtener los códigos base con seek directo por PK en OrdenesDeposito (NOLOCK)
        const codeReq = pool.request();
        codeReq.timeout = 5000;
        ids.forEach((id, i) => codeReq.input(`oid${i}`, sql.Int, id));
        const inClause = ids.map((_, i) => `@oid${i}`).join(',');

        const codesRes = await codeReq.query(`
            SELECT DISTINCT ${SQL_CODIGO_BASE} AS CodigoBase
            FROM dbo.OrdenesDeposito od WITH (NOLOCK)
            WHERE od.OrdIdOrden IN (${inClause})
              AND od.OrdCodigoOrden IS NOT NULL;
        `);

        const codigos = [...new Set(codesRes.recordset.map(r => r.CodigoBase?.trim()).filter(Boolean))];
        if (!codigos.length) return;

        // 2. Actualizar PedidosCobranza con consulta sargable (permite uso de índices) y ROWLOCK
        const updateReq = pool.request();
        updateReq.timeout = 5000;
        codigos.forEach((doc, i) => updateReq.input(`doc${i}`, sql.VarChar(100), doc));
        const inDocs = codigos.map((_, i) => `@doc${i}`).join(',');

        const res = await updateReq.query(`
            UPDATE pc WITH (ROWLOCK)
            SET pc.EstadoCobro = 'Pagado',
                pc.FechaPago   = GETDATE()
            FROM dbo.PedidosCobranza pc
            WHERE pc.EstadoCobro IN ('Pendiente', 'PENDIENTE', 'pendiente')
              AND pc.NoDocERP IN (${inDocs});
        `);

        const n = res.rowsAffected?.[0] || 0;
        if (n > 0) logger.info(`[COBRANZA] ${n} pedido(s) marcados Pagado (${codigos.join(',')})`);
    } catch (err) {
        logger.warn(`[COBRANZA] Aviso marcando Pagado (órdenes ${ids.join(',')}): ${err.message}`);
    }
}

/**
 * Inverso: al anular un pago, la cobranza vuelve de 'Pagado' a 'Pendiente'.
 * Solo pisa filas en 'Pagado' para no interferir con el flujo WMS.
 */
async function marcarCobranzaPendiente(_db, ordIds) {
    const ids = soloIdsValidos(ordIds);
    if (!ids.length) return;

    try {
        const pool = await getPool();

        // 1. Obtener los códigos base con seek directo por PK en OrdenesDeposito (NOLOCK)
        const codeReq = pool.request();
        codeReq.timeout = 5000;
        ids.forEach((id, i) => codeReq.input(`oid${i}`, sql.Int, id));
        const inClause = ids.map((_, i) => `@oid${i}`).join(',');

        const codesRes = await codeReq.query(`
            SELECT DISTINCT ${SQL_CODIGO_BASE} AS CodigoBase
            FROM dbo.OrdenesDeposito od WITH (NOLOCK)
            WHERE od.OrdIdOrden IN (${inClause})
              AND od.OrdCodigoOrden IS NOT NULL;
        `);

        const codigos = [...new Set(codesRes.recordset.map(r => r.CodigoBase?.trim()).filter(Boolean))];
        if (!codigos.length) return;

        // 2. Actualizar PedidosCobranza con consulta sargable y ROWLOCK
        const updateReq = pool.request();
        updateReq.timeout = 5000;
        codigos.forEach((doc, i) => updateReq.input(`doc${i}`, sql.VarChar(100), doc));
        const inDocs = codigos.map((_, i) => `@doc${i}`).join(',');

        const res = await updateReq.query(`
            UPDATE pc WITH (ROWLOCK)
            SET pc.EstadoCobro = 'Pendiente',
                pc.FechaPago   = NULL
            FROM dbo.PedidosCobranza pc
            WHERE pc.EstadoCobro IN ('Pagado', 'PAGADO', 'pagado')
              AND pc.NoDocERP IN (${inDocs});
        `);

        const n = res.rowsAffected?.[0] || 0;
        if (n > 0) logger.info(`[COBRANZA] ${n} pedido(s) revertidos a Pendiente (${codigos.join(',')})`);
    } catch (err) {
        logger.warn(`[COBRANZA] Aviso revirtiendo a Pendiente (órdenes ${ids.join(',')}): ${err.message}`);
    }
}

module.exports = { marcarCobranzaPagada, marcarCobranzaPendiente };
