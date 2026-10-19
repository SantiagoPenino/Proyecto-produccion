// Archivo de rutas (lugaresRoutes.js)
const express = require('express');
const router = express.Router();
const { getLugaresRetiro } = require('../controllers/lugaresRetiroController.js');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos (19/10): no tenía login. Lo usa solo Entrega de pedidos.
router.use(verifyToken, soloInternoConRol());

// Ruta para obtener los lugares de retiro
router.get('/lugares-retiro', getLugaresRetiro);

// Exportar las rutas
module.exports = router;