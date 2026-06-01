const express = require('express');
const router = express.Router();
const controller = require('../controllers/rollsController'); // 👈 Aquí se llama "controller"
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/board', controller.getBoardData);
router.get('/list', controller.getRollosActivos); // Endpoint específico para combo
router.post('/move', controller.moveOrder);
router.post('/create', verifyToken, controller.createRoll);
router.post('/reorder', controller.reorderOrders);

// 👇 CORREGIDO: Debe decir "controller" (singular), igual que arriba
router.post('/update-name', controller.updateRollName);
router.post('/update', controller.updateRollGeneral); // ✅ Nueva ruta genérica
router.post('/swap-bobina', controller.swapBobina); // ✅ Relevo de Bobina
router.post('/split', controller.splitRoll); // ✅ Corte de Lote (Split)
router.post('/dismantle', controller.dismantleRoll);
router.get('/history', controller.getRollHistory); // New endpoint for history
router.get('/:id/labels', controller.getRollLabels); // New
router.post('/:id/generate-labels', controller.generateRollLabels);

router.get('/metrics/:rolloId', controller.getRolloMetrics);
router.get('/details/:rolloId', controller.getRollDetails);

// Magic Route
router.post('/magic', controller.magicRollAssignment);

// Coordinación
router.post('/reorder-pending', verifyToken, controller.reorderPendingOrders);
router.post('/reorder-rolls',   verifyToken, controller.reorderRolls);

module.exports = router;