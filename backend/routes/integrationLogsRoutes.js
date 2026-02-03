const express = require('express');
const router = express.Router();
const controller = require('../controllers/integrationLogsController');

router.get('/', controller.getLogs);
router.put('/resolve', controller.resolveLog);
router.post('/clean', controller.clearLogs);

module.exports = router;
