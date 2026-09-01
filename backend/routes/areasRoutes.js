const express = require('express');
const router = express.Router();
const stockCtrl = require('../controllers/stockController');
const invCtrl = require('../controllers/inventoryController'); // Importamos el nuevo
const controller = require('../controllers/areasController');
const { verifyToken } = require('../middleware/authMiddleware');

// Rutas de Solicitudes
router.post('/', stockCtrl.createRequest);
router.get('/history', stockCtrl.getHistory); // ?area=DTF

// Rutas de Insumos (Autocompletado)
router.get('/items', invCtrl.getInsumos); // ?q=tinta
router.post('/items', invCtrl.createInsumo);

router.get('/', controller.getAllAreas); // Esto maneja GET /api/areas
router.get('/', controller.getAllAreas);
router.get('/:code/details', controller.getAreaDetails); // Para la config page
router.post('/printer', verifyToken, controller.addPrinter);
router.put('/printer/:id', verifyToken, controller.updatePrinter);
router.delete('/printer/:id', controller.deletePrinter); // <--- RUTA DE ELIMINAR
router.post('/insumo-link', controller.toggleInsumoArea);
router.post('/status', controller.addStatus);
router.put('/status/:id', controller.updateStatus);
router.delete('/status/:id', controller.deleteStatus);
router.post('/columns', controller.saveColumns);
router.get('/dictionary', controller.getColumnsDictionary); // <--- NUEVO ENDPOINT
router.get('/', controller.getAllAreas);
module.exports = router;

