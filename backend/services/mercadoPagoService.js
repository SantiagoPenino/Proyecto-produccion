/**
 * mercadoPagoService.js — Servicio centralizado para pagos con MercadoPago Checkout Pro
 * Arquitectura paralela a handyService.js
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const MP_API_BASE = 'https://api.mercadopago.com';

/**
 * Crea una Preferencia de pago en MercadoPago y guarda la transacción en MercadoPagoTransactions
 * @param {Object} options
 * @param {Array}  options.items         - [{title, quantity, unit_price, currency_id}]
 * @param {number} options.totalAmount   - Monto total
 * @param {string} options.currency      - 'UYU' o 'USD'
 * @param {string} options.commerceName  - Nombre del comercio
 * @param {Object} options.ordersData    - Datos para guardar en OrdersJson (para el webhook)
 * @param {number} options.codCliente    - Código del cliente
 * @param {string} options.logPrefix     - Prefijo para logs
 * @param {number} options.expiraEnMinutos - Vigencia del link (24 h si no se pasa). El tótem usa minutos:
 *                                         un QR que sigue vivo después de que el cliente se fue a pagar a la
 *                                         caja es una puerta a cobrarle dos veces.
 * @returns {{ success, url, transactionId, preferenceId, error }}
 */
async function createPreference({
    items,
    totalAmount,
    currency = 'UYU',
    commerceName = 'USER',
    ordersData = {},
    codCliente = 0,
    logPrefix = '[MP]',
    expiraEnMinutos = 24 * 60
}) {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        logger.error(`${logPrefix} MP_ACCESS_TOKEN no configurado en .env`);
        return { success: false, error: 'Pasarela de pago no configurada.' };
    }

    const siteUrl = process.env.SITE_URL || 'https://user.com.uy';
    // MP_WEBHOOK_BASE_URL permite usar ngrok en local sin cambiar el SITE_URL de producción
    const webhookBase = process.env.MP_WEBHOOK_BASE_URL || siteUrl;
    const transactionId = uuidv4();

    const preference = {
        items: items.map(item => ({
            id: item.id || transactionId,
            title: item.title,
            quantity: Number(item.quantity) || 1,
            unit_price: Number(Number(item.unit_price).toFixed(2)),
            currency_id: currency
        })),
        back_urls: {
            success: `${siteUrl}/portal/payment-status?txId=${transactionId}&gateway=mp`,
            failure: `${siteUrl}/portal/payment-status?txId=${transactionId}&gateway=mp`,
            pending: `${siteUrl}/portal/payment-status?txId=${transactionId}&gateway=mp`
        },
        auto_return: 'approved',
        notification_url: `${webhookBase}/api/web-orders/mp-webhook`,
        external_reference: transactionId,
        // Métadatos de la tienda
        statement_descriptor: commerceName,
        // Expiración de la preferencia: 24 horas salvo que se pida otra (tótem)
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: new Date(Date.now() + expiraEnMinutos * 60 * 1000).toISOString()
    };

    logger.info(`${logPrefix} Creando preferencia de pago...`);
    logger.info(`${logPrefix} Payload: ${JSON.stringify(preference)}`);

    let response;
    try {
        response = await axios.post(`${MP_API_BASE}/checkout/preferences`, preference, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (axiosErr) {
        const status = axiosErr.response?.status;
        const rawData = axiosErr.response?.data;
        logger.error(`${logPrefix} ══ ERROR MP HTTP ${status} ══`);
        logger.error(`${logPrefix} Response body: ${rawData ? JSON.stringify(rawData) : '(vacío)'}`);
        logger.error(`${logPrefix} Axios message: ${axiosErr.message}`);
        return { success: false, error: `MercadoPago HTTP ${status}: ${rawData?.message || axiosErr.message}` };
    }

    const { id: preferenceId, init_point } = response.data;

    if (!init_point) {
        logger.error(`${logPrefix} Respuesta inesperada de MP:`, JSON.stringify(response.data));
        return { success: false, error: 'La pasarela no devolvió una URL válida.' };
    }

    logger.info(`${logPrefix} Preferencia creada: ${preferenceId}`);
    logger.info(`${logPrefix} Init Point: ${init_point}`);

    // Guardar en MercadoPagoTransactions para reconciliar con el webhook
    try {
        const pool = await getPool();
        await pool.request()
            .input('txId',        sql.VarChar(100),      transactionId)
            .input('prefId',      sql.VarChar(200),      preferenceId)
            .input('payUrl',      sql.VarChar(500),      init_point)
            .input('ordersJson',  sql.NVarChar(sql.MAX), JSON.stringify(ordersData))
            .input('codCliente',  sql.Int,               codCliente)
            .query(`
                INSERT INTO MercadoPagoTransactions
                    (TransactionId, PreferenceId, PaymentUrl, OrdersJson, CodCliente, Status, CreatedAt)
                VALUES
                    (@txId, @prefId, @payUrl, @ordersJson, @codCliente, 'pending', GETDATE())
            `);
        logger.info(`${logPrefix} TransactionId ${transactionId} guardado en MercadoPagoTransactions.`);
    } catch (dbErr) {
        logger.warn(`${logPrefix} No se pudo guardar en BD:`, dbErr.message);
    }

    return { success: true, url: init_point, transactionId, preferenceId };
}

module.exports = { createPreference };
