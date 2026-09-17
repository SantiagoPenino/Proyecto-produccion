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

// Libro de entregas (Spec 39): envío parcial, complementos, "lo que falta de este pedido"
const libroEntregasController = require('../controllers/libroEntregasController');
router.get('/libro/config', libroEntregasController.getConfig);
router.get('/libro/orden/:id', libroEntregasController.getLibroOrden);
router.get('/libro/pedido/:noDoc', libroEntregasController.getLibroPedido);
router.get('/libro/pendientes', libroEntregasController.getPendientesArea);
router.post('/libro/envio-info', libroEntregasController.getEnvioInfo);
// Reposiciones de una orden (madre, falla o la que reportó), accesible desde CUALQUIER área
// (fallaBandejaController.getReposicionesOrden ya es genérica; solo estaba montada para las
// áreas de bandeja EMB/EST/TWC/TWT). El detalle de orden (OrderDetailModal) la usa para
// mostrar el archivo original a reponer en las áreas de impresión estándar (SB/DF/ECOUV).
router.get('/reposiciones/orden/:ordenId', require('../controllers/fallaBandejaController').getReposicionesOrden);

// Control PRO (FASE 6): pedidos con orden madre PRO ya reunidos físicamente en PRO,
// esperando aprobación manual antes de generar la etiqueta final y salir a Depósito.
router.get('/pro/pedidos-completos', logisticsController.getPedidosCompletosPRO);
router.post('/pro/pedidos/:noDocERP/aprobar-control', logisticsController.aprobarControlPRO);

// [PRENDAS] Reportar falla desde la Bandeja de Producción — mismo controlador genérico que
// EMB/EST/TWC/TWT (bandejaRoutes.js), forzando el área acá igual que hacen esos mounts, pero
// SIN el resto de las rutas de esa fábrica (Trabajo/Control/aprobar-control ya tienen su
// propio flujo en PRO vía aprobarControlPRO arriba — no serían válidas para AreaID='PRO').
const fallaBandejaPRO = require('../controllers/fallaBandejaController');
router.use('/pro/orders/:ordenId/falla', (req, res, next) => { req.query.area = 'PRO'; next(); });
router.get('/pro/orders/:ordenId/falla/pendientes', fallaBandejaPRO.getPendientes);
router.post('/pro/orders/:ordenId/falla/es-lo-pendiente', fallaBandejaPRO.esLoPendiente);
router.post('/pro/orders/:ordenId/falla/proponer', fallaBandejaPRO.proponer);
router.post('/pro/orders/:ordenId/falla', fallaBandejaPRO.reportar);

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