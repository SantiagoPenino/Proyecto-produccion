const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/stockArtController');

router.use(verifyToken);

router.get('/', ctrl.getStockArt);
router.post('/', ctrl.createStockArt);
router.get('/productos-terminados', ctrl.getProductosTerminados);
router.post('/productos-terminados', ctrl.crearProductoTerminado);
router.put('/productos-terminados/:codArticulo', ctrl.updateProductoTerminadoDatos);
router.get('/terminaciones', ctrl.getTerminacionesCatalogo);
router.post('/terminaciones', ctrl.createTerminacion);
router.get('/terminaciones/articulos-disponibles', ctrl.getArticulosParaTerminaciones);
router.get('/materiales-impresion', ctrl.getMaterialesImpresion);
router.get('/terminaciones/:id/materiales', ctrl.getMaterialesDeTerminacion);
router.put('/terminaciones/:id/materiales', ctrl.setMaterialesDeTerminacion);
router.put('/terminaciones/:id', ctrl.updateTerminacion);
router.get('/articulos/:codArticulo/terminaciones', ctrl.getTerminacionesArticulo);
router.put('/articulos/:codArticulo/terminaciones', ctrl.setTerminacionesArticulo);
router.get('/articulos/:codArticulo/producto-terminado', ctrl.getProductoTerminado);
router.put('/articulos/:codArticulo/producto-terminado', ctrl.setProductoTerminado);
router.put('/articulos/:codArticulo/precio-base', ctrl.setPrecioBaseArticulo);
router.put('/articulos/:codArticulo/mover', ctrl.moverArticulo);
router.delete('/articulos/:codArticulo', ctrl.deleteArticulo);
router.get('/:codStock/articulos', ctrl.getArticulos);
router.put('/:codStock', ctrl.updateStockArt);
router.delete('/:codStock', ctrl.deleteStockArt);

module.exports = router;
