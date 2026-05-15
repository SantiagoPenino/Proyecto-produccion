const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { getSincroArticulos, saveSincroArticulos } = require('../controllers/sincroController');

router.use(verifyToken);

router.get('/articulos', getSincroArticulos);
router.put('/articulos', saveSincroArticulos);

module.exports = router;
