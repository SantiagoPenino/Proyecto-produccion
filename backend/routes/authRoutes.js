const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware'); // Asegúrate que este middleware exista en tu proyecto

router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
// POST /register borrado el 10/09/2026: creaba usuarios INTERNOS desde un endpoint
// público y nunca funcionó (columnas inexistentes). Ver la nota en authController.
// El registro de clientes es POST /api/web-auth/register.
router.get('/me', verifyToken, authController.me);

module.exports = router;