const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos (19/10): verifyToken solo acepta también el token de un cliente del portal.
// Las dos rutas «disponible» quedan abiertas a clientes y diseñadores: las usa el formulario de
// pedido del portal (useOrderForm) y también el interno (revisado ruta por ruta).
const interno = [verifyToken, soloInternoConRol()];

// Rutas de Inventario
router.get('/report', interno, inventoryController.getInventoryReport);
router.get('/area', interno, inventoryController.getInventoryByArea); // ?areaId=DTF
router.post('/stock/add', interno, inventoryController.addStock);
router.post('/stock/close', interno, inventoryController.closeBobina);
router.post('/stock/adjust', interno, inventoryController.adjustBobina); // Nueva ruta ajuste
router.get('/stock/history', interno, inventoryController.getBobinaHistory); // Nueva ruta historial
router.post('/stock/confirmar-medida', interno, inventoryController.confirmarMedida); // Confirmar medida tela de cliente
router.get('/stock/estado-tela',       interno, inventoryController.getEstadoTela);   // Estado de cuenta por bobina
router.get('/tela-cliente/disponible', verifyToken, require('../controllers/webDesignerController').impersonarCliente, inventoryController.getBovinasDisponibles); // Bobinas disponibles para pedido tela cliente (soporta diseñador impersonando)
router.get('/prendas-cliente/disponible', verifyToken, require('../controllers/webDesignerController').impersonarCliente, inventoryController.getPrendasClienteDisponibles); // [BORDADO] Prendas entregadas por el cliente con saldo libre (mismo patrón que las bobinas)


// CRUD Insumos (Catálogo)
router.get('/insumos', interno, inventoryController.getInsumos);
router.post('/insumos', interno, inventoryController.createInsumo);
router.put('/insumos/:id', interno, inventoryController.updateInsumo);
router.delete('/insumos/:id', interno, inventoryController.deleteInsumo);

module.exports = router;
