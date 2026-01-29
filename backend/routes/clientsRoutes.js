const express = require('express');
const router = express.Router();
const controller = require('../controllers/clientsController');

// GET /api/clients (Lista general para integración)
router.get('/', controller.getAllClients);

// GET /api/clients/external/:id (Proxy para API 6061)
router.get('/external/:id', controller.getMacrosoftClientData);

// GET /api/clients/react-list (Proxy para API React DataAll)
router.get('/react-list', controller.getAllReactClients);

// GET /api/clients/search?q=Juan (Búsqueda autocompletado)
// GET /api/clients/search?q=Juan (Búsqueda autocompletado en otros módulos)
router.get('/search', controller.searchClients);

// GET /api/clients/unified-search?term=... (Búsqueda inteligente Local -> Legacy)
router.get('/unified-search', controller.searchClientUnified);

// POST /api/clients (Crear cliente nuevo)
router.post('/', controller.createClient);

// PUT /api/clients/:codCliente/link (Vincular con React)
router.put('/:codCliente/link', controller.updateClientLink);

// POST /api/clients/import-react (Importar de React a Local)
router.post('/import-react', controller.importReactClient);

// POST /api/clients/export-react (Exportar de Local a React - Placeholder)
router.post('/export-react', controller.createReactClient);

module.exports = router;