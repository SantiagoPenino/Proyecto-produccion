const express = require('express');
const router = express.Router();
const rolesController = require('../controllers/rolesController');
const { verifyToken, soloAdmin } = require('../middleware/authMiddleware');

// Hasta el 28/09/2026 estas rutas no pedían login. Todo solo Admin, lectura incluida: las
// únicas pantallas que las usan son Roles y Usuarios (RolesPage.jsx, UsersPage.jsx).
router.use(verifyToken, soloAdmin);

router.get('/', rolesController.getAll);
router.post('/', rolesController.create);
router.put('/:id', rolesController.update);
router.delete('/:id', rolesController.delete);
router.get('/:id/permissions', rolesController.getPermissions);
router.post('/:id/permissions', rolesController.updatePermissions);

module.exports = router;
