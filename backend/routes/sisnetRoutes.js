const express = require('express');
const router = express.Router();
const sisnetController = require('../controllers/sisnetController');

// Rutas de prueba para la integración con SISNET eFactura (SOAP)

// 1. Probar estado (status)
router.get('/status', sisnetController.testStatus);

// 2. Probar obtención de CAE (por tipo, ej: 111 = e-Factura)
router.get('/cae/:tipo', sisnetController.testObtenerCAE);

// 3. Probar envío de CFE (recepcionCFE) con datos mock
router.post('/enviar-prueba', sisnetController.testEnviarCFE);

module.exports = router;
