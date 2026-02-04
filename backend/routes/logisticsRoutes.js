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
router.get('/bultos/:label', logisticsController.getBultoByLabel);

// Remitos (Dispatch)
router.post('/remitos', logisticsController.createRemito);
router.post('/remitos/validate', logisticsController.validateDispatch);
router.get('/remitos/incoming', logisticsController.getIncomingRemitos);
router.get('/remitos/outgoing', logisticsController.getOutgoingRemitos);
router.get('/remitos/:code', logisticsController.getRemitoByCode);

// Recepción
router.post('/receive', logisticsController.receiveDispatch);

// Transport
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
router.post('/recover', logisticsController.recoverItem);

// Stock Deposito & Sync
router.get('/deposit-stock', logisticsController.getDepositStock);
router.post('/deposit-sync', logisticsController.syncDepositStock);

module.exports = router;