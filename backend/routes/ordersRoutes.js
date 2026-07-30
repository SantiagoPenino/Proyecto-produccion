const express = require('express');
const router = express.Router();

// Importamos el controlador
const ordersController = require('../controllers/ordersController');
const clientOrdersController = require('../controllers/clientOrdersController');

// 👇 Importamos Middleware de Autenticación
const { verifyToken, authorizeAdminOrArea, soloInternoConRol, ROLES_EDITAN_ESTADO } = require('../middleware/authMiddleware');

// RUTAS CLIENTE WEB
router.post('/client', verifyToken, clientOrdersController.createClientOrder);

// --- AQUÍ VAN LAS RUTAS DE CONSULTA ESPECÍFICA (Antes de las rutas con :id) ---

// Reportes y Búsqueda Avanzada
router.post('/search/advanced', ordersController.advancedSearchOrders); // TODO: Restaurar verifyToken luego de debug
router.get('/details/:id', ordersController.getOrderFullDetails); // También liberamos detalles para prueba
router.get('/search/integral/:ref', ordersController.getIntegralPedidoDetailsV2); // Nueva Ruta Integral (Version SQL SP)
router.get('/priorities', ordersController.getPrioritiesConfig);
router.get('/estados', ordersController.getEstadosConfig);

// Ruta para el resumen de la ActiveOrdersCard.jsx (Protegida)
router.get('/active', verifyToken, authorizeAdminOrArea, ordersController.getActiveOrdersSummary);
router.get('/cancelled', verifyToken, authorizeAdminOrArea, ordersController.getCancelledOrdersSummary);
router.get('/failed', verifyToken, authorizeAdminOrArea, ordersController.getFailedOrdersSummary);

// 1. RUTAS PRINCIPALES (CRUD)
router.get('/', verifyToken, ordersController.getOrdersByArea);      // Obtener lista completa
router.post('/', verifyToken, ordersController.createOrder);         // Crear orden

// Acciones específicas SIN ID en URL (POST global)
router.post('/assign-roll', verifyToken, ordersController.assignRoll);
router.post('/unassign-roll', verifyToken, ordersController.unassignOrder);
router.post('/cancel', verifyToken, ordersController.cancelOrder);
router.post('/cancel-request', verifyToken, ordersController.cancelRequest);
router.post('/cancel-roll', verifyToken, ordersController.cancelRoll);

// Rutas con :id (DEBEN IR AL FINAL de los GET/PUT/DELETE específicos)
router.delete('/:id', verifyToken, ordersController.deleteOrder);
// Antes iban con verifyToken pelado, que acepta cualquier JWT válido — un cliente del portal
// podía cambiar el estado de cualquier orden llamando la API directo. Ahora ambas exigen usuario
// INTERNO, pero se restringen distinto según quién las usa:
//
//  · /status      → la disparan FLUJOS DEL SISTEMA (LogisticsCartModal la pasa a 'Pendiente',
//                   ActiveRollModal a 'Terminación'). No es una edición manual: en el modal de
//                   la orden el estado general está bloqueado con candado. Sin restricción de rol,
//                   para no romperle el circuito a Logística ni a las áreas.
//  · /area-status → ES el cambio manual: el combo "Estado en su Área" del detalle de la orden.
//                   Limitado a los roles habilitados (ver ROLES_EDITAN_ESTADO).
router.put('/:id/status', verifyToken, soloInternoConRol(), ordersController.updateStatus);
router.put('/:id/area-status', verifyToken, soloInternoConRol(ROLES_EDITAN_ESTADO), ordersController.updateAreaStatus);
router.get('/history/:id', verifyToken, ordersController.getOrderHistory);

// 2. GESTIÓN DE ARCHIVOS
router.put('/file/update', verifyToken, ordersController.updateFile);
router.post('/file/add', verifyToken, ordersController.addFile);

// Subida de archivo de PRODUCCIÓN (PDF) a una orden existente — uso interno (arte final TPU).
const multerProd = require('multer');
const pathProd = require('path');
const fsProd = require('fs');
const tmpDirProd = pathProd.join(__dirname, '../uploads/tmp');
if (!fsProd.existsSync(tmpDirProd)) fsProd.mkdirSync(tmpDirProd, { recursive: true });
const uploadProdFile = multerProd({
    storage: multerProd.diskStorage({
        destination: (req, file, cb) => cb(null, tmpDirProd),
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
    }),
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});
router.post('/:ordenId/production-file', verifyToken, uploadProdFile.single('file'), ordersController.uploadProductionFile);

// TPU: enviar la orden a aprobación del cliente (retiene hasta que apruebe el arte).
router.post('/:ordenId/enviar-aprobacion', verifyToken, ordersController.enviarAprobacionTPU);

// TPU: texturas por zona elegidas por el cliente. La edición es interna (cualquier rol) y queda
// registrada en el historial — cambia lo que se fabrica respecto de lo que el cliente aprobó.
router.get('/:ordenId/texturas', verifyToken, ordersController.getTexturasOrdenInterno);
router.put('/:ordenId/texturas', verifyToken, soloInternoConRol(), ordersController.setTexturasOrdenInterno);
router.post('/file/cancel', verifyToken, ordersController.cancelFile);
router.post('/reactivate', verifyToken, ordersController.reactivateOrder);
router.post('/reactivate-request', verifyToken, ordersController.reactivateRequest);
router.post('/file/reactivate', verifyToken, ordersController.reactivateFile);
router.put('/service/update', verifyToken, ordersController.updateService);
router.delete('/file/:id', verifyToken, ordersController.deleteFile);

// Extras (Safe Load) - Separados
router.get('/:id/references', ordersController.getOrderReferences);
router.get('/:id/services', ordersController.getOrderServices);

router.post('/assign-fabric-bobbin', verifyToken, ordersController.assignFabricBobbin);
module.exports = router;