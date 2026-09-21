'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SOLICITUDES DE VENDEDORES — endpoints internos (/api/solicitudes-vendedor)
// Spec: specs/41-captacion-de-solicitudes-vendedores.md
// Controller fino: las reglas viven en services/solicitudesVendedorService.js
// ─────────────────────────────────────────────────────────────────────────────
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/solicitudesVendedorService');

const manejar = (res, err, ctx) => {
  const status = err?.status || 500;
  if (status >= 500) logger.error(`[SOLICITUDES] ${ctx}: ${err?.stack || err?.message}`);
  else logger.warn(`[SOLICITUDES] ${ctx}: ${err.message}`);
  res.status(status).json({ success: false, error: err?.message || 'Error inesperado' });
};

const id = (v) => parseInt(v, 10);
const accion = (ctx, fn) => async (req, res) => {
  try { res.json({ success: true, data: await fn(await getPool(), req) }); }
  catch (e) { manejar(res, e, ctx); }
};

exports.miPerfil          = accion('miPerfil',          (pool, req) => svc.miPerfil(pool, req.user));
exports.listar            = accion('listar',            (pool, req) => svc.listar(pool, req.user, req.query || {}));
exports.obtener           = accion('obtener',           (pool, req) => svc.obtener(pool, req.user, id(req.params.id)));
exports.crear             = accion('crear',             (pool, req) => svc.crear(pool, req.user, req.body || {}));
exports.actualizar        = accion('actualizar',        (pool, req) => svc.actualizar(pool, req.user, id(req.params.id), req.body || {}));
exports.guardarPrecio     = accion('guardarPrecio',     (pool, req) => svc.guardarPrecio(pool, req.user, id(req.params.id), req.body || {}));
exports.confirmarSena     = accion('confirmarSena',     (pool, req) => svc.confirmarSena(pool, req.user, id(req.params.id), req.body || {}));
exports.agregarInteraccion = accion('agregarInteraccion', (pool, req) => svc.agregarInteraccion(pool, req.user, id(req.params.id), req.body || {}));
exports.cancelar          = accion('cancelar',          (pool, req) => svc.cancelar(pool, req.user, id(req.params.id), req.body || {}));
exports.subirArchivo      = accion('subirArchivo',      (pool, req) => svc.subirArchivo(pool, req.user, id(req.params.id), req.body || {}, req.file));
exports.materialesPrincipal = accion('materialesPrincipal', (pool) => svc.materialesPrincipal(pool));
exports.definirProduccionArchivo = accion('definirProduccionArchivo', (pool, req) => svc.definirProduccionArchivo(pool, req.user, id(req.params.id), id(req.params.archivoId), req.body || {}));
exports.convertir         = accion('convertir',         (pool, req) => svc.convertir(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}, req.app));
exports.bobinasDelCliente = accion('bobinasDelCliente', (pool, req) => svc.bobinasDelCliente(pool, req.user, id(req.params.id)));
exports.reintentarArchivos = accion('reintentarArchivos', (pool, req) => svc.reintentarArchivos(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.app));
exports.quitarArchivo     = accion('quitarArchivo',     (pool, req) => svc.quitarArchivo(pool, req.user, id(req.params.id), id(req.params.archivoId)));

exports.enviarADiseno     = accion('enviarADiseno',     (pool, req) => svc.enviarADiseno(pool, req.user, id(req.params.parteId), req.body || {}));
exports.disenosEnProduccion = accion('disenosEnProduccion', (pool, req) => svc.disenosEnProduccion(pool, req.user));
exports.bandeja           = accion('bandeja',           (pool, req) => svc.bandeja(pool, req.user));
exports.tomarParte        = accion('tomarParte',        (pool, req) => svc.tomarParte(pool, req.user, id(req.params.parteId)));
exports.aceptarCambio     = accion('aceptarCambio',     (pool, req) => svc.aceptarCambio(pool, req.user, id(req.params.parteId)));

exports.listarVendedores  = accion('listarVendedores',  (pool) => svc.listarVendedores(pool));
exports.listarDisenadores = accion('listarDisenadores', (pool, req) => svc.listarDisenadores(pool, req.user));
exports.definirDisenador  = accion('definirDisenador',  (pool, req) => svc.definirDisenador(pool, req.user, id(req.params.idUsuario), !!req.body?.activo));
