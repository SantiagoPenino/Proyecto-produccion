const express = require('express');
const router = express.Router();
const auditDepositoController = require('../controllers/auditDepositoController');
const casosController = require('../controllers/auditDepositoCasosController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

// Este módulo es INTERNO. Antes cualquier JWT válido (incluido el de un cliente del portal) podía
// llamar /actions y marcar órdenes como entregadas. Se bloquea todo token que NO sea interno;
// los tokens internos viejos (sin userType) siguen entrando para no cortar al personal del depósito.
const soloNoCliente = (req, res, next) => {
    const u = req.user || {};
    const esCliente = u.userType === 'CLIENT' || u.role === 'WEB_CLIENT' || u.codCliente != null
        || (u.userType && u.userType !== 'INTERNAL');
    if (esCliente) return res.status(403).json({ success: false, error: 'La auditoría de depósito es exclusiva del sistema interno.' });
    next();
};
router.use(soloNoCliente);

router.post('/check', auditDepositoController.checkAudit);
router.post('/actions', auditDepositoController.performAction);
router.post('/notify', auditDepositoController.notifyAction);

// Endpoint unificado de carga inicial (liveCodes + auditData en un solo request)
router.get('/init', auditDepositoController.initAudit);

// Endpoints para persistencia de escaneo temporal en DB
// (con una auditoría ABIERTA trabajan contra la sesión, no contra AuditoriaScansTemp)
router.get('/live', auditDepositoController.getLiveScans);
router.post('/live', auditDepositoController.addLiveScan);
router.post('/live/remove', auditDepositoController.removeLiveScan);
router.post('/live/clear', auditDepositoController.clearLiveScans);

// ── Sesión de auditoría: fotografía al abrir, motor de fusión al cerrar ──
router.get('/sesion', casosController.getSesion);
router.get('/prefijos', casosController.getPrefijos);
router.post('/sesion/abrir', casosController.abrirSesion);
router.post('/sesion/cerrar', casosController.cerrarSesion);
router.post('/sesion/anular', casosController.anularSesion);

// ── Historial de auditorías (la fotografía de cada una queda guardada) ──
router.get('/auditorias', casosController.listarAuditorias);
router.get('/auditorias/:id', casosController.getAuditoria);

// ── Reportes (Fase 4), conteo cíclico (Fase 5) y usuarios para asignar ──
router.get('/reportes', casosController.getReporte);
router.get('/ciclico', casosController.getCiclico);
router.get('/usuarios', casosController.getUsuarios);

// ── Registro permanente de casos ──
router.get('/casos', casosController.listarCasos);
router.post('/casos/accion-lote', casosController.accionLote); // antes de /casos/:id
router.get('/casos/:id', casosController.getCaso);
router.post('/casos/:id/accion', casosController.accionCaso);

module.exports = router;
