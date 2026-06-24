const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/sysadminController');

// Middleware: solo admins (case-insensitive, acepta variantes)
const ADMIN_ROLES = ['admin', 'administrador', 'sysadmin'];
const requireAdmin = (req, res, next) => {
    const role = (req.user?.role || '').toLowerCase().trim();
    if (!req.user || !ADMIN_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere rol admin.' });
    }
    next();
};

router.use(verifyToken, requireAdmin);

// Phase 1
router.get('/status', ctrl.getSystemStatus);
router.get('/logs', ctrl.getLogFiles);
router.get('/logs/:filename', ctrl.getLogContent);
router.post('/clear-logs', ctrl.clearLogs);
router.get('/metrics', ctrl.getDailyMetrics);
router.get('/slow-queries', ctrl.getSlowQueries);

// Phase 2
router.get('/sessions', ctrl.getSessions);
router.delete('/sessions/:userId', ctrl.killSession);
router.post('/sql', ctrl.executeSql);
router.post('/restart', ctrl.restartServer);
router.post('/maintenance', ctrl.broadcastMaintenance);

// Phase 3
router.get('/services', ctrl.testServices);
router.post('/backup', ctrl.backupDatabase);
router.get('/client-errors', ctrl.getClientErrors);
router.get('/tables', ctrl.getTableInfo);
router.get('/tables/:tableName', ctrl.getTableColumns);
router.get('/audit', ctrl.getAuditTrail);

// ── CRON JOBS ─────────────────────────────────────────────────────────────────
const jobRegistry = require('../jobs/jobRegistry');

/** GET /api/sysadmin/cron – lista todos los jobs con su estado */
router.get('/cron', (req, res) => {
    res.json({ success: true, data: jobRegistry.getAll() });
});

/** POST /api/sysadmin/cron/:jobId/ejecutar – dispara un job manualmente */
router.post('/cron/:jobId/ejecutar', async (req, res) => {
    const { jobId } = req.params;
    try {
        // Fire and forget — responde inmediato, el job corre en background
        jobRegistry.ejecutarManual(jobId)
            .then(() => {})
            .catch(e => console.error(`[CRON-MANUAL] Error en ${jobId}:`, e.message));
        res.json({ success: true, message: `Job "${jobId}" iniciado en background.` });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;

