const express = require('express');
const router = express.Router();
const productionKanbanController = require('../controllers/productionKanbanController');
const { verifyToken } = require('../middleware/authMiddleware');
// Mover un lote a una máquina choca seguido con "sacar del lote" (tocan Ordenes y Rollos al revés).
// Si SQL nos elige como víctima del deadlock (1205) se reintenta solo; el handler relanza ese error
// en vez de responder. Ver utils/reintentarDeadlock.
const { conReintentoDeadlock } = require('../utils/reintentarDeadlock');

router.get('/board', productionKanbanController.getBoard);
router.post('/assign', verifyToken, conReintentoDeadlock(productionKanbanController.assignRoll));
router.post('/unassign', verifyToken, conReintentoDeadlock(productionKanbanController.unassignRoll));

module.exports = router;