const express = require('express');
const router = express.Router();
const controller = require('../controllers/logisticsController');

router.get('/cart-candidates', controller.getOrdersForCart); // ?area=DTF
router.post('/dispatch', controller.createDispatch);

module.exports = router;