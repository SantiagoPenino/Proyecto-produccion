const express = require('express');
const router = express.Router();
const productionController = require('../controllers/productionController');
const { verifyToken } = require('../middleware/authMiddleware');

// Kanban y Asignación
router.get('/board', productionController.getProductionBoard);
// NOTA: '/assign' (productionController.assignRoll) eliminado — endpoint huérfano (el front usa /production-kanban/assign).
router.post('/toggle-status', verifyToken, productionController.toggleRollStatus);
router.get('/details', productionController.getOrderDetails);

// Control de Calidad
router.get('/ready-for-control', productionController.getRollAndFiles);
router.post('/register-action', verifyToken, productionController.registerFileAction);

// Compatibilidad con Tabla
router.get('/board-data', productionController.getBoardData);
router.post('/move-order', verifyToken, productionController.moveOrder);
router.post('/create-roll', verifyToken, productionController.createRoll);
router.post('/magic-sort', verifyToken, productionController.magicSort);

// Etiqueta térmica del lote finalizado (se carga en un iframe oculto → sin verifyToken, igual que las etiquetas de orden)
router.get('/rollo/:id/etiqueta-lote/print', productionController.printEtiquetaLote);

module.exports = router;