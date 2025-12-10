const express = require('express');
const router = express.Router();
const controller = require('../controllers/rollsController');

router.get('/board', controller.getBoardData);
router.post('/move', controller.moveOrder);
router.post('/create', controller.createRoll);

module.exports = router;