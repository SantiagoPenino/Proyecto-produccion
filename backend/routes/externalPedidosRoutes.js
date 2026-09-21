'use strict';
// /api/external/pedidos-prenda — ingreso de pedidos de prenda por sistema (x-api-key).
// Documentación para el integrador: backend/docs/API_EXTERNAL_PEDIDOS_PRENDA.md
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/externalPedidosController');

router.use(rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Demasiados pedidos por minuto. Esperá y reintentá.' } }));
router.use(ctrl.verificarKey);   // TODA la ruta exige la key: un handler nuevo no puede quedar abierto por olvido

// Catálogos (valores válidos para armar el pedido)
router.get('/catalogo/telas', ctrl.catalogoTelas);
router.get('/catalogo/servicios', ctrl.catalogoServicios);
router.get('/catalogo/productos-terminados', ctrl.catalogoProductos);
router.get('/catalogo/clientes/:codCliente/bobinas', ctrl.catalogoBobinas);

// Pedidos
router.post('/', ctrl.recibir);
router.get('/:idExterno', ctrl.estado);
router.post('/:idExterno/reintentar-archivos', ctrl.reintentarArchivos);

module.exports = router;
