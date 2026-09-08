const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { getDepositoDashboard } = require('../controllers/dashboardController');
const {
    getOverview,
    getAnalytics,
    getFiltros,
} = require('../controllers/productionAnalyticsController');
const { generarInforme } = require('../controllers/informeProduccionController');
const { getPanel, getPanelConfig, putPanelConfig } = require('../controllers/produccionPanelController');

router.get('/deposito', verifyToken, getDepositoDashboard);

// Producción analytics
router.get('/produccion/overview',  verifyToken, getOverview);
router.get('/produccion/analytics', verifyToken, getAnalytics);
router.get('/produccion/filtros',   verifyToken, getFiltros);
router.post('/produccion/informe',  verifyToken, generarInforme);

// Panel de Producción (Reportes de Contabilidad → Dashboard)
router.get('/produccion/panel',        verifyToken, getPanel);
router.get('/produccion/panel/config', verifyToken, getPanelConfig);
router.put('/produccion/panel/config', verifyToken, putPanelConfig);

module.exports = router;
