const express = require('express');
const router = express.Router();

// Verifica que la ruta al archivo sea correcta (../controllers/adminController)
const adminController = require('../controllers/adminController');

const configGlobalController = require('../controllers/configGlobalController');

// Aquí es donde daba el error.
// Si adminController.getDynamicData no existe, explota.
router.get('/dynamic', adminController.getDynamicData);

// Configuración General (tabla ConfiguracionGlobal)
router.get('/config-global', configGlobalController.getAll);
router.put('/config-global', configGlobalController.upsert);

module.exports = router;