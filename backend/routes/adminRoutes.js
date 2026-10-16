const express = require('express');
const router = express.Router();

const configGlobalController = require('../controllers/configGlobalController');
const { verifyToken, soloAdmin } = require('../middleware/authMiddleware');

// Hasta el 28/09/2026 estas rutas no pedían login. Todo solo Admin.
// Por ruta y no con router.use: este router está montado en /api/admin y un router.use
// también frenaría POST /api/admin/sync-precios, que está definida aparte en server.js.

// Configuración General (tabla ConfiguracionGlobal) — la usa ConfigGlobalModal.jsx
router.get('/config-global', verifyToken, soloAdmin, configGlobalController.getAll);
// Registro del intercambio con TIZADA PRO (llamadas, avisos y pedidos) — lo usa ConfigTizadaProLogModal.jsx
router.get('/tizadapro/registro', verifyToken, soloAdmin, require('../controllers/tizadaProRegistroController').getRegistro);
router.get('/tizadapro/envios/:id', verifyToken, soloAdmin, require('../controllers/tizadaProRegistroController').getEnvio);
router.put('/config-global', verifyToken, soloAdmin, configGlobalController.upsert);

module.exports = router;