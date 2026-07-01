const express = require('express');
const router = express.Router();
const receptionController = require('../controllers/receptionController');

// Rutas de Recepción / Atención al Cliente
router.get('/init-data', receptionController.getInitData);
router.post('/create', receptionController.createReception);
router.get('/history', receptionController.getHistory);
router.get('/orders-by-client', receptionController.getOrdersByClient);
router.get('/stock', receptionController.getStock);
router.get('/orders-for-fabric', receptionController.getPotentialOrdersForFabric);
router.post('/guardar-comprobante', receptionController.guardarComprobante);
router.get('/bobinas-by-orden/:orden',  receptionController.getBobinasByOrden);



module.exports = router;
