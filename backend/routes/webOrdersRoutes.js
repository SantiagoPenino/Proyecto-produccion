const express = require('express');
const router = express.Router();
const webOrdersController = require('../controllers/webOrdersController');
const integrationOrdersController = require('../controllers/integrationOrdersController');
const { verifyToken } = require('../middleware/authMiddleware');

const driveService = require('../services/driveService');
const fs = require('fs');
const path = require('path');

// GET /api/web-orders/my-orders
router.get('/my-orders', verifyToken, webOrdersController.getClientOrders);

// GET /api/web-orders/active-sublimation
router.get('/active-sublimation', verifyToken, webOrdersController.getActiveSublimationOrders);

// DELETE /api/web-orders/incomplete/:id (Eliminar pedido zombie)
router.delete('/incomplete/:id', verifyToken, webOrdersController.deleteIncompleteOrder);

// DELETE /api/web-orders/bundle/:docId (Eliminar todo el proyecto)
router.delete('/bundle/:docId', verifyToken, webOrdersController.deleteOrderBundle);

// GET /api/web-orders/area-mapping
router.get('/area-mapping', webOrdersController.getAreaMapping);

// GET /api/web-orders/pickup-orders (Órdenes para Retiro, API Externa)
router.get('/pickup-orders', verifyToken, webOrdersController.getPickupOrders);

// POST /api/web-orders/pickup-orders/create (Generar Orden de Retiro)
router.post('/pickup-orders/create', verifyToken, webOrdersController.createPickupOrder);

// GET /api/web-orders/shipping-data (Datos para confirmación de retiro)
router.get('/shipping-data', verifyToken, webOrdersController.getShippingData);

// POST /api/web-orders/saved-addresses (Guardar dirección)
router.post('/saved-addresses', verifyToken, webOrdersController.saveAddress);

// DELETE /api/web-orders/saved-addresses/:id (Eliminar dirección)
router.delete('/saved-addresses/:id', verifyToken, webOrdersController.deleteAddress);

// POST /api/web-orders/pickup-orders/pdf (Generar PDF)
router.post('/pickup-orders/pdf', verifyToken, webOrdersController.generatePickupReceipt);

// POST /api/web-orders/pickup-orders/handy-payment (Generar Link de Pago Handy)
router.post('/pickup-orders/handy-payment', verifyToken, webOrdersController.createHandyPaymentLink);

// POST /api/web-orders/handy-webhook (Webhook Callback desde Handy)
router.post('/handy-webhook', webOrdersController.handyWebhook);

// POST /api/web-orders/handy-refund (Solicitar Devolución a Handy)
router.post('/handy-refund', verifyToken, webOrdersController.createHandyRefund);

// POST /api/web-orders/handy-refund-webhook (Webhook Callback de Devolución)
router.post('/handy-refund-webhook', webOrdersController.handyRefundWebhook);

// GET /api/web-orders/payment-status/:transactionId (Consultar estado de pago)
router.get('/payment-status/:transactionId', webOrdersController.getPaymentStatus);

// PUT /api/web-orders/area-mapping/:codOrden (Toggle Visibility)
router.put('/area-mapping/:codOrden', verifyToken, webOrdersController.updateAreaVisibility);

// Endpoint para creación de pedido desde Cliente Web
// POST /api/web-orders/create
router.post('/create', verifyToken, webOrdersController.createWebOrder);

// --- INTEGRACIÓN EXTERNA (API KEY) ---
const INTEGRATION_KEY = process.env.INTEGRATION_API_KEY || 'macrosoft-secret-key';

const verifyApiKey = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key && key === INTEGRATION_KEY) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
};

// POST /api/web-orders/integration/create
router.post('/integration/create', verifyApiKey, integrationOrdersController.createPlanillaOrder);

// --- Google Drive Auth ---
router.get('/drive/auth-url', (req, res) => {
    const url = driveService.getAuthUrl();
    if (url) res.json({ url });
    else res.status(500).json({ error: "OAuth no inicializado. ¿Subiste oauth-credentials.json?" });
});

router.post('/drive/save-token', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Falta el código de autorización" });
    const success = await driveService.saveToken(code);
    if (success) res.json({ success: true, message: "Cuenta vinculada correctamente" });
    else res.status(500).json({ error: "Error al guardar el token" });
});

router.get('/drive/save-token-get', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("Falta el código de autorización en la URL");
    const success = await driveService.saveToken(code);
    if (success) res.send("<h1>✅ ¡VINCULACIÓN EXITOSA!</h1><p>Ya puedes cerrar esta ventana y crear tu pedido.</p>");
    else res.status(500).send("<h1>❌ ERROR</h1><p>El código podría haber expirado. Intenta obtener uno nuevo.</p>");
});

// --- EXPERIMENTO DE STREAMING DE ARCHIVOS ---
const multer = require('multer');
// Usamos memoria RAM temporal para recibir el buffer (límite por defecto de Node, cuidado con archivos >1GB)
// Para producción REAL con archivos GIGANTES, mejor usar DiskStorage y borrar luego.
// Pero para empezar, memoria es lo más rápido y fácil de implementar.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // Límite de 500MB por archivo para seguridad
});


router.post('/upload-stream', verifyToken, upload.single('file'), webOrdersController.uploadOrderFile);

// --- SUBIDA DE IMÁGENES DE CONFIGURACIÓN (CMS) ---
const storageConfig = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../uploads/config_images');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'cms-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadConfig = multer({ storage: storageConfig });

router.post('/config-image-upload', verifyToken, uploadConfig.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Construct public URL (assuming server runs on same host/port)
    // El frontend debe prepender la URL base si es necesario, pero devolveremos la ruta relativa.
    // server.js sirve /uploads -> backend/uploads
    // Archivo guardado en backend/uploads/config_images/xxx.jpg
    // URL Pública: /uploads/config_images/xxx.jpg

    // IMPORTANTE: Multer path usa backslashes en Windows. Reemplazar por forward slashes.
    const relativePath = `/uploads/config_images/${req.file.filename}`;

    res.json({ success: true, url: relativePath });
});

module.exports = router;
