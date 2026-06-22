const express = require('express');
const router = express.Router();
const externalController = require('../controllers/externalController');

// Endpoint para extraer las órdenes (OrdenesDeposito) con importe, paginadas
// GET /api/external/ordenes?page=1&pageSize=100&fechaDesde=&fechaHasta=&codigoOrden=&estado=&idCliente=&material=
router.get('/ordenes', externalController.getOrdenes);

// Endpoint para extraer la lista de Vendedores (Trabajadores)
// GET /api/external/vendedores
router.get('/vendedores', externalController.getVendedores);

// Endpoint para extraer la lista de clientes desde otro sistema
// GET /api/external/clientes
router.get('/clientes', externalController.getClientes);

// Endpoint para actualizar el Vendedor de un cliente
// PATCH /api/external/clientes/:id/vendedor
router.patch('/clientes/:id/vendedor', externalController.updateVendedor);

module.exports = router;
