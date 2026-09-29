// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — helpers compartidos por los controllers del módulo
// (solicitudes, máquinas, mantenimientos, proyectos, insumos, reportes).
// Plan: docs/servicio-tecnico-plan.md · Tablas: docs/servicio-tecnico/st-etapa*.sql
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { esAdminOServicioTecnico } = require('../middleware/authMiddleware');
const { normalizarEstado } = require('../utils/estadoEquipo');
const { nombreOriginal, carpetaEntidad, rutaAdjunto, limpiarTemporales } = require('../middleware/multerServicioTecnico');

const MODULO = 'SERVICIO_TECNICO';
const CATEGORIAS = ['MAQUINA', 'PC', 'RED', 'SOFTWARE', 'INSTALACIONES', 'OTRO'];
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
const ESTADOS = ['PENDIENTE', 'EN_CURSO', 'EN_ESPERA', 'DERIVADA', 'FINALIZADA'];
const RESULTADOS = ['RESUELTA', 'PARCIAL', 'NO_RESUELTA', 'CANCELADA'];
const ETIQUETA_RESULTADO = { RESUELTA: 'Resuelta', PARCIAL: 'Resuelta en parte', NO_RESUELTA: 'No resuelta', CANCELADA: 'Cancelada' };
const ETIQUETA_PRIORIDAD = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' };

const codigo = (solId) => `ST-${String(solId).padStart(5, '0')}`;
const urlSolicitud = (solId) => `/servicio-tecnico?sol=${solId}`;
const esTecnico = (req) => esAdminOServicioTecnico(req.user);
const esAdmin = (req) => String(req.user?.role || '').trim().toLowerCase() === 'admin' || Number(req.user?.idRol) === 1;
const texto = (v, max) => {
    const s = v == null ? '' : String(v).trim();
    return s ? s.slice(0, max) : null;
};
const bool = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
const idNum = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const fechaISO = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
// Comodines de LIKE escritos por el usuario (%, _, [) se buscan literales.
const escaparLike = (s) => String(s).replace(/[[%_]/g, '[$&]');
// Hoy en Uruguay como 'AAAA-MM-DD' (el reloj de la base en prod es UTC: a las 21 h ya es "mañana").
const hoyUY = (fecha = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(fecha);
const numero = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

// Scripts sin correr: respuesta clara en vez de "Invalid object name".
const responderError = (res, err, donde) => {
    if (err?.number === 208) {
        return res.status(503).json({ success: false, error: 'Falta correr los scripts de Servicio Técnico en la base (docs/servicio-tecnico/).' });
    }
    logger.error(`[ServicioTecnico] ${donde}: ${err.message} | num=${err.number ?? '-'}`);
    return res.status(500).json({ success: false, error: err.message });
};

// Solo técnicos (área SERVICIO) o Admin. Responde 403 y devuelve false si no.
const exigirTecnico = (req, res, que = 'hacer esto') => {
    if (esTecnico(req)) return true;
    res.status(403).json({ success: false, error: `Solo Servicio Técnico puede ${que}.` });
    return false;
};

// Aviso por socket para que las pantallas del módulo se refresquen. `datos` indica qué cambió.
const emitirST = (req, datos = {}) => {
    try { req.app.get('socketio')?.emit('st:updated', datos); } catch (_) { /* sin sockets no pasa nada */ }
};
const emitirCambio = (req, solId) => emitirST(req, { solId });

// Cambió el estado de una máquina: que el tablero de Planeación y las áreas se refresquen.
const avisarTableros = (req, equipoId) => {
    try { req.app.get('socketio')?.emit('lotes:updated', { equipoId, motivo: 'estado-equipo' }); } catch (_) { /* nada */ }
};

// ── Usuarios ─────────────────────────────────────────────────────────────────
// El token interno no trae el nombre (sp_AutenticarUsuario no devuelve Nombre): se busca en
// Usuarios y se guarda un rato en memoria.
const cacheNombres = new Map(); // id → { nombre, hasta }
async function nombreUsuario(pool, id, respaldo = null) {
    const n = idNum(id);
    if (!n) return respaldo;
    const c = cacheNombres.get(n);
    if (c && c.hasta > Date.now()) return c.nombre;
    try {
        const r = await pool.request().input('U', sql.Int, n)
            .query('SELECT LTRIM(RTRIM(ISNULL(NULLIF(Nombre, \'\'), Usuario))) AS Nombre FROM dbo.Usuarios WHERE IdUsuario = @U');
        const nombre = r.recordset[0]?.Nombre || respaldo;
        cacheNombres.set(n, { nombre, hasta: Date.now() + 10 * 60 * 1000 });
        return nombre;
    } catch (_) { return respaldo; }
}
async function usuarioActual(pool, req) {
    const id = idNum(req.user?.id);
    return { id, nombre: await nombreUsuario(pool, id, req.user?.name || req.user?.username || 'Usuario') };
}

// Técnicos = usuarios activos del área SERVICIO.
async function tecnicos(pool) {
    const r = await pool.request().query(`
        SELECT IdUsuario AS id, LTRIM(RTRIM(ISNULL(NULLIF(Nombre, ''), Usuario))) AS nombre
        FROM dbo.Usuarios WITH (NOLOCK)
        WHERE ISNULL(Activo, 1) = 1 AND UPPER(LTRIM(RTRIM(ISNULL(AreaUsuario, '')))) = 'SERVICIO'
        ORDER BY nombre`);
    return r.recordset;
}

// Encargado: el elegido en la pantalla (ConfiguracionGlobal) o, si no hay, la variable de entorno.
async function encargado(pool) {
    let id = null;
    let origen = null;
    try {
        const r = await pool.request().query(`SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'ST_EncargadoId'`);
        id = idNum(r.recordset[0]?.Valor);
        if (id) origen = 'pantalla';
    } catch (_) { /* sin tabla o sin clave */ }
    if (!id && process.env.ST_ENCARGADO_USUARIO) {
        const env = String(process.env.ST_ENCARGADO_USUARIO).trim();
        if (/^\d+$/.test(env)) id = idNum(env);
        else {
            const r = await pool.request().input('Usr', sql.NVarChar(100), env)
                .query('SELECT TOP 1 IdUsuario FROM dbo.Usuarios WHERE Usuario = @Usr AND ISNULL(Activo, 1) = 1');
            id = idNum(r.recordset[0]?.IdUsuario);
        }
        if (id) origen = 'variable de entorno';
    }
    return id ? { id, nombre: await nombreUsuario(pool, id), origen } : null;
}

// A quién avisar algo "del sector": el encargado o, si no hay, todos los técnicos.
async function destinatariosServicio(pool, excluirId = null) {
    const enc = await encargado(pool);
    const ids = enc ? [enc.id] : (await tecnicos(pool)).map(t => t.id);
    return ids.filter(id => id !== excluirId);
}

// ── Historial ────────────────────────────────────────────────────────────────
async function historial(reqOrTx, { entidad = 'SOLICITUD', entidadId, usuario, accion, detalle = null, motivo = null, aUsuario = null }) {
    await reqOrTx.request()
        .input('E', sql.VarChar(20), entidad)
        .input('Id', sql.Int, entidadId)
        .input('U', sql.Int, usuario?.id || null)
        .input('UN', sql.NVarChar(150), usuario?.nombre || null)
        .input('A', sql.VarChar(30), accion)
        .input('D', sql.NVarChar(sql.MAX), detalle)
        .input('M', sql.NVarChar(500), motivo ? String(motivo).slice(0, 500) : null)
        .input('AU', sql.Int, aUsuario?.id || null)
        .input('AUN', sql.NVarChar(150), aUsuario?.nombre || null)
        .query(`INSERT INTO dbo.ST_Historial (Entidad, EntidadId, UsuarioId, UsuarioNombre, Accion, Detalle, Motivo, AUsuarioId, AUsuarioNombre)
                VALUES (@E, @Id, @U, @UN, @A, @D, @M, @AU, @AUN)`);
}

async function leerHistorial(pool, entidad, entidadId) {
    const r = await pool.request().input('E', sql.VarChar(20), entidad).input('Id', sql.Int, entidadId).query(`
        SELECT HisId, Fecha, UsuarioId, UsuarioNombre, Accion, Detalle, Motivo, AUsuarioId, AUsuarioNombre
        FROM dbo.ST_Historial WHERE Entidad = @E AND EntidadId = @Id ORDER BY Fecha, HisId`);
    return r.recordset;
}

// Cambia el estado de una máquina y lo deja en su historial. Devuelve el estado anterior
// (null si la máquina no existe).
async function cambiarEstadoEquipo(tx, { equipoId, nuevo, usuario, motivo }) {
    const r = await tx.request().input('E', sql.Int, equipoId)
        .query('SELECT Nombre, Estado FROM dbo.ConfigEquipos WITH (UPDLOCK) WHERE EquipoID = @E');
    if (!r.recordset.length) return null;
    const anterior = normalizarEstado(r.recordset[0].Estado) || 'DISPONIBLE';
    if (anterior === nuevo) return anterior;
    await tx.request().input('E', sql.Int, equipoId).input('S', sql.NVarChar(100), nuevo)
        .query('UPDATE dbo.ConfigEquipos SET Estado = @S WHERE EquipoID = @E');
    await historial(tx, { entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'ESTADO', detalle: `${anterior} → ${nuevo}`, motivo });
    return anterior;
}

// ── Adjuntos ─────────────────────────────────────────────────────────────────
// Recién subidos (en _temp) → carpeta de la entidad + fila en ST_Adjuntos.
async function guardarAdjuntos(pool, { entidad, entidadId, files, usuario }) {
    const guardados = [];
    if (!files?.length) return guardados;
    const carpeta = carpetaEntidad(entidad, entidadId);
    fs.mkdirSync(carpeta, { recursive: true });
    for (const f of files) {
        try {
            fs.renameSync(f.path, rutaAdjunto(entidad, entidadId, f.filename));
            const r = await pool.request()
                .input('E', sql.VarChar(20), entidad)
                .input('Id', sql.Int, entidadId)
                .input('Arch', sql.NVarChar(260), f.filename)
                .input('Orig', sql.NVarChar(260), nombreOriginal(f))
                .input('Mime', sql.VarChar(100), String(f.mimetype || '').slice(0, 100))
                .input('B', sql.Int, f.size || null)
                .input('U', sql.Int, usuario?.id || null)
                .input('UN', sql.NVarChar(150), usuario?.nombre || null)
                .query(`INSERT INTO dbo.ST_Adjuntos (Entidad, EntidadId, Archivo, NombreOriginal, Mime, Bytes, UsuarioId, UsuarioNombre)
                        OUTPUT INSERTED.AdjId VALUES (@E, @Id, @Arch, @Orig, @Mime, @B, @U, @UN)`);
            guardados.push({ AdjId: r.recordset[0].AdjId, NombreOriginal: nombreOriginal(f) });
        } catch (err) {
            logger.error(`[ServicioTecnico] adjunto ${f?.originalname} de ${entidad} ${entidadId}: ${err.message}`);
            limpiarTemporales([f]);
        }
    }
    return guardados;
}

async function leerAdjuntos(pool, entidad, entidadId) {
    const r = await pool.request().input('E', sql.VarChar(20), entidad).input('Id', sql.Int, entidadId).query(`
        SELECT AdjId, NombreOriginal, Mime, Bytes, UsuarioNombre, Fecha
        FROM dbo.ST_Adjuntos WHERE Entidad = @E AND EntidadId = @Id ORDER BY Fecha, AdjId`);
    return r.recordset;
}

module.exports = {
    MODULO, CATEGORIAS, PRIORIDADES, ESTADOS, RESULTADOS, ETIQUETA_RESULTADO, ETIQUETA_PRIORIDAD,
    codigo, urlSolicitud, esTecnico, esAdmin, texto, bool, idNum, fechaISO, escaparLike, hoyUY, numero,
    responderError, exigirTecnico, emitirST, emitirCambio, avisarTableros,
    nombreUsuario, usuarioActual, tecnicos, encargado, destinatariosServicio,
    historial, leerHistorial, cambiarEstadoEquipo, guardarAdjuntos, leerAdjuntos, limpiarTemporales,
};
