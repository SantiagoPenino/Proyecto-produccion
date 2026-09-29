const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificacionesController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos logueados: cada uno ve y marca SUS avisos.
router.use(verifyToken, soloInternoConRol());

router.get('/', controller.listar);                          // GET  /api/notificaciones
router.post('/leer-todas', controller.marcarTodas);          // POST /api/notificaciones/leer-todas
router.post('/:id/leida', controller.marcarLeida);           // POST /api/notificaciones/:id/leida
router.post('/push/suscribir', controller.suscribirPush);    // POST { subscription, dispositivo }
router.post('/push/desuscribir', controller.desuscribirPush);// POST { endpoint }
router.post('/push/probar', controller.probarPush);          // POST → push de prueba

module.exports = router;
