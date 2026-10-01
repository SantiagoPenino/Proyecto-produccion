const express = require('express');
const router = express.Router();

// Verifica que la ruta al archivo sea correcta (../controllers/adminController)
const adminController = require('../controllers/adminController');

const configGlobalController = require('../controllers/configGlobalController');
const { verifyToken, soloAdmin } = require('../middleware/authMiddleware');

// Hasta el 28/09/2026 estas rutas no pedían login. Todo solo Admin.
// Por ruta y no con router.use: este router está montado en /api/admin y un router.use
// también frenaría POST /api/admin/sync-precios, que está definida aparte en server.js.

// Aquí es donde daba el error.
// Si adminController.getDynamicData no existe, explota.
// Nadie la llama hoy: AdminDashboard.jsx no se importa en ningún lado.
router.get('/dynamic', verifyToken, soloAdmin, adminController.getDynamicData);

// Configuración General (tabla ConfiguracionGlobal) — la usa ConfigGlobalModal.jsx
router.get('/config-global', verifyToken, soloAdmin, configGlobalController.getAll);
router.put('/config-global', verifyToken, soloAdmin, configGlobalController.upsert);

module.exports = router;