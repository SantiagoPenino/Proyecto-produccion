const express = require('express');
const router = express.Router();
const controller = require('../controllers/failuresController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Catálogo de tipos de falla de producción (TiposFallas) — lo usa el panel de producción
// (ProduccionPanelSection → POST /titles). Los tickets de mantenimiento que vivían acá
// (TicketsMantenimiento) pasaron a Servicio Técnico: /api/servicio-tecnico (28/09/2026).
// Antes estas rutas no pedían login.
router.use(verifyToken, soloInternoConRol());

router.get('/titles', controller.searchFailureTitles); // ?q=texto&area=DF
router.post('/titles', controller.createFailureType);

module.exports = router;
