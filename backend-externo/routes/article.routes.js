// backend-externo/routes/article.routes.js

const express = require('express');
const router = express.Router();
// Importamos el objeto completo del controlador
const articuloController = require('../controllers/article.controller'); 

// Ruta principal: GET /api/articulos (con filtro opcional ?familia=COD)
router.get('/', articuloController.getAllArticulos);

// Nueva ruta para obtener la lista de familias
router.get('/familias', articuloController.getSuperFamilias);

module.exports = router;