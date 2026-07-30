const express = require('express');
const router = express.Router();
const controller = require('../controllers/ecoUvFinishingController');

router.get('/orders', controller.getFinishingOrders);
router.get('/orders/:id/details', controller.getOrderDetails);
router.put('/items/:itemId', controller.updateExtraItem); // update quantity
router.put('/terminaciones/:id/estado', controller.updateTerminacionEstado); // Pendiente | Hecha
router.post('/orders/:id/control', controller.controlOrder);
router.put('/archivos/:archivoId/control-copias', controller.updateControlCopiasArchivo); // copias controladas POR ARCHIVO (control de terminaciones)

module.exports = router;
