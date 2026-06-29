const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/produccionAnalyticsController');

router.use(verifyToken);

router.get('/filtros',                    ctrl.getFiltros);
router.get('/dashboard',                  ctrl.getDashboard);
router.get('/reporte/ordenes',            ctrl.getReporteOrdenes);
router.get('/reporte/metros-material',    ctrl.getReporteMetrosMaterial);
router.get('/reporte/clientes',           ctrl.getReporteClientes);
router.get('/reporte/fallas-reposiciones',ctrl.getReporteFallasReposiciones);
router.get('/reporte/cancelaciones',      ctrl.getReporteCancelaciones);

module.exports = router;
