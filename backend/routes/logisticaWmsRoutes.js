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
    const sqlBase = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
    const extBase = process.env.WMS_API_URL || 'https://administracionuser.uy/api/external';
    const apiKey  = process.env.WMS_API_KEY  || '';
    const results = [];

    // 1. Verificar que el /sql sigue vivo
    try {
        const r = await fetch(`${sqlBase}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'SELECT 1 AS test' }),
            signal: AbortSignal.timeout(5000)
        });
        const j = await r.json();
        results.push({ label: 'sql_alive', status: r.status, ok: j.success });
    } catch (e) { results.push({ label: 'sql_alive', error: e.message }); }

    // 2. Probar endpoint externo con distintos headers de auth
    const variants = [
        { label: 'sin_auth',       headers: {} },
        { label: 'x-api-key',      headers: { 'x-api-key': apiKey } },
        { label: 'authorization',  headers: { 'Authorization': `Bearer ${apiKey}` } },
        { label: 'api-key',        headers: { 'api-key': apiKey } },
    ];

    for (const { label, headers } of variants) {
        try {
            const r = await fetch(`${extBase}/articulos/descontar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ variante_id: 410, cantidad: 1, deposito_id: 5 }),
                signal: AbortSignal.timeout(8000)
            });
            const ct = r.headers.get('content-type') || '';
            const body = await r.text();
            results.push({ label, url: `${extBase}/articulos/descontar`, status: r.status, isJson: ct.includes('json'), preview: body.substring(0, 150) });
        } catch (e) {
            results.push({ label, error: e.message });
        }
    }

    res.json({ sqlBase, extBase, resultados: results });
});



module.exports = router;
