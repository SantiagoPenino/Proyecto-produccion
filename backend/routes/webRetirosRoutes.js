const express = require('express');
const router = express.Router();
const webRetirosController = require('../controllers/webRetirosController');

// 👇 Middleware
const { verifyToken } = require('../middleware/authMiddleware');

// RUTAS API PARA LA TABLA RETIROSWEB
router.post('/ingresar', verifyToken, webRetirosController.crearRetiro);
router.post('/sincronizar', verifyToken, webRetirosController.sincronizarRetirosWeb);
router.post('/pay-link', verifyToken, webRetirosController.createHandyPaymentLinkForRetiro);
router.post('/payment', verifyToken, webRetirosController.createHandyPaymentLinkForRetiro);
router.get('/locales', verifyToken, webRetirosController.getAllLocalRetiros);
router.get('/mis-retiros', verifyToken, webRetirosController.getMyRetirosPendientes);
router.get('/pagos-online', verifyToken, webRetirosController.getPagosOnline);

// RUTAS API PARA ESTANTES FÍSICOS
router.get('/estantes', verifyToken, webRetirosController.obtenerMapaEstantes);
router.post('/estantes/asignar', verifyToken, webRetirosController.asignarRetiroAEstante);
router.delete('/estantes/liberar/:ubicacionId', verifyToken, webRetirosController.marcarRetiroEntregado);
router.post('/estantes/liberar-multiple', verifyToken, webRetirosController.marcarRetiroEntregadoMultiple);

router.post('/excepcional', verifyToken, webRetirosController.marcarExcepcional);
router.get('/excepciones', verifyToken, webRetirosController.getExcepciones);
router.put('/excepciones/:id/gestionar', verifyToken, webRetirosController.gestionarExcepcion);

module.exports = router;
