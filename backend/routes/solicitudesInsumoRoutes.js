const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/solicitudesInsumoController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Spec 39: solicitudes de insumo del cliente — bandeja de Atención al Cliente y Administración.
// Solo internos; las decisiones y la notificación quedan firmadas con el usuario logueado.
const ROLES = ['Admin', 'Administracion', 'Coordinador', 'Atención al Cliente', 'Atencion al Cliente', 'VENTAS'];
router.get('/', verifyToken, soloInternoConRol(), ctrl.listar);
router.get('/abiertas-cliente', verifyToken, soloInternoConRol(), ctrl.abiertasCliente);
router.get('/:id', verifyToken, soloInternoConRol(), ctrl.detalle);
router.post('/:id/notificar', verifyToken, soloInternoConRol(ROLES), ctrl.notificar);
router.post('/:id/decision', verifyToken, soloInternoConRol(ROLES), ctrl.decidir);
router.post('/:id/vincular-pre', verifyToken, soloInternoConRol(), ctrl.vincularPre);

module.exports = router;
