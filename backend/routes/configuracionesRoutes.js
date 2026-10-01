const express = require('express');
const router = express.Router();
const configuracionesController = require('../controllers/configuracionesController');
const { verifyToken, soloInternoConRol, soloAdmin } = require('../middleware/authMiddleware');

// Hasta el 28/09/2026 no pedían login: cualquiera podía prender o apagar los procesos
// automáticos (ConfiguracionesSync) o mover la fila de la planilla.
// Leer el estado: cualquier usuario interno, porque Logística → Stock del Depósito
// (DepositStockPage.jsx) mira si la sincronización está prendida antes de enviar. Lo demás solo lo usa
// Configuración → Procesos Automáticos (ConfigSyncModal.jsx): solo Admin.
router.use(verifyToken);

router.get('/', soloInternoConRol(), configuracionesController.getConfiguraciones);
router.post('/toggle', soloAdmin, configuracionesController.updateConfiguracion);
router.get('/get-planilla-row', soloAdmin, configuracionesController.getPlanillaRow);
router.post('/set-planilla-row', soloAdmin, configuracionesController.setPlanillaRow);

module.exports = router;
