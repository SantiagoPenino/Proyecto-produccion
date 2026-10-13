'use strict';
/**
 * Pago con MercadoPago desde el tótem (QR con el link de pago). Montado en server.js como /api/totem-mp,
 * con totemAuth como las demás rutas del tótem. Ver services/totemMpService.js.
 *
 *   GET  /api/totem-mp/estado          ¿el tótem ofrece MercadoPago? (hay credenciales)
 *   POST /api/totem-mp/pagos           { clientId, orders } → crea el retiro y el link (el tótem lo muestra como QR)
 *   GET  /api/totem-mp/pagos/:txId     cómo va el pago (el tótem consulta cada 3 s)
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { totemAuth } = require('../middleware/totemAuth');
const pos = require('../services/poslink/poslinkService');
const mp = require('../services/totemMpService');

router.use(totemAuth);

router.get('/estado', (req, res) => res.json({ mp: mp.estaConfigurado() }));

router.post('/pagos', async (req, res) => {
    try {
        if (!mp.estaConfigurado()) return res.status(400).json({ success: false, error: 'MercadoPago no está configurado.' });
        const { clientId, orders } = req.body || {};
        const r = await mp.iniciarPagoMp({ clientId, orders });
        const io = req.app.get('socketio');
        if (io) {
            io.emit('actualizado', { type: 'actualizacion' });
            io.emit('retiros:update', { type: 'nuevo_retiro', ordenId: r.retiro.id, formaRetiro: 'RT' });
        }
        return res.status(201).json({ success: true, data: r });
    } catch (e) {
        const retiro = e.retiro || null;
        if (e instanceof pos.CobroPosError) return res.status(400).json({ success: false, codigo: e.codigo, error: e.message, retiro });
        logger.error(`[MP TÓTEM] iniciar pago: ${e.message}`);
        return res.status(500).json({ success: false, error: 'No se pudo generar el pago con MercadoPago.', retiro });
    }
});

router.get('/pagos/:txId', async (req, res) => {
    try {
        const r = await mp.estadoPagoMp(req.params.txId, req.app);
        if (!r) return res.status(404).json({ success: false, error: 'Pago inexistente.' });
        return res.json({ success: true, data: r });
    } catch (e) {
        logger.error(`[MP TÓTEM] estado: ${e.message}`);
        return res.status(500).json({ success: false, error: 'No se pudo consultar el pago.' });
    }
});

module.exports = router;
