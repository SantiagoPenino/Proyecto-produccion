const express = require('express');
const router = express.Router();
const controller = require('../controllers/rollsController'); // 👈 Aquí se llama "controller"
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/board', controller.getBoardData);
router.get('/list', controller.getRollosActivos); // Endpoint específico para combo
router.post('/move', controller.moveOrder);
router.post('/create', verifyToken, controller.createRoll);
router.post('/reorder', controller.reorderOrders);
router.post('/order-printed', controller.setOrderPrinted); // Marcar impreso (todas las áreas)
router.post('/orders-printed-bulk', controller.setOrdersPrintedBulk); // Marcar impreso un GRUPO, en orden
router.post('/order-calandered', controller.setOrderCalandered); // Marcar calandrado (SB, lote en calandra)
router.post('/order-cantidad-impresa', controller.setOrderCantidadImpresa); // Impresión parcial (TPU): unidades impresas
router.post('/order-magnitud', controller.setOrderMagnitud);   // Editar metros (Magnitud) de una orden (-F)
router.post('/order-group', controller.setOrderGroup);     // Agrupar/desagrupar en el lote (SB)

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

// Next roll name (sequential per area per day)
router.get('/next-name', controller.getNextRollName);

// Magic Route
router.post('/magic', controller.magicRollAssignment);

// Coordinación
router.post('/reorder-pending', verifyToken, controller.reorderPendingOrders);
router.post('/reorder-rolls',   verifyToken, controller.reorderRolls);

module.exports = router;