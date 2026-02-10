const express = require('express');
const router = express.Router();
const webOrdersController = require('../controllers/webOrdersController');
const { verifyToken } = require('../middleware/authMiddleware');

const driveService = require('../services/driveService');

// GET /api/web-orders/my-orders
router.get('/my-orders', verifyToken, webOrdersController.getClientOrders);

// GET /api/web-orders/active-sublimation
router.get('/active-sublimation', verifyToken, webOrdersController.getActiveSublimationOrders);

// Endpoint para creación de pedido desde Cliente Web
// POST /api/web-orders/create
router.post('/create', verifyToken, webOrdersController.createWebOrder);

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

module.exports = router;
