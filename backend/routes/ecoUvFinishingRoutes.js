const express = require('express');
const router = express.Router();
const controller = require('../controllers/ecoUvFinishingController');
// Sin verifyToken req.user llega vacío y todos los cambios de estado del área
// quedaban firmados como "Sistema" en el historial, en vez del operario logueado.
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/orders', verifyToken, controller.getFinishingOrders);
router.get('/orders/:id/details', verifyToken, controller.getOrderDetails);
router.put('/items/:itemId', verifyToken, controller.updateExtraItem); // update quantity
router.put('/terminaciones/:id/estado', verifyToken, controller.updateTerminacionEstado); // Pendiente | Hecha
router.post('/orders/:id/control', verifyToken, controller.controlOrder);
router.put('/archivos/:archivoId/control-copias', verifyToken, controller.updateControlCopiasArchivo); // copias controladas POR ARCHIVO (control de terminaciones)
router.post('/orders/:id/confirmar-magnitudes', verifyToken, controller.confirmarMagnitudes);          // cantidades reales del taller -> actualiza la cotización

module.exports = router;
