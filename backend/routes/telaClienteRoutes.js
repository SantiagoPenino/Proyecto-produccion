const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/telaClienteController');
const { verifyToken } = require('../middleware/authMiddleware');

// Saldo de metros por tipo de tela
router.get('/:clienteId/saldo',         verifyToken, ctrl.getSaldo);

// Estado de cuenta completo (extracto)
router.get('/:clienteId/estado-cuenta', verifyToken, ctrl.getEstadoCuenta);

// Devolución física de excedente — solicitar (bobina interna) + bandeja de aprobación
router.post('/:clienteId/bobinas/:bobinaId/solicitar', verifyToken, ctrl.solicitarDevolucion);
router.get('/bandeja',                                  verifyToken, ctrl.getBandeja);
router.get('/bandeja/para-empaquetar',                  verifyToken, ctrl.getParaEmpaquetar);
router.post('/bandeja/:tevId/aprobar',                  verifyToken, ctrl.aprobarEvento);
router.post('/bandeja/:tevId/rechazar',                 verifyToken, ctrl.rechazarEvento);
router.post('/bandeja/:tevId/entregada',                verifyToken, ctrl.marcarEntregada); // se le dio en mano
router.post('/bandeja/:tevId/empaquetar',               verifyToken, ctrl.empaquetarDevolucion);
router.post('/bandeja/:tevId/marcar-enviado',           verifyToken, ctrl.marcarAvisoEnviado);

module.exports = router;
