const express = require('express');
const router = express.Router();
const controller = require('../controllers/pricesController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Todo el router es del sistema interno (13/10): no tenía auth y cualquiera sin login podía
// cambiar la lista de precios base. Todos los que lo llaman están en la app interna y mandan
// token (revisado ruta por ruta). El portal y las páginas públicas usan /api/precios-publicos.
router.use(verifyToken, soloInternoConRol());

// Rutas de Precios Base y Cálculo
router.get('/base', controller.getBasePrices);
router.post('/base', controller.saveBasePrice);
router.post('/base/bulk', controller.saveBasePricesBulk);
router.put('/lista-flags', controller.saveListFlags);
router.put('/descripcion-lista', controller.saveDescripcionLista);
router.get('/tiered', controller.getTieredPrices);
router.post('/tiered/bulk', controller.saveTieredPricesBulk);
router.post('/calculate', controller.calculatePriceEndpoint);
// Precios por cantidad (solo lectura, /vendedores/precios-cantidad): sin ?area, las áreas; con ?area, la matriz
router.get('/por-cantidad', controller.getPreciosPorCantidad);
// Tarifas por dato técnico (bordado: puntadas; estampado: bajadas), en ConfiguracionPrecios: las muestra y edita Precios Estándar
router.get('/tarifa/:tipo', controller.getTarifa);
router.put('/tarifa/:tipo', controller.saveTarifa);
// Lista de precios dinámica (29/10/2026, /admin/lista-precios-dinamica): tela × consumo + confección + margen por franja
const listaDinamica = require('../controllers/listaPreciosDinamicaController');
router.get('/lista-dinamica', listaDinamica.getDatos);
router.put('/lista-dinamica/config', listaDinamica.saveConfig);
router.post('/lista-dinamica/cotizar', listaDinamica.cotizar);
router.get('/lista-dinamica/producto/:proId', listaDinamica.getProducto);

module.exports = router;
