'use strict';
/**
 * Cobro con tarjeta en el tótem (POSLink, F3 de docs/poslink-implementacion-plan.md). Montado en
 * server.js como /api/totem-pos. Sin usuario logueado: va con totemAuth (el token del tótem, el mismo
 * de las demás rutas) y ADEMÁS con la clave del POS de ese tótem (header X-Totem-Pos), que dice qué
 * terminal es la suya. Sin clave válida no hay cobro: no hay modo "abierto" como en totemAuth.
 *
 *   GET  /api/totem-pos/estado                      ¿este tótem cobra con tarjeta? (sin clave → pos: false)
 *   POST /api/totem-pos/cobros                      { clientId, orders } → crea el retiro y manda el cobro
 *   GET  /api/totem-pos/cobros/:uuid                un paso de poleo (la pantalla llama cada 2,5 s)
 *   GET  /api/totem-pos/cobros/:uuid/cfe            el e-Ticket del cobro, cuando DGI lo aceptó (para imprimirlo)
 *   POST /api/totem-pos/cobros/:uuid/cancelar       antes de que el POS tome la venta
 *   POST /api/totem-pos/cobros/:uuid/reintentar     mismo retiro, después de un cobro sin cobrar
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { totemAuth } = require('../middleware/totemAuth');
const pos = require('../services/poslink/poslinkService');
const totem = require('../services/poslink/poslinkTotemService');

const claveDe = (req) => String(req.get('X-Totem-Pos') || '').trim();

router.use(totemAuth);

router.get('/estado', async (req, res) => {
    try {
        if (!pos.estaConfigurado()) return res.json({ pos: false });
        const t = await totem.terminalPorClave(claveDe(req));
        return res.json(t ? { pos: true, terminal: t.PteEtiqueta } : { pos: false });
    } catch (e) {
        logger.error(`[POSLINK TÓTEM] estado: ${e.message}`);
        return res.json({ pos: false });
    }
});

// Desde acá, la clave del POS es obligatoria.
router.use(async (req, res, next) => {
    try {
        if (!pos.estaConfigurado()) return res.status(400).json({ success: false, error: 'El cobro con tarjeta no está configurado.' });
        const t = await totem.terminalPorClave(claveDe(req));
        if (!t) {
            logger.warn(`[POSLINK TÓTEM] Pedido sin clave de POS válida desde ${req.ip}`);
            return res.status(401).json({ success: false, error: 'Este tótem no tiene POS habilitado.' });
        }
        req.terminalTotem = t;
        return next();
    } catch (e) {
        logger.error(`[POSLINK TÓTEM] clave: ${e.message}`);
        return res.status(500).json({ success: false, error: 'No se pudo verificar el POS del tótem.' });
    }
});

function responderError(res, e, accion) {
    const retiro = e.retiro || null;
    if (e instanceof pos.CobroPosError) {
        const status = ['TERMINAL_OCUPADA', 'YA_EN_COBRO', 'ESTADO'].includes(e.codigo) ? 409
            : e.codigo === 'INEXISTENTE' ? 404 : 400;
        return res.status(status).json({ success: false, codigo: e.codigo, error: e.message, retiro });
    }
    logger.error(`[POSLINK TÓTEM] ${accion}: ${e.message}`);
    return res.status(500).json({ success: false, error: 'No se pudo cobrar con tarjeta.', retiro });
}

router.post('/cobros', async (req, res) => {
    try {
        const { clientId, orders } = req.body || {};
        const r = await totem.iniciarCobroTotem({ terminal: req.terminalTotem, clientId, orders });
        const io = req.app.get('socketio');
        if (io) {
            io.emit('actualizado', { type: 'actualizacion' });
            io.emit('retiros:update', { type: 'nuevo_retiro', ordenId: r.retiro.id, formaRetiro: 'RT' });
        }
        return res.status(201).json({ success: true, data: r.cobro, retiro: r.retiro });
    } catch (e) { return responderError(res, e, 'iniciar cobro'); }
});

router.get('/cobros/:uuid', async (req, res) => {
    try {
        const c = await totem.consultar({ terminal: req.terminalTotem, uuid: req.params.uuid });
        if (c?.estado === 'REGISTRADA') {
            const io = req.app.get('socketio');
            if (io) { io.emit('actualizado', { type: 'actualizacion' }); io.emit('retiros:update', { type: 'pago' }); }
        }
        return res.json({ success: true, data: c });
    } catch (e) { return responderError(res, e, 'consultar cobro'); }
});

// e-Ticket del cobro para imprimirlo en el tótem (INF-SIS-2026-18): { listo: false } hasta que DGI lo acepta.
router.get('/cobros/:uuid/cfe', async (req, res) => {
    try {
        const r = await totem.eTicketDelCobro({ terminal: req.terminalTotem, uuid: req.params.uuid });
        return res.json({ success: true, data: r });
    } catch (e) { return responderError(res, e, 'e-Ticket del cobro'); }
});

router.post('/cobros/:uuid/cancelar', async (req, res) => {
    try {
        const r = await totem.cancelar({ terminal: req.terminalTotem, uuid: req.params.uuid });
        return res.json({ success: true, cancelada: r.cancelada, motivo: r.motivo, data: r.cobro });
    } catch (e) { return responderError(res, e, 'cancelar cobro'); }
});

router.post('/cobros/:uuid/reintentar', async (req, res) => {
    try {
        const c = await totem.reintentar({ terminal: req.terminalTotem, uuid: req.params.uuid });
        return res.status(201).json({ success: true, data: c });
    } catch (e) { return responderError(res, e, 'reintentar cobro'); }
});

module.exports = router;
