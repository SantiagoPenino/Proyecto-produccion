const express = require('express');
const router = express.Router();
const controller = require('../controllers/productsIntegrationController');

// 1. Obtener Lista de Articulos locales
router.get('/local', controller.getLocalArticles);

// 2. Proxy para obtener JSON remoto
router.get('/remote', controller.getRemoteProducts);

// 3. Vincular un producto
router.post('/link', controller.linkProduct);

// 4. Desvincular
router.post('/unlink', controller.unlinkProduct);

module.exports = router;
