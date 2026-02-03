const express = require('express');
const router = express.Router();
const controller = require('../controllers/pricesController');

// Rutas de Precios Base y Cálculo
router.get('/base', controller.getBasePrices);
router.post('/base', controller.saveBasePrice);
router.post('/base/bulk', controller.saveBasePricesBulk);
router.post('/calculate', controller.calculatePriceEndpoint);
router.get('/calculate', controller.debugPriceEndpoint);

module.exports = router;
