const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { verifyToken } = require('../middleware/authMiddleware'); // Asumiendo que usas autenticación

// Rutas de Inventario
router.get('/report', verifyToken, inventoryController.getInventoryReport);
router.get('/area', verifyToken, inventoryController.getInventoryByArea); // ?areaId=DTF
router.post('/stock/add', verifyToken, inventoryController.addStock);
router.post('/stock/close', verifyToken, inventoryController.closeBobina);
router.post('/stock/adjust', verifyToken, inventoryController.adjustBobina); // Nueva ruta ajuste
router.get('/stock/history', verifyToken, inventoryController.getBobinaHistory); // Nueva ruta historial
router.post('/stock/confirmar-medida', verifyToken, inventoryController.confirmarMedida); // Confirmar medida tela de cliente
router.get('/stock/estado-tela',       verifyToken, inventoryController.getEstadoTela);   // Estado de cuenta por bobina
router.get('/tela-cliente/disponible', verifyToken, require('../controllers/webDesignerController').impersonarCliente, inventoryController.getBovinasDisponibles); // Bobinas disponibles para pedido tela cliente (soporta diseñador impersonando)
router.get('/prendas-cliente/disponible', verifyToken, require('../controllers/webDesignerController').impersonarCliente, inventoryController.getPrendasClienteDisponibles); // [BORDADO] Prendas entregadas por el cliente con saldo libre (mismo patrón que las bobinas)


// CRUD Insumos (Catálogo)
router.get('/insumos', verifyToken, inventoryController.getInsumos);
router.post('/insumos', verifyToken, inventoryController.createInsumo);
router.put('/insumos/:id', verifyToken, inventoryController.updateInsumo);
router.delete('/insumos/:id', verifyToken, inventoryController.deleteInsumo);

module.exports = router;
