const express = require('express');
const router = express.Router();
const controller = require('../controllers/productsIntegrationController');

// 1. Obtener Lista de Articulos locales
router.get('/local', controller.getLocalArticles);

// 2. Proxy para obtener JSON remoto
router.get('/remote', controller.getRemoteProducts);

// 3. Vincular un producto
router.post('/link', controller.linkProduct);

// 4. Desvincular
router.post('/unlink', controller.unlinkProduct);

// 5. Actualizar Producto Local
router.post('/update', controller.updateLocalProduct);

// 6. Crear Producto Local (nuevo)
router.post('/create', controller.createLocalProduct);

// 6b. Eliminar Producto Local
router.delete('/:id', controller.deleteLocalProduct);

const uploadArticulo = require('../middleware/multerArticulosConfig');

// 7. Actualizar ID Maestro WMS
router.put('/wms/:id', controller.updateWmsMasterId);

// 7.1 Obtener Master Products de WMS
router.get('/wms/masters', controller.getWmsMasters);

// 7.1.1 Importar Master Product desde WMS
router.post('/wms/import/:id', controller.importWmsMaster);

// 7.2 Obtener Variantes de un Master Product del WMS
router.get('/wms/variants/:id', controller.getWmsVariants);

// 8. Cargar Imagen Articulo (campo opcional 'color' en el multipart → imagen de ese color)
router.post('/upload-image/:id', uploadArticulo.single('image'), controller.uploadArticleImage);

// 8b. Imágenes del artículo (principal + por color) / borrar la de un color (?color=ROJO)
router.get('/article-images/:id', controller.getArticleImages);
router.delete('/article-image/:id', controller.deleteArticleImageColor);

// 9. Variantes locales de un artículo y precios
router.get('/article-variants/:id', controller.getArticleVariants);
router.put('/article-variants/:id/price', controller.updateVariantPrice);

// 10. [MARKETING] Admin de la vitrina de la tienda (/marketing/productos): lista de
// productos vendibles con su estado de publicación + upsert de la ficha de venta.
const tiendaCtrl = require('../controllers/tiendaController');
router.get('/vitrina', tiendaCtrl.getVitrinaAdmin);
router.put('/vitrina/:id', tiendaCtrl.saveVitrinaProducto);
// Variantes con ejes Talle/Color (backfill incremental al leer + corrección manual)
router.get('/vitrina/:id/variantes', tiendaCtrl.getVitrinaVariantes);
router.put('/vitrina/:id/variantes-ejes', tiendaCtrl.saveVitrinaVariantesEjes);

module.exports = router;
