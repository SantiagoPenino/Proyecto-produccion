// =====================================================================
// CONSULTA AL CLIENTE — rutas internas (planta)
// =====================================================================
// Las del portal del cliente viven en webOrdersRoutes (/api/web-orders/consultas),
// para que queden bajo la misma autenticación que el resto del portal.
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/consultasClienteController');
const { verifyToken } = require('../middleware/authMiddleware');
const { uploadConsultas } = require('../middleware/multerConsultasConfig');

router.use(verifyToken);

// Decisión 3 del plan: consultan TODOS los usuarios internos, sin permiso especial.

router.get('/motivos', ctrl.getMotivos);
router.get('/orden/:ordenId', ctrl.getPorOrden);
router.get('/foto/:consultaId/:fotoId', ctrl.getFoto);

// multipart: campos + fotos[] (hasta 5, solo imágenes, 5 MB c/u)
router.post('/', uploadConsultas.array('fotos', 5), ctrl.crear);
router.post('/:id/retirar', ctrl.retirar);

module.exports = router;
