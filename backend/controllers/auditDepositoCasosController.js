/**
 * Auditoría de Depósito — endpoints de SESIÓN (abrir / cerrar / anular), HISTORIAL y REGISTRO DE CASOS.
 * La lógica vive en services/auditoriaDepositoService.js. Este archivo solo traduce HTTP.
 * Los endpoints viejos de escaneo (/init, /check, /live…) siguen en auditDepositoController.js y
 * pasan a modo "sesión" solos cuando hay una auditoría abierta.
 */
const logger = require('../utils/logger');
const svc = require('../services/auditoriaDepositoService');
const rep = require('../services/auditoriaDepositoReportesService');

const responder = (res, fn) => fn().then(data => res.json({ success: true, ...data })).catch(err => {
    const status = err.status || 500;
    if (status >= 500) logger.error('[AUDIT-DEP-CASOS] ' + err.message, err);
    res.status(status).json({ success: false, error: err.message });
});

// Identidad del operador: sin id no se opera (nada de fallback a usuario 1).
const usuarioDe = (req) => {
    const u = req.user;
    if (!u || u.id == null) { const e = new Error('Usuario no identificado. Volvé a iniciar sesión.'); e.status = 401; throw e; }
    return u;
};

/* ── SESIÓN ─────────────────────────────────────────────────────────────────────────── */

// GET /api/audit-deposito/sesion → estado del módulo (sesión abierta con contadores, última cerrada, config)
exports.getSesion = (req, res) => responder(res, () => svc.estadoModulo());

// GET /api/audit-deposito/prefijos → prefijos de área con órdenes activas (para el alcance)
exports.getPrefijos = (req, res) => responder(res, async () => ({ data: await svc.listarPrefijosActivos() }));

// POST /api/audit-deposito/sesion/abrir { alcanceTipo, alcanceValor, importarPrevios, observaciones }
exports.abrirSesion = (req, res) => responder(res, async () => {
    const usuario = usuarioDe(req);
    const { alcanceTipo, alcanceValor, importarPrevios, observaciones } = req.body || {};
    const r = await svc.abrirAuditoria({ usuario, alcanceTipo, alcanceValor, importarPrevios: !!importarPrevios, observaciones });
    const io = req.app.get('socketio');
    if (io) io.emit('audit:sesion', { accion: 'ABIERTA', codigo: r.sesion.codigo });
    return {
        ...r,
        message: `Auditoría ${r.sesion.codigo} abierta: fotografía de ${r.sesion.contadores.snapshotCant} órdenes activas (${r.sesion.alcanceTexto})` +
            (r.importados ? `. Se importaron ${r.importados} escaneos previos.` : '.'),
    };
});

// POST /api/audit-deposito/sesion/cerrar → detección + fusión + auto-cierre (una transacción)
exports.cerrarSesion = (req, res) => responder(res, async () => {
    const usuario = usuarioDe(req);
    const r = await svc.cerrarAuditoria({ usuario, io: req.app.get('socketio') });
    const io = req.app.get('socketio');
    if (io) io.emit('audit:sesion', { accion: 'CERRADA', codigo: r.codigo });
    return {
        data: r,
        message: `Auditoría ${r.codigo} cerrada. Nuevos: ${r.nuevos} · Ya existentes: ${r.existentes} · Reincidentes: ${r.reincidentes} · Resueltos: ${r.resueltos} · Abiertos totales: ${r.abiertosTotal}`,
    };
});

// POST /api/audit-deposito/sesion/anular { motivo } → descarta la sesión sin tocar el registro de casos
exports.anularSesion = (req, res) => responder(res, async () => {
    const usuario = usuarioDe(req);
    const r = await svc.anularAuditoria({ usuario, motivo: (req.body || {}).motivo });
    const io = req.app.get('socketio');
    if (io) io.emit('audit:sesion', { accion: 'ANULADA', codigo: r.codigo });
    return { data: r, message: `Auditoría ${r.codigo} anulada. No se generó ni cerró ningún caso.` };
});

/* ── HISTORIAL ──────────────────────────────────────────────────────────────────────── */

// GET /api/audit-deposito/auditorias
exports.listarAuditorias = (req, res) => responder(res, async () => ({ data: await svc.listarAuditorias({ limit: req.query.limit }) }));

// GET /api/audit-deposito/auditorias/:id → la fotografía tal como se tomó + escaneos
exports.getAuditoria = (req, res) => responder(res, async () => ({ data: await svc.obtenerAuditoria(req.params.id) }));

/* ── CASOS ──────────────────────────────────────────────────────────────────────────── */

// GET /api/audit-deposito/casos?estado=VIVOS|CERRADOS|TODOS|CRONICOS|REINCIDENTES|ALTA&tipo=&severidad=&q=
exports.listarCasos = (req, res) => responder(res, async () => {
    const { estado, tipo, severidad, q, orden, limit, responsableId } = req.query || {};
    return svc.listarCasos({ estado, tipo, severidad, q, orden, limit, responsableId });
});

// GET /api/audit-deposito/casos/:id → caso + línea de tiempo
exports.getCaso = (req, res) => responder(res, () => svc.obtenerCaso(req.params.id));

// POST /api/audit-deposito/casos/:id/accion { accion, detalle, responsableId, responsableNombre }
exports.accionCaso = (req, res) => responder(res, async () => {
    const usuario = usuarioDe(req);
    const { accion, detalle, responsableId, responsableNombre } = req.body || {};
    const fechaLimite = Object.prototype.hasOwnProperty.call(req.body || {}, 'fechaLimite') ? req.body.fechaLimite : undefined;
    const r = await svc.accionCaso({ casoId: req.params.id, accion, detalle, usuario, responsableId, responsableNombre, fechaLimite, io: req.app.get('socketio') });
    return { data: r, message: `${r.codigo}: ${svc.ACCIONES[r.accion].nombre.toLowerCase()} aplicada` + (r.estado ? ` (estado ${r.estado})` : '') };
});

// POST /api/audit-deposito/casos/accion-lote { casoIds: [], accion, detalle }
exports.accionLote = (req, res) => responder(res, async () => {
    const usuario = usuarioDe(req);
    const { casoIds, accion, detalle, responsableId, responsableNombre } = req.body || {};
    const fechaLimite = Object.prototype.hasOwnProperty.call(req.body || {}, 'fechaLimite') ? req.body.fechaLimite : undefined;
    const r = await svc.accionLote({ casoIds, accion, detalle, usuario, responsableId, responsableNombre, fechaLimite, io: req.app.get('socketio') });
    return { data: r, message: `Acción aplicada a ${r.aplicados} caso${r.aplicados === 1 ? '' : 's'}` + (r.errores.length ? `; ${r.errores.length} con error` : '') };
});

/* ── REPORTES (Fase 4) · CONTEO CÍCLICO (Fase 5) · USUARIOS ─────────────────────────── */

// GET /api/audit-deposito/reportes?audId=  (sin audId: foto en vivo del depósito)
exports.getReporte = (req, res) => responder(res, async () => ({ data: await rep.construirReporte({ audId: req.query.audId || null }) }));

// GET /api/audit-deposito/ciclico → plan de conteo cíclico por área (ABC + última auditoría + vencimiento)
exports.getCiclico = (req, res) => responder(res, async () => ({ data: await rep.planCiclico() }));

// GET /api/audit-deposito/usuarios → usuarios internos activos (para asignar responsable)
exports.getUsuarios = (req, res) => responder(res, async () => ({ data: await rep.listarUsuariosInternos() }));
