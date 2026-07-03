const express = require('express');
const router = express.Router();
const empresasController = require('../controllers/empresasController');

router.get('/', empresasController.listar);
router.get('/:id', empresasController.obtener);
router.post('/', empresasController.crear);
router.put('/:id', empresasController.actualizar);
router.post('/:id/default', empresasController.setPorDefecto);
router.post('/:id/toggle', empresasController.toggleActiva);

module.exports = router;
