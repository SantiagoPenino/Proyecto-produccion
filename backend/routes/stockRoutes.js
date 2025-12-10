const express = require('express');
const router = express.Router();

// Importamos los controladores
const stockCtrl = require('../controllers/stockController');
const invCtrl = require('../controllers/inventoryController');

// --- Rutas de Solicitudes (stockController) ---
router.post('/', stockCtrl.createRequest);
router.get('/history', stockCtrl.getHistory);
router.get('/urgent-count', stockCtrl.getUrgentCount); // <--- Verifica que esta función exista en stockController

// --- Rutas de Inventario (inventoryController) ---
router.get('/items', invCtrl.searchItems); 
router.post('/items', invCtrl.createItem);

module.exports = router;