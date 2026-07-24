const express = require('express');
const router = express.Router();
const controller = require('../controllers/tareasController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todo el módulo requiere estar logueado; el controller además exige que sea usuario interno.
router.use(verifyToken);

router.get('/', controller.listar);              // GET  /api/tareas?estado=pendientes|hechas|todas
router.post('/', controller.crear);              // POST /api/tareas { titulo, descripcion? }
router.put('/:id/hecha', controller.marcarHecha);// PUT  /api/tareas/:id/hecha { hecha }
router.delete('/:id', controller.eliminar);      // DELETE /api/tareas/:id

module.exports = router;
