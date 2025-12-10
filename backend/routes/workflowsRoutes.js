const express = require('express');
const router = express.Router();
const controller = require('../controllers/workflowsController');

router.get('/', controller.getWorkflows);
router.post('/', controller.createWorkflow);

module.exports = router;