const express = require('express');
const router = express.Router();
const controller = require('../controllers/ecoUvFinishingController');

router.get('/orders', controller.getFinishingOrders);
router.get('/orders/:id/details', controller.getOrderDetails);
router.put('/items/:itemId', controller.updateExtraItem); // update quantity
router.post('/orders/:id/control', controller.controlOrder);

module.exports = router;
