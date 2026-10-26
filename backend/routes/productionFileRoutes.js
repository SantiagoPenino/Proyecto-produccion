const express = require('express');
const router = express.Router();

const productionFileController = require('../controllers/productionFileController');
const pedidosController = require('../controllers/pedidosController');
const etiquetasController = require('../controllers/etiquetasController');
const rollsController = require('../controllers/rollsController'); // Updated to new controller
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

// --- ORDENES Y ARCHIVOS (Producción Diaria) ---
router.get('/ordenes', productionFileController.getOrdenes);
router.get('/orden/:ordenId/archivos', productionFileController.getArchivosPorOrden);
router.get('/orden/:ordenId/fallas-imagenes', productionFileController.getFallasImagenes);
router.get('/lote/:rolloId/fallas-imagenes', verifyToken, productionFileController.getFallasImagenesLote);
router.get('/orden/:ordenId/fallas', verifyToken, productionFileController.getFallasOrden);   // tipo de cada falla de la nota (detalle)   // zona marcada de cada -F del lote
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
router.get('/ordenes/entregadas', verifyToken, productionFileController.getCompletedOrdersForReplacement);
router.get('/orden/:ordenId/relacionadas', verifyToken, productionFileController.getRelatedOrders);
// Telas que se pueden elegir y si admite archivo nuevo (26/10/2026)
router.get('/orden/:ordenId/reposicion-opciones', verifyToken, productionFileController.getOpcionesReposicion);
// Con archivos nuevos llega multipart (mismo multer que la subida de archivos de producción de ordersRoutes);
// sin ellos, JSON como siempre: multer deja pasar lo que no es multipart.
const multerRepo = require('multer');
const fsRepo = require('fs');
const tmpDirRepo = require('../utils/rutasUploads').rutaUploads('tmp'); // UPLOADS_PATH
if (!fsRepo.existsSync(tmpDirRepo)) fsRepo.mkdirSync(tmpDirRepo, { recursive: true });
const uploadRepo = multerRepo({
    storage: multerRepo.diskStorage({
        destination: (req, file, cb) => cb(null, tmpDirRepo),
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
    }),
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});
router.post('/ordenes/reposicion', verifyToken, uploadRepo.array('archivosNuevos', 20), productionFileController.createCustomerReplacementOrder);

// --- CANASTO FALLA (Confirmación y Liberación) ---
router.post('/canasto-falla/confirmar', productionFileController.confirmarFalla);
router.post('/canasto-falla/liberar',   productionFileController.liberarCanastaFalla);

module.exports = router;