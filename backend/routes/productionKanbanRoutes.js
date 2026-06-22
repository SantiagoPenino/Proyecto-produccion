const express = require('express');
const router = express.Router();
const productionKanbanController = require('../controllers/productionKanbanController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/board', productionKanbanController.getBoard);
router.post('/assign', verifyToken, productionKanbanController.assignRoll);
router.post('/unassign', verifyToken, productionKanbanController.unassignRoll);

module.exports = router;