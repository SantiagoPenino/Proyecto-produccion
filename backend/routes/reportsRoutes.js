const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

// Solo usuarios internos (19/10): no tenía login. Lo usa solo Perfiles de precios (PriceReports).
router.use(verifyToken, soloInternoConRol());

router.get('/client/:clientId', reportsController.getClientPriceOverview);
router.get('/profile/:profileId/clients', reportsController.getProfileClients);

module.exports = router;
