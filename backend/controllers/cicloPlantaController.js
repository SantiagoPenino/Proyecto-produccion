// Tiempo de respuesta de las áreas (26/10/2026, plan INF-SIS-2026-04). Lee el ciclo en planta que guarda el job
// «Ciclo en planta» (services/cicloPlantaService.js).
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/cicloPlantaService');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/dashboard/produccion/ciclo?area=SB&dias=30  (o &desde=AAAA-MM-DD&hasta=AAAA-MM-DD, de Uruguay)
exports.getResumen = async (req, res) => {
    const area = String(req.query.area || '').trim().toUpperCase();
    if (!area || area.length > 20) return res.status(400).json({ error: 'Falta el área.' });
    const desde = FECHA.test(req.query.desde || '') ? req.query.desde : null;
    const hasta = FECHA.test(req.query.hasta || '') ? req.query.hasta : null;
    if ((desde || hasta) && !(desde && hasta && desde <= hasta)) return res.status(400).json({ error: 'Período inválido.' });
    const dias = Math.min(366, Math.max(1, parseInt(req.query.dias, 10) || 30));
    try {
        res.json(await svc.resumenArea(await getPool(), { area, dias, desde, hasta }));
    } catch (e) {
        logger.error(`[CICLO-PLANTA] resumen ${area}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/dashboard/produccion/ciclo/orden/:id → el ciclo de una orden (o null si todavía no está pronta)
exports.getOrden = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Orden inválida.' });
    try {
        res.json(await svc.cicloDeOrden(await getPool(), id));
    } catch (e) {
        logger.error(`[CICLO-PLANTA] orden ${id}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
};
