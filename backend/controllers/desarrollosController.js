// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — lo común del módulo (fase 0, docs/desarrollos/plan-integracion.md §6):
// sesión y nivel, equipo de desarrollo, catálogos, comentarios, historial de cambios y adjuntos.
// Pedidos, Bandeja, Proyectos, etc. llegan en las fases siguientes, en sus propios controllers.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const fabrica = require('../services/desarrollos/fabrica');
const { notificar } = require('../services/notificacionesService');
const {
    ENTIDADES, NIVELES, texto, idNum, escaparLike, esAdmin, codigoSolicitud,
    usuarioActual, nivelDe, exigir, accesoEntidad, bitacora, leerBitacora, emitir, responderError,
} = require('../services/desarrollos/comun');
const { nombreOriginal, carpetaEntidad, rutaAdjunto, limpiarTemporales } = require('../middleware/multerDesarrollos');

const entidadDe = (v) => {
    const e = String(v || '').trim().toUpperCase();
    return ENTIDADES.includes(e) ? e : null;
};
const lineasValidas = new Set(fabrica.LINEAS.map(l => l.areaId));
const leerLineas = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
    .map(x => String(x).trim().toUpperCase()).filter(x => lineasValidas.has(x)))];

// GET /sesion → quién soy en el módulo
exports.sesion = async (req, res) => {
    try {
        const pool = await getPool();
        const [usuario, nivel] = await Promise.all([usuarioActual(pool, req), nivelDe(pool, req)]);
        res.json({ success: true, data: { usuario, nivel, esEditor: nivel === 'EDITOR', esEquipo: !!nivel, esAdmin: esAdmin(req) } });
    } catch (err) { responderError(res, err, 'sesion'); }
};

// ── Equipo de desarrollo ─────────────────────────────────────────────────────
async function leerEquipo(pool) {
    const r = await pool.request().query(`
        SELECT e.UsuarioID AS usuarioId, e.Nivel AS nivel, e.Lineas AS lineas, e.FechaAlta AS fechaAlta,
               LTRIM(RTRIM(ISNULL(NULLIF(u.Nombre, ''), u.Usuario))) AS nombre, LTRIM(RTRIM(u.Usuario)) AS usuario,
               LTRIM(RTRIM(ro.NombreRol)) AS rol
        FROM dbo.DesEquipo e
        JOIN dbo.Usuarios u ON u.IdUsuario = e.UsuarioID
        LEFT JOIN dbo.Roles ro ON ro.IdRol = u.IdRol
        WHERE e.Activo = 1 AND ISNULL(u.Activo, 1) = 1
        ORDER BY nombre`);
    return r.recordset.map(x => ({ ...x, lineas: leerLineas(x.lineas) }));
}

// GET /equipo → los del equipo (para los selectores de responsable, solo ellos)
exports.equipo = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver el equipo')) return;
        res.json({ success: true, data: await leerEquipo(pool) });
    } catch (err) { responderError(res, err, 'equipo'); }
};

// GET /equipo/candidatos?q= → usuarios activos que todavía no están en el equipo (editor)
exports.candidatos = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'sumar gente al equipo')) return;
        const q = texto(req.query.q, 60);
        const request = pool.request();
        let filtro = '';
        if (q) {
            request.input('Q', sql.NVarChar(80), `%${escaparLike(q)}%`);
            filtro = 'AND (u.Nombre LIKE @Q OR u.Usuario LIKE @Q)';
        }
        const r = await request.query(`
            SELECT TOP 40 u.IdUsuario AS usuarioId, LTRIM(RTRIM(ISNULL(NULLIF(u.Nombre, ''), u.Usuario))) AS nombre,
                   LTRIM(RTRIM(u.Usuario)) AS usuario, LTRIM(RTRIM(ro.NombreRol)) AS rol
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Roles ro ON ro.IdRol = u.IdRol
            WHERE ISNULL(u.Activo, 1) = 1
              AND NOT EXISTS (SELECT 1 FROM dbo.DesEquipo e WHERE e.UsuarioID = u.IdUsuario AND e.Activo = 1)
              ${filtro}
            ORDER BY nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'candidatos'); }
};

// PUT /equipo/:usuarioId { nivel, lineas } → suma o cambia a alguien (editor)
exports.guardarMiembro = async (req, res) => {
    const usuarioId = idNum(req.params.usuarioId);
    const nivel = String(req.body?.nivel || '').toUpperCase();
    if (!usuarioId) return res.status(400).json({ success: false, error: 'Usuario inválido.' });
    if (!NIVELES.includes(nivel)) return res.status(400).json({ success: false, error: 'El nivel tiene que ser Editor o Colaborador.' });
    const lineas = leerLineas(req.body?.lineas);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el equipo')) return;
        const u = await pool.request().input('U', sql.Int, usuarioId)
            .query(`SELECT LTRIM(RTRIM(ISNULL(NULLIF(Nombre, ''), Usuario))) AS Nombre FROM dbo.Usuarios WHERE IdUsuario = @U AND ISNULL(Activo, 1) = 1`);
        if (!u.recordset.length) return res.status(404).json({ success: false, error: 'No existe ese usuario o está inactivo.' });
        await pool.request()
            .input('U', sql.Int, usuarioId).input('N', sql.VarChar(12), nivel).input('L', sql.VarChar(100), lineas.join(',') || null)
            .query(`MERGE dbo.DesEquipo AS t USING (SELECT @U AS UsuarioID) AS s ON t.UsuarioID = s.UsuarioID
                    WHEN MATCHED THEN UPDATE SET Nivel = @N, Lineas = @L, Activo = 1
                    WHEN NOT MATCHED THEN INSERT (UsuarioID, Nivel, Lineas) VALUES (@U, @N, @L);`);
        emitir(req, { entidad: 'EQUIPO' });
        res.json({ success: true, data: await leerEquipo(pool) });
    } catch (err) { responderError(res, err, 'guardarMiembro'); }
};

// DELETE /equipo/:usuarioId → lo saca del equipo (editor). Sus tareas quedan con su nombre.
exports.quitarMiembro = async (req, res) => {
    const usuarioId = idNum(req.params.usuarioId);
    if (!usuarioId) return res.status(400).json({ success: false, error: 'Usuario inválido.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el equipo')) return;
        await pool.request().input('U', sql.Int, usuarioId).query('UPDATE dbo.DesEquipo SET Activo = 0 WHERE UsuarioID = @U');
        emitir(req, { entidad: 'EQUIPO' });
        res.json({ success: true, data: await leerEquipo(pool) });
    } catch (err) { responderError(res, err, 'quitarMiembro'); }
};

// ── Catálogos ────────────────────────────────────────────────────────────────
// GET /catalogos → listas que usan las pantallas: tipos de desarrollo, plantillas, líneas, familias
// y etiquetas del maestro, estados y tildes de muestras, y la configuración de la planificación.
exports.catalogos = async (req, res) => {
    try {
        const pool = await getPool();
        const [tipos, plantillas, areas, estados, tildes, config] = await Promise.all([
            pool.request().query(`SELECT TipoID AS id, Clave AS clave, Nombre AS nombre, EsProducto AS esProducto
                                  FROM dbo.DesTiposDesarrollo WHERE Activo = 1 ORDER BY Orden, TipoID`),
            pool.request().query(`
                SELECT p.PlantillaID AS id, p.Clave AS clave, p.Nombre AS nombre, p.Para AS para, p.TipoID AS tipoId,
                       p.Descripcion AS descripcion, p.Fija AS fija,
                       (SELECT COUNT(*) FROM dbo.DesPlantillaEtapas e WHERE e.PlantillaID = p.PlantillaID) AS etapas,
                       (SELECT COUNT(*) FROM dbo.DesPlantillaTareas x WHERE x.PlantillaID = p.PlantillaID) AS tareas,
                       (SELECT ISNULL(SUM(x.DiasHabiles), 0) FROM dbo.DesPlantillaTareas x WHERE x.PlantillaID = p.PlantillaID) AS dias
                FROM dbo.DesPlantillas p WHERE p.Activo = 1 ORDER BY p.Orden, p.PlantillaID`),
            pool.request().query(`SELECT LTRIM(RTRIM(AreaID)) AS areaId, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.Areas`),
            pool.request().query(`SELECT EstadoID AS id, Clave AS clave, Nombre AS nombre, Tono AS tono
                                  FROM dbo.DesMuestraEstados WHERE Activo = 1 ORDER BY Orden, EstadoID`),
            pool.request().query(`SELECT TildeID AS id, Clave AS clave, Nombre AS nombre
                                  FROM dbo.DesMuestraTildes WHERE Activo = 1 ORDER BY Orden, TildeID`),
            pool.request().query(`SELECT Clave, Valor FROM dbo.DesConfig WHERE Clave IN ('plan_horizonte', 'plan_tanda')`),
        ]);

        // Del maestro: familias (las de "Prendas" en StockArt, como Configurar Productos) y etiquetas.
        // Si algo falla, el resto de los catálogos sale igual.
        let familias = [];
        let etiquetas = [];
        try {
            familias = (await pool.request().query(`
                SELECT LTRIM(RTRIM(CodStock)) AS codStock, LTRIM(RTRIM(Articulo)) AS nombre
                FROM dbo.StockArt WHERE LTRIM(RTRIM(SupFlia)) = '2' AND LTRIM(RTRIM(CodStock)) <> '2.2.1.4'
                ORDER BY Articulo`)).recordset;
        } catch (err) { logger.warn(`[Desarrollos] catálogos: familias del maestro: ${err.message}`); }
        try {
            etiquetas = (await pool.request().query(`SELECT EtiquetaID AS id, Nombre AS nombre FROM dbo.ProductoEtiqueta WHERE Activo = 1 ORDER BY Nombre`)).recordset;
        } catch (err) { logger.warn(`[Desarrollos] catálogos: etiquetas: ${err.message}`); }

        const nombreArea = Object.fromEntries(areas.recordset.map(a => [a.areaId, a.nombre]));
        const cfg = Object.fromEntries(config.recordset.map(c => [c.Clave, c.Valor]));
        res.json({
            success: true,
            data: {
                tipos: tipos.recordset,
                plantillas: plantillas.recordset,
                etapasFabrica: fabrica.ETAPAS,
                colores: fabrica.COLORES,
                lineas: fabrica.LINEAS.map(l => ({ areaId: l.areaId, nombre: l.nombre, nombreArea: nombreArea[l.areaId] || null })),
                familias,
                etiquetas,
                muestraEstados: estados.recordset,
                muestraTildes: tildes.recordset,
                plan: {
                    horizonte: Number(cfg.plan_horizonte ?? fabrica.PLAN.horizonte),
                    tanda: Number(cfg.plan_tanda ?? fabrica.PLAN.tanda),
                },
            },
        });
    } catch (err) { responderError(res, err, 'catalogos'); }
};

// ── Comentarios ──────────────────────────────────────────────────────────────
// Un hilo por pedido o proyecto. No se editan ni se borran (como en el prototipo).
exports.comentarios = async (req, res) => {
    const entidad = entidadDe(req.params.entidad);
    const id = idNum(req.params.id);
    if (!entidad || !id) return res.status(400).json({ success: false, error: 'Pedido de comentarios inválido.' });
    try {
        const pool = await getPool();
        const acceso = await accesoEntidad(pool, req, entidad, id);
        if (!acceso) return res.status(404).json({ success: false, error: 'No existe.' });
        if (!acceso.ver) return res.status(403).json({ success: false, error: 'No tenés acceso a esto.' });
        const r = await pool.request().input('E', sql.VarChar(10), entidad).input('Id', sql.Int, id).query(`
            SELECT ComentarioID AS id, Texto AS texto, UsuarioID AS usuarioId, UsuarioNombre AS quien, Fecha AS fecha
            FROM dbo.DesComentarios WHERE Entidad = @E AND EntidadID = @Id ORDER BY Fecha, ComentarioID`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'comentarios'); }
};

exports.comentar = async (req, res) => {
    const entidad = entidadDe(req.params.entidad);
    const id = idNum(req.params.id);
    const txt = texto(req.body?.texto, 2000);
    if (!entidad || !id) return res.status(400).json({ success: false, error: 'Pedido de comentarios inválido.' });
    if (!txt) return res.status(400).json({ success: false, error: 'Escribí el comentario.' });
    try {
        const pool = await getPool();
        const acceso = await accesoEntidad(pool, req, entidad, id);
        if (!acceso) return res.status(404).json({ success: false, error: 'No existe.' });
        if (!acceso.comentar) return res.status(403).json({ success: false, error: 'No podés comentar acá.' });
        const usuario = await usuarioActual(pool, req);
        const r = await pool.request()
            .input('E', sql.VarChar(10), entidad).input('Id', sql.Int, id).input('T', sql.NVarChar(2000), txt)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`INSERT INTO dbo.DesComentarios (Entidad, EntidadID, Texto, UsuarioID, UsuarioNombre)
                    OUTPUT INSERTED.ComentarioID AS id, INSERTED.Texto AS texto, INSERTED.UsuarioID AS usuarioId,
                           INSERTED.UsuarioNombre AS quien, INSERTED.Fecha AS fecha
                    VALUES (@E, @Id, @T, @U, @UN)`);
        emitir(req, { entidad, id, que: 'comentario' });
        if (entidad === 'SOLICITUD') avisarComentarioPedido(pool, req, id, usuario, txt).catch(err => logger.warn(`[Desarrollos] aviso de comentario: ${err.message}`));
        res.json({ success: true, data: r.recordset[0] });
    } catch (err) { responderError(res, err, 'comentar'); }
};

// Comentario en un pedido: si comenta el equipo, le llega a quien lo pidió; si comenta quien lo
// pidió, les llega a los editores del equipo. Nunca a quien escribió.
async function avisarComentarioPedido(pool, req, id, usuario, txt) {
    const r = await pool.request().input('Id', sql.Int, id)
        .query('SELECT Numero, Titulo, PedidoPorUsuarioID FROM dbo.DesSolicitudes WHERE SolicitudID = @Id');
    const s = r.recordset[0];
    if (!s) return;
    const esDelEquipo = !!await nivelDe(pool, req);
    let destino;
    let url;
    if (esDelEquipo && s.PedidoPorUsuarioID !== usuario.id) {
        destino = s.PedidoPorUsuarioID ? [s.PedidoPorUsuarioID] : [];
        url = `/desarrollos/pedidos?abrir=${id}`;
    } else {
        const e = await pool.request().query(`SELECT e.UsuarioID FROM dbo.DesEquipo e JOIN dbo.Usuarios u ON u.IdUsuario = e.UsuarioID
            WHERE e.Activo = 1 AND e.Nivel = 'EDITOR' AND ISNULL(u.Activo, 1) = 1`);
        destino = e.recordset.map(x => x.UsuarioID);
        url = `/desarrollos/bandeja?abrir=${id}`;
    }
    destino = destino.filter(x => x && x !== usuario.id);
    if (!destino.length) return;
    notificar({
        usuarioIds: destino, modulo: 'DESARROLLOS', io: req.app.get('socketio'), tag: `des-sol-${id}`,
        titulo: `${usuario.nombre} comentó ${codigoSolicitud(s.Numero)}`, texto: `${s.Titulo}: ${txt}`, url,
    });
}

// ── Historial de cambios ─────────────────────────────────────────────────────
exports.historial = async (req, res) => {
    const entidad = entidadDe(req.params.entidad);
    const id = idNum(req.params.id);
    if (!entidad || !id) return res.status(400).json({ success: false, error: 'Pedido de historial inválido.' });
    try {
        const pool = await getPool();
        const acceso = await accesoEntidad(pool, req, entidad, id);
        if (!acceso) return res.status(404).json({ success: false, error: 'No existe.' });
        // El historial es del equipo: a quien pidió algo le alcanza con el estado y los comentarios.
        if (!acceso.ver || !await nivelDe(pool, req)) return res.status(403).json({ success: false, error: 'No tenés acceso a esto.' });
        res.json({ success: true, data: await leerBitacora(pool, entidad, id) });
    } catch (err) { responderError(res, err, 'historial'); }
};

// ── Adjuntos ─────────────────────────────────────────────────────────────────
const ACCION_ADJUNTO = { SOLICITUD: 'el pedido', PROYECTO: 'el proyecto', MUESTRA: 'la muestra' };

async function leerAdjuntos(pool, entidad, id) {
    const r = await pool.request().input('E', sql.VarChar(10), entidad).input('Id', sql.Int, id).query(`
        SELECT AdjuntoID AS id, NombreOriginal AS nombre, Mime AS tipo, Bytes AS bytes, UsuarioID AS usuarioId,
               UsuarioNombre AS quien, Fecha AS fecha
        FROM dbo.DesAdjuntos WHERE Entidad = @E AND EntidadID = @Id AND Borrado = 0 ORDER BY Fecha, AdjuntoID`);
    return r.recordset;
}

// GET /adjuntos/:entidad/:id → lista
exports.adjuntos = async (req, res) => {
    const entidad = entidadDe(req.params.entidad);
    const id = idNum(req.params.id);
    if (!entidad || !ACCION_ADJUNTO[entidad] || !id) return res.status(400).json({ success: false, error: 'Pedido de adjuntos inválido.' });
    try {
        const pool = await getPool();
        const acceso = await accesoEntidad(pool, req, entidad, id);
        if (!acceso) return res.status(404).json({ success: false, error: 'No existe.' });
        if (!acceso.ver) return res.status(403).json({ success: false, error: 'No tenés acceso a esto.' });
        res.json({ success: true, data: await leerAdjuntos(pool, entidad, id) });
    } catch (err) { responderError(res, err, 'adjuntos'); }
};

// POST /adjuntos/:entidad/:id (multipart "adjuntos") → sube y devuelve la lista
exports.adjuntar = async (req, res) => {
    const entidad = entidadDe(req.params.entidad);
    const id = idNum(req.params.id);
    const files = req.files || [];
    if (!entidad || !ACCION_ADJUNTO[entidad] || !id) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Pedido de adjuntos inválido.' }); }
    if (!files.length) return res.status(400).json({ success: false, error: 'No llegó ningún archivo.' });
    try {
        const pool = await getPool();
        const acceso = await accesoEntidad(pool, req, entidad, id);
        if (!acceso) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe.' }); }
        if (!acceso.adjuntar) { limpiarTemporales(files); return res.status(403).json({ success: false, error: `No podés subir archivos a ${ACCION_ADJUNTO[entidad]}.` }); }
        const usuario = await usuarioActual(pool, req);
        const carpeta = carpetaEntidad(entidad, id);
        fs.mkdirSync(carpeta, { recursive: true });
        const nombres = [];
        for (const f of files) {
            try {
                fs.renameSync(f.path, rutaAdjunto(entidad, id, f.filename));
                await pool.request()
                    .input('E', sql.VarChar(10), entidad).input('Id', sql.Int, id)
                    .input('Arch', sql.NVarChar(260), f.filename).input('Orig', sql.NVarChar(260), nombreOriginal(f))
                    .input('Mime', sql.VarChar(100), String(f.mimetype || '').slice(0, 100)).input('B', sql.Int, f.size || null)
                    .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
                    .query(`INSERT INTO dbo.DesAdjuntos (Entidad, EntidadID, Archivo, NombreOriginal, Mime, Bytes, UsuarioID, UsuarioNombre)
                            VALUES (@E, @Id, @Arch, @Orig, @Mime, @B, @U, @UN)`);
                nombres.push(nombreOriginal(f));
            } catch (err) {
                logger.error(`[Desarrollos] adjunto ${f?.originalname} de ${entidad} ${id}: ${err.message}`);
                limpiarTemporales([f]);
            }
        }
        if (nombres.length) {
            await bitacora(pool, { entidad, entidadId: id, accion: 'Archivos', detalle: `subió ${nombres.join(', ')}`, usuario });
            emitir(req, { entidad, id, que: 'adjuntos' });
        }
        res.json({ success: true, data: await leerAdjuntos(pool, entidad, id), subidos: nombres.length });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'adjuntar');
    }
};

// GET /adjunto/:adjId → el archivo (con login: el front lo baja como blob)
exports.verAdjunto = async (req, res) => {
    const adjId = idNum(req.params.adjId);
    if (!adjId) return res.status(400).json({ success: false, error: 'Adjunto inválido.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('Id', sql.Int, adjId)
            .query('SELECT Entidad, EntidadID, Archivo, NombreOriginal, Mime FROM dbo.DesAdjuntos WHERE AdjuntoID = @Id AND Borrado = 0');
        const a = r.recordset[0];
        if (!a) return res.status(404).json({ success: false, error: 'No existe el adjunto.' });
        const acceso = await accesoEntidad(pool, req, a.Entidad, a.EntidadID);
        if (!acceso?.ver) return res.status(403).json({ success: false, error: 'No tenés acceso a este archivo.' });
        const abs = rutaAdjunto(a.Entidad, a.EntidadID, a.Archivo);
        if (!fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'El archivo ya no está en el servidor.' });
        if (a.Mime) res.type(a.Mime);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.NombreOriginal || a.Archivo)}`);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.sendFile(abs);
    } catch (err) { responderError(res, err, 'verAdjunto'); }
};

// DELETE /adjunto/:adjId → lo marca borrado (el archivo queda en disco). Editor, o quien lo subió
// mientras pueda subir archivos ahí.
exports.quitarAdjunto = async (req, res) => {
    const adjId = idNum(req.params.adjId);
    if (!adjId) return res.status(400).json({ success: false, error: 'Adjunto inválido.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('Id', sql.Int, adjId)
            .query('SELECT Entidad, EntidadID, NombreOriginal, UsuarioID FROM dbo.DesAdjuntos WHERE AdjuntoID = @Id AND Borrado = 0');
        const a = r.recordset[0];
        if (!a) return res.status(404).json({ success: false, error: 'No existe el adjunto.' });
        const [acceso, nivel] = await Promise.all([accesoEntidad(pool, req, a.Entidad, a.EntidadID), nivelDe(pool, req)]);
        const esSuyo = a.UsuarioID && a.UsuarioID === idNum(req.user?.id);
        if (!(nivel === 'EDITOR' || (esSuyo && acceso?.adjuntar))) {
            return res.status(403).json({ success: false, error: 'Solo quien lo subió o quien edita Desarrollos puede quitarlo.' });
        }
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, adjId).query('UPDATE dbo.DesAdjuntos SET Borrado = 1 WHERE AdjuntoID = @Id');
        await bitacora(pool, { entidad: a.Entidad, entidadId: a.EntidadID, accion: 'Archivos', detalle: `quitó ${a.NombreOriginal || 'un archivo'}`, usuario });
        emitir(req, { entidad: a.Entidad, id: a.EntidadID, que: 'adjuntos' });
        res.json({ success: true, data: await leerAdjuntos(pool, a.Entidad, a.EntidadID) });
    } catch (err) { responderError(res, err, 'quitarAdjunto'); }
};
