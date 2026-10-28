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
const { getPanel, getCumplimientoDetalle, getPanelConfig, putPanelConfig } = require('../controllers/produccionPanelController');
const cicloPlanta = require('../controllers/cicloPlantaController');

router.get('/deposito', verifyToken, getDepositoDashboard);

// Producción analytics
router.get('/produccion/overview',  verifyToken, getOverview);
router.get('/produccion/analytics', verifyToken, getAnalytics);
router.get('/produccion/filtros',   verifyToken, getFiltros);
router.post('/produccion/informe',  verifyToken, generarInforme);

// Tiempo de respuesta de cada área: ciclo en planta (plan INF-SIS-2026-04)
router.get('/produccion/ciclo',           verifyToken, cicloPlanta.getResumen);
router.get('/produccion/ciclo/orden/:id', verifyToken, cicloPlanta.getOrden);

// Panel de Producción (Reportes de Contabilidad → Dashboard)
router.get('/produccion/panel',        verifyToken, getPanel);
router.get('/produccion/panel/cumplimiento-detalle', verifyToken, getCumplimientoDetalle);
router.get('/produccion/panel/config', verifyToken, getPanelConfig);
router.put('/produccion/panel/config', verifyToken, putPanelConfig);

module.exports = router;
