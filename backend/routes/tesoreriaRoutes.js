const express = require('express');
const router = express.Router();
const tesoreriaController = require('../controllers/tesoreriaController');

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
