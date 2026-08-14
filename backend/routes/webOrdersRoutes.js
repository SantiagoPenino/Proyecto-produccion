const express = require('express');
const router = express.Router();
const webOrdersController = require('../controllers/webOrdersController');
const integrationOrdersController = require('../controllers/integrationOrdersController');
const { verifyToken } = require('../middleware/authMiddleware');

const driveService = require('../services/driveService');
const fs = require('fs');
const path = require('path');

// GET /api/web-orders/file-thumbnail/:fileId — proxy de thumbnail autenticado desde Drive (sin auth: fileId es GUID no enumerable)
router.get('/file-thumbnail/:fileId', async (req, res) => {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).json({ error: 'fileId requerido' });
    try {
        const url = await driveService.getThumbnailUrl(fileId);
        if (!url) return res.status(404).end();
        // Redirigir al cliente a la URL de thumbnail firmada por Google
        res.redirect(url);
    } catch (err) {
        res.status(500).end();
    }
});

// Impersonación de diseñadores (WEB_DESIGNER + header X-Cliente-CodCliente, validada
// contra ClienteDisenadores). Para clientes normales es un no-op.
const { impersonarCliente } = require('../controllers/webDesignerController');

// GET /api/web-orders/my-orders
router.get('/my-orders', verifyToken, impersonarCliente, webOrdersController.getClientOrders);
// GET /api/web-orders/order/:ordenId/files — archivos + copias de una orden del cliente
router.get('/order/:ordenId/files', verifyToken, impersonarCliente, webOrdersController.getOrderFiles);
// GET /api/web-orders/orders-files?ids=1,2,3 — archivos de todas las hermanas de un pedido (multitela)
router.get('/orders-files', verifyToken, impersonarCliente, webOrdersController.getOrdersFiles);

// TPU: visor 3D del parche — capas del arte y su contenido (solo dueño del pedido)
router.get('/tpu-model/:ordenId', verifyToken, impersonarCliente, webOrdersController.getTpuModelCapas);
router.get('/tpu-model/:ordenId/archivo/:archivoId', verifyToken, impersonarCliente, webOrdersController.getTpuModelArchivo);

// TPU: catálogo de texturas (listado de assets/textures). Sin impersonarCliente: no hay nada
// scopeado al cliente y lo consume también el detalle de orden interno (F5).
router.get('/texturas-tpu', verifyToken, webOrdersController.getTexturasTpu);

// TPU: elección de textura por zona. El POST solo entra mientras el pedido espera aprobación.
router.get('/orden/:ordenId/texturas', verifyToken, impersonarCliente, webOrdersController.getTexturasOrden);
router.post('/orden/:ordenId/texturas', verifyToken, impersonarCliente, webOrdersController.setTexturasOrden);

// GET /api/web-orders/active-sublimation
router.get('/active-sublimation', verifyToken, impersonarCliente, webOrdersController.getActiveSublimationOrders);

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

// PATCH /api/web-orders/pickup-orders/:id/shipping (Actualizar datos de envío)
router.patch('/pickup-orders/:id/shipping', verifyToken, webOrdersController.updatePickupShipping);

// POST /api/web-orders/saved-addresses (Guardar dirección)
router.post('/saved-addresses', verifyToken, webOrdersController.saveAddress);

// DELETE /api/web-orders/saved-addresses/:id (Eliminar dirección)
router.delete('/saved-addresses/:id', verifyToken, webOrdersController.deleteAddress);

// POST /api/web-orders/pickup-orders/pdf (Generar PDF)
router.post('/pickup-orders/pdf', verifyToken, webOrdersController.generatePickupReceipt);

// POST /api/web-orders/pickup-orders/handy-payment (Generar Link de Pago Handy)
router.post('/pickup-orders/handy-payment', verifyToken, webOrdersController.createHandyPaymentLink);

// POST /api/web-orders/pickup-orders/init-payment (Nuevo flujo: generar link sin crear retiro)
router.post('/pickup-orders/init-payment', verifyToken, webOrdersController.initHandyPayment);

// POST /api/web-orders/handy-webhook (Webhook Callback desde Handy)
router.post('/handy-webhook', webOrdersController.handyWebhook);

// POST /api/web-orders/pickup-orders/mp-payment (Generar preferencia MercadoPago)
router.post('/pickup-orders/mp-payment', verifyToken, webOrdersController.initMpPayment);

// POST /api/web-orders/mp-webhook (Webhook Callback desde MercadoPago)
router.post('/mp-webhook', webOrdersController.mpWebhook);

// ── TÓTEM ────────────────────────────────────────────────────────────────────
// No llevan verifyToken (el tótem no tiene usuario logueado) pero SÍ totemAuth: exigen el token
// de dispositivo. Antes estaban totalmente abiertas y el único control era un chequeo de IP en el
// front, que solo escondía la pantalla. Con TOTEM_TOKEN vacío el middleware deja pasar (dev).
const { totemAuth } = require('../middleware/totemAuth');

// POST /api/web-orders/totem-lookup (Buscar órdenes por código)
router.post('/totem-lookup', totemAuth, webOrdersController.totemLookup);

// POST /api/web-orders/totem-lookup-by-client (Buscar órdenes por QR del cliente)
router.post('/totem-lookup-by-client', totemAuth, webOrdersController.totemLookupByClient);

// GET /api/web-orders/totem-verify (¿este equipo está autorizado?) — SIN totemAuth a propósito:
// debe poder contestar { authorized:false } para que el tótem muestre la pantalla de bloqueo.
router.get('/totem-verify', webOrdersController.totemVerify);

// POST /api/web-orders/totem-create-pickup (Crear retiro desde tótem)
router.post('/totem-create-pickup', totemAuth, webOrdersController.totemCreatePickup);

// POST /api/web-orders/totem-announce (Anunciarse con orden de retiro)
router.post('/totem-announce', totemAuth, webOrdersController.totemAnnounce);

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
router.post('/create', verifyToken, impersonarCliente, webOrdersController.createWebOrder);

// POST /api/web-orders/aprobar-pedido — el CLIENTE aprueba un pedido retenido de su diseñador.
// SIN impersonarCliente a propósito: el diseñador no puede aprobar en nombre del cliente.
router.post('/aprobar-pedido', verifyToken, webOrdersController.aprobarPedido);
// POST /api/web-orders/rechazar-pedido — el CLIENTE rechaza el boceto; vuelve a producción marcada.
router.post('/rechazar-pedido', verifyToken, webOrdersController.rechazarPedido);

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

// DiskStorage temporal: evita cargar 300MB en RAM
const multer = require('multer');
const uploadTmpDir = path.join(__dirname, '../uploads/tmp');
if (!fs.existsSync(uploadTmpDir)) fs.mkdirSync(uploadTmpDir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadTmpDir),
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
    }),
    limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB
});

router.post('/upload-stream', verifyToken, impersonarCliente, upload.single('file'), webOrdersController.uploadOrderFile);

// TPU: PNG del boceto aprobado (parche renderizado + referencia de texturas) → ArchivosReferencia.
// Va acá abajo y no con el resto de las rutas TPU porque necesita `upload`, que se define recién
// unas líneas más arriba.
router.post('/orden/:ordenId/boceto-aprobado', verifyToken, impersonarCliente, upload.single('file'), webOrdersController.subirBocetoAprobado);

// ── TIENDA (e-commerce del portal — ver docs/ecommerce-portal-plan.md) ───────
// Catálogo de la vitrina: solo productos publicados en TiendaProductos, precio base y stock
// WMS informativo. Read-only con token del portal — el picking, el sync y la edición de
// precios quedan en las rutas internas (/api/wms), que un cliente no alcanza.
const tiendaController = require('../controllers/tiendaController');
router.get('/tienda/catalogo', verifyToken, impersonarCliente, tiendaController.getTiendaCatalogo);
// Checkout F2: compra de TERMINADOS — cliente del token, precios recalculados en el server
// (el body solo dice qué y cuánto), VEN- + ancla + remito automático. Se paga al retirar.
router.post('/tienda/checkout', verifyToken, impersonarCliente, tiendaController.checkoutTienda);

// TPU: "Mis matrices" — pedidos TPU finalizados del cliente con arte, para reusar.
router.get('/mis-matrices', verifyToken, impersonarCliente, webOrdersController.getMisMatrices);
// TPU: reusar una matriz — crea el pedido copiando el arte, directo a producción, sin cobrar la matriz.
router.post('/reuse-matriz', verifyToken, impersonarCliente, webOrdersController.reuseMatrizTPU);

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
