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

// Latido del monitor externo (herramientas/monitor-externo, en una PC de la oficina): sin login, con la clave
// MONITOR_EXTERNO_TOKEN en el header x-monitor-token. Va ANTES del router.use de abajo para que no pida sesión.
const crypto = require('crypto');
router.post('/monitor/latido-externo', (req, res) => {
    const clave = process.env.MONITOR_EXTERNO_TOKEN || '';
    if (clave.length < 16) return res.status(503).json({ error: 'Falta MONITOR_EXTERNO_TOKEN en el .env del servidor.' });
    const a = crypto.createHash('sha256').update(String(req.headers['x-monitor-token'] || '')).digest();
    const b = crypto.createHash('sha256').update(clave).digest();
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Clave inválida.' });
    require('../services/monitorService').registrarLatidoExterno({ pc: req.body?.pc, version: req.body?.version, ip: req.ip });
    res.json({ ok: true });
});

router.use(verifyToken, requireAdmin);

// Phase 1
router.get('/status', ctrl.getSystemStatus);
// Monitor en tiempo real (/admin/monitor): la última muestra; con ?historia=1, también las últimas 2 h
// Acciones del monitor (con confirmación en la pantalla; quedan en la auditoría): terminar un python de la lista de
// procesos y cortar una sesión de SQL que bloquea o tiene una transacción dormida
const accionMonitor = (fn) => async (req, res) => {
    try { res.json({ ok: true, mensaje: await fn(req) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
router.post('/monitor/terminar-proceso', accionMonitor(req => require('../services/monitorService').terminarProceso(req.body?.pid, req.user, req.ip)));
router.post('/monitor/cortar-sesion', accionMonitor(req => require('../services/monitorService').cortarSesionSql(req.body?.sesion, req.user, req.ip)));

// Historia guardada en disco (una muestra por minuto, 8 días): ?horas=24 o 168
router.get('/monitor/historia', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(require('../services/monitorService').leerHistoria(req.query.horas));
});
router.get('/monitor', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(require('../services/monitorService').snapshot({ conHistoria: req.query.historia === '1' }));
});
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
router.get('/backup/estado', ctrl.estadoBackup);
router.get('/client-errors', ctrl.getClientErrors);
router.get('/tables', ctrl.getTableInfo);
router.get('/tables/:tableName', ctrl.getTableColumns);
router.get('/audit', ctrl.getAuditTrail);

// ── CRON JOBS ─────────────────────────────────────────────────────────────────
const jobRegistry = require('../jobs/jobRegistry');

/** GET /api/sysadmin/cron – lista los jobs con su estado. Solo los que tienen función
 *  ejecutable: un registrar() sin setFn no aparece como tarjeta (ver jobRegistry). */
router.get('/cron', (req, res) => {
    res.json({ success: true, data: jobRegistry.getEjecutables() });
});

/** GET /api/sysadmin/cron/cuadre-saldos/detalle – última foto del cuadre nocturno de
 *  saldos con sus LISTAS (cuentas fuera del modelo, cargos ≠ total, documentos sin cargo,
 *  ajustes a mano, cobros dobles) y el histórico de contadores de los últimos 30 días.
 *  La foto la escribe backend/jobs/cuadreSaldos.job.js en dbo.CuadreSaldosDiario. */
router.get('/cron/cuadre-saldos/detalle', async (req, res) => {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const ult = await pool.request().query(`
            SELECT TOP 1 * FROM dbo.CuadreSaldosDiario WITH(NOLOCK) ORDER BY Corrida DESC`);
        if (!ult.recordset.length) {
            return res.json({ success: true, data: null, message: 'Todavía no hay ninguna corrida del cuadre. Ejecutá el job una vez.' });
        }
        const foto = ult.recordset[0];
        let detalle = null;
        try { detalle = foto.Detalle ? JSON.parse(foto.Detalle) : null; } catch { detalle = null; }
        const hist = await pool.request().query(`
            SELECT TOP 30 Fecha, Corrida, CuentasFueraDelModelo, DebeNoCuadra, DebeSinDocumento, AFavor, AFavorConDeuda,
                   CargoDistintoTotal, DocsSinCargo, ColumnaMal, FalsosPositivos, AjustesManuales24h, DobleCobro
            FROM dbo.CuadreSaldosDiario WITH(NOLOCK) ORDER BY Corrida DESC`);
        const { Detalle, ...contadores } = foto;
        res.json({ success: true, data: { contadores, detalle, historico: hist.recordset } });
    } catch (err) {
        // Sin tabla todavía (el job la crea en su primera corrida) → respuesta vacía, no error.
        if (/Invalid object name/i.test(err.message)) {
            return res.json({ success: true, data: null, message: 'Todavía no hay ninguna corrida del cuadre. Ejecutá el job una vez.' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
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

