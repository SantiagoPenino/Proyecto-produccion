const express = require('express');
const router = express.Router();
const controller = require('../controllers/logisticaWmsController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/pending', verifyToken, controller.getPendingOrders);
router.get('/prepared', verifyToken, controller.getPreparedOrders);
router.put('/start/:pedidoId', verifyToken, controller.startPreparation);
router.put('/confirm/:pedidoId', verifyToken, controller.confirmPreparation);
router.put('/receive/:pedidoId', verifyToken, controller.receivePreparedOrder);
router.put('/update-item/:pedidoId', verifyToken, controller.updateItemQuantity);
router.delete('/delete-item/:pedidoId/:wms_variante_id', verifyToken, controller.deleteItem);
router.put('/cancel/:pedidoId', verifyToken, controller.cancelOrder);
router.put('/deliver/:pedidoId', verifyToken, controller.markDelivered);

// ── Diagnóstico público — abrí en el navegador
// http://localhost:5000/api/wms-logistica/wms-test
router.get('/wms-test', async (req, res) => {
    const base = 'http://3.85.26.173:5005';
    const results = [];

    // GET endpoints
    for (const path of ['/api/status', '/api/articulos', '/api/inventory/variants']) {
        try {
            const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(8000) });
            const ct = r.headers.get('content-type') || '';
            const body = await r.text();
            results.push({ method: 'GET', url: `${base}${path}`, status: r.status, isJson: ct.includes('json'), preview: body.substring(0, 150) });
        } catch (e) {
            results.push({ method: 'GET', url: `${base}${path}`, error: e.message });
        }
    }

    // POST /api/articulos/descontar — el que necesitamos
    try {
        const r = await fetch(`${base}/api/articulos/descontar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variante_id: 410, cantidad: 1, deposito_id: 5 }),
            signal: AbortSignal.timeout(8000)
        });
        const ct = r.headers.get('content-type') || '';
        const body = await r.text();
        results.push({ method: 'POST', url: `${base}/api/articulos/descontar`, status: r.status, isJson: ct.includes('json'), preview: body.substring(0, 200) });
    } catch (e) {
        results.push({ method: 'POST', url: `${base}/api/articulos/descontar`, error: e.message });
    }

    res.json({ resultados: results });
});

module.exports = router;
