const express = require('express');
const router = express.Router();

const productionFileController = require('../controllers/productionFileController');
const pedidosController = require('../controllers/pedidosController');
const etiquetasController = require('../controllers/etiquetasController');
const rollsController = require('../controllers/rollsController'); // Updated to new controller
const equiposController = require('../controllers/equiposController');
const { verifyToken } = require('../middleware/authMiddleware');

// --- ROLLOS ---
router.get('/rollos', rollsController.getRollosActivos);
router.get('/rollos-activos', rollsController.getRollosActivos); // Alias for frontend compatibility
router.get('/rollo/:rolloId/metrics', rollsController.getRolloMetrics);

// --- PEDIDOS ---
router.get('/pedido/:noDocErp/metrics', pedidosController.getPedidoMetrics);

// --- ETIQUETAS ---
router.get('/orden/:ordenId/etiquetas', etiquetasController.getEtiquetas);
router.delete('/etiqueta/:id', etiquetasController.deleteEtiqueta);
router.post('/orden/:ordenId/etiqueta-extra', etiquetasController.createExtraLabel);

// --- EQUIPOS ---
router.get('/equipos', equiposController.getEquipos);

// --- ORDENES Y ARCHIVOS (Producción Diaria) ---
router.get('/ordenes', productionFileController.getOrdenes);
router.get('/orden/:ordenId/archivos', productionFileController.getArchivosPorOrden);
router.get('/view-drive-file', productionFileController.viewDriveFile);
router.get('/tipos-falla', productionFileController.getTiposFalla);
router.get('/motivos-cancelacion', productionFileController.getMotivosCancelacion);
router.post('/controlar', verifyToken, productionFileController.postControlArchivo);
router.post('/update-copy-count', productionFileController.updateFileCopyCount);
router.post('/orden/:ordenId/completar', verifyToken, productionFileController.completarOrden);
// --- ETIQUETAS y Vista Dividida ---
router.get('/ordenes-labels', etiquetasController.getOrdersForLabels);
router.post('/regen-labels/:ordenId', productionFileController.regenerateEtiquetas);
router.post('/recalc-labels/:ordenId', productionFileController.recalcularContadoresEtiquetas);
router.get('/orden/:ordenId/etiquetas/print', etiquetasController.printEtiquetas);
router.get('/orden/:id/pending-services', etiquetasController.getPendingServices);
router.post('/orden/:id/next-service', etiquetasController.updateOrderNextService);

// --- REPOSICIONES (Atención al Cliente) ---
router.get('/ordenes/entregadas', productionFileController.getCompletedOrdersForReplacement);
router.get('/orden/:ordenId/relacionadas', productionFileController.getRelatedOrders);
router.post('/ordenes/reposicion', productionFileController.createCustomerReplacementOrder);

// --- CANASTO FALLA (Confirmación y Liberación) ---
router.post('/canasto-falla/confirmar', productionFileController.confirmarFalla);
router.post('/canasto-falla/liberar',   productionFileController.liberarCanastaFalla);

module.exports = router;