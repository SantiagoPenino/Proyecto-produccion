const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { obtenerMetodosPago, realizarPago, subirComprobante } = require('../controllers/pagosController');
const upload = require('../middleware/multerConfig'); // Importar configuración de multer

// Ruta para obtener métodos de pago
router.get('/metodos', obtenerMetodosPago);

// Ruta para realizar un pago
router.post('/realizarPago', verifyToken, realizarPago);

// Ruta para subir un comprobante
router.post('/uploadComprobante', verifyToken, upload.single('comprobante'), subirComprobante);

module.exports = router;
