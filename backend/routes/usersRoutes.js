const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const { verifyToken, soloInternoConRol, soloAdmin } = require('../middleware/authMiddleware');

// Hasta el 28/09/2026 estas rutas no pedían login: sin token se podía crear un usuario Admin.
// Listar: cualquier usuario interno, porque las bandejas de Bordado/Estampado/Corte/Costura
// (EmbBandeja.jsx) lo usan para elegir operario. Alta, cambios y bajas: solo Admin.
router.use(verifyToken);

router.get('/', soloInternoConRol(), usersController.getAll);
router.post('/', soloAdmin, usersController.create);
router.put('/:id', soloAdmin, usersController.update);
router.delete('/:id', soloAdmin, usersController.delete);

module.exports = router;
