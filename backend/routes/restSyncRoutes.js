const express = require('express');
const router = express.Router();
// IMPORTANTE: Asegúrate de que el archivo en controllers se llame exactamente así
const RestSyncController = require('../controllers/RestSyncController');

// Esta es la ruta que llama el botón
router.post('/run', RestSyncController.syncOrders);

module.exports = router;