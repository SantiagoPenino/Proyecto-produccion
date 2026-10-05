'use strict';
const express = require('express');
const router = express.Router();
const configuradorController = require('../controllers/configuradorController');
const { verifyToken } = require('../middleware/authMiddleware');
const uploadFichaDiseno = require('../middleware/multerFichaDisenoConfig');
const uploadMoldeTizada = require('../middleware/multerMoldeTizadaConfig');

// Configurador de Productos — /api/configurador
// Camino aislado: no toca web-orders / prendas-orders / stockart.
// Los moldes NO se cargan acá: viven en TizadaPro (base externa, solo lectura).
router.use(verifyToken);

// Productos configurables
router.get('/productos', configuradorController.getProductos);
router.post('/productos', configuradorController.crearProducto);
router.get('/productos/:proId', configuradorController.getProductoFicha);
router.put('/productos/:proId', configuradorController.guardarProductoConfig);
router.put('/productos/:proId/identidad', configuradorController.actualizarIdentidad);   // nombre y código del artículo

// Etiquetas (árbol: Familia → Etiqueta → Producto)
router.get('/etiquetas', configuradorController.getEtiquetas);
router.post('/etiquetas', configuradorController.crearEtiqueta);
router.put('/etiquetas/:id', configuradorController.renombrarEtiqueta);
router.put('/productos/:proId/etiqueta', configuradorController.asignarEtiqueta);

// Catálogo de técnicas (opciones por área EMB/DF/TPU)
router.get('/tecnicas', configuradorController.getTecnicas);
router.post('/tecnicas', configuradorController.crearTecnicaOpcion);
router.put('/tecnicas/:id', configuradorController.updateTecnicaOpcion);

// Productos del local (selector del paso Origen: stock vivo del WMS)
router.get('/productos-local', configuradorController.getProductosLocal);
// [ACCESORIOS] depósitos del WMS y stock vivo por depósito
router.get('/depositos-wms', configuradorController.getDepositosWms);
router.get('/stock-wms/:depositoId', configuradorController.getStockWms);

// F1: producción principal — áreas que pueden producir un producto y materiales de impresión de cada área
router.get('/areas-principales', configuradorController.getAreasPrincipales);
router.get('/materiales-area/:areaId', configuradorController.getMaterialesArea);

// Moldes de TizadaPro (solo lectura): modelos, piezas, talles y telas permitidas
router.get('/tizadapro/moldes', configuradorController.getTizadaProMoldes);
router.post('/tizadapro/moldes/procesar-carpeta', configuradorController.procesarCarpetaMoldes);   // siluetas desde la carpeta de PDFs
router.get('/tizadapro/moldes/:ref', configuradorController.getTizadaProMolde);
// PDF del molde (una vez por molde) → siluetas de las piezas
router.post('/tizadapro/moldes/:ref/pdf', (req, res, next) => uploadMoldeTizada.single('molde')(req, res, (err) => (err ? res.status(400).json({ error: err.message }) : next())), configuradorController.subirPdfMoldeTizadaPro);

// Ficha de diseño (catálogo ISO chico + dibujo técnico anotable)
router.get('/costuras-iso', configuradorController.getCosturasIso);          // ?all=1 incluye inactivas
router.post('/costuras-iso', configuradorController.crearCosturaIso);
router.put('/costuras-iso/:id', configuradorController.updateCosturaIso);
// [PASO A PASO] imagen de la costura, foto de un paso y catálogo de máquinas de costura
router.post('/costuras-iso/:id/imagen', uploadFichaDiseno.single('imagen'), configuradorController.subirImagenCosturaIso);
router.post('/ficha-diseno/imagen-paso', uploadFichaDiseno.single('imagen'), configuradorController.subirImagenPasoCostura);
router.get('/maquinas-costura', configuradorController.getMaquinasCostura);  // ?all=1 incluye inactivas
router.post('/maquinas-costura', configuradorController.crearMaquinaCostura);
router.put('/maquinas-costura/:id', configuradorController.updateMaquinaCostura);

// Catálogo de avíos (cierres, botones, elásticos…)
router.get('/avios', configuradorController.getAvios);                     // ?all=1 incluye inactivos
router.post('/avios', configuradorController.crearAvio);
router.put('/avios/:id', configuradorController.updateAvio);
router.post('/productos/:proId/ficha-diseno/dibujo', uploadFichaDiseno.single('dibujo'), configuradorController.subirDibujoFicha);

module.exports = router;
