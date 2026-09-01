const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/presupuestosController');

// Presupuestos y hojas membretadas (/ventas/presupuestos)
router.get('/catalogo',    verifyToken, ctrl.getCatalogo);
router.get('/cotizacion',  verifyToken, ctrl.getCotizacion);   // antes de /:id, o la captura el matcher
router.get('/',            verifyToken, ctrl.list);
router.get('/:id',         verifyToken, ctrl.getOne);
router.post('/',           verifyToken, ctrl.create);
router.put('/:id',         verifyToken, ctrl.update);
router.put('/:id/estado',  verifyToken, ctrl.setEstado);

module.exports = router;
