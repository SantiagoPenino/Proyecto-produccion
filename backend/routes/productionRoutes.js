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

module.exports = router;