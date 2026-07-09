const webpush = require('web-push');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ── VAPID Config ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@user.com.uy';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
    logger.info('[WebPush] ✅ VAPID keys configuradas.');
} else {
    logger.warn('[WebPush] ⚠️ VAPID keys no configuradas. Push notifications deshabilitadas.');
}

// ── Ensure Table ─────────────────────────────────────────────────────────────
async function ensureTable() {
    const pool = await getPool();
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PushSubscriptions')
        BEGIN
            CREATE TABLE PushSubscriptions (
                Id INT IDENTITY PRIMARY KEY,
                ClienteWebID INT NOT NULL,
                Endpoint NVARCHAR(500) NOT NULL,
                KeysP256dh NVARCHAR(200),
                KeysAuth NVARCHAR(100),
                CreatedAt DATETIME DEFAULT GETDATE(),
                CONSTRAINT UQ_Push_Endpoint UNIQUE(Endpoint)
            );
            CREATE INDEX IX_Push_Cliente ON PushSubscriptions(ClienteWebID);
        END
    `);
}

// Init table on load
ensureTable().catch(err => logger.error('[WebPush] Error creating table:', err.message));

// ── Subscribe ────────────────────────────────────────────────────────────────
async function subscribe(clientId, subscription) {
    const pool = await getPool();

    // Upsert: si el endpoint ya existe, actualizamos
    await pool.request()
        .input('ClienteWebID', sql.Int, clientId)
        .input('Endpoint', sql.NVarChar(500), subscription.endpoint)
        .input('P256dh', sql.NVarChar(200), subscription.keys?.p256dh || '')
        .input('Auth', sql.NVarChar(100), subscription.keys?.auth || '')
        .query(`
            IF EXISTS (SELECT 1 FROM PushSubscriptions WHERE Endpoint = @Endpoint)
                UPDATE PushSubscriptions SET ClienteWebID = @ClienteWebID, KeysP256dh = @P256dh, KeysAuth = @Auth, CreatedAt = GETDATE() WHERE Endpoint = @Endpoint
            ELSE
                INSERT INTO PushSubscriptions (ClienteWebID, Endpoint, KeysP256dh, KeysAuth) VALUES (@ClienteWebID, @Endpoint, @P256dh, @Auth)
        `);

    logger.info(`[WebPush] Suscripción guardada para cliente ${clientId}`);
}

// ── Unsubscribe ──────────────────────────────────────────────────────────────
async function unsubscribe(clientId, endpoint) {
    const pool = await getPool();
    await pool.request()
        .input('ClienteWebID', sql.Int, clientId)
        .input('Endpoint', sql.NVarChar(500), endpoint)
        .query(`DELETE FROM PushSubscriptions WHERE ClienteWebID = @ClienteWebID AND Endpoint = @Endpoint`);

    logger.info(`[WebPush] Suscripción eliminada para cliente ${clientId}`);
}

// ── Send to Client ───────────────────────────────────────────────────────────
// tag: agrupa notificaciones (mismo tag = se reemplazan; distinto = conviven).
// actions: botones [{ action, title }] (máx 2). actionUrls: { [action]: url } destino de cada botón.
async function sendToClient(clientId, { title, body, icon, url, tag, actions, actionUrls }) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // Push deshabilitado

    const pool = await getPool();
    const result = await pool.request()
        .input('ClienteWebID', sql.Int, clientId)
        .query(`SELECT Endpoint, KeysP256dh, KeysAuth FROM PushSubscriptions WHERE ClienteWebID = @ClienteWebID`);

    logger.info(`[WebPush Debug] Buscando suscripciones para ClienteWebID=${clientId}... Encontrados: ${result.recordset.length}`);

    if (result.recordset.length === 0) return;

    const payload = JSON.stringify({
        title: title || 'Notificación',
        body: body || '',
        icon: icon || '/assets/images/pwa.png',
        url: url || '/portal/pickup',
        tag: tag || undefined,
        actions: Array.isArray(actions) && actions.length ? actions.slice(0, 2) : undefined,
        actionUrls: actionUrls || undefined,
    });

    for (const sub of result.recordset) {
        const pushSubscription = {
            endpoint: sub.Endpoint,
            keys: { p256dh: sub.KeysP256dh, auth: sub.KeysAuth },
        };

        try {
            await webpush.sendNotification(pushSubscription, payload);
            logger.info(`[WebPush Debug] Notificación enviada con éxito a Endpoint: ${sub.Endpoint.substring(0, 30)}...`);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Suscripción expirada, eliminar
                await pool.request()
                    .input('Endpoint', sql.NVarChar(500), sub.Endpoint)
                    .query(`DELETE FROM PushSubscriptions WHERE Endpoint = @Endpoint`);
                logger.info(`[WebPush] Suscripción expirada eliminada: ${sub.Endpoint.substring(0, 50)}...`);
            } else {
                logger.error(`[WebPush] Error enviando push: ${err.message}`);
            }
        }
    }
}

// ── Send to Order's Client (by orderId) ──────────────────────────────────────
// Looks up the CodCliente + CodigoOrden via order, then sends push
// Supports {code} placeholder in title/body for the CodigoOrden
async function sendToOrderClient(orderId, { title, body, icon, url, tag, actions, actionUrls }) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('OID', sql.Int, orderId)
            .query(`
                SELECT c.CodCliente, o.CodigoOrden
                FROM Ordenes o
                INNER JOIN Clientes c ON
                    (COL_LENGTH('Ordenes', 'CliIdCliente') IS NOT NULL AND o.CliIdCliente = c.CliIdCliente) OR
                    (o.Cliente = c.Nombre) OR
                    (LTRIM(RTRIM(o.Cliente)) = LTRIM(RTRIM(c.Nombre)))
                WHERE o.OrdenID = @OID
            `);

        const row = result.recordset[0];
        if (!row?.CodCliente) {
            logger.warn(`[WebPush] No se encontró cliente asociado a la Orden ${orderId}. Verificá espacios en el nombre o CliIdCliente.`);
            return;
        }

        const code = row.CodigoOrden || `#${orderId}`;
        const finalTitle = (title || '').replace(/\{code\}/g, code);
        const finalBody = (body || '').replace(/\{code\}/g, code);

        await sendToClient(row.CodCliente, {
            title: finalTitle,
            body: finalBody,
            icon,
            url,
            // Tag por pedido: avisos del MISMO pedido se reemplazan; de pedidos distintos conviven
            tag: tag || `orden-${code}`,
            actions,
            actionUrls,
        });
    } catch (err) {
        logger.error(`[WebPush] Error sendToOrderClient(${orderId}):`, err.message);
    }
}

module.exports = { subscribe, unsubscribe, sendToClient, sendToOrderClient, VAPID_PUBLIC };
