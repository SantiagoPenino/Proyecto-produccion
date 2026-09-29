// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — proyectos con historial (etapa 4). Plan: docs/servicio-tecnico-plan.md
// Tabla: docs/servicio-tecnico/st-etapa4.sql (ST_Proyectos). El historial (avances, cambios de
// estado, ediciones, insumos) vive en ST_Historial con Entidad = 'PROYECTO'; los adjuntos en
// ST_Adjuntos. Leer: cualquier usuario interno. Crear y actualizar: técnicos o Admin.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const { notificar } = require('../services/notificacionesService');
const {
    MODULO, PRIORIDADES, texto, idNum, fechaISO, escaparLike, responderError, exigirTecnico, emitirST, nombreUsuario,
    usuarioActual, historial, leerHistorial, guardarAdjuntos, leerAdjuntos, limpiarTemporales, hoyUY,
} = require('../services/servicioTecnicoComun');

const ESTADOS_PROYECTO = ['PLANIFICADO', 'EN_CURSO', 'EN_PAUSA', 'TERMINADO', 'CANCELADO'];
const ETIQUETA_ESTADO = { PLANIFICADO: 'Planificado', EN_CURSO: 'En curso', EN_PAUSA: 'En pausa', TERMINADO: 'Terminado', CANCELADO: 'Cancelado' };
const urlProyecto = (id) => `/servicio-tecnico?seccion=proyectos&proy=${id}`;
const fmtDia = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

const SELECT_PROYECTO = `
    SELECT p.ProyId, p.Titulo, p.Descripcion, p.ResponsableId, p.ResponsableNombre, p.Estado, p.Progreso, p.Prioridad,
           CONVERT(VARCHAR(10), p.FechaInicio, 23) AS FechaInicio, CONVERT(VARCHAR(10), p.FechaEstimadaFin, 23) AS FechaEstimadaFin,
           p.FechaFin, p.EquipoId, e.Nombre AS EquipoNombre, p.EquipoTexto, p.CreadoPorNombre, p.FechaCreacion, p.FechaActualizacion,
           (SELECT COUNT(*) FROM dbo.ST_Adjuntos a WHERE a.Entidad = 'PROYECTO' AND a.EntidadId = p.ProyId) AS Adjuntos,
           (SELECT MAX(h.Fecha) FROM dbo.ST_Historial h WHERE h.Entidad = 'PROYECTO' AND h.EntidadId = p.ProyId AND h.Accion = 'AVANCE') AS UltimoAvance,
           CASE WHEN p.Estado IN ('PLANIFICADO', 'EN_CURSO', 'EN_PAUSA') AND p.FechaEstimadaFin < CAST(@Hoy AS DATE) THEN 1 ELSE 0 END AS Atrasado
    FROM dbo.ST_Proyectos p LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = p.EquipoId`;

async function leerProyecto(pool, id) {
    const r = await pool.request().input('Id', sql.Int, id).input('Hoy', sql.VarChar(10), hoyUY()).query(`${SELECT_PROYECTO} WHERE p.ProyId = @Id`);
    return r.recordset[0] || null;
}

const avisarResponsable = (req, responsable, usuario, titulo, textoAviso, proyId) => {
    if (!responsable?.id || responsable.id === usuario?.id) return;
    notificar({ usuarioIds: [responsable.id], modulo: MODULO, io: req.app.get('socketio'), titulo, texto: textoAviso, url: urlProyecto(proyId), tag: `st-proy-${proyId}` });
};

// GET /proyectos?estado=ABIERTOS|TODOS|<estado>&q=
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        const r = pool.request().input('Hoy', sql.VarChar(10), hoyUY());
        const where = [];
        const estado = String(req.query.estado || 'ABIERTOS').toUpperCase();
        if (estado === 'ABIERTOS') where.push(`p.Estado IN ('PLANIFICADO', 'EN_CURSO', 'EN_PAUSA')`);
        else if (ESTADOS_PROYECTO.includes(estado)) { where.push('p.Estado = @Estado'); r.input('Estado', sql.VarChar(15), estado); }
        const q = texto(req.query.q, 100);
        if (q) { where.push('(p.Titulo LIKE @Q OR p.Descripcion LIKE @Q OR p.ResponsableNombre LIKE @Q OR e.Nombre LIKE @Q OR p.EquipoTexto LIKE @Q)'); r.input('Q', sql.NVarChar(120), `%${escaparLike(q)}%`); }
        const result = await r.query(`${SELECT_PROYECTO} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY CASE p.Estado WHEN 'EN_CURSO' THEN 0 WHEN 'PLANIFICADO' THEN 1 WHEN 'EN_PAUSA' THEN 2 ELSE 3 END,
                     CASE p.Prioridad WHEN 'CRITICA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC,
                     p.FechaActualizacion DESC`);
        res.json({ success: true, data: result.recordset });
    } catch (err) { responderError(res, err, 'proyectos.listar'); }
};

// GET /proyectos/:id → proyecto + historial + adjuntos + insumos usados
exports.detalle = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    try {
        const pool = await getPool();
        const p = await leerProyecto(pool, id);
        if (!p) return res.status(404).json({ success: false, error: 'No existe el proyecto.' });
        const [his, adj, usos] = await Promise.all([
            leerHistorial(pool, 'PROYECTO', id),
            leerAdjuntos(pool, 'PROYECTO', id),
            pool.request().input('P', sql.Int, id).query(`
                SELECT UsoId, Fecha, Nombre, Unidad, Cantidad, CostoTotal, Moneda, UsuarioNombre FROM dbo.ST_InsumosUso WHERE ProyId = @P ORDER BY Fecha DESC`),
        ]);
        res.json({ success: true, data: { ...p, historial: his, adjuntos: adj, insumos: usos.recordset } });
    } catch (err) { responderError(res, err, 'proyectos.detalle'); }
};

// Valida los campos de un proyecto (crear o editar). Devuelve { datos } o { error }.
async function leerDatos(pool, b) {
    const d = {};
    d.titulo = texto(b.titulo, 200);
    if (!d.titulo) return { error: 'Poné un título.' };
    d.descripcion = texto(b.descripcion, 8000);
    d.prioridad = PRIORIDADES.includes(String(b.prioridad || '').toUpperCase()) ? String(b.prioridad).toUpperCase() : 'MEDIA';
    d.fechaInicio = fechaISO(b.fechaInicio);
    d.fechaEstimadaFin = fechaISO(b.fechaEstimadaFin);
    if (d.fechaInicio && d.fechaEstimadaFin && d.fechaEstimadaFin < d.fechaInicio) return { error: 'La fecha estimada de fin es anterior al inicio.' };
    d.equipoId = idNum(b.equipoId);
    d.equipoTexto = d.equipoId ? null : texto(b.equipoTexto, 150);
    const rid = idNum(b.responsableId);
    d.responsable = null;
    if (rid) {
        const nombre = await nombreUsuario(pool, rid);
        if (!nombre) return { error: 'El responsable elegido no existe.' };
        d.responsable = { id: rid, nombre };
    }
    return { datos: d };
}

// POST /proyectos
exports.crear = async (req, res) => {
    if (!exigirTecnico(req, res, 'crear proyectos')) return;
    try {
        const pool = await getPool();
        const { datos: d, error } = await leerDatos(pool, req.body || {});
        if (error) return res.status(400).json({ success: false, error });
        const usuario = await usuarioActual(pool, req);
        const r = await pool.request()
            .input('T', sql.NVarChar(200), d.titulo).input('D', sql.NVarChar(sql.MAX), d.descripcion)
            .input('R', sql.Int, d.responsable?.id || null).input('RN', sql.NVarChar(150), d.responsable?.nombre || null)
            .input('P', sql.VarChar(10), d.prioridad).input('FI', sql.VarChar(10), d.fechaInicio).input('FE', sql.VarChar(10), d.fechaEstimadaFin)
            .input('E', sql.Int, d.equipoId).input('ET', sql.NVarChar(150), d.equipoTexto)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`INSERT INTO dbo.ST_Proyectos (Titulo, Descripcion, ResponsableId, ResponsableNombre, Prioridad, FechaInicio, FechaEstimadaFin,
                        EquipoId, EquipoTexto, CreadoPorId, CreadoPorNombre)
                    OUTPUT INSERTED.ProyId
                    VALUES (@T, @D, @R, @RN, @P, CAST(@FI AS DATE), CAST(@FE AS DATE), @E, @ET, @U, @UN)`);
        const proyId = r.recordset[0].ProyId;
        await historial(pool, { entidad: 'PROYECTO', entidadId: proyId, usuario, accion: 'CREADO', detalle: d.responsable ? `Responsable: ${d.responsable.nombre}` : null });
        avisarResponsable(req, d.responsable, usuario, `Proyecto a tu cargo: ${d.titulo}`, d.fechaEstimadaFin ? `Fin estimado: ${fmtDia(d.fechaEstimadaFin)}` : null, proyId);
        emitirST(req, { proyId });
        res.json({ success: true, data: await leerProyecto(pool, proyId) });
    } catch (err) { responderError(res, err, 'proyectos.crear'); }
};

// PUT /proyectos/:id — deja en el historial qué cambió
exports.editar = async (req, res) => {
    if (!exigirTecnico(req, res, 'editar proyectos')) return;
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    try {
        const pool = await getPool();
        const act = await leerProyecto(pool, id);
        if (!act) return res.status(404).json({ success: false, error: 'No existe el proyecto.' });
        const { datos: d, error } = await leerDatos(pool, req.body || {});
        if (error) return res.status(400).json({ success: false, error });
        const cambios = [];
        const comparar = (etq, antes, despues, fmt = (x) => x ?? '—') => { if ((antes ?? null) !== (despues ?? null)) cambios.push(`${etq}: ${fmt(antes)} → ${fmt(despues)}`); };
        comparar('Título', act.Titulo, d.titulo);
        if ((act.Descripcion ?? null) !== (d.descripcion ?? null)) cambios.push('Descripción');
        comparar('Prioridad', act.Prioridad, d.prioridad);
        comparar('Inicio', act.FechaInicio, d.fechaInicio, fmtDia);
        comparar('Fin estimado', act.FechaEstimadaFin, d.fechaEstimadaFin, fmtDia);
        comparar('Responsable', act.ResponsableNombre, d.responsable?.nombre || null);
        comparar('Máquina', act.EquipoId, d.equipoId, (x) => (x ? `#${x}` : '—'));
        comparar('Equipo/lugar', act.EquipoTexto, d.equipoTexto);
        if (!cambios.length) return res.json({ success: true, data: act });
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, id)
            .input('T', sql.NVarChar(200), d.titulo).input('D', sql.NVarChar(sql.MAX), d.descripcion)
            .input('R', sql.Int, d.responsable?.id || null).input('RN', sql.NVarChar(150), d.responsable?.nombre || null)
            .input('P', sql.VarChar(10), d.prioridad).input('FI', sql.VarChar(10), d.fechaInicio).input('FE', sql.VarChar(10), d.fechaEstimadaFin)
            .input('E', sql.Int, d.equipoId).input('ET', sql.NVarChar(150), d.equipoTexto)
            .query(`UPDATE dbo.ST_Proyectos SET Titulo = @T, Descripcion = @D, ResponsableId = @R, ResponsableNombre = @RN, Prioridad = @P,
                        FechaInicio = CAST(@FI AS DATE), FechaEstimadaFin = CAST(@FE AS DATE), EquipoId = @E, EquipoTexto = @ET,
                        FechaActualizacion = GETDATE()
                    WHERE ProyId = @Id`);
        await historial(pool, { entidad: 'PROYECTO', entidadId: id, usuario, accion: 'EDITADO', detalle: cambios.join('\n') });
        if (d.responsable?.id && d.responsable.id !== act.ResponsableId) {
            avisarResponsable(req, d.responsable, usuario, `Proyecto a tu cargo: ${d.titulo}`, null, id);
        }
        emitirST(req, { proyId: id });
        res.json({ success: true, data: await leerProyecto(pool, id) });
    } catch (err) { responderError(res, err, 'proyectos.editar'); }
};

// POST /proyectos/:id/avance (multipart: texto, progreso, adjuntos) — un avance en un proyecto
// planificado lo pasa a "en curso".
exports.avance = async (req, res) => {
    const files = req.files || [];
    if (!exigirTecnico(req, res, 'cargar avances')) { limpiarTemporales(files); return; }
    const id = idNum(req.params.id);
    const nota = texto(req.body?.texto, 8000);
    const progreso = req.body?.progreso === '' || req.body?.progreso == null ? null : parseInt(req.body.progreso, 10);
    if (!id) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Proyecto inválido.' }); }
    if (!nota && progreso == null && !files.length) return res.status(400).json({ success: false, error: 'Escribí el avance.' });
    if (progreso != null && !(progreso >= 0 && progreso <= 100)) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'El avance va de 0 a 100 %.' }); }
    try {
        const pool = await getPool();
        const p = await leerProyecto(pool, id);
        if (!p) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe el proyecto.' }); }
        if (['TERMINADO', 'CANCELADO'].includes(p.Estado)) { limpiarTemporales(files); return res.status(409).json({ success: false, error: 'El proyecto está cerrado: reabrilo para cargar avances.' }); }
        const usuario = await usuarioActual(pool, req);
        const pasaEnCurso = p.Estado === 'PLANIFICADO';
        await pool.request().input('Id', sql.Int, id).input('Prog', sql.TinyInt, progreso).input('Curso', sql.Bit, pasaEnCurso).input('Hoy', sql.VarChar(10), hoyUY())
            .query(`UPDATE dbo.ST_Proyectos SET Progreso = ISNULL(@Prog, Progreso),
                        Estado = CASE WHEN @Curso = 1 THEN 'EN_CURSO' ELSE Estado END,
                        FechaInicio = CASE WHEN @Curso = 1 AND FechaInicio IS NULL THEN CAST(@Hoy AS DATE) ELSE FechaInicio END,
                        FechaActualizacion = GETDATE()
                    WHERE ProyId = @Id`);
        const adj = await guardarAdjuntos(pool, { entidad: 'PROYECTO', entidadId: id, files, usuario });
        const partes = [nota, progreso != null && progreso !== p.Progreso ? `Avance: ${p.Progreso}% → ${progreso}%` : null,
            adj.length ? `Adjuntó: ${adj.map(a => a.NombreOriginal).join(', ')}` : null].filter(Boolean);
        await historial(pool, { entidad: 'PROYECTO', entidadId: id, usuario, accion: 'AVANCE', detalle: partes.join('\n') });
        if (pasaEnCurso) await historial(pool, { entidad: 'PROYECTO', entidadId: id, usuario, accion: 'ESTADO', detalle: 'Planificado → En curso' });
        emitirST(req, { proyId: id });
        res.json({ success: true, data: await leerProyecto(pool, id) });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'proyectos.avance');
    }
};

// POST /proyectos/:id/estado { estado, motivo } — pausar/cancelar piden motivo; terminar deja 100 %
exports.cambiarEstado = async (req, res) => {
    if (!exigirTecnico(req, res, 'cambiar el estado de un proyecto')) return;
    const id = idNum(req.params.id);
    const estado = String(req.body?.estado || '').toUpperCase();
    const motivo = texto(req.body?.motivo, 500);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    if (!ESTADOS_PROYECTO.includes(estado)) return res.status(400).json({ success: false, error: 'Estado inválido.' });
    if (['EN_PAUSA', 'CANCELADO'].includes(estado) && !motivo) return res.status(400).json({ success: false, error: 'Indicá el motivo.' });
    try {
        const pool = await getPool();
        const p = await leerProyecto(pool, id);
        if (!p) return res.status(404).json({ success: false, error: 'No existe el proyecto.' });
        if (p.Estado === estado) return res.json({ success: true, data: p });
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, id).input('E', sql.VarChar(15), estado).input('Hoy', sql.VarChar(10), hoyUY())
            .query(`UPDATE dbo.ST_Proyectos SET Estado = @E,
                        Progreso = CASE WHEN @E = 'TERMINADO' THEN 100 ELSE Progreso END,
                        FechaFin = CASE WHEN @E IN ('TERMINADO', 'CANCELADO') THEN GETDATE() ELSE NULL END,
                        FechaInicio = CASE WHEN @E = 'EN_CURSO' AND FechaInicio IS NULL THEN CAST(@Hoy AS DATE) ELSE FechaInicio END,
                        FechaActualizacion = GETDATE()
                    WHERE ProyId = @Id`);
        await historial(pool, { entidad: 'PROYECTO', entidadId: id, usuario, accion: 'ESTADO', detalle: `${ETIQUETA_ESTADO[p.Estado]} → ${ETIQUETA_ESTADO[estado]}`, motivo });
        if (p.ResponsableId && p.ResponsableId !== usuario.id) {
            avisarResponsable(req, { id: p.ResponsableId }, usuario, `${p.Titulo}: ${ETIQUETA_ESTADO[estado].toLowerCase()}`, motivo, id);
        }
        emitirST(req, { proyId: id });
        res.json({ success: true, data: await leerProyecto(pool, id) });
    } catch (err) { responderError(res, err, 'proyectos.estado'); }
};

// POST /proyectos/:id/adjuntos (multipart)
exports.adjuntar = async (req, res) => {
    const files = req.files || [];
    if (!exigirTecnico(req, res, 'adjuntar en proyectos')) { limpiarTemporales(files); return; }
    const id = idNum(req.params.id);
    if (!id) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Proyecto inválido.' }); }
    if (!files.length) return res.status(400).json({ success: false, error: 'No llegó ningún archivo.' });
    try {
        const pool = await getPool();
        if (!(await leerProyecto(pool, id))) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe el proyecto.' }); }
        const usuario = await usuarioActual(pool, req);
        const adj = await guardarAdjuntos(pool, { entidad: 'PROYECTO', entidadId: id, files, usuario });
        if (adj.length) await historial(pool, { entidad: 'PROYECTO', entidadId: id, usuario, accion: 'ADJUNTO', detalle: adj.map(a => a.NombreOriginal).join(', ') });
        emitirST(req, { proyId: id });
        res.json({ success: true, data: adj });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'proyectos.adjuntar');
    }
};
