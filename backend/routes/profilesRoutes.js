const express = require('express');
const router = express.Router();
const controller = require('../controllers/profilesController');

// 2. Asignación Clientes (Specific routes FIRST)
router.get('/assignments', controller.getAllCustomersWithProfile);
router.post('/assign', controller.assignProfileToCustomer);

// 1. Perfiles (Generic /:id routes LAST)
router.get('/', controller.getAllProfiles);
router.post('/', controller.saveProfile);
router.get('/:id', controller.getProfileDetails);
router.delete('/:id', controller.deleteProfile);

module.exports = router;
