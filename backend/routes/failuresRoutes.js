const express = require('express');
const router = express.Router();
const controller = require('../controllers/failuresController');
const { verifyToken, soloInternoConRol, soloAdmin } = require('../middleware/authMiddleware');

// Catálogo de tipos de falla de producción (TiposFallas) — lo usa el panel de producción
// (ProduccionPanelSection → POST /titles). Los tickets de mantenimiento que vivían acá
// (TicketsMantenimiento) pasaron a Servicio Técnico: /api/servicio-tecnico (28/09/2026).
// Antes estas rutas no pedían login.
router.use(verifyToken, soloInternoConRol());

router.get('/titles', controller.searchFailureTitles); // ?q=texto&area=DF
router.post('/titles', controller.createFailureType);

// Pantalla «Tipos de falla» (/admin/tipos-falla, 23/10/2026): listar para cualquier interno; crear,
// editar y borrar solo admin.
router.get('/tipos', controller.listarTipos);
router.post('/tipos', soloAdmin, controller.crearTipo);
router.put('/tipos/:id', soloAdmin, controller.editarTipo);
router.delete('/tipos/:id', soloAdmin, controller.borrarTipo);

// Pestaña «Servicio Técnico»: las sugerencias del «¿Qué pasa?» (ST_TiposFalla)
router.get('/st-tipos', controller.listarSugerenciasST);
router.post('/st-tipos', soloAdmin, controller.crearSugerenciaST);
router.put('/st-tipos/:id', soloAdmin, controller.editarSugerenciaST);
router.delete('/st-tipos/:id', soloAdmin, controller.borrarSugerenciaST);

module.exports = router;
