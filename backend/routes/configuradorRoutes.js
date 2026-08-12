const express = require('express');
const router = express.Router();
const configuradorController = require('../controllers/configuradorController');
const { verifyToken } = require('../middleware/authMiddleware');

// CONFIGURADOR DE PRODUCTOS (/configurar-productos) — ver configuradorController.
// Camino aislado: no toca web-orders / prendas-orders / stockart.
router.use(verifyToken);

// Productos configurables
router.get('/productos', configuradorController.getProductos);
router.post('/productos', configuradorController.crearProducto);
router.get('/productos/:proId', configuradorController.getProductoFicha);
router.put('/productos/:proId', configuradorController.guardarProductoConfig);

// Catálogo de técnicas (opciones por área EMB/DF/TPU)
router.get('/tecnicas', configuradorController.getTecnicas);
router.post('/tecnicas', configuradorController.crearTecnicaOpcion);
router.put('/tecnicas/:id', configuradorController.updateTecnicaOpcion);

// Catálogo de componentes (confeccionados: cuello/manga/puño/costado)
router.get('/componentes', configuradorController.getComponentes);
router.post('/componentes', configuradorController.crearComponenteOpcion);
router.put('/componentes/:id', configuradorController.updateComponenteOpcion);

// Selector del paso Origen: productos del local con stock vivo (falla blanda)
router.get('/productos-local', configuradorController.getProductosLocal);

module.exports = router;
