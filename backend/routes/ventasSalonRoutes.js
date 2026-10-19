'use strict';
// /api/ventas-salon — ventas de promos que cargan los vendedores de salón y sus comisiones (19/10/2026).
// Usuarios internos. Quién puede qué (por las entradas del menú del rol) lo decide el service.
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/ventasSalonController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(soloInternoConRol());

router.get('/mi-perfil', ctrl.miPerfil);
router.get('/vendedores', ctrl.listarVendedores);     // supervisor: para cargar a nombre de otro
router.get('/franjas', ctrl.franjas);
router.put('/franjas', ctrl.guardarFranjas);          // solo Admin
router.get('/resumen', ctrl.resumen);                 // ?anio&mes — supervisor
router.get('/ganadores', ctrl.ganadores);             // supervisor

router.get('/', ctrl.listar);                         // ?anio&mes[&idUsuario]
router.post('/', ctrl.crear);
router.put('/:id', ctrl.actualizar);
router.post('/:id/anular', ctrl.anular);

module.exports = router;
