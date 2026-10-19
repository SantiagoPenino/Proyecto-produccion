'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// VENTAS DE SALÓN — endpoints internos (/api/ventas-salon), 19/10/2026
// Controller fino: las reglas y los permisos viven en services/ventasSalonService.js
// ─────────────────────────────────────────────────────────────────────────────
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/ventasSalonService');

const manejar = (res, err, ctx) => {
  const status = err?.status || 500;
  if (status >= 500) logger.error(`[VENTAS-SALON] ${ctx}: ${err?.stack || err?.message}`);
  else logger.warn(`[VENTAS-SALON] ${ctx}: ${err.message}`);
  res.status(status).json({ success: false, error: err?.message || 'Error inesperado' });
};

const id = (v) => parseInt(v, 10);
const accion = (ctx, fn) => async (req, res) => {
  try { res.json({ success: true, data: await fn(await getPool(), req) }); }
  catch (e) { manejar(res, e, ctx); }
};

exports.miPerfil         = accion('miPerfil',         (pool, req) => svc.miPerfil(pool, req.user));
exports.listar           = accion('listar',           (pool, req) => svc.listar(pool, req.user, req.query || {}));
exports.listarVendedores = accion('listarVendedores', (pool, req) => svc.listarVendedores(pool, req.user));
exports.crear            = accion('crear',            (pool, req) => svc.crear(pool, req.user, req.body || {}));
exports.actualizar       = accion('actualizar',       (pool, req) => svc.actualizar(pool, req.user, id(req.params.id), req.body || {}));
exports.anular           = accion('anular',           (pool, req) => svc.anular(pool, req.user, id(req.params.id), req.body || {}));
exports.franjas          = accion('franjas',          (pool, req) => svc.franjas(pool, req.user));
exports.guardarFranjas   = accion('guardarFranjas',   (pool, req) => svc.guardarFranjas(pool, req.user, req.body || {}));
exports.resumen          = accion('resumen',          (pool, req) => svc.resumen(pool, req.user, req.query || {}));
exports.ganadores        = accion('ganadores',        (pool, req) => svc.ganadores(pool, req.user));
