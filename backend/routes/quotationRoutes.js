const express = require('express');
const router = express.Router();
const controller = require('../controllers/quotationController');
const { verifyToken } = require('../middleware/authMiddleware');

// Listar todas las cotizaciones (debe ir ANTES del :noDocERP dinámico)
router.get('/list', verifyToken, controller.listQuotations);

// Buscar productos (debe ir ANTES del :noDocERP para no chocarse)
router.get('/search-products', verifyToken, controller.searchProducts);

// Cargar cotización de un documento
router.get('/:noDocERP', verifyToken, controller.getQuotation);

// Guardar cotización editada (recalcula QR)
router.put('/:noDocERP', verifyToken, controller.saveQuotation);

// Reconstruir todas las líneas desde el origen real (Magnitud/puntadas/bajadas de cada
// orden + motor de precios), respetando el modo de facturación guardado
router.post('/:noDocERP/reconstruir', verifyToken, controller.reconstruirLineas);

module.exports = router;
