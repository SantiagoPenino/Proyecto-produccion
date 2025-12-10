const express = require('express');
const router = express.Router();
const controller = require('../controllers/ordersController');

// GET /api/orders (Obtener todas las órdenes o filtrar por ?area=DTF)
router.get('/', controller.getOrdersByArea);
router.post('/', controller.createOrder);
router.get('/priorities', controller.getPrioritiesConfig);
router.post('/assign-roll', controller.assignRoll); // POST /api/orders/assign-roll
router.put('/files/update', controller.updateFile);
router.post('/files/add', controller.addFile);
router.delete('/files/:id', controller.deleteFile);
module.exports = router;