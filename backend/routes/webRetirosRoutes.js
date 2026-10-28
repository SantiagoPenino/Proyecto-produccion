const express = require('express');
const router = express.Router();
const webRetirosController = require('../controllers/webRetirosController');

// 👇 Middleware
const { verifyToken } = require('../middleware/authMiddleware');
const { conReintentoDeadlock } = require('../utils/reintentarDeadlock');

// RUTAS API PARA LA TABLA RETIROSWEB
router.post('/ingresar', verifyToken, webRetirosController.crearRetiro);
router.post('/sincronizar', verifyToken, webRetirosController.sincronizarRetirosWeb);
router.post('/pay-link', verifyToken, webRetirosController.createHandyPaymentLinkForRetiro);
router.post('/payment', verifyToken, webRetirosController.createHandyPaymentLinkForRetiro);
router.get('/locales', verifyToken, webRetirosController.getAllLocalRetiros);
router.get('/mis-retiros', verifyToken, webRetirosController.getMyRetirosPendientes);
router.get('/mis-retiros/historial', verifyToken, webRetirosController.getMyRetirosHistorial);
router.get('/pagos-online', verifyToken, webRetirosController.getPagosOnline);
router.get('/historial-pagos', verifyToken, webRetirosController.getHistorialPagos);
router.get('/pagos-online-fallidos', verifyToken, webRetirosController.getPagosOnlineFallidos);
router.get('/pagos-mp', verifyToken, webRetirosController.getPagosMp);
router.get('/pagos-mp-fallidos', verifyToken, webRetirosController.getPagosMpFallidos);
router.get('/cuadre-diario', verifyToken, webRetirosController.getCuadreDiario);

// RUTAS API PARA ESTANTES FÍSICOS
router.get('/estantes', verifyToken, webRetirosController.obtenerMapaEstantes);
router.post('/estantes/asignar', verifyToken, webRetirosController.asignarRetiroAEstante);
router.delete('/estantes/desasignar', verifyToken, webRetirosController.desasignarRetiroDeEstante);
router.post('/estantes/mover', verifyToken, webRetirosController.moverRetiroEntreEstantes);
// [26/10] Reintento ante deadlock: la entrega libera el estante y puede chocar con otra entrega a la vez.
// La múltiple reintenta retiro por retiro adentro del handler.
router.delete('/estantes/liberar/:ubicacionId', verifyToken, conReintentoDeadlock(webRetirosController.marcarRetiroEntregado));
router.post('/estantes/liberar-multiple', verifyToken, webRetirosController.marcarRetiroEntregadoMultiple);

router.post('/excepcional', verifyToken, webRetirosController.marcarExcepcional);
router.get('/excepciones', verifyToken, webRetirosController.getExcepciones);
router.put('/excepciones/:id/gestionar', verifyToken, webRetirosController.gestionarExcepcion);

router.get('/:oreId/bultos', verifyToken, webRetirosController.getBultosRetiro);
router.post('/anular/:id', verifyToken, webRetirosController.anularRetiro);

module.exports = router;
