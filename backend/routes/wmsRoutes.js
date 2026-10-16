const express = require('express');
const router = express.Router();
const controller = require('../controllers/wmsController');
// const { verifyToken } = require('../middleware/authMiddleware'); // Omit verifyToken for easier testing right now or include it if requested. Let's include it.

const { verifyToken } = require('../middleware/authMiddleware');

router.get('/catalog', verifyToken, controller.getCatalog);
router.post('/sync', verifyToken, controller.syncCatalog);
router.post('/order', verifyToken, controller.createOrder);

// Pricing exceptions for variants

router.get('/exchange-rate', verifyToken, controller.getExchangeRate);

// [WMS] Vista de impresión A4 del pedido (formato remito) — sin verifyToken porque la
// carga el iframe de la Print Station (/print-station), que no puede mandar el JWT;
// mismo criterio que /orden/:id/etiquetas/print en productionFileRoutes.
router.get('/pedido/:pedidoId/remito-print', controller.printPedidoRemito);

module.exports = router;
