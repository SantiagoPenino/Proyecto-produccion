// Lista de precios dinámica (29/10/2026) — /admin/lista-precios-dinamica. La lógica está en services/listaPreciosDinamica.js
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/listaPreciosDinamica');

const responderError = (res, e, donde) => {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error(`[ListaDinamica] ${donde}: ${e.message}`);
    return res.status(500).json({ error: e.message });
};

// GET /api/prices/lista-dinamica — configuración, telas con sus escalas, productos con su lista calculada
exports.getDatos = async (req, res) => {
    try { res.json(await svc.datos(await getPool())); }
    catch (e) { responderError(res, e, 'datos'); }
};

// PUT /api/prices/lista-dinamica/config — franjas (costo y margen), áreas de las telas, moneda, redondeo, aplicar
exports.saveConfig = async (req, res) => {
    try {
        const cfg = await svc.guardarConfig(await getPool(), req.body || {});
        logger.info(`[ListaDinamica] Configuración guardada por usuario ${req.user?.id}: ${JSON.stringify(cfg)}`);
        res.json({ success: true, config: cfg });
    } catch (e) { responderError(res, e, 'guardar config'); }
};

// POST /api/prices/lista-dinamica/cotizar — { proId, telaProId, cantidad }
exports.cotizar = async (req, res) => {
    try { res.json(await svc.cotizar(await getPool(), req.body || {})); }
    catch (e) { responderError(res, e, 'cotizar'); }
};

// GET /api/prices/lista-dinamica/producto/:proId — la lista dinámica de un producto (paso Precios del configurador)
exports.getProducto = async (req, res) => {
    try { res.json(await svc.deProducto(await getPool(), Number(req.params.proId))); }
    catch (e) { responderError(res, e, 'producto'); }
};
