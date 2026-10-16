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
exports.guardarDatos      = accion('guardarDatos',      (pool, req) => svc.guardarDatos(pool, req.user, id(req.params.id), req.body || {}));   // [GUARDADO AUTOMÁTICO 15/10] un dato a la vez
exports.guardarPrecio     = accion('guardarPrecio',     (pool, req) => svc.guardarPrecio(pool, req.user, id(req.params.id), req.body || {}));
exports.confirmarSena     = accion('confirmarSena',     (pool, req) => svc.confirmarSena(pool, req.user, id(req.params.id), req.body || {}));
exports.agregarInteraccion = accion('agregarInteraccion', (pool, req) => svc.agregarInteraccion(pool, req.user, id(req.params.id), req.body || {}));
exports.cancelar          = accion('cancelar',          (pool, req) => svc.cancelar(pool, req.user, id(req.params.id), req.body || {}));
exports.subirArchivo      = accion('subirArchivo',      (pool, req) => svc.subirArchivo(pool, req.user, id(req.params.id), req.body || {}, req.file));
exports.materialesPrincipal = accion('materialesPrincipal', (pool, req) => svc.materialesPrincipal(pool, req.query?.area || 'SB'));   // ?area=DIRECTA → materiales de esa área
exports.definirProduccionArchivo = accion('definirProduccionArchivo', (pool, req) => svc.definirProduccionArchivo(pool, req.user, id(req.params.id), id(req.params.archivoId), req.body || {}));
exports.convertir         = accion('convertir',         (pool, req) => svc.convertir(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}, req.app));
exports.bobinasDelCliente = accion('bobinasDelCliente', (pool, req) => svc.bobinasDelCliente(pool, req.user, id(req.params.id)));
exports.reintentarArchivos = accion('reintentarArchivos', (pool, req) => svc.reintentarArchivos(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.app));
exports.recuperarArchivos = accion('recuperarArchivos', (pool, req) => svc.recuperarArchivos(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.app));
exports.quitarArchivo     = accion('quitarArchivo',     (pool, req) => svc.quitarArchivo(pool, req.user, id(req.params.id), id(req.params.archivoId)));

// Tizadas de TizadaPro: lista de trabajos terminados y vínculo con la producción principal
exports.tizadasTizadaPro  = accion('tizadasTizadaPro',  (pool, req) => svc.tizadasTizadaPro(pool, req.user, req.query || {}));
// Piezas, telas y arte de la sublimación (por producto del catálogo con molde de TizadaPro)
exports.moldeDelProducto  = accion('moldeDelProducto',  (pool, req) => svc.moldeDelProducto(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
exports.guardarSublimacion = accion('guardarSublimacion', (pool, req) => svc.guardarSublimacion(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));
exports.guardarTalles     = accion('guardarTalles',     (pool, req) => svc.guardarTalles(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));
exports.vincularTizada    = accion('vincularTizada',    (pool, req) => svc.vincularTizada(pool, req.user, id(req.params.parteId), req.body || {}));

exports.enviarADiseno     = accion('enviarADiseno',     (pool, req) => svc.enviarADiseno(pool, req.user, id(req.params.parteId), req.body || {}));
exports.disenosEnProduccion = accion('disenosEnProduccion', (pool, req) => svc.disenosEnProduccion(pool, req.user));
// Ficha del pedido en PDF: todo lo cargado en la solicitud (y en Diseño), organizado.
exports.fichaPdf = async (req, res) => {
  try {
    const pool = await getPool();
    const sol = await svc.obtener(pool, req.user, id(req.params.id));
    const ficha = require('../services/solicitudesVendedorFichaPdf');
    const pdf = await ficha.generarPdf(sol);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${ficha.nombreArchivo(sol)}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  } catch (e) { manejar(res, e, 'fichaPdf'); }
};
// TIZADA PRO por API (diseños + lista de talles → tizada automática)
exports.tizadaProVer        = accion('tizadaProVer',        (pool, req) => svc.tizadaProVer(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
exports.tizadaProEditables = accion('tizadaProEditables', (pool, req) => svc.tizadaProEditables(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));
exports.piezasDelArte = accion('piezasDelArte', (pool, req) => svc.piezasDelArte(pool, req.user, id(req.params.id), id(req.params.archivoId)));
exports.tizadaProGuardar    = accion('tizadaProGuardar',    (pool, req) => svc.tizadaProGuardar(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));
// [A MEDIDA]
exports.tizadaProCalcular   = accion('tizadaProCalcular',   (pool, req) => svc.tizadaProCalcular(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));
exports.tizadaProArteVista  = accion('tizadaProArteVista',  (pool, req) => svc.tizadaProArteVista(pool, req.user, id(req.params.id), id(req.params.productoSolId), id(req.params.archivoId)));
exports.tizadaProPlantillaPedir  = accion('tizadaProPlantillaPedir',  (pool, req) => svc.tizadaProPlantillaPedir(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
exports.tizadaProPlantillaEstado = accion('tizadaProPlantillaEstado', (pool, req) => svc.tizadaProPlantillaEstado(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
exports.tizadaProPlantillaBajar = async (req, res) => {
  try {
    const a = await svc.tizadaProPlantillaBajar(await getPool(), req.user, id(req.params.id), id(req.params.productoSolId), req.query.nombre);
    res.setHeader('Content-Type', a.tipo);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.send(a.buffer);
  } catch (e) { manejar(res, e, 'tizadaProPlantillaBajar'); }
};
exports.tizadaProEnviar     = accion('tizadaProEnviar',     (pool, req) => svc.tizadaProEnviar(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));
exports.tizadaProActualizar = accion('tizadaProActualizar', (pool, req) => svc.tizadaProActualizar(pool, req.user, id(req.params.id), id(req.params.envioId), req.body || {}));
exports.estimarPlazo      = accion('estimarPlazo',      (pool, req) => svc.estimarPlazo(pool, req.user, id(req.params.id)));
exports.calendario        = accion('calendario',        (pool, req) => svc.calendario(pool, req.user, req.query || {}));
exports.bandeja           = accion('bandeja',           (pool, req) => svc.bandeja(pool, req.user));
exports.correccionAbrir   = accion('correccionAbrir',   (pool, req) => svc.correccionAbrir(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.body || {}));   // [15/10] corregir el diseño de un pedido
exports.correccionCancelar = accion('correccionCancelar', (pool, req) => svc.correccionCancelar(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
exports.correccionAplicar = accion('correccionAplicar', (pool, req) => svc.correccionAplicar(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.app));   // "Pasar al pedido"
exports.correccionPlan    = accion('correccionPlan',    (pool, req) => svc.correccionPlan(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
exports.disenosHechos     = accion('disenosHechos',     (pool, req) => svc.disenosHechos(pool, req.user, req.query || {}));   // [15/10] pestaña "Hechos" (?desde=&hasta=)
exports.tomarParte        = accion('tomarParte',        (pool, req) => svc.tomarParte(pool, req.user, id(req.params.parteId)));
exports.aceptarCambio     = accion('aceptarCambio',     (pool, req) => svc.aceptarCambio(pool, req.user, id(req.params.parteId)));
// [TIPO DEL EXTRA 14/10] cómo se hace cada bordado / DTF / TPU, desde la tabla del arte (la misma lista que la Tienda)
exports.formasDeExtras    = accion('formasDeExtras',    (pool, req) => svc.formasDeExtras(pool, req.user, id(req.params.id), id(req.params.productoSolId)));
// [FASE 1 15/10] agregar / quitar un bordado, DTF o TPU desde la tabla del arte ({ activo: true | false })
exports.cambiarExtra      = accion('cambiarExtra',      (pool, req) => svc.cambiarExtra(pool, req.user, id(req.params.id), id(req.params.productoSolId), req.params.tipo, req.body || {}));
exports.listarVendedores  = accion('listarVendedores',  (pool) => svc.listarVendedores(pool));
exports.listarDisenadores = accion('listarDisenadores', (pool, req) => svc.listarDisenadores(pool, req.user));
exports.definirDisenador  = accion('definirDisenador',  (pool, req) => svc.definirDisenador(pool, req.user, id(req.params.idUsuario), !!req.body?.activo));
