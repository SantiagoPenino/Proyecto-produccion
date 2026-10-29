// Fechas de una orden y de su pedido para el detalle de la orden (services/fechasOrdenService.js).
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/fechasOrdenService');

// GET /api/orders/fechas/:id → { hoy, orden, pedido } (404 si la orden no existe)
exports.getFechas = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Orden inválida.' });
    try {
        const datos = await svc.fechasDeOrden(await getPool(), id);
        if (!datos) return res.status(404).json({ error: 'No existe la orden.' });
        res.json(datos);
    } catch (e) {
        logger.error(`[FECHAS-ORDEN] orden ${id}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
};
