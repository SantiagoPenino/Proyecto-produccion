const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');

const { verifyToken, soloAdmin } = require('../middleware/authMiddleware');

// Hasta el 28/09/2026 solo pedían verifyToken, que acepta cualquier token: un cliente del
// portal o un diseñador podía crear, editar y borrar módulos del menú.

// El menú propio: App.jsx lo pide al entrar con el id del logueado, también para los clientes
// del portal. Un token que no es interno no tiene menú del sistema: se le devuelve vacío, sin
// 403 para no llenar el log en cada visita al portal (antes podía recibir el menú del usuario
// interno con su mismo número). El menú de otro usuario, solo un Admin.
const soloSuMenu = (req, res, next) => {
    if (req.user.userType !== 'INTERNAL') return res.json([]);
    if (String(req.params.userId) === String(req.user.id)) return next();
    return soloAdmin(req, res, next);
};
router.get('/user/:userId', verifyToken, soloSuMenu, menuController.getByUser);

// Editor del menú (MenuAdmin.jsx) y lista de módulos de Roles (RolesPage.jsx): solo Admin.
router.get('/', verifyToken, soloAdmin, menuController.getAll);
router.post('/', verifyToken, soloAdmin, menuController.create);
router.put('/:id', verifyToken, soloAdmin, menuController.update);
router.delete('/:id', verifyToken, soloAdmin, menuController.remove);

module.exports = router;