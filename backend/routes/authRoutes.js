const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware'); // Asegúrate que este middleware exista en tu proyecto

router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.post('/register', authController.register);
router.get('/me', verifyToken, authController.me);

module.exports = router;