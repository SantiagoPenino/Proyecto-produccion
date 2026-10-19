// apiordenes.js
const express = require('express');
const router = express.Router();
const { getOrdenesByFilter, createOrden, getOrdenByCodigo, getOrdenesClienteByOrden, getOrdenesEstado, updateOrdenEstado, getEstadosOrdenes, updateExportacion, eliminarOrdenes, getModosOrdenes, parseQROrden, updatePhoneAndResendWsp, getPendingWspOrders, omitirWsp } = require('../controllers/ordenesController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Las rutas que no tenían login quedan solo para usuarios internos (19/10). Las llaman Buscar órdenes,
// Carga a depósito y Recepción; data/:orderNumber, dataordenescliente y estados las usaba la app
// React vieja (borrada).
const interno = [verifyToken, soloInternoConRol()];

// Ruta para obtener todas las órdenes
router.get('/datafilter', interno, getOrdenesByFilter);

// Ruta para obtener una orden específica por número
router.get('/data/:orderNumber', interno, getOrdenByCodigo);

// Ruta para obtener las ordenes de un cliente a partir de una orden
router.get('/dataordenescliente/:idOrden', interno, getOrdenesClienteByOrden)

// Ruta para crear orden
router.post('/data', verifyToken, createOrden);

// Ruta para pre-visualizar detalles reales del código
router.post('/parse-qr', verifyToken, parseQROrden);
// Nueva ruta para re-despachar WSP y corregir teléfono
router.post('/update-phone', verifyToken, updatePhoneAndResendWsp);
// Omitir envío de WSP (marcar como avisado sin enviar)
router.post('/omitir-wsp', verifyToken, omitirWsp);

// Ruta para traer las ordenes pendientes de WSP al cargar la página
router.get('/pending-wsp', verifyToken, getPendingWspOrders);

// Ruta para obtener órdenes por múltiples estados
router.get('/estados', interno, getOrdenesEstado);

// Ruta para actualizar el estado de órdenes a "Avisado"
router.post('/actualizarEstado', verifyToken, updateOrdenEstado);

// Ruta para obtener los estados de las órdenes
router.get('/estados/list', interno, getEstadosOrdenes);

// Ruta para obtener los modos de las órdenes
router.get('/modos', interno, getModosOrdenes);

// Ruta para actualizar la exportacion de las ordenes
router.post('/actualizarExportacion', verifyToken, updateExportacion)

// Ruta para eliminar órdenes de retiro
router.delete('/eliminar', verifyToken, eliminarOrdenes);

module.exports = router;
