'use strict';
// /api/rrhh — Recursos Humanos (solo usuarios internos). Cada pantalla exige que el rol tenga su
// entrada en el menú (Admin siempre).
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rrhhController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(soloInternoConRol());

// Descuento a trabajadores (perfil de precios "Descuento Trabajadores 10%").
// Las rutas fijas van antes que /:cliId.
const base = '/descuento-trabajadores';
router.get(base,                                   ctrl.exigirAcceso, ctrl.listar);
router.get(`${base}/buscar`,                       ctrl.exigirAcceso, ctrl.buscar);
router.get(`${base}/trabajadores`,                 ctrl.exigirAcceso, ctrl.buscarTrabajadores);
router.post(`${base}/vinculos`,                    ctrl.exigirAcceso, ctrl.vincular);
router.delete(`${base}/vinculos/:cedula/:cliId`,   ctrl.exigirAcceso, ctrl.desvincular);
router.put(`${base}/clientes/:cliId/ci`,           ctrl.exigirAcceso, ctrl.actualizarCiCliente);
router.put(`${base}/trabajadores/:cedula/ci`,      ctrl.exigirAcceso, ctrl.actualizarCiTrabajador);
router.post(`${base}/:cliId`,                      ctrl.exigirAcceso, ctrl.aplicar);
router.delete(`${base}/:cliId`,                    ctrl.exigirAcceso, ctrl.quitar);

module.exports = router;
