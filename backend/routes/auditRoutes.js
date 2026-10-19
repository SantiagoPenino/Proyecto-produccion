const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos (19/10): no tenía login. Lo usa solo /admin/audit.
router.use(verifyToken, soloInternoConRol());

router.get('/', auditController.getAll);

module.exports = router;
