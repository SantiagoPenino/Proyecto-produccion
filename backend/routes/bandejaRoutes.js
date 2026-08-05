const express = require('express');
const embBoardController = require('../controllers/embBoardController');
const { verifyToken } = require('../middleware/authMiddleware');

// [BANDEJA GENÉRICA] Fábrica de rutas "sin lotes" (Bandeja/Control) — un mismo controlador
// (embBoardController.js) sirve a cualquier área de servicio sin archivo de impresión
// propio (EMB, EST, TWC, TWT, ...). Cada área monta este router forzando su AreaID en
// req.query.area, así el controlador nunca depende de un default implícito.
function createBandejaRoutes(area) {
    const router = express.Router();
    router.use((req, res, next) => { req.query.area = area; next(); });

    router.get('/orders', verifyToken, embBoardController.getEmbOrders);
    router.get('/orders/bloqueadas', verifyToken, embBoardController.getEmbOrdersBloqueadas);
    router.get('/maquinas', verifyToken, embBoardController.getMaquinasEmb);
    router.put('/orders/:ordenId/maquina', verifyToken, embBoardController.asignarMaquina);
    router.put('/orders/:ordenId/operario', verifyToken, embBoardController.asignarOperario);
    router.put('/orders/:ordenId/trabajo', verifyToken, embBoardController.setEstadoTrabajo);
    router.put('/orders/:ordenId/progreso', verifyToken, embBoardController.setProgreso);
    router.post('/orders/:ordenId/finalizar-trabajo', verifyToken, embBoardController.finalizarTrabajo);
    router.put('/orders/:ordenId/progreso-control', verifyToken, embBoardController.setProgresoControl);
    router.post('/orders/:ordenId/aprobar-control', verifyToken, embBoardController.aprobarControl);

    return router;
}

module.exports = { createBandejaRoutes };
