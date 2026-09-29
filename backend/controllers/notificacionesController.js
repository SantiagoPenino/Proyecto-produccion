// ─────────────────────────────────────────────────────────────────────────────
// Campanita del sistema interno: avisos por usuario + activar push en el celular.
// Ver services/notificacionesService.js.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const push = require('../services/pushNotificationService');

const faltanTablas = (err) => err?.number === 208; // Invalid object name

// GET /api/notificaciones → últimos 40 avisos del usuario + cantidad sin leer
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('U', sql.Int, req.user.id).query(`
            SELECT TOP 40 NotId, Modulo, Titulo, Texto, Url, Leida, Fecha
            FROM dbo.NotificacionesUsuario WITH (NOLOCK)
            WHERE UsuarioId = @U
            ORDER BY Fecha DESC;
            SELECT COUNT(*) AS SinLeer FROM dbo.NotificacionesUsuario WITH (NOLOCK) WHERE UsuarioId = @U AND Leida = 0;
        `);
        res.json({ success: true, data: r.recordsets[0], sinLeer: r.recordsets[1][0]?.SinLeer || 0 });
    } catch (err) {
        // Sin las tablas (script sin correr) la campanita queda vacía en vez de dar error.
        if (faltanTablas(err)) return res.json({ success: true, data: [], sinLeer: 0 });
        logger.error(`[Notificaciones] listar: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/notificaciones/:id/leida
exports.marcarLeida = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Aviso inválido.' });
    try {
        const pool = await getPool();
        await pool.request().input('Id', sql.Int, id).input('U', sql.Int, req.user.id).query(`
            UPDATE dbo.NotificacionesUsuario SET Leida = 1, FechaLeida = GETDATE()
            WHERE NotId = @Id AND UsuarioId = @U AND Leida = 0
        `);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[Notificaciones] marcarLeida: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/notificaciones/leer-todas
exports.marcarTodas = async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request().input('U', sql.Int, req.user.id).query(`
            UPDATE dbo.NotificacionesUsuario SET Leida = 1, FechaLeida = GETDATE()
            WHERE UsuarioId = @U AND Leida = 0
        `);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[Notificaciones] marcarTodas: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/notificaciones/push/suscribir { subscription, dispositivo }
exports.suscribirPush = async (req, res) => {
    try {
        const { subscription, dispositivo } = req.body || {};
        if (!subscription?.endpoint) return res.status(400).json({ success: false, error: 'Suscripción inválida.' });
        await push.subscribeInterno(req.user.id, subscription, dispositivo);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[Notificaciones] suscribirPush: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/notificaciones/push/desuscribir { endpoint }
exports.desuscribirPush = async (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (!endpoint) return res.status(400).json({ success: false, error: 'Falta el endpoint.' });
        await push.unsubscribeInterno(req.user.id, endpoint);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[Notificaciones] desuscribirPush: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/notificaciones/push/probar → push de prueba a los dispositivos del usuario
exports.probarPush = async (req, res) => {
    if (!push.VAPID_PUBLIC) return res.status(503).json({ success: false, error: 'Las notificaciones push no están configuradas en el servidor.' });
    await push.sendToUsuariosInternos([req.user.id], {
        title: 'Avisos activados',
        body: 'Así te van a llegar los avisos del sistema a este dispositivo.',
        url: '/',
        tag: 'prueba-avisos',
    });
    res.json({ success: true });
};
