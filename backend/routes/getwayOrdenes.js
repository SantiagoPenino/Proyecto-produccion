// apiordenes.js
const express = require('express');
const router = express.Router();
const { getOrdenesByFilter, createOrden, getOrdenByCodigo, getOrdenesClienteByOrden, getOrdenesEstado, updateOrdenEstado, getEstadosOrdenes, updateExportacion, eliminarOrdenes, getModosOrdenes, parseQROrden } = require('../controllers/ordenesController');
const { verifyToken } = require('../middleware/authMiddleware');

// Ruta para obtener todas las órdenes
router.get('/datafilter', getOrdenesByFilter);

// Ruta para obtener una orden específica por número
router.get('/data/:orderNumber', getOrdenByCodigo);

// Ruta para obtener las ordenes de un cliente a partir de una orden
router.get('/dataordenescliente/:idOrden', getOrdenesClienteByOrden)

// Ruta para crear orden
router.post('/data', verifyToken, createOrden);

// Ruta para pre-visualizar detalles reales del código
router.post('/parse-qr', verifyToken, parseQROrden);

// Ruta para obtener órdenes por múltiples estados
router.get('/estados', getOrdenesEstado);

// Ruta para actualizar el estado de órdenes a "Avisado"
router.post('/actualizarEstado', verifyToken, updateOrdenEstado);

// Ruta para obtener los estados de las órdenes
router.get('/estados/list', getEstadosOrdenes);

// Ruta para obtener los modos de las órdenes
router.get('/modos', getModosOrdenes);

// Ruta para actualizar la exportacion de las ordenes
router.post('/actualizarExportacion', verifyToken, updateExportacion)

// Ruta para eliminar órdenes de retiro
router.delete('/eliminar', verifyToken, eliminarOrdenes);

module.exports = router;
