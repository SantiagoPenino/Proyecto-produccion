const express = require('express');
const router = express.Router();
const controller = require('../controllers/specialPricesController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Todo el router es del sistema interno (13/10): no tenía auth y cualquiera sin login podía
// cambiar o borrar los precios especiales de un cliente. Todos los que lo llaman están en la
// app interna y mandan token (revisado ruta por ruta).
router.use(verifyToken, soloInternoConRol());

router.get('/clients', controller.getClients);
router.get('/:clientId', controller.getClientRules);
router.post('/profile', controller.saveClientProfile);
router.delete('/:clientId', controller.deleteClient);

module.exports = router;
