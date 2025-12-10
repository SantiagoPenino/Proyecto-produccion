const express = require('express');
const router = express.Router();
const stockCtrl = require('../controllers/stockController');
const invCtrl = require('../controllers/inventoryController'); // Importamos el nuevo
const controller = require('../controllers/areasController');

// Rutas de Solicitudes
router.post('/', stockCtrl.createRequest);
router.get('/history', stockCtrl.getHistory); // ?area=DTF

// Rutas de Insumos (Autocompletado)
router.get('/items', invCtrl.searchItems); // ?q=tinta
router.post('/items', invCtrl.createItem);

router.get('/', controller.getAllAreas); // Esto maneja GET /api/areas
router.get('/', controller.getAllAreas);
router.get('/:code/details', controller.getAreaDetails); // Para la config page
router.post('/printer', controller.addPrinter);
router.put('/printer/:id', controller.updatePrinter); // <--- NUEVA RUTA
router.post('/insumo-link', controller.toggleInsumoArea);
router.post('/statuses', controller.saveStatuses);
router.post('/columns', controller.saveColumns);
router.get('/dictionary', controller.getColumnsDictionary); // <--- NUEVO ENDPOINT
router.get('/', controller.getAllAreas);
module.exports = router;

