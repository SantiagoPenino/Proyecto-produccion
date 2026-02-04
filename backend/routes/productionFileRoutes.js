const express = require('express');
const router = express.Router();

const productionFileController = require('../controllers/productionFileController');
const pedidosController = require('../controllers/pedidosController');
const etiquetasController = require('../controllers/etiquetasController');
const rollsController = require('../controllers/rollsController'); // Updated to new controller
const equiposController = require('../controllers/equiposController');

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
router.get('/tipos-falla', productionFileController.getTiposFalla);
router.post('/controlar', productionFileController.postControlArchivo);
// --- ETIQUETAS y Vista Dividida ---
router.get('/ordenes-labels', etiquetasController.getOrdersForLabels);
router.post('/regen-labels/:ordenId', productionFileController.regenerateEtiquetas);
router.get('/orden/:ordenId/etiquetas/print', etiquetasController.printEtiquetas);

module.exports = router;