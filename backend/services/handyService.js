/**
 * handyService.js — Servicio centralizado para pagos con Handy
 * Elimina duplicación entre webOrdersController y webRetirosController
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../config/db');

/**
 * Crea un link de pago en Handy y guarda la transacción en HandyTransactions
 * @param {Object} options
 * @param {Array}  options.products     - [{Name, Quantity, Amount, TaxedAmount}]
 * @param {number} options.totalAmount  - Monto total
 * @param {number} options.currencyCode - 840 (USD) o 858 (UYU)
 * @param {string} options.commerceName - Nombre del comercio (ej: "USER", "USER - Retiros")
 * @param {string} options.imageUrl     - URL de la imagen (opcional)
 * @param {Object} options.ordersData   - Datos para guardar en OrdersJson
 * @param {number} options.codCliente   - Código del cliente
 * @param {string} options.logPrefix    - Prefijo para logs (ej: "[HANDY]", "[HANDY RETIRO]")
 * @returns {{ success, url, transactionId, error }}
 */
async function createPaymentLink({
    products,
    totalAmount,
    currencyCode,
    commerceName = 'USER',
    imageUrl = 'https://user.com.uy/assets/images/logo.jpg',
    ordersData = {},
    codCliente = 0,
    logPrefix = '[HANDY]'
}) {
    const isProduction = process.env.HANDY_ENVIRONMENT === 'production';
    const handySecret = process.env.HANDY_MERCHANT_SECRET;
    const handyUrl = isProduction
        ? 'https://api.payments.handy.uy/api/v2/payments'
        : 'https://api.payments.arriba.uy/api/v2/payments';
    const siteUrl = process.env.SITE_URL || 'https://user.com.uy';

    const transactionId = uuidv4();
    const invoiceNumber = Math.floor(Math.random() * 90000) + 10000;

    const handyPayload = {
        Cart: {
            Currency: currencyCode,
            TotalAmount: Number(Number(totalAmount).toFixed(2)),
            TaxedAmount: Number((Number(totalAmount) / 1.22).toFixed(2)),
            Products: products,
            InvoiceNumber: invoiceNumber,
            LinkImageUrl: imageUrl,
            TransactionExternalId: transactionId
        },
        Client: {
            CommerceName: commerceName,
            SiteUrl: `${siteUrl}/payment-status?txId=${transactionId}`
        },
        CallbackURL: `${siteUrl}/api/web-orders/handy-webhook`,
        ResponseType: "Json"
    };

    console.log(`${logPrefix} Creando link de pago (${isProduction ? 'PRODUCCIÓN' : 'TESTING'})...`);
    console.log(`${logPrefix} Payload:`, JSON.stringify(handyPayload));

    const response = await axios.post(handyUrl, handyPayload, {
        headers: { 'merchant-secret-key': handySecret }
    });

    if (!response.data?.url) {
        return { success: false, error: 'La pasarela no devolvió una URL válida.' };
    }

    const paymentUrl = response.data.url;
    console.log(`${logPrefix} Link generado:`, paymentUrl);

    // Guardar en HandyTransactions para reconciliar con el webhook
    try {
        const pool = await getPool();
        const orderIdsJson = JSON.stringify(ordersData);

        await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .input('payUrl', sql.VarChar(500), paymentUrl)
            .input('amount', sql.Decimal(18, 2), totalAmount)
            .input('currency', sql.Int, currencyCode)
            .input('ordersJson', sql.NVarChar(sql.MAX), orderIdsJson)
            .input('codCliente', sql.Int, codCliente)
            .query(`
                INSERT INTO HandyTransactions (TransactionId, PaymentUrl, TotalAmount, Currency, OrdersJson, CodCliente, Status, CreatedAt)
                VALUES (@txId, @payUrl, @amount, @currency, @ordersJson, @codCliente, 'Creado', GETDATE())
            `);
        console.log(`${logPrefix} TransactionId ${transactionId} guardado en HandyTransactions.`);
    } catch (dbErr) {
        console.warn(`${logPrefix} No se pudo guardar TransactionId en BD:`, dbErr.message);
    }

    return { success: true, url: paymentUrl, transactionId };
}

module.exports = { createPaymentLink };
