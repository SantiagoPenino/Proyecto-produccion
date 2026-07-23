const express = require('express');
const router = express.Router();
const controller = require('../controllers/profilesController');
const urgExc    = require('../controllers/urgenciaExcepcionesController');
const urgDescRollo = require('../controllers/urgenciaDescuentoRolloController');

// Excepciones de urgencia (antes de rutas genéricas con /:id)
router.get('/urgencia-excepciones/areas',  urgExc.getAreas);
router.get('/urgencia-excepciones',        urgExc.getExcepciones);
router.post('/urgencia-excepciones',       urgExc.addExcepcion);
router.delete('/urgencia-excepciones/:id', urgExc.deleteExcepcion);

// Bonificación de metros por urgencia sin cargo (rollo por adelantado)
router.get('/urgencia-descuento-rollo/config',          urgDescRollo.getConfig);
router.put('/urgencia-descuento-rollo/config',           urgDescRollo.setConfig);
router.get('/urgencia-descuento-rollo/excepciones',      urgDescRollo.getExcepciones);
router.post('/urgencia-descuento-rollo/excepciones',     urgDescRollo.addExcepcion);
router.delete('/urgencia-descuento-rollo/excepciones/:id', urgDescRollo.deleteExcepcion);

// 2. Asignación Clientes (Specific routes FIRST)
router.get('/assignments', controller.getAllCustomersWithProfile);
router.post('/assign', controller.assignProfileToCustomer);

// 1. Perfiles (Generic /:id routes LAST)
router.get('/', controller.getAllProfiles);
router.post('/', controller.saveProfile);
router.get('/:id', controller.getProfileDetails);
router.patch('/:id/categoria', controller.updateCategoria);
router.delete('/:id', controller.deleteProfile);

module.exports = router;
