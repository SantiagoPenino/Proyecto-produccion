const express = require('express');
const router = express.Router();
const receptionController = require('../controllers/receptionController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos (19/10): no tenía login. Lo usan solo Recepción y Despachos (atención al
// cliente). De paso, /create registra el usuario real en vez del 1 por defecto.
router.use(verifyToken, soloInternoConRol());

// Rutas de Recepción / Atención al Cliente
router.get('/init-data', receptionController.getInitData);
router.post('/create', receptionController.createReception);
router.get('/history', receptionController.getHistory);
router.get('/orders-by-client', receptionController.getOrdersByClient);
router.get('/stock', receptionController.getStock);
router.get('/orders-for-fabric', receptionController.getPotentialOrdersForFabric);
router.get('/bobinas-by-orden/:orden',  receptionController.getBobinasByOrden);



module.exports = router;
