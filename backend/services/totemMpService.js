/**
 * totemMpService.js — pago con MercadoPago desde el tótem: el tótem muestra un QR con el link de pago
 * (Checkout Pro, el mismo que usa el portal) y el cliente lo abre con el celular.
 *
 *   · El retiro se crea ANTES, como con la tarjeta (prepararRetiroTotem): el importe sale del servidor
 *     y, si el cliente no paga, el retiro queda para pagar en la caja con su ticket, como hoy.
 *   · El pago lo registra el aviso de MercadoPago que ya existe (webOrdersController.mpWebhook): con
 *     `ordenRetiro` en el OrdersJson, el aviso no crea otro retiro y asienta el pago en ESE, en la caja
 *     administrativa, igual que los pagos del portal.
 *   · El link vence en minutos (EXPIRA_MIN): si el cliente se va y paga en la caja, un link vivo por
 *     24 h podría cobrarle dos veces.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const LOG = '[MP TÓTEM]';
const EXPIRA_MIN = 15;

function estaConfigurado() {
    return !!process.env.MP_ACCESS_TOKEN;
}

/**
 * Crea el retiro y el link de pago.
 * @returns {{ url, transactionId, retiro: { id, codigo }, moneda, monto, expiraEnMinutos }}
 */
async function iniciarPagoMp({ clientId, orders }) {
    const { prepararRetiroTotem } = require('./poslink/poslinkTotemService');
    const r = await prepararRetiroTotem({ clientId, orders, origen: 'tótem MercadoPago' });
    const { createPreference } = require('./mercadoPagoService');
    const pref = await createPreference({
        items: r.aPagar.map(o => ({
            id: String(o.rawId || o.id),
            title: String(o.desc || o.id || 'Pedido').substring(0, 256),
            quantity: 1,
            unit_price: Number(Number(o.amount).toFixed(2)),
            currency_id: r.moneda,
        })),
        totalAmount: r.total,
        currency: r.moneda,
        commerceName: 'USER',
        ordersData: {
            type: 'totem-mp',
            ordenRetiro: r.codigo,           // el aviso de MP asienta el pago en este retiro (no crea otro)
            // Las facturadas van marcadas: el aviso las deja fuera del cobro de caja (INF-SIS-2026-14)
            orders: r.elegidas.map(o => ({ id: o.id, desc: o.desc || o.id, amount: o.amount, rawId: o.rawId,
                                           ...(o.facturada ? { facturada: o.facturada.documento } : {}) })),
            totalCost: r.total,
            moneda: r.moneda,
        },
        codCliente: parseInt(r.cliente.CodCliente, 10) || 0,
        logPrefix: LOG,
        expiraEnMinutos: EXPIRA_MIN,
    });
    if (!pref.success) {
        const e = new Error(pref.error || 'No se pudo generar el pago con MercadoPago.');
        e.retiro = { id: r.retiroId, codigo: r.codigo };
        throw e;
    }
    logger.info(`${LOG} Link de pago para ${r.codigo}: ${r.moneda} ${r.total} (Tx ${pref.transactionId}, vence en ${EXPIRA_MIN} min).`);
    return {
        url: pref.url,
        transactionId: pref.transactionId,
        retiro: { id: r.retiroId, codigo: r.codigo },
        moneda: r.moneda,
        monto: r.total,
        expiraEnMinutos: EXPIRA_MIN,
    };
}

/**
 * Pregunta a la API de MercadoPago si hay un pago APROBADO con este link (external_reference = nuestro
 * TransactionId). Es lo que el aviso de MP debería contarnos; acá se pregunta directo por si el aviso se
 * demora o no llega (en local, con el túnel caído, no llega nunca).
 */
async function buscarPagoAprobado(transactionId) {
    const axios = require('axios');
    const r = await axios.get('https://api.mercadopago.com/v1/payments/search', {
        params: { external_reference: transactionId, sort: 'date_created', criteria: 'desc' },
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
        timeout: 8000,
    });
    return (r.data?.results || []).find(p => p.status === 'approved') || null;
}

/**
 * Procesa el pago por el MISMO camino que el aviso de MercadoPago (mpWebhook, modo IPN: consulta el pago a
 * la API y lo asienta). El aviso marca el pago con PaidAt antes de registrarlo, así que si el aviso real
 * llega a la vez, uno solo lo registra.
 */
function procesarComoAviso(paymentId, app) {
    const { mpWebhook } = require('../controllers/webOrdersController');
    const resFalso = { status() { return this; }, send() { return this; } };
    return mpWebhook({ query: { topic: 'payment', id: String(paymentId) }, headers: {}, body: {}, app }, resFalso);
}

const ultimaBusqueda = new Map(); // TransactionId → última consulta a la API de MP (no más de una cada 9 s)

/**
 * Cómo va el pago: lo que dijo MercadoPago (Status) y si el pago ya quedó asentado en el retiro.
 * `registrado` es lo que importa para el cliente: el retiro ya figura pago.
 * @param {object} [app] la app de Express (para que el registro avise por socket, como el aviso de MP)
 */
async function estadoPagoMp(transactionId, app = null) {
    const pool = await getPool();
    const r = await pool.request().input('Tx', sql.VarChar(100), String(transactionId))
        .query(`SELECT Status, PaidAt, OrdersJson FROM dbo.MercadoPagoTransactions WHERE TransactionId = @Tx`);
    const t = r.recordset[0];
    if (!t) return null;
    let datos = {};
    try { datos = JSON.parse(t.OrdersJson || '{}'); } catch (e) { datos = {}; }
    if (datos.type !== 'totem-mp') return null; // el tótem solo consulta sus propios pagos
    const retiroId = parseInt(String(datos.ordenRetiro || '').replace(/^[A-Za-z]+-0*/, ''), 10);
    let registrado = false;
    if (Number.isInteger(retiroId)) {
        const p = await pool.request().input('R', sql.Int, retiroId)
            .query('SELECT PagIdPago FROM dbo.OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @R');
        registrado = p.recordset[0]?.PagIdPago != null;
    }
    let status = String(t.Status || 'pending');

    // Sin asentar todavía: ¿MercadoPago ya lo aprobó? Si el aviso no lo procesó, se procesa por su camino.
    if (!registrado && Date.now() - (ultimaBusqueda.get(transactionId) || 0) > 9000) {
        ultimaBusqueda.set(transactionId, Date.now());
        try {
            const pago = await buscarPagoAprobado(transactionId);
            if (pago) {
                status = 'approved';
                if (!t.PaidAt) {
                    logger.info(`${LOG} Pago ${pago.id} aprobado en MercadoPago y sin aviso todavía (Tx ${transactionId}): se procesa como el aviso.`);
                    procesarComoAviso(pago.id, app).catch(e => logger.error(`${LOG} Procesando el pago ${pago.id}: ${e.message}`));
                }
            }
        } catch (e) {
            logger.warn(`${LOG} No se pudo consultar el pago a MercadoPago (Tx ${transactionId}): ${e.message}`);
        }
    }

    return {
        estado: registrado ? 'REGISTRADO' : status === 'approved' ? 'APROBADO' : ['rejected', 'cancelled'].includes(status) ? 'RECHAZADO' : 'PENDIENTE',
        status,
        registrado,
        retiro: datos.ordenRetiro || null,
    };
}

module.exports = { estaConfigurado, iniciarPagoMp, estadoPagoMp };
