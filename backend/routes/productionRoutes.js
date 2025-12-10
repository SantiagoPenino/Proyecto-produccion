const express = require('express');
const router = express.Router();
const controller = require('../controllers/productionController');

router.get('/board', controller.getProductionBoard);
router.post('/assign', controller.assignRollToMachine);

module.exports = router;