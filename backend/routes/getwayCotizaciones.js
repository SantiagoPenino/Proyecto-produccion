const express = require('express');
const router = express.Router();
const { getCotizacionesHoy, insertCotizacion, fetchFromBCU, getCotizacionHasta } = require('../controllers/cotizacionesController');

// Ruta para obtener cotizaciones de hoy
router.get('/hoy', getCotizacionesHoy);

// La última cotización cargada hasta una fecha (?fecha=AAAA-MM-DD)
router.get('/hasta', getCotizacionHasta);

// Ruta para insertar una nueva cotización
router.post('/insertar', insertCotizacion);

// Buscar cotización directamente del BCU (on demand)
router.get('/bcu', fetchFromBCU);

module.exports = router;
