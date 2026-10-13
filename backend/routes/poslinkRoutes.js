'use strict';
/**
 * Cobro con tarjeta integrado (POSLink) desde la caja — F2 de docs/poslink-implementacion-plan.md.
 * Se monta en contabilidadRoutes como /caja/pos, así que hereda verifyToken + soloInternoConRol:
 * solo usuarios internos. El tótem (F3) va a tener sus propias rutas con totemAuth.
 *
 *   GET  /caja/pos/terminales          terminales de caja habilitadas (vacío = no se ofrece el POS)
 *   POST /caja/pos/cobros              arranca: { terminal, header, aplicaciones, pagos, posIndex, empresaId }
 *   GET  /caja/pos/cobros/:uuid        un paso de poleo contra Resonet + estado para la pantalla.
 *                                      La pantalla lo llama cada 2,5 s (entre 2 y 3 s, SPEC p.29).
 *   POST /caja/pos/cobros/:uuid/cancelar         antes de que el POS tome la venta
 *   POST /caja/pos/cobros/:uuid/cerrar-sin-cobro pedido de autorización / billetera, sin cobro
 *   GET  /caja/pos/revisar             casos trabados que esperan a una persona
 *   POST /caja/pos/cobros/:uuid/resolver         { estadoFinal, nota } → los cierra (resolverManual)
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const pos = require('../services/poslink/poslinkService');

const io = (req) => req.app?.get('socketio');

function responderError(res, e, accion) {
    if (e instanceof pos.CobroPosError) {
        const status = ['TERMINAL_OCUPADA', 'YA_EN_COBRO', 'ESTADO'].includes(e.codigo) ? 409
            : e.codigo === 'INEXISTENTE' || e.codigo === 'TERMINAL_INEXISTENTE' ? 404 : 400;
        return res.status(status).json({ success: false, codigo: e.codigo, error: e.message });
    }
    logger.error(`[POSLINK] ${accion}: ${e.message}`);
    return res.status(500).json({ success: false, error: e.message });
}

router.get('/terminales', async (req, res) => {
    try {
        if (!pos.estaConfigurado()) return res.json({ success: true, data: [] });
        return res.json({ success: true, data: await pos.terminalesCaja() });
    } catch (e) { return responderError(res, e, 'terminales'); }
});

router.post('/cobros', async (req, res) => {
    try {
        if (!pos.estaConfigurado()) return res.status(400).json({ success: false, error: 'El cobro con POS no está configurado en este servidor.' });
        const { terminal, header, aplicaciones, pagos, posIndex, empresaId } = req.body || {};
        const r = await pos.iniciarCobroCaja({
            terminal, header, aplicaciones, pagos, posIndex: Number(posIndex),
            usuarioId: req.user.id,
            empresaId: empresaId || req.user?.empresaId || null,
        });
        return res.status(201).json({ success: true, data: pos.estadoPublico(await pos.obtenerCobro({ uuid: r.uuid })) });
    } catch (e) { return responderError(res, e, 'iniciar cobro'); }
});

router.get('/cobros/:uuid', async (req, res) => {
    try {
        const antes = await pos.obtenerCobro({ uuid: req.params.uuid });
        if (!antes) return res.status(404).json({ success: false, error: 'Cobro inexistente.' });
        const f = await pos.polear({ uuid: req.params.uuid });
        if (f && f.PtxEstado === 'REGISTRADA' && antes.PtxEstado !== 'REGISTRADA') {
            const s = io(req); if (s) { s.emit('actualizado', { type: 'actualizacion' }); s.emit('retiros:update', { type: 'pago' }); }
        }
        return res.json({ success: true, data: pos.estadoPublico(f) });
    } catch (e) { return responderError(res, e, 'consultar cobro'); }
});

router.post('/cobros/:uuid/cancelar', async (req, res) => {
    try {
        const r = await pos.cancelar({ uuid: req.params.uuid });
        if (!r) return res.status(404).json({ success: false, error: 'Cobro inexistente.' });
        return res.json({ success: true, cancelada: r.cancelada, motivo: r.motivo || null, data: pos.estadoPublico(r.fila) });
    } catch (e) { return responderError(res, e, 'cancelar cobro'); }
});

// ── Anulación / devolución de una venta con tarjeta (F4) ──
// GET  /caja/pos/ventas?dias=7       ventas con tarjeta registradas (con lo ya devuelto de cada una)
// POST /caja/pos/reversiones         { uuidVenta, monto?, motivo } → anulación (lote abierto) o devolución
//                                    (lote cerrado), según el lote del POS. Se sigue con GET /cobros/:uuid.
router.get('/ventas', async (req, res) => {
    try {
        if (!pos.estaConfigurado()) return res.json({ success: true, data: [] });
        const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 60);
        return res.json({ success: true, data: await pos.ventasAnulables({ dias }) });
    } catch (e) { return responderError(res, e, 'ventas con tarjeta'); }
});

router.post('/reversiones', async (req, res) => {
    try {
        const { uuidVenta, monto, motivo } = req.body || {};
        const montoCentesimos = monto != null && monto !== '' ? Math.round(Number(monto) * 100) : null;
        const r = await pos.iniciarReversion({ uuidVenta, montoCentesimos, usuarioId: req.user.id, motivo });
        return res.status(201).json({ success: true, data: pos.estadoPublico(await pos.obtenerCobro({ uuid: r.uuid })) });
    } catch (e) { return responderError(res, e, 'anular/devolver'); }
});

router.post('/cobros/:uuid/cerrar-sin-cobro', async (req, res) => {
    try {
        const f = await pos.cerrarSinCobro({ uuid: req.params.uuid, usuarioId: req.user.id });
        return res.json({ success: true, data: pos.estadoPublico(f) });
    } catch (e) { return responderError(res, e, 'cerrar sin cobro'); }
});

// ── Casos trabados (en duda, cobrado sin registrar, reversa sin confirmar…) ──
router.get('/revisar', async (req, res) => {
    try {
        if (!pos.estaConfigurado()) return res.json({ success: true, data: [] });
        return res.json({ success: true, data: await pos.casosParaRevisar() });
    } catch (e) { return responderError(res, e, 'casos para revisar'); }
});

router.post('/cobros/:uuid/resolver', async (req, res) => {
    const { estadoFinal, nota } = req.body || {};
    const texto = String(nota || '').trim();
    if (texto.length < 5) return res.status(400).json({ success: false, error: 'Escribí qué verificaste (POS, banco, voucher…).' });
    try {
        const f = await pos.resolverManual({ uuid: req.params.uuid, estadoFinal: String(estadoFinal || '').toUpperCase(), usuarioId: req.user.id, nota: texto.slice(0, 300) });
        const s = io(req); if (s) { s.emit('actualizado', { type: 'actualizacion' }); s.emit('retiros:update', { type: 'pago' }); }
        return res.json({ success: true, data: pos.estadoPublico(f) });
    } catch (e) {
        if (e instanceof pos.CobroPosError) return responderError(res, e, 'resolver caso');
        // resolverManual tira Error común para estados o destinos no permitidos: es un 400, no un 500.
        logger.warn(`[POSLINK] resolver ${req.params.uuid}: ${e.message}`);
        return res.status(400).json({ success: false, error: e.message });
    }
});

module.exports = router;
