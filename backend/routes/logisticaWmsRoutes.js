const express = require('express');
const router = express.Router();
const controller = require('../controllers/logisticaWmsController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/pending', verifyToken, controller.getPendingOrders);
router.get('/prepared', verifyToken, controller.getPreparedOrders);
router.put('/start/:pedidoId', verifyToken, controller.startPreparation);
router.put('/confirm/:pedidoId', verifyToken, controller.confirmPreparation);
router.put('/receive/:pedidoId', verifyToken, controller.receivePreparedOrder);
router.put('/update-item/:pedidoId', verifyToken, controller.updateItemQuantity);
router.delete('/delete-item/:pedidoId/:wms_variante_id', verifyToken, controller.deleteItem);
router.put('/cancel/:pedidoId', verifyToken, controller.cancelOrder);
router.put('/deliver/:pedidoId', verifyToken, controller.markDelivered);

// [WMS] Trazabilidad y notas del pedido (tabla PedidosCobranzaEventos)
router.get('/eventos/:pedidoId', verifyToken, controller.getEventos);
router.post('/nota/:pedidoId', verifyToken, controller.addNota);

// [WMS] Pestaña Historial (pedidos terminados/cancelados, con búsqueda)
router.get('/historial', verifyToken, controller.getHistorialPedidos);
// Impresión de etiquetas por pedido — sin verifyToken: se abre con window.open (iframe/
// pestaña sin JWT), mismo criterio que /orden/:id/etiquetas/print
router.get('/etiquetas-print/:pedidoId', controller.printEtiquetasPedido);
// Agregar un bulto extra al pedido (etiquetas 1/2, 2/2...)
router.post('/bulto-extra/:pedidoId', verifyToken, controller.addBultoPedido);

module.exports = router;
