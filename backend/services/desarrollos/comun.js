// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — helpers compartidos (docs/desarrollos/plan-integracion.md).
//
// Permisos (§4.2 del plan):
// · Ver cada pantalla: el menú del rol (Modulos + PermisosRoles).
// · Equipo de desarrollo (DesEquipo): EDITOR (todo) o COLABORADOR (carga pedidos, muestras y
//   comentarios). Los Admin son editores sin cargarlos.
// · Quien pidió algo (un vendedor) ve y comenta SU pedido aunque no sea del equipo.
// Todo se valida acá, en el servidor: en el prototipo varias escrituras no tenían control.
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../../config/db');
const logger = require('../../utils/logger');

const ENTIDADES = ['SOLICITUD', 'PROYECTO', 'MUESTRA', 'TANDA'];
const NIVELES = ['EDITOR', 'COLABORADOR'];

const texto = (v, max) => {
    const s = v == null ? '' : String(v).trim();
    return s ? s.slice(0, max) : null;
};
const idNum = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const fechaISO = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const bool = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
// Comodines de LIKE escritos por el usuario (%, _, [) se buscan literales.
const escaparLike = (s) => String(s).replace(/[[%_]/g, '[$&]');
// Hoy en Uruguay como 'AAAA-MM-DD' (el reloj de la base en prod es UTC).
const hoyUY = (fecha = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(fecha);
// Igual que DP.norm del prototipo: minúsculas, sin tildes, lo que no es letra o número → espacio.
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();

// Códigos: los pedidos son DES-NN (en el prototipo SOL-NN, que ya usan el WMS y las solicitudes de
// vendedores). Mínimo dos dígitos, como nextCode.
const codigoSolicitud = (numero) => `DES-${String(numero).padStart(2, '0')}`;

const esAdmin = (req) => req.user?.userType === 'INTERNAL'
    && (Number(req.user?.idRol) === 1 || String(req.user?.role || '').trim().toLowerCase() === 'admin');

// ── Usuarios ─────────────────────────────────────────────────────────────────
// El token interno no siempre trae el nombre: se busca en Usuarios y se guarda un rato en memoria.
const cacheNombres = new Map(); // id → { nombre, hasta }
async function nombreUsuario(pool, id, respaldo = null) {
    const n = idNum(id);
    if (!n) return respaldo;
    const c = cacheNombres.get(n);
    if (c && c.hasta > Date.now()) return c.nombre;
    try {
        const r = await pool.request().input('U', sql.Int, n)
            .query(`SELECT LTRIM(RTRIM(ISNULL(NULLIF(Nombre, ''), Usuario))) AS Nombre FROM dbo.Usuarios WHERE IdUsuario = @U`);
        const nombre = r.recordset[0]?.Nombre || respaldo;
        cacheNombres.set(n, { nombre, hasta: Date.now() + 10 * 60 * 1000 });
        return nombre;
    } catch (_) { return respaldo; }
}
async function usuarioActual(pool, req) {
    const id = idNum(req.user?.id);
    return { id, nombre: await nombreUsuario(pool, id, req.user?.name || req.user?.username || 'Usuario') };
}

// ── Permisos ─────────────────────────────────────────────────────────────────
// Nivel en el módulo: 'EDITOR', 'COLABORADOR' o null (no es del equipo). Se calcula una vez por pedido.
async function nivelDe(pool, req) {
    if (req._desNivel !== undefined) return req._desNivel;
    let nivel = null;
    if (req.user?.userType === 'INTERNAL') {
        if (esAdmin(req)) nivel = 'EDITOR';
        else {
            const id = idNum(req.user?.id);
            if (id) {
                const r = await pool.request().input('U', sql.Int, id)
                    .query('SELECT Nivel FROM dbo.DesEquipo WHERE UsuarioID = @U AND Activo = 1');
                nivel = r.recordset[0]?.Nivel || null;
            }
        }
    }
    req._desNivel = nivel;
    return nivel;
}

// ¿El rol del usuario tiene esta entrada del menú? Por Ruta, porque los IdModulo de local y prod no
// coinciden (mismo criterio que Servicio Técnico).
async function rolVeRuta(pool, req, ruta) {
    const idRol = Number(req.user?.idRol);
    if (!Number.isInteger(idRol) || req.user?.userType !== 'INTERNAL') return false;
    const r = await pool.request().input('Rol', sql.Int, idRol).input('Ruta', sql.NVarChar(200), ruta)
        .query(`SELECT TOP 1 1 AS Si FROM dbo.PermisosRoles pr JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo
                WHERE pr.IdRol = @Rol AND LTRIM(RTRIM(m.Ruta)) = @Ruta`);
    return r.recordset.length > 0;
}

// Exige un nivel: 'EQUIPO' (editor o colaborador) o 'EDITOR'. Responde 403 y devuelve false si no.
async function exigir(req, res, pool, minimo, que = 'hacer esto') {
    const nivel = await nivelDe(pool, req);
    const ok = minimo === 'EDITOR' ? nivel === 'EDITOR' : !!nivel;
    if (ok) return true;
    res.status(403).json({
        success: false,
        error: minimo === 'EDITOR'
            ? `Solo quien edita Desarrollos puede ${que}.`
            : `Solo el equipo de desarrollo puede ${que}.`,
    });
    return false;
}

// Qué puede hacer el usuario con un pedido, proyecto o muestra. null si no existe.
// → { ver, comentar, adjuntar, esDueno }
async function accesoEntidad(pool, req, entidad, entidadId) {
    const nivel = await nivelDe(pool, req);
    const yo = idNum(req.user?.id);
    if (entidad === 'SOLICITUD') {
        const r = await pool.request().input('Id', sql.Int, entidadId)
            .query('SELECT PedidoPorUsuarioID, AutorUsuarioID FROM dbo.DesSolicitudes WHERE SolicitudID = @Id AND Borrado = 0');
        const s = r.recordset[0];
        if (!s) return null;
        const esDueno = !!yo && (s.PedidoPorUsuarioID === yo || s.AutorUsuarioID === yo);
        const ve = !!nivel || esDueno;
        return { ver: ve, comentar: ve, adjuntar: ve, esDueno };
    }
    if (entidad === 'PROYECTO') {
        const r = await pool.request().input('Id', sql.Int, entidadId)
            .query('SELECT 1 AS Si FROM dbo.DesProyectos WHERE ProyectoID = @Id AND Borrado = 0');
        if (!r.recordset.length) return null;
        return { ver: !!nivel, comentar: !!nivel, adjuntar: nivel === 'EDITOR', esDueno: false };
    }
    if (entidad === 'MUESTRA') {
        const r = await pool.request().input('Id', sql.Int, entidadId)
            .query('SELECT 1 AS Si FROM dbo.DesMuestras WHERE MuestraID = @Id AND Borrado = 0');
        if (!r.recordset.length) return null;
        return { ver: !!nivel, comentar: !!nivel, adjuntar: !!nivel, esDueno: false };
    }
    if (entidad === 'TANDA') {
        const r = await pool.request().input('Id', sql.Int, entidadId)
            .query('SELECT 1 AS Si FROM dbo.DesTandas WHERE TandaID = @Id');
        if (!r.recordset.length) return null;
        return { ver: !!nivel, comentar: false, adjuntar: false, esDueno: false };
    }
    return null;
}

// ── Historial de cambios (bitácora) ──────────────────────────────────────────
// En el prototipo se cortaba en las últimas 200 entradas; acá queda todo.
async function bitacora(reqOrTx, { entidad, entidadId, accion, detalle = null, usuario = null }) {
    await reqOrTx.request()
        .input('E', sql.VarChar(10), entidad)
        .input('Id', sql.Int, entidadId)
        .input('A', sql.NVarChar(60), String(accion).slice(0, 60))
        .input('D', sql.NVarChar(1000), detalle == null ? null : String(detalle).slice(0, 1000))
        .input('U', sql.Int, usuario?.id || null)
        .input('UN', sql.NVarChar(150), usuario?.nombre || null)
        .query(`INSERT INTO dbo.DesBitacora (Entidad, EntidadID, Accion, Detalle, UsuarioID, UsuarioNombre)
                VALUES (@E, @Id, @A, @D, @U, @UN)`);
}

async function leerBitacora(pool, entidad, entidadId) {
    const r = await pool.request().input('E', sql.VarChar(10), entidad).input('Id', sql.Int, entidadId).query(`
        SELECT BitacoraID AS id, Fecha AS fecha, Accion AS accion, Detalle AS detalle, UsuarioID AS usuarioId, UsuarioNombre AS quien
        FROM dbo.DesBitacora WHERE Entidad = @E AND EntidadID = @Id ORDER BY Fecha DESC, BitacoraID DESC`);
    return r.recordset;
}

// ── Avisos y errores ─────────────────────────────────────────────────────────
// Aviso por socket para que las pantallas abiertas se refresquen. `datos` dice qué cambió.
const emitir = (req, datos = {}) => {
    try { req.app.get('socketio')?.emit('desarrollos:cambio', datos); } catch (_) { /* sin sockets no pasa nada */ }
};

const responderError = (res, err, donde) => {
    logger.error(`[Desarrollos] ${donde}: ${err.message} | num=${err.number ?? '-'}`);
    return res.status(500).json({ success: false, error: err.message });
};

module.exports = {
    ENTIDADES, NIVELES,
    texto, idNum, fechaISO, bool, escaparLike, hoyUY, norm, codigoSolicitud, esAdmin,
    nombreUsuario, usuarioActual, nivelDe, rolVeRuta, exigir, accesoEntidad,
    bitacora, leerBitacora, emitir, responderError,
};
