const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/vendedorVistaController');
const { verifyToken } = require('../middleware/authMiddleware');

// Vista 360 del Vendedor — SOLO LECTURA (no hay POST/PATCH/DELETE acá a propósito)
router.get('/clientes/:CliIdCliente/deposito-pendiente', verifyToken, ctrl.getDepositoPendiente);

// Cartera de vendedores (Clientes.VendedorID)
router.get('/vendedores',                       verifyToken, ctrl.getVendedores);
router.get('/vendedores/:VendedorID/clientes',  verifyToken, ctrl.getClientesDeVendedor);

module.exports = router;
