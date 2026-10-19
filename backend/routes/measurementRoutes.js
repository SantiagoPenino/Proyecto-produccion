const express = require('express');
const router = express.Router();
const controller = require('../controllers/measurementController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos (19/10): no tenía login. Lo usa solo el detalle del lote (RollDetailsModal).
router.use(verifyToken, soloInternoConRol());

// GET: Obtener lista de trabajo
router.get('/', controller.getOrdersToMeasure);

// POST: Analizar archivos (Medición Automática en Memoria)
router.post('/analyze', controller.measureFiles);

// POST: Guardar cambios en base de datos
router.post('/save', controller.saveMeasurements);

// Legacy/Compat
router.post('/auto-measure', controller.measureFiles);

// ZIP Download
router.post('/process-batch', controller.processBatch);
router.post('/download-zip', controller.downloadOrdersZip);

// Descarga archivo por archivo (sin ZIP): primero el manifiesto, después cada archivo suelto.
router.post('/files-manifest', controller.getOrdersFilesManifest);
router.get('/file/:archivoId', controller.downloadSingleFile);

// Local Download Structure
router.post('/process-batch-by-orders', controller.processOrdersBatch);

// NEW: Server Side Full Process (Download + Measure + Update DB)
router.post('/process-server', controller.processFilesServerSide);

// NEW: Server Side Full Process by OrderIds
router.post('/process-server-orders', controller.processOrdersServerSide);

module.exports = router;
