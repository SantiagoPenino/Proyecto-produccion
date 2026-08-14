const express = require('express');
const router = express.Router();
const controller = require('../controllers/planificacionController');

router.get('/agenda', controller.getAgenda);
router.get('/capacidad', controller.getCapacidad);
router.get('/capacidad/detalle', controller.getDetalleGrupo);
router.get('/historico', controller.getHistorico);

module.exports = router;
