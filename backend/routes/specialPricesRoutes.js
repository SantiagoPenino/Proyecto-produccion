const express = require('express');
const router = express.Router();
const controller = require('../controllers/specialPricesController');

router.get('/clients', controller.getClients);
router.get('/:clientId', controller.getClientRules);
router.post('/profile', controller.saveClientProfile);
router.delete('/:clientId', controller.deleteClient);

module.exports = router;
