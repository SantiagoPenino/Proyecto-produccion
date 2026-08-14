const express = require('express');
const router = express.Router();
const logisticsController = require('../controllers/logisticsController');

// --- LEGACY ---
// Validar lote antes de procesar
router.post('/validate-batch', logisticsController.validateBatch);
// Procesar lote (ingreso/egreso)
router.post('/process-batch', logisticsController.processBatch);

// --- NEW WMS (Bultos & Remitos) ---
// Bultos
router.post('/bultos', logisticsController.createBulto);
router.post('/bultos/resolve-qr', logisticsController.resolveBultoQR);
router.get('/bultos/:label', logisticsController.getBultoByLabel);

// Remitos (Dispatch)
router.post('/remitos', logisticsController.createRemito);
router.post('/remitos/from-orders', logisticsController.createRemitoFromOrders);
router.post('/remitos/validate', logisticsController.validateDispatch);
router.get('/remitos/incoming', logisticsController.getIncomingRemitos);
router.get('/remitos/outgoing', logisticsController.getOutgoingRemitos);
router.get('/remitos/search', logisticsController.searchRemitos);
router.get('/remitos/:code', logisticsController.getRemitoByCode);

// Recepción
router.post('/receive', logisticsController.receiveDispatch);
router.get('/esperando-bultos', logisticsController.getEsperandoBultos);

// Control PRO (FASE 6): pedidos con orden madre PRO ya reunidos físicamente en PRO,
// esperando aprobación manual antes de generar la etiqueta final y salir a Depósito.
router.get('/pro/pedidos-completos', logisticsController.getPedidosCompletosPRO);
router.post('/pro/pedidos/:noDocERP/aprobar-control', logisticsController.aprobarControlPRO);

// Transport
const uploadEncomiendas = require('../middleware/multerEncomiendasConfig');
router.post('/remitos/:code/confirm-delivery', uploadEncomiendas.single('comprobante'), logisticsController.confirmRemitoDelivery);
router.post('/transport/confirm', logisticsController.confirmTransport);
router.get('/transport/active', logisticsController.getActiveTransports);
router.get('/requirements', logisticsController.getOrderRequirements);
router.get('/requirements/resources', logisticsController.getAvailableResources);
router.post('/requirements/toggle', logisticsController.toggleRequirement);

// Dashboard & History
// Dashboard & History
router.get('/dashboard', logisticsController.getDashboard);
router.get('/history', logisticsController.getHistory);
router.get('/stock', logisticsController.getAreaStock); // NEW
router.get('/lost', logisticsController.getLostItems);
// verifyToken: la recuperación cambia estados de órdenes (gancho TERMINAC) y el
// historial debe firmarse con el operario logueado, no con "Sistema".
router.post('/recover', require('../middleware/authMiddleware').verifyToken, logisticsController.recoverItem);

// Stock Deposito & Sync
router.get('/deposit-stock', logisticsController.getDepositStock);
router.post('/deposit-sync', logisticsController.syncDepositStock);
router.post('/deposit-recalculate', logisticsController.recalculateDepositStockPrices);
router.post('/deposit-release', logisticsController.releaseDepositStock);

module.exports = router;