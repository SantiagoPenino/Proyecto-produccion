const express = require('express');
const router = express.Router();
const controller = require('../controllers/clientsController');

// GET /api/clients/search?q=Juan
router.get('/search', controller.searchClients);

// POST /api/clients (Crear cliente nuevo)
router.post('/', controller.createClient);

module.exports = router;