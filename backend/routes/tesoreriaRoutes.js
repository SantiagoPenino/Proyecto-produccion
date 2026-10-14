const express = require('express');
const router = express.Router();
const tesoreriaController = require('../controllers/tesoreriaController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Todo el router es del sistema interno (13/10): no tenía auth y cualquiera sin login podía
// recibir, emitir o anular cheques. Todos los que lo llaman están en la app interna y mandan
// token (revisado ruta por ruta). De paso, el controller ahora registra el usuario real
// (req.user) en vez del 1 por defecto.
router.use(verifyToken, soloInternoConRol());

// Catálogo de Bancos
router.get('/bancos', tesoreriaController.getBancos);

// Operaciones de Cartera de Cheques
router.get('/cheques', tesoreriaController.getCheques);
router.post('/cheques/recibir', tesoreriaController.recibirCheque);
router.post('/cheques/emitir', tesoreriaController.emitirCheque);
router.patch('/cheques/:id/estado', tesoreriaController.cambiarEstadoCheque);
// Editar datos de un cheque en cartera (cliente, librador, fechas…). No toca importe ni estado.
router.put('/cheques/:id', tesoreriaController.editarCheque);
// Baja de un cheque cargado por error: lo marca ANULADO y revierte su asiento.
router.delete('/cheques/:id', tesoreriaController.anularCheque);

module.exports = router;
