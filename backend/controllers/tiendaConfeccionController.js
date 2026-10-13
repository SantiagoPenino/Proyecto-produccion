// Tienda del portal → pedidos de prendas CONFECCIONADAS a pedido (F3). La lógica vive en
// services/tiendaConfeccionService.js; acá solo se toma el cliente del token y se contesta.
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/tiendaConfeccionService');

const accion = (nombre, fn) => async (req, res) => {
    try {
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(403).json({ error: 'Sesión sin cliente asociado.' });
        const pool = await getPool();
        res.json({ success: true, data: await fn(pool, codCliente, req) });
    } catch (err) {
        if (!err.status || err.status >= 500) logger.error(`[TIENDA-CONF] ${nombre}: ${err.message}`);
        res.status(err.status || 500).json({ error: err.status ? err.message : 'No pudimos completar la operación. Probá de nuevo.' });
    }
};
const id = (v) => parseInt(v, 10);

exports.opciones   = accion('opciones',   (pool, cli, req) => svc.opciones(pool, id(req.params.proId)));
exports.crear      = accion('crear',      (pool, cli, req) => svc.crear(pool, cli, id(req.body?.proIdProducto)));
exports.ver        = accion('ver',        (pool, cli, req) => svc.ver(pool, cli, id(req.params.id)));
exports.guardar    = accion('guardar',    (pool, cli, req) => svc.guardar(pool, cli, id(req.params.id), req.body || {}));
exports.subirArte  = accion('subirArte',  (pool, cli, req) => svc.subirArte(pool, cli, id(req.params.id), req.file));
exports.revisar    = accion('revisar',    (pool, cli, req) => svc.revisar(pool, cli, id(req.params.id)));
