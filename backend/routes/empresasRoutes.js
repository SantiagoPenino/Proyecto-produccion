const express = require('express');
const router = express.Router();
const empresasController = require('../controllers/empresasController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Todo el router es del sistema interno (13/10): no tenía auth y cualquiera sin login podía
// cambiar la empresa emisora de las facturas. Todos los que lo llaman están en la app interna
// y mandan token (revisado ruta por ruta).
router.use(verifyToken, soloInternoConRol());

router.get('/', empresasController.listar);
router.get('/:id', empresasController.obtener);
router.post('/', empresasController.crear);
router.put('/:id', empresasController.actualizar);
router.post('/:id/default', empresasController.setPorDefecto);
router.post('/:id/toggle', empresasController.toggleActiva);

module.exports = router;
