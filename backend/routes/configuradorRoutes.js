const express = require('express');
const router = express.Router();
const configuradorController = require('../controllers/configuradorController');
const moldesController = require('../controllers/moldesController');
const { verifyToken } = require('../middleware/authMiddleware');
const uploadFichaDiseno = require('../middleware/multerFichaDisenoConfig');
const uploadMolde = require('../middleware/multerMoldeConfig');

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
router.put('/componentes/:id/piezas', configuradorController.setPiezasComponente);

// Nomenclador de piezas (Frente / Espalda / Manga izquierda / ...) — de acá
// sale el combo de Posición del aplique
router.get('/piezas', configuradorController.getPiezas);
router.post('/piezas', configuradorController.crearPieza);
router.put('/piezas/:id', configuradorController.updatePieza);

// Selector del paso Origen: productos del local con stock vivo (falla blanda)
router.get('/productos-local', configuradorController.getProductosLocal);

// Variantes (confeccionados — motor cartesiano de Componentes)
router.get('/productos/:proId/variantes', configuradorController.getVariantes);
router.post('/productos/:proId/variantes/generar', configuradorController.generarVariantes);
router.put('/variantes/:id', configuradorController.updateVariante);

// Ficha de diseño imprimible (dibujo anotado + campos del pie + costuras ISO)
router.get('/costuras-iso', configuradorController.getCosturasIso);
router.post('/productos/:proId/ficha-diseno/dibujo', uploadFichaDiseno.single('dibujo'), configuradorController.subirDibujoFicha);

// Moldes escalados (/moldes) — se sube el PDF del plotter, el backend lo
// despieza y el usuario rotula cada nido contra PiezasPrenda. Ver
// moldesController y docs/migrations/moldes_escalados.sql.
router.get('/curvas-talle', moldesController.getCurvas);
router.get('/moldes', moldesController.getMoldes);
router.post('/moldes', uploadMolde.single('molde'), moldesController.subirMolde);
router.get('/moldes/:id', moldesController.getMolde);
router.put('/moldes/:id/piezas', moldesController.rotularPiezas);
router.get('/moldes/:id/extraer', moldesController.extraerTalle);

module.exports = router;
