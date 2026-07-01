const express = require('express');
const router = express.Router();
const controller = require('../controllers/wmsController');
// const { verifyToken } = require('../middleware/authMiddleware'); // Omit verifyToken for easier testing right now or include it if requested. Let's include it.

const { verifyToken } = require('../middleware/authMiddleware');

router.get('/catalog', verifyToken, controller.getCatalog);
router.post('/sync', verifyToken, controller.syncCatalog);
router.post('/order', verifyToken, controller.createOrder);
router.get('/images/:idproid', verifyToken, controller.getImages);
router.put('/location/:idproid', verifyToken, controller.updateLocation);

// Pricing exceptions for variants
router.get('/master/:idproid/variants', verifyToken, controller.getMasterVariants);
router.put('/variants/:wms_variante_id/price', verifyToken, controller.updateVariantPrice);

router.get('/exchange-rate', verifyToken, controller.getExchangeRate);

module.exports = router;
