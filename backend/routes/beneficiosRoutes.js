'use strict';
// /api/beneficios — beneficios pactados sobre la billetera (solo usuarios internos).
// Quién aprueba, pausa y cierra lo decide el servicio (roles Admin / Administracion);
// proponer y consultar lo puede cualquier usuario interno con acceso al menú.
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/beneficiosController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(soloInternoConRol());

router.get('/config', ctrl.getConfig);
router.post('/config', ctrl.setConfig);
router.get('/catalogo', ctrl.catalogo);

// Aprobadores autorizados a mano (además de los roles Admin/Administracion)
router.get('/aprobadores', ctrl.listarAprobadores);
router.post('/aprobadores', ctrl.agregarAprobador);
router.post('/aprobadores/:idUsuario/quitar', ctrl.quitarAprobador);

router.get('/plantillas', ctrl.listarPlantillas);
router.post('/plantillas', ctrl.crearPlantilla);
router.put('/plantillas/:id', ctrl.editarPlantilla);
router.post('/plantillas/:id/:accion(aprobar|rechazar|pausar|reanudar|enviar)', ctrl.accionPlantilla);

router.post('/evaluar', ctrl.evaluar);
router.get('/pactos', ctrl.listarPactos);
router.post('/pactos', ctrl.proponerPacto);
router.put('/pactos/:id', ctrl.editarPacto);
router.post('/pactos/:id/:accion(aprobar|rechazar|cancelar)', ctrl.decidirPacto);

router.get('/cliente/:cliId', ctrl.vistaCliente);
router.post('/activar', ctrl.activarDesdeCaja);
router.post('/bolsas/:bclId/:accion(pausar|reanudar|cerrar)', ctrl.accionBolsa);
router.post('/bolsas/:bclId/refrescar', ctrl.refrescarBolsa);

router.get('/:id', ctrl.obtener);

module.exports = router;
