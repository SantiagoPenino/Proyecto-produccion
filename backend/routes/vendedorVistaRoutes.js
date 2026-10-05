const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/vendedorVistaController');
const { verifyToken } = require('../middleware/authMiddleware');

// Vista 360 del Vendedor — SOLO LECTURA (no hay POST/PATCH/DELETE acá a propósito)
router.get('/clientes/:CliIdCliente/deposito-pendiente', verifyToken, ctrl.getDepositoPendiente);

// Ventas del mes por vendedor — antes de '/vendedores/:VendedorID/...' no hace falta
// (no comparten prefijo), pero se deja arriba por legibilidad.
router.get('/ventas-mensuales',                 verifyToken, ctrl.getVentasMensuales);
// El ganador de cada mes desde junio 2026 (para la tira de ganadores y la racha)
router.get('/ganadores',                        verifyToken, ctrl.getGanadores);

// Cartera de vendedores (Clientes.VendedorID)
router.get('/vendedores',                       verifyToken, ctrl.getVendedores);
router.get('/vendedores/:VendedorID/clientes',  verifyToken, ctrl.getClientesDeVendedor);

module.exports = router;
