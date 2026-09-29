// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — mantenimientos (etapa 3). Plan: docs/servicio-tecnico-plan.md
//
// Procedimientos (pasos con tiempo estimado), planes periódicos y trabajos del calendario
// (mantenimientos y tareas puntuales, cada uno con su lista de tareas). Tablas:
// docs/servicio-tecnico/st-etapa3.sql. La generación de trabajos desde los planes vive en
// services/stMantenimientoService.js (la usa también el job diario).
//
// Leer: cualquier usuario interno. Crear, editar, posponer, empezar, terminar: técnicos (área
// SERVICIO) o Admin. Si un trabajo "requiere parar la máquina", al empezarlo la máquina pasa a
// MANTENIMIENTO (no recibe lotes) y al terminarlo el técnico elige cómo queda.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { ESTADOS_EQUIPO, normalizarEstado } = require('../utils/estadoEquipo');
const { notificar } = require('../services/notificacionesService');
const {
    MODULO, codigo, texto, bool, idNum, fechaISO, hoyUY, responderError, exigirTecnico, emitirST, avisarTableros,
    nombreUsuario, usuarioActual, encargado, historial, leerHistorial, cambiarEstadoEquipo, guardarAdjuntos, leerAdjuntos,
    limpiarTemporales,
} = require('../services/servicioTecnicoComun');
const {
    UNIDADES, TIPOS_TRABAJO, SELECT_TRABAJO, sumarIntervalo, cadaTexto, crearTrabajo, asegurarTrabajoDePlan,
    asegurarTodosLosPlanes, avanzarPlan, leerTrabajo,
} = require('../services/stMantenimientoService');

const urlTrabajo = (id) => `/servicio-tecnico?trab=${id}`;
const fmtDia = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const minutosValidos = (v, max = 24 * 60) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

// Lunes y domingo de la semana de una fecha 'AAAA-MM-DD'.
const semanaDe = (fecha) => {
    const [y, m, d] = fecha.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const lunes = new Date(dt);
    lunes.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const domingo = new Date(lunes);
    domingo.setUTCDate(lunes.getUTCDate() + 6);
    return { desde: lunes.toISOString().slice(0, 10), hasta: domingo.toISOString().slice(0, 10) };
};

// Técnico elegido (id) → { id, nombre } o null. Valida que exista.
async function tecnicoElegido(pool, v) {
    const id = idNum(v);
    if (!id) return null;
    const nombre = await nombreUsuario(pool, id);
    return nombre ? { id, nombre } : undefined; // undefined = no existe
}

const avisarAsignado = (req, tecnico, usuario, titulo, texto, trabId) => {
    if (!tecnico?.id || tecnico.id === usuario?.id) return;
    notificar({ usuarioIds: [tecnico.id], modulo: MODULO, io: req.app.get('socketio'), titulo, texto, url: urlTrabajo(trabId), tag: `st-trab-${trabId}` });
};

// =============================================================================
// PROCEDIMIENTOS
// =============================================================================
function leerPasos(pasos) {
    if (!Array.isArray(pasos) || !pasos.length) return { error: 'Cargá al menos un paso.' };
    const lista = [];
    for (const p of pasos) {
        const t = texto(p?.texto, 500);
        if (!t) continue;
        const m = minutosValidos(p?.minutos ?? 0);
        if (m === null) return { error: `Tiempo inválido en el paso "${t}".` };
        lista.push({ texto: t, detalle: texto(p?.detalle, 4000), minutos: m });
    }
    if (!lista.length) return { error: 'Cargá al menos un paso.' };
    if (lista.length > 100) return { error: 'Máximo 100 pasos.' };
    return { pasos: lista };
}

async function guardarPasos(tx, procId, pasos) {
    await tx.request().input('P', sql.Int, procId).query('DELETE FROM dbo.ST_ProcedimientoPasos WHERE ProcId = @P');
    let orden = 1;
    for (const p of pasos) {
        await tx.request().input('P', sql.Int, procId).input('O', sql.Int, orden++)
            .input('T', sql.NVarChar(500), p.texto).input('D', sql.NVarChar(sql.MAX), p.detalle).input('M', sql.Int, p.minutos)
            .query('INSERT INTO dbo.ST_ProcedimientoPasos (ProcId, Orden, Texto, Detalle, MinutosEstimados) VALUES (@P, @O, @T, @D, @M)');
    }
}

// GET /procedimientos?todos=1
exports.listarProcedimientos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('Todos', sql.Bit, req.query.todos === '1').query(`
            SELECT p.ProcId, p.Titulo, p.Descripcion, p.AreaId, a.Nombre AS AreaNombre, p.EquipoId, e.Nombre AS EquipoNombre,
                   p.Activo, p.CreadoPorNombre, p.FechaCreacion, p.ActualizadoPorNombre, p.FechaActualizacion,
                   (SELECT COUNT(*) FROM dbo.ST_ProcedimientoPasos x WHERE x.ProcId = p.ProcId) AS Pasos,
                   (SELECT ISNULL(SUM(x.MinutosEstimados), 0) FROM dbo.ST_ProcedimientoPasos x WHERE x.ProcId = p.ProcId) AS MinutosTotal,
                   (SELECT COUNT(*) FROM dbo.ST_Planes pl WHERE pl.ProcId = p.ProcId AND pl.Activo = 1) AS PlanesActivos
            FROM dbo.ST_Procedimientos p
            LEFT JOIN dbo.Areas a ON a.AreaID = p.AreaId
            LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = p.EquipoId
            WHERE p.Activo = 1 OR @Todos = 1
            ORDER BY p.Activo DESC, p.Titulo`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'procedimientos.listar'); }
};

// GET /procedimientos/:id
exports.detalleProcedimiento = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Procedimiento inválido.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('P', sql.Int, id).query(`
            SELECT ProcId, Titulo, Descripcion, AreaId, EquipoId, Activo, CreadoPorNombre, FechaCreacion, ActualizadoPorNombre, FechaActualizacion
            FROM dbo.ST_Procedimientos WHERE ProcId = @P;
            SELECT PasoId, Orden, Texto, Detalle, MinutosEstimados FROM dbo.ST_ProcedimientoPasos WHERE ProcId = @P ORDER BY Orden, PasoId;`);
        if (!r.recordsets[0].length) return res.status(404).json({ success: false, error: 'No existe el procedimiento.' });
        res.json({ success: true, data: { ...r.recordsets[0][0], pasos: r.recordsets[1] } });
    } catch (err) { responderError(res, err, 'procedimientos.detalle'); }
};

// POST /procedimientos  |  PUT /procedimientos/:id   { titulo, descripcion, areaId, equipoId, pasos: [{ texto, detalle, minutos }] }
exports.guardarProcedimiento = async (req, res) => {
    if (!exigirTecnico(req, res, 'crear o editar procedimientos')) return;
    const id = req.params.id ? idNum(req.params.id) : null;
    if (req.params.id && !id) return res.status(400).json({ success: false, error: 'Procedimiento inválido.' });
    const b = req.body || {};
    const titulo = texto(b.titulo, 200);
    if (!titulo) return res.status(400).json({ success: false, error: 'Poné un título.' });
    const { pasos, error } = leerPasos(b.pasos);
    if (error) return res.status(400).json({ success: false, error });
    let tx = null;
    try {
        const pool = await getPool();
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        let procId = id;
        const r = tx.request()
            .input('T', sql.NVarChar(200), titulo).input('D', sql.NVarChar(sql.MAX), texto(b.descripcion, 8000))
            .input('A', sql.VarChar(20), texto(b.areaId, 20)).input('E', sql.Int, idNum(b.equipoId))
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre);
        if (id) {
            const u = await r.input('P', sql.Int, id).query(`
                UPDATE dbo.ST_Procedimientos SET Titulo = @T, Descripcion = @D, AreaId = @A, EquipoId = @E,
                       ActualizadoPorNombre = @UN, FechaActualizacion = GETDATE()
                WHERE ProcId = @P`);
            if (!u.rowsAffected[0]) { await rollbackSeguro(tx, 'ST procedimiento'); tx = null; return res.status(404).json({ success: false, error: 'No existe el procedimiento.' }); }
        } else {
            const ins = await r.query(`INSERT INTO dbo.ST_Procedimientos (Titulo, Descripcion, AreaId, EquipoId, CreadoPorId, CreadoPorNombre, ActualizadoPorNombre)
                                       OUTPUT INSERTED.ProcId VALUES (@T, @D, @A, @E, @U, @UN, @UN)`);
            procId = ins.recordset[0].ProcId;
        }
        await guardarPasos(tx, procId, pasos);
        await historial(tx, {
            entidad: 'PROCEDIMIENTO', entidadId: procId, usuario, accion: id ? 'EDITADO' : 'CREADO',
            detalle: `${pasos.length} pasos · ${pasos.reduce((s, p) => s + p.minutos, 0)} min`,
        });
        await tx.commit();
        tx = null;
        emitirST(req, { procId });
        res.json({ success: true, data: { ProcId: procId } });
    } catch (err) {
        await rollbackSeguro(tx, 'ST procedimiento');
        responderError(res, err, 'procedimientos.guardar');
    }
};

// PUT /procedimientos/:id/activo { activo }
exports.activarProcedimiento = async (req, res) => {
    if (!exigirTecnico(req, res, 'activar o desactivar procedimientos')) return;
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Procedimiento inválido.' });
    try {
        const pool = await getPool();
        const activo = bool(req.body?.activo);
        await pool.request().input('P', sql.Int, id).input('A', sql.Bit, activo)
            .query('UPDATE dbo.ST_Procedimientos SET Activo = @A, FechaActualizacion = GETDATE() WHERE ProcId = @P');
        await historial(pool, { entidad: 'PROCEDIMIENTO', entidadId: id, usuario: await usuarioActual(pool, req), accion: activo ? 'ACTIVADO' : 'DESACTIVADO' });
        emitirST(req, { procId: id });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'procedimientos.activar'); }
};

// =============================================================================
// PLANES
// =============================================================================
// GET /planes?todos=1
exports.listarPlanes = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('Todos', sql.Bit, req.query.todos === '1').input('Hoy', sql.VarChar(10), hoyUY()).query(`
            SELECT p.PlanId, p.Titulo, p.Descripcion, p.EquipoId, e.Nombre AS EquipoNombre, LTRIM(RTRIM(e.AreaID)) AS EquipoArea,
                   p.EquipoTexto, p.ProcId, pr.Titulo AS ProcTitulo, p.CadaValor, p.CadaUnidad, p.TecnicoId, p.TecnicoNombre,
                   CONVERT(VARCHAR(10), p.ProximaFecha, 23) AS ProximaFecha, p.ParaMaquina, p.Activo, p.CreadoPorNombre, p.FechaCreacion,
                   t.TrabId AS TrabAbiertoId, CONVERT(VARCHAR(10), t.FechaProgramada, 23) AS TrabAbiertoFecha, t.Estado AS TrabAbiertoEstado,
                   t.VecesPospuesto AS TrabAbiertoPospuesto,
                   CASE WHEN t.FechaProgramada < CAST(@Hoy AS DATE) THEN 1 ELSE 0 END AS TrabAbiertoVencido,
                   (SELECT CONVERT(VARCHAR(10), MAX(x.FechaFin), 23) FROM dbo.ST_Trabajos x WHERE x.PlanId = p.PlanId AND x.Estado = 'REALIZADO') AS UltimaVezRealizado
            FROM dbo.ST_Planes p
            LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = p.EquipoId
            LEFT JOIN dbo.ST_Procedimientos pr ON pr.ProcId = p.ProcId
            OUTER APPLY (SELECT TOP 1 * FROM dbo.ST_Trabajos x WHERE x.PlanId = p.PlanId AND x.Estado IN ('PENDIENTE', 'EN_CURSO') ORDER BY x.FechaProgramada) t
            WHERE p.Activo = 1 OR @Todos = 1
            ORDER BY p.Activo DESC, t.FechaProgramada, p.Titulo`);
        res.json({ success: true, data: r.recordset.map(p => ({ ...p, CadaTexto: cadaTexto(p.CadaValor, p.CadaUnidad) })) });
    } catch (err) { responderError(res, err, 'planes.listar'); }
};

// Valida los datos de un plan. Devuelve { datos } o { error }.
async function leerDatosPlan(pool, b) {
    const d = {};
    d.procId = idNum(b.procId);
    let proc = null;
    if (d.procId) {
        const r = await pool.request().input('P', sql.Int, d.procId).query('SELECT Titulo FROM dbo.ST_Procedimientos WHERE ProcId = @P');
        proc = r.recordset[0];
        if (!proc) return { error: 'El procedimiento elegido no existe.' };
    }
    d.titulo = texto(b.titulo, 200) || proc?.Titulo;
    if (!d.titulo) return { error: 'Poné un título o elegí un procedimiento.' };
    d.descripcion = texto(b.descripcion, 8000);
    d.cadaValor = parseInt(b.cadaValor, 10);
    if (!(d.cadaValor >= 1 && d.cadaValor <= 365)) return { error: 'La frecuencia tiene que ser entre 1 y 365.' };
    d.cadaUnidad = String(b.cadaUnidad || '').toUpperCase();
    if (!UNIDADES.includes(d.cadaUnidad)) return { error: 'Elegí cada cuánto (días, semanas o meses).' };
    d.equipoId = idNum(b.equipoId);
    if (d.equipoId) {
        const r = await pool.request().input('E', sql.Int, d.equipoId).query('SELECT EquipoID FROM dbo.ConfigEquipos WHERE EquipoID = @E');
        if (!r.recordset.length) return { error: 'La máquina elegida no existe.' };
    }
    d.equipoTexto = d.equipoId ? null : texto(b.equipoTexto, 150);
    d.paraMaquina = !!d.equipoId && bool(b.paraMaquina);
    d.tecnico = await tecnicoElegido(pool, b.tecnicoId);
    if (d.tecnico === undefined) return { error: 'El técnico elegido no existe.' };
    const hoy = hoyUY();
    d.proximaFecha = fechaISO(b.proximaFecha) || hoy;
    if (d.proximaFecha < hoy) d.proximaFecha = hoy;
    return { datos: d };
}

// POST /planes
exports.crearPlan = async (req, res) => {
    if (!exigirTecnico(req, res, 'crear planes de mantenimiento')) return;
    let tx = null;
    try {
        const pool = await getPool();
        const { datos: d, error } = await leerDatosPlan(pool, req.body || {});
        if (error) return res.status(400).json({ success: false, error });
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const ins = await tx.request()
            .input('T', sql.NVarChar(200), d.titulo).input('D', sql.NVarChar(sql.MAX), d.descripcion)
            .input('E', sql.Int, d.equipoId).input('ET', sql.NVarChar(150), d.equipoTexto).input('P', sql.Int, d.procId)
            .input('CV', sql.Int, d.cadaValor).input('CU', sql.VarChar(10), d.cadaUnidad)
            .input('Tec', sql.Int, d.tecnico?.id || null).input('TecN', sql.NVarChar(150), d.tecnico?.nombre || null)
            .input('F', sql.VarChar(10), d.proximaFecha).input('Para', sql.Bit, d.paraMaquina)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`INSERT INTO dbo.ST_Planes (Titulo, Descripcion, EquipoId, EquipoTexto, ProcId, CadaValor, CadaUnidad, TecnicoId, TecnicoNombre,
                        ProximaFecha, ParaMaquina, CreadoPorId, CreadoPorNombre)
                    OUTPUT INSERTED.PlanId
                    VALUES (@T, @D, @E, @ET, @P, @CV, @CU, @Tec, @TecN, CAST(@F AS DATE), @Para, @U, @UN)`);
        const planId = ins.recordset[0].PlanId;
        await historial(tx, { entidad: 'PLAN', entidadId: planId, usuario, accion: 'CREADO', detalle: `${cadaTexto(d.cadaValor, d.cadaUnidad)} · primera vez ${fmtDia(d.proximaFecha)}` });
        const trabId = await asegurarTrabajoDePlan(tx, planId, usuario);
        await tx.commit();
        tx = null;
        if (trabId) avisarAsignado(req, d.tecnico, usuario, `Mantenimiento asignado: ${d.titulo}`, `${cadaTexto(d.cadaValor, d.cadaUnidad)} · el próximo es el ${fmtDia(d.proximaFecha)}`, trabId);
        emitirST(req, { planId, trabId });
        res.json({ success: true, data: { PlanId: planId, TrabId: trabId } });
    } catch (err) {
        await rollbackSeguro(tx, 'ST crear plan');
        responderError(res, err, 'planes.crear');
    }
};

// PUT /planes/:id — los cambios de título, técnico, máquina y fecha pasan también al trabajo pendiente
exports.editarPlan = async (req, res) => {
    if (!exigirTecnico(req, res, 'editar planes de mantenimiento')) return;
    const planId = idNum(req.params.id);
    if (!planId) return res.status(400).json({ success: false, error: 'Plan inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        const act = await pool.request().input('P', sql.Int, planId).query('SELECT PlanId, TecnicoId FROM dbo.ST_Planes WHERE PlanId = @P');
        if (!act.recordset.length) return res.status(404).json({ success: false, error: 'No existe el plan.' });
        const { datos: d, error } = await leerDatosPlan(pool, req.body || {});
        if (error) return res.status(400).json({ success: false, error });
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        await tx.request()
            .input('Id', sql.Int, planId)
            .input('T', sql.NVarChar(200), d.titulo).input('D', sql.NVarChar(sql.MAX), d.descripcion)
            .input('E', sql.Int, d.equipoId).input('ET', sql.NVarChar(150), d.equipoTexto).input('P', sql.Int, d.procId)
            .input('CV', sql.Int, d.cadaValor).input('CU', sql.VarChar(10), d.cadaUnidad)
            .input('Tec', sql.Int, d.tecnico?.id || null).input('TecN', sql.NVarChar(150), d.tecnico?.nombre || null)
            .input('F', sql.VarChar(10), d.proximaFecha).input('Para', sql.Bit, d.paraMaquina)
            .query(`UPDATE dbo.ST_Planes SET Titulo = @T, Descripcion = @D, EquipoId = @E, EquipoTexto = @ET, ProcId = @P,
                        CadaValor = @CV, CadaUnidad = @CU, TecnicoId = @Tec, TecnicoNombre = @TecN,
                        ProximaFecha = CAST(@F AS DATE), ParaMaquina = @Para
                    WHERE PlanId = @Id`);
        // El trabajo pendiente (sin empezar) sigue al plan. Si no se pospuso, también la fecha.
        const pend = await tx.request().input('P', sql.Int, planId).query(`
            SELECT TOP 1 TrabId, VecesPospuesto, TecnicoId FROM dbo.ST_Trabajos WHERE PlanId = @P AND Estado = 'PENDIENTE' ORDER BY FechaProgramada`);
        const t = pend.recordset[0];
        if (t) {
            await tx.request()
                .input('Id', sql.Int, t.TrabId).input('T', sql.NVarChar(200), d.titulo).input('D', sql.NVarChar(sql.MAX), d.descripcion)
                .input('E', sql.Int, d.equipoId).input('ET', sql.NVarChar(150), d.equipoTexto)
                .input('Tec', sql.Int, d.tecnico?.id || null).input('TecN', sql.NVarChar(150), d.tecnico?.nombre || null)
                .input('Para', sql.Bit, d.paraMaquina).input('F', sql.VarChar(10), d.proximaFecha).input('MoverFecha', sql.Bit, t.VecesPospuesto === 0)
                .query(`UPDATE dbo.ST_Trabajos SET Titulo = @T, Descripcion = @D, EquipoId = @E, EquipoTexto = @ET,
                            TecnicoId = @Tec, TecnicoNombre = @TecN, ParaMaquina = @Para,
                            FechaProgramada = CASE WHEN @MoverFecha = 1 THEN CAST(@F AS DATE) ELSE FechaProgramada END,
                            FechaOriginal = CASE WHEN @MoverFecha = 1 THEN CAST(@F AS DATE) ELSE FechaOriginal END,
                            FechaActualizacion = GETDATE()
                        WHERE TrabId = @Id`);
        }
        await historial(tx, { entidad: 'PLAN', entidadId: planId, usuario, accion: 'EDITADO', detalle: `${d.titulo} · ${cadaTexto(d.cadaValor, d.cadaUnidad)}` });
        await tx.commit();
        tx = null;
        if (t && d.tecnico?.id && d.tecnico.id !== t.TecnicoId) {
            avisarAsignado(req, d.tecnico, usuario, `Mantenimiento asignado: ${d.titulo}`, `${cadaTexto(d.cadaValor, d.cadaUnidad)}`, t.TrabId);
        }
        emitirST(req, { planId });
        res.json({ success: true });
    } catch (err) {
        await rollbackSeguro(tx, 'ST editar plan');
        responderError(res, err, 'planes.editar');
    }
};

// PUT /planes/:id/activo { activo } — desactivar cancela el trabajo pendiente (sin empezar)
exports.activarPlan = async (req, res) => {
    if (!exigirTecnico(req, res, 'activar o desactivar planes')) return;
    const planId = idNum(req.params.id);
    if (!planId) return res.status(400).json({ success: false, error: 'Plan inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        const activo = bool(req.body?.activo);
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const hoy = hoyUY();
        const u = await tx.request().input('P', sql.Int, planId).input('A', sql.Bit, activo).input('Hoy', sql.VarChar(10), hoy).query(`
            UPDATE dbo.ST_Planes SET Activo = @A,
                   ProximaFecha = CASE WHEN @A = 1 AND ProximaFecha < CAST(@Hoy AS DATE) THEN CAST(@Hoy AS DATE) ELSE ProximaFecha END
            WHERE PlanId = @P`);
        if (!u.rowsAffected[0]) { await rollbackSeguro(tx, 'ST activar plan'); tx = null; return res.status(404).json({ success: false, error: 'No existe el plan.' }); }
        if (!activo) {
            const pend = await tx.request().input('P', sql.Int, planId)
                .query(`SELECT TrabId FROM dbo.ST_Trabajos WHERE PlanId = @P AND Estado = 'PENDIENTE'`);
            for (const { TrabId } of pend.recordset) {
                await tx.request().input('T', sql.Int, TrabId)
                    .query(`UPDATE dbo.ST_Trabajos SET Estado = 'CANCELADO', Motivo = 'Plan desactivado', FechaFin = GETDATE(), FechaActualizacion = GETDATE() WHERE TrabId = @T`);
                await historial(tx, { entidad: 'TRABAJO', entidadId: TrabId, usuario, accion: 'CANCELADO', motivo: 'Plan desactivado' });
            }
        } else {
            await asegurarTrabajoDePlan(tx, planId, usuario);
        }
        await historial(tx, { entidad: 'PLAN', entidadId: planId, usuario, accion: activo ? 'ACTIVADO' : 'DESACTIVADO' });
        await tx.commit();
        tx = null;
        emitirST(req, { planId });
        res.json({ success: true });
    } catch (err) {
        await rollbackSeguro(tx, 'ST activar plan');
        responderError(res, err, 'planes.activar');
    }
};

// =============================================================================
// TRABAJOS (calendario)
// =============================================================================
// Seguimientos de solicitudes pendientes de hacer, con fecha hasta `hasta` (incluye los atrasados).
async function seguimientosPendientes(pool, { desde = null, hasta, tecnicoId = null }) {
    const r = pool.request().input('Hasta', sql.VarChar(10), hasta);
    const where = [`s.RequiereSeguimiento = 1`, `s.FechaSeguimiento IS NOT NULL`, `s.SeguimientoHechoFecha IS NULL`,
        `s.FechaSeguimiento <= CAST(@Hasta AS DATE)`];
    if (desde) { where.push('s.FechaSeguimiento >= CAST(@Desde AS DATE)'); r.input('Desde', sql.VarChar(10), desde); }
    if (tecnicoId) { where.push('s.TecnicoId = @Tec'); r.input('Tec', sql.Int, tecnicoId); }
    const q = await r.query(`
        SELECT s.SolId, s.Titulo, s.EquipoId, e.Nombre AS EquipoNombre, s.EquipoTexto, s.TecnicoId, s.TecnicoNombre,
               CONVERT(VARCHAR(10), s.FechaSeguimiento, 23) AS FechaSeguimiento, s.SeguimientoNota, s.Estado, s.Resultado
        FROM dbo.ST_Solicitudes s LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = s.EquipoId
        WHERE ${where.join(' AND ')}
        ORDER BY s.FechaSeguimiento`);
    return q.recordset.map(s => ({ ...s, Codigo: codigo(s.SolId) }));
}

// Filtro de técnico: 'yo' | 'sin' (sin asignar) | id
function filtroTecnico(req, valor, r, where, col = 't.TecnicoId') {
    if (!valor) return;
    if (valor === 'sin') { where.push(`${col} IS NULL`); return; }
    const id = valor === 'yo' ? idNum(req.user?.id) : idNum(valor);
    if (id) { where.push(`${col} = @FiltroTec`); r.input('FiltroTec', sql.Int, id); }
}

// GET /trabajos?desde=&hasta=&tecnico=yo|sin|id&vencidos=1
exports.listarTrabajos = async (req, res) => {
    try {
        const pool = await getPool();
        const hoy = hoyUY();
        const desde = fechaISO(req.query.desde) || semanaDe(hoy).desde;
        const hasta = fechaISO(req.query.hasta) || semanaDe(hoy).hasta;
        if (hasta < desde) return res.status(400).json({ success: false, error: 'Rango de fechas inválido.' });
        await asegurarTodosLosPlanes(pool); // por si algún plan quedó sin su próximo trabajo

        const r = pool.request().input('Hoy', sql.VarChar(10), hoy).input('Desde', sql.VarChar(10), desde).input('Hasta', sql.VarChar(10), hasta);
        const where = ['t.FechaProgramada BETWEEN CAST(@Desde AS DATE) AND CAST(@Hasta AS DATE)'];
        filtroTecnico(req, req.query.tecnico, r, where);
        const trabajos = await r.query(`${SELECT_TRABAJO} WHERE ${where.join(' AND ')} ORDER BY t.FechaProgramada, t.TecnicoNombre, t.Titulo`);

        let vencidos = [];
        if (req.query.vencidos === '1') {
            const rv = pool.request().input('Hoy', sql.VarChar(10), hoy).input('Desde', sql.VarChar(10), desde);
            const wv = [`t.Estado IN ('PENDIENTE', 'EN_CURSO')`, 't.FechaProgramada < CAST(@Hoy AS DATE)', 't.FechaProgramada < CAST(@Desde AS DATE)'];
            filtroTecnico(req, req.query.tecnico, rv, wv);
            vencidos = (await rv.query(`${SELECT_TRABAJO} WHERE ${wv.join(' AND ')} ORDER BY t.FechaProgramada`)).recordset;
        }
        const tecFiltro = req.query.tecnico === 'yo' ? idNum(req.user?.id) : idNum(req.query.tecnico);
        const seguimientos = await seguimientosPendientes(pool, { desde: req.query.vencidos === '1' ? null : desde, hasta, tecnicoId: tecFiltro });
        res.json({ success: true, data: { hoy, desde, hasta, trabajos: trabajos.recordset, vencidos, seguimientos } });
    } catch (err) { responderError(res, err, 'trabajos.listar'); }
};

// GET /mi-semana → lo del técnico logueado: esta semana, atrasado, sin asignar, sus solicitudes y seguimientos
exports.miSemana = async (req, res) => {
    try {
        const pool = await getPool();
        const hoy = hoyUY();
        const { desde, hasta } = semanaDe(hoy);
        const yo = idNum(req.user?.id);
        await asegurarTodosLosPlanes(pool);
        const base = () => pool.request().input('Hoy', sql.VarChar(10), hoy).input('Hasta', sql.VarChar(10), hasta).input('Yo', sql.Int, yo || -1);
        const [mios, sinAsignar, sols, seguimientos] = await Promise.all([
            base().query(`${SELECT_TRABAJO}
                WHERE t.TecnicoId = @Yo AND (
                    (t.Estado IN ('PENDIENTE', 'EN_CURSO') AND t.FechaProgramada <= CAST(@Hasta AS DATE))
                    OR (t.Estado NOT IN ('PENDIENTE', 'EN_CURSO') AND t.FechaProgramada = CAST(@Hoy AS DATE)))
                ORDER BY CASE t.Estado WHEN 'EN_CURSO' THEN 0 ELSE 1 END, t.FechaProgramada, t.Titulo`),
            base().query(`${SELECT_TRABAJO}
                WHERE t.TecnicoId IS NULL AND t.Estado IN ('PENDIENTE', 'EN_CURSO') AND t.FechaProgramada <= CAST(@Hasta AS DATE)
                ORDER BY t.FechaProgramada, t.Titulo`),
            pool.request().input('Yo', sql.Int, yo || -1).query(`
                SELECT s.SolId, s.Titulo, s.Prioridad, s.Estado, s.EsperaMotivo, s.MaquinaNoTrabaja, s.FechaSolicitud,
                       s.EquipoId, e.Nombre AS EquipoNombre, s.EquipoTexto, s.DerivadaExterno
                FROM dbo.ST_Solicitudes s LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = s.EquipoId
                WHERE s.TecnicoId = @Yo AND s.Estado <> 'FINALIZADA'
                ORDER BY CASE s.Prioridad WHEN 'CRITICA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC, s.FechaSolicitud`),
            seguimientosPendientes(pool, { hasta, tecnicoId: yo }),
        ]);
        res.json({
            success: true,
            data: {
                hoy, desde, hasta,
                trabajos: mios.recordset, sinAsignar: sinAsignar.recordset,
                solicitudes: sols.recordset.map(s => ({ ...s, Codigo: codigo(s.SolId) })),
                seguimientos,
            },
        });
    } catch (err) { responderError(res, err, 'miSemana'); }
};

// GET /trabajos/:id → trabajo + tareas + historial + adjuntos
exports.detalleTrabajo = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Trabajo inválido.' });
    try {
        const pool = await getPool();
        const t = await leerTrabajo(pool, id);
        if (!t) return res.status(404).json({ success: false, error: 'No existe el trabajo.' });
        const [tareas, his, adj] = await Promise.all([
            pool.request().input('T', sql.Int, id).query(`
                SELECT TareaId, Orden, Texto, Detalle, MinutosEstimados, Hecha, HechaPorNombre, FechaHecha, Nota
                FROM dbo.ST_TrabajoTareas WHERE TrabId = @T ORDER BY Orden, TareaId`),
            leerHistorial(pool, 'TRABAJO', id),
            leerAdjuntos(pool, 'TRABAJO', id),
        ]);
        res.json({ success: true, data: { ...t, tareas: tareas.recordset, historial: his, adjuntos: adj } });
    } catch (err) { responderError(res, err, 'trabajos.detalle'); }
};

// POST /trabajos → mantenimiento suelto o tarea puntual
//   { tipo, titulo, descripcion, fecha, tecnicoId, minutosEstimados, procId, equipoId | equipoTexto, paraMaquina, tareas: [{ texto, minutos }] }
exports.crearTrabajo = async (req, res) => {
    if (!exigirTecnico(req, res, 'programar trabajos')) return;
    const b = req.body || {};
    const tipo = String(b.tipo || 'TAREA').toUpperCase();
    if (!TIPOS_TRABAJO.includes(tipo)) return res.status(400).json({ success: false, error: 'Tipo inválido.' });
    const fecha = fechaISO(b.fecha);
    if (!fecha) return res.status(400).json({ success: false, error: 'Elegí la fecha.' });
    let tx = null;
    try {
        const pool = await getPool();
        let procTitulo = null;
        const procId = idNum(b.procId);
        if (procId) {
            const r = await pool.request().input('P', sql.Int, procId).query('SELECT Titulo FROM dbo.ST_Procedimientos WHERE ProcId = @P');
            if (!r.recordset.length) return res.status(400).json({ success: false, error: 'El procedimiento elegido no existe.' });
            procTitulo = r.recordset[0].Titulo;
        }
        const titulo = texto(b.titulo, 200) || procTitulo;
        if (!titulo) return res.status(400).json({ success: false, error: 'Poné un título.' });
        const tecnico = await tecnicoElegido(pool, b.tecnicoId);
        if (tecnico === undefined) return res.status(400).json({ success: false, error: 'El técnico elegido no existe.' });
        const equipoId = idNum(b.equipoId);
        let tareas = null;
        if (!procId && Array.isArray(b.tareas) && b.tareas.length) {
            const lp = leerPasos(b.tareas);
            if (lp.error) return res.status(400).json({ success: false, error: lp.error });
            tareas = lp.pasos;
        }
        const minutos = b.minutosEstimados === '' || b.minutosEstimados == null ? null : minutosValidos(b.minutosEstimados, 7 * 24 * 60);
        if (b.minutosEstimados !== '' && b.minutosEstimados != null && minutos === null) return res.status(400).json({ success: false, error: 'Tiempo estimado inválido.' });
        const usuario = await usuarioActual(pool, req);

        tx = new sql.Transaction(pool);
        await tx.begin();
        const trabId = await crearTrabajo(tx, {
            tipo, procId, equipoId, equipoTexto: texto(b.equipoTexto, 150), titulo, descripcion: texto(b.descripcion, 8000),
            fecha, tecnico, minutosEstimados: minutos, paraMaquina: bool(b.paraMaquina), tareas, creadoPor: usuario,
        });
        await historial(tx, { entidad: 'TRABAJO', entidadId: trabId, usuario, accion: 'CREADO', detalle: `Programado para el ${fmtDia(fecha)}${tecnico ? ` · ${tecnico.nombre}` : ''}` });
        await tx.commit();
        tx = null;
        avisarAsignado(req, tecnico, usuario, `${tipo === 'TAREA' ? 'Tarea' : 'Mantenimiento'} asignado: ${titulo}`, `Para el ${fmtDia(fecha)}`, trabId);
        emitirST(req, { trabId });
        res.json({ success: true, data: await leerTrabajo(pool, trabId) });
    } catch (err) {
        await rollbackSeguro(tx, 'ST crear trabajo');
        responderError(res, err, 'trabajos.crear');
    }
};

// Carga un trabajo abierto para una acción de técnico. Responde el error y devuelve null si no corresponde.
async function trabajoParaAccion(req, res, pool, { abierto = true } = {}) {
    if (!exigirTecnico(req, res)) return null;
    const id = idNum(req.params.id);
    if (!id) { res.status(400).json({ success: false, error: 'Trabajo inválido.' }); return null; }
    const t = await leerTrabajo(pool, id);
    if (!t) { res.status(404).json({ success: false, error: 'No existe el trabajo.' }); return null; }
    if (abierto && !['PENDIENTE', 'EN_CURSO'].includes(t.Estado)) {
        res.status(409).json({ success: false, error: 'El trabajo ya está cerrado.' }); return null;
    }
    return t;
}

// PUT /trabajos/:id { titulo, descripcion, tecnicoId, minutosEstimados, equipoTexto }
exports.editarTrabajo = async (req, res) => {
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool);
        if (!t) return;
        const b = req.body || {};
        const usuario = await usuarioActual(pool, req);
        const r = pool.request().input('Id', sql.Int, t.TrabId);
        const sets = [];
        const cambios = [];
        if ('titulo' in b) {
            const v = texto(b.titulo, 200);
            if (!v) return res.status(400).json({ success: false, error: 'El título no puede quedar vacío.' });
            if (v !== t.Titulo) { sets.push('Titulo = @Tit'); r.input('Tit', sql.NVarChar(200), v); cambios.push(`Título: ${t.Titulo} → ${v}`); }
        }
        if ('descripcion' in b) {
            const v = texto(b.descripcion, 8000);
            if ((v ?? null) !== (t.Descripcion ?? null)) { sets.push('Descripcion = @Desc'); r.input('Desc', sql.NVarChar(sql.MAX), v); cambios.push('Descripción'); }
        }
        if ('equipoTexto' in b && !t.EquipoId) {
            const v = texto(b.equipoTexto, 150);
            if ((v ?? null) !== (t.EquipoTexto ?? null)) { sets.push('EquipoTexto = @EqT'); r.input('EqT', sql.NVarChar(150), v); cambios.push(`Equipo/lugar: ${t.EquipoTexto || '—'} → ${v || '—'}`); }
        }
        if ('minutosEstimados' in b) {
            const v = minutosValidos(b.minutosEstimados, 7 * 24 * 60);
            if (v === null) return res.status(400).json({ success: false, error: 'Tiempo estimado inválido.' });
            if (v !== t.MinutosEstimados) { sets.push('MinutosEstimados = @Min'); r.input('Min', sql.Int, v); cambios.push(`Tiempo estimado: ${t.MinutosEstimados} → ${v} min`); }
        }
        let nuevoTec = null;
        if ('tecnicoId' in b) {
            const tec = await tecnicoElegido(pool, b.tecnicoId);
            if (tec === undefined) return res.status(400).json({ success: false, error: 'El técnico elegido no existe.' });
            if ((tec?.id || null) !== (t.TecnicoId || null)) {
                sets.push('TecnicoId = @Tec, TecnicoNombre = @TecN');
                r.input('Tec', sql.Int, tec?.id || null).input('TecN', sql.NVarChar(150), tec?.nombre || null);
                cambios.push(`Técnico: ${t.TecnicoNombre || 'sin asignar'} → ${tec?.nombre || 'sin asignar'}`);
                nuevoTec = tec;
            }
        }
        if (!sets.length) return res.json({ success: true, data: t });
        await r.query(`UPDATE dbo.ST_Trabajos SET ${sets.join(', ')}, FechaActualizacion = GETDATE() WHERE TrabId = @Id`);
        await historial(pool, { entidad: 'TRABAJO', entidadId: t.TrabId, usuario, accion: 'EDITADO', detalle: cambios.join('\n') });
        if (nuevoTec) avisarAsignado(req, nuevoTec, usuario, `Te asignaron: ${t.Titulo}`, `Para el ${fmtDia(t.FechaProgramada)}`, t.TrabId);
        emitirST(req, { trabId: t.TrabId });
        res.json({ success: true, data: await leerTrabajo(pool, t.TrabId) });
    } catch (err) { responderError(res, err, 'trabajos.editar'); }
};

// POST /trabajos/:id/posponer { fecha, motivo }
exports.posponer = async (req, res) => {
    const fecha = fechaISO(req.body?.fecha);
    const motivo = texto(req.body?.motivo, 500);
    if (!fecha) return res.status(400).json({ success: false, error: 'Elegí la nueva fecha.' });
    if (!motivo) return res.status(400).json({ success: false, error: 'Indicá por qué se pospone.' });
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool);
        if (!t) return;
        if (fecha < hoyUY()) return res.status(400).json({ success: false, error: 'La nueva fecha no puede ser anterior a hoy.' });
        if (fecha === t.FechaProgramada) return res.status(400).json({ success: false, error: 'Es la misma fecha que ya tiene.' });
        const posterga = fecha > t.FechaProgramada;
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, t.TrabId).input('F', sql.VarChar(10), fecha).input('Suma', sql.Int, posterga ? 1 : 0)
            .query(`UPDATE dbo.ST_Trabajos SET FechaProgramada = CAST(@F AS DATE), VecesPospuesto = VecesPospuesto + @Suma, FechaActualizacion = GETDATE()
                    WHERE TrabId = @Id`);
        await historial(pool, {
            entidad: 'TRABAJO', entidadId: t.TrabId, usuario, accion: posterga ? 'POSPUESTO' : 'REPROGRAMADO',
            detalle: `${fmtDia(t.FechaProgramada)} → ${fmtDia(fecha)}`, motivo,
        });
        if (t.TecnicoId && t.TecnicoId !== usuario.id) {
            avisarAsignado(req, { id: t.TecnicoId }, usuario, `${posterga ? 'Pospuesto' : 'Reprogramado'}: ${t.Titulo}`, `Ahora para el ${fmtDia(fecha)} — ${motivo}`, t.TrabId);
        }
        emitirST(req, { trabId: t.TrabId });
        res.json({ success: true, data: await leerTrabajo(pool, t.TrabId) });
    } catch (err) { responderError(res, err, 'trabajos.posponer'); }
};

// POST /trabajos/:id/empezar → EN_CURSO; si requiere parar la máquina, la pasa a MANTENIMIENTO
exports.empezar = async (req, res) => {
    let tx = null;
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool);
        if (!t) return;
        if (t.Estado === 'EN_CURSO') return res.json({ success: true, data: t });
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        let maquinaCambio = false;
        let previo = null;
        if (t.ParaMaquina && t.EquipoId) {
            previo = await cambiarEstadoEquipo(tx, { equipoId: t.EquipoId, nuevo: 'MANTENIMIENTO', usuario, motivo: `${t.Tipo === 'TAREA' ? 'Tarea' : 'Mantenimiento'}: ${t.Titulo}` });
            maquinaCambio = !!previo && previo !== 'MANTENIMIENTO';
        }
        await tx.request().input('Id', sql.Int, t.TrabId).input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .input('Prev', sql.NVarChar(100), maquinaCambio ? previo : null)
            .query(`UPDATE dbo.ST_Trabajos SET Estado = 'EN_CURSO', FechaInicio = GETDATE(),
                        TecnicoId = ISNULL(TecnicoId, @U), TecnicoNombre = ISNULL(TecnicoNombre, @UN),
                        EstadoEquipoPrevio = ISNULL(@Prev, EstadoEquipoPrevio), FechaActualizacion = GETDATE()
                    WHERE TrabId = @Id`);
        await historial(tx, { entidad: 'TRABAJO', entidadId: t.TrabId, usuario, accion: 'EMPEZADO', detalle: maquinaCambio ? `${t.EquipoNombre} pasó a MANTENIMIENTO` : null });
        await tx.commit();
        tx = null;
        if (maquinaCambio) avisarTableros(req, t.EquipoId);
        emitirST(req, { trabId: t.TrabId, equipoId: t.EquipoId || undefined });
        res.json({ success: true, data: await leerTrabajo(pool, t.TrabId) });
    } catch (err) {
        await rollbackSeguro(tx, 'ST empezar trabajo');
        responderError(res, err, 'trabajos.empezar');
    }
};

// Cierra el trabajo (terminar / cancelar) y, si es de un plan, genera el siguiente.
async function cerrarTrabajo(req, res, { estadoFinal, motivo = null, minutosReales = null, observaciones = null, estadoEquipo = '' }) {
    let tx = null;
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool);
        if (!t) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        // Tiempo real: el cargado; si no, desde que se empezó; si nunca se empezó, el estimado.
        const reales = estadoFinal !== 'REALIZADO' ? null
            : minutosReales != null ? minutosReales
            : t.FechaInicio ? Math.max(1, Math.round((Date.now() - new Date(t.FechaInicio).getTime()) / 60000))
            : t.MinutosEstimados;
        await tx.request().input('Id', sql.Int, t.TrabId).input('E', sql.VarChar(15), estadoFinal)
            .input('Min', sql.Int, reales).input('Obs', sql.NVarChar(sql.MAX), observaciones).input('Mot', sql.NVarChar(500), motivo)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`UPDATE dbo.ST_Trabajos SET Estado = @E, MinutosReales = @Min, Observaciones = ISNULL(@Obs, Observaciones), Motivo = @Mot,
                        FechaFin = GETDATE(), FechaInicio = ISNULL(FechaInicio, CASE WHEN @E = 'REALIZADO' THEN GETDATE() END),
                        TecnicoId = ISNULL(TecnicoId, @U), TecnicoNombre = ISNULL(TecnicoNombre, @UN), FechaActualizacion = GETDATE()
                    WHERE TrabId = @Id`);
        const etiqueta = { REALIZADO: 'Realizado', NO_REALIZADO: 'No realizado', CANCELADO: 'Cancelado' }[estadoFinal];
        await historial(tx, {
            entidad: 'TRABAJO', entidadId: t.TrabId, usuario, accion: estadoFinal,
            detalle: [etiqueta, reales != null ? `${reales} min (estimado ${t.MinutosEstimados})` : null, observaciones].filter(Boolean).join(' · '), motivo,
        });
        let maquinaCambio = false;
        if (t.EquipoId && estadoEquipo) {
            const anterior = await cambiarEstadoEquipo(tx, { equipoId: t.EquipoId, nuevo: estadoEquipo, usuario, motivo: `${t.Titulo}: ${etiqueta.toLowerCase()}` });
            maquinaCambio = !!anterior && anterior !== estadoEquipo;
        }
        const siguiente = await avanzarPlan(tx, { planId: t.PlanId, realizado: estadoFinal === 'REALIZADO', fechaProgramada: t.FechaProgramada, creadoPor: usuario });
        await tx.commit();
        tx = null;
        if (maquinaCambio) avisarTableros(req, t.EquipoId);
        emitirST(req, { trabId: t.TrabId, planId: t.PlanId || undefined, equipoId: t.EquipoId || undefined });
        const actualizado = await leerTrabajo(pool, t.TrabId);
        res.json({ success: true, data: { ...actualizado, siguienteTrabId: siguiente || null, siguiente: siguiente ? await leerTrabajo(pool, siguiente) : null } });
    } catch (err) {
        await rollbackSeguro(tx, `ST cerrar trabajo (${estadoFinal})`);
        responderError(res, err, 'trabajos.cerrar');
    }
}

// POST /trabajos/:id/terminar { resultado: REALIZADO | NO_REALIZADO, minutosReales, observaciones, motivo, estadoEquipo }
exports.terminar = async (req, res) => {
    const b = req.body || {};
    const resultado = String(b.resultado || 'REALIZADO').toUpperCase();
    if (!['REALIZADO', 'NO_REALIZADO'].includes(resultado)) return res.status(400).json({ success: false, error: 'Resultado inválido.' });
    const motivo = texto(b.motivo, 500);
    if (resultado === 'NO_REALIZADO' && !motivo) return res.status(400).json({ success: false, error: 'Indicá por qué no se realizó.' });
    const minutosReales = b.minutosReales === '' || b.minutosReales == null ? null : minutosValidos(b.minutosReales, 7 * 24 * 60);
    if (b.minutosReales !== '' && b.minutosReales != null && minutosReales === null) return res.status(400).json({ success: false, error: 'Tiempo real inválido.' });
    const estadoEquipo = normalizarEstado(b.estadoEquipo);
    if (estadoEquipo && !ESTADOS_EQUIPO.includes(estadoEquipo)) return res.status(400).json({ success: false, error: 'Estado de máquina inválido.' });
    return cerrarTrabajo(req, res, { estadoFinal: resultado, motivo, minutosReales, observaciones: texto(b.observaciones, 8000), estadoEquipo });
};

// POST /trabajos/:id/cancelar { motivo }
exports.cancelar = async (req, res) => {
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) return res.status(400).json({ success: false, error: 'Indicá por qué se cancela.' });
    const estadoEquipo = normalizarEstado(req.body?.estadoEquipo);
    return cerrarTrabajo(req, res, { estadoFinal: 'CANCELADO', motivo, estadoEquipo: ESTADOS_EQUIPO.includes(estadoEquipo) ? estadoEquipo : '' });
};

// PUT /trabajos/:id/tareas/:tareaId { hecha, nota } — tildar una tarea empieza el trabajo si estaba pendiente
exports.marcarTarea = async (req, res) => {
    const tareaId = idNum(req.params.tareaId);
    if (!tareaId) return res.status(400).json({ success: false, error: 'Tarea inválida.' });
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool);
        if (!t) return;
        const hecha = bool(req.body?.hecha);
        if (hecha && t.Estado === 'PENDIENTE' && t.ParaMaquina && t.EquipoId) {
            return res.status(409).json({ success: false, error: 'Primero tocá "Empezar": este trabajo pasa la máquina a mantenimiento.' });
        }
        const usuario = await usuarioActual(pool, req);
        const u = await pool.request().input('T', sql.Int, t.TrabId).input('Id', sql.Int, tareaId).input('H', sql.Bit, hecha)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .input('N', sql.NVarChar(500), 'nota' in (req.body || {}) ? texto(req.body.nota, 500) : undefined)
            .query(`UPDATE dbo.ST_TrabajoTareas SET Hecha = @H,
                        HechaPorId = CASE WHEN @H = 1 THEN @U END, HechaPorNombre = CASE WHEN @H = 1 THEN @UN END,
                        FechaHecha = CASE WHEN @H = 1 THEN GETDATE() END
                        ${'nota' in (req.body || {}) ? ', Nota = @N' : ''}
                    WHERE TareaId = @Id AND TrabId = @T`);
        if (!u.rowsAffected[0]) return res.status(404).json({ success: false, error: 'No existe la tarea.' });
        if (hecha && t.Estado === 'PENDIENTE') {
            await pool.request().input('Id', sql.Int, t.TrabId).input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
                .query(`UPDATE dbo.ST_Trabajos SET Estado = 'EN_CURSO', FechaInicio = GETDATE(),
                            TecnicoId = ISNULL(TecnicoId, @U), TecnicoNombre = ISNULL(TecnicoNombre, @UN), FechaActualizacion = GETDATE()
                        WHERE TrabId = @Id AND Estado = 'PENDIENTE'`);
            await historial(pool, { entidad: 'TRABAJO', entidadId: t.TrabId, usuario, accion: 'EMPEZADO' });
        }
        emitirST(req, { trabId: t.TrabId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'trabajos.marcarTarea'); }
};

// POST /trabajos/:id/tareas { texto, minutos } → agrega una tarea
exports.agregarTarea = async (req, res) => {
    const t0 = texto(req.body?.texto, 500);
    if (!t0) return res.status(400).json({ success: false, error: 'Escribí la tarea.' });
    const minutos = minutosValidos(req.body?.minutos ?? 0);
    if (minutos === null) return res.status(400).json({ success: false, error: 'Tiempo inválido.' });
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool);
        if (!t) return;
        await pool.request().input('T', sql.Int, t.TrabId).input('Tx', sql.NVarChar(500), t0).input('M', sql.Int, minutos).query(`
            INSERT INTO dbo.ST_TrabajoTareas (TrabId, Orden, Texto, MinutosEstimados)
            VALUES (@T, (SELECT ISNULL(MAX(Orden), 0) + 1 FROM dbo.ST_TrabajoTareas WHERE TrabId = @T), @Tx, @M);
            UPDATE dbo.ST_Trabajos SET MinutosEstimados = MinutosEstimados + @M, FechaActualizacion = GETDATE() WHERE TrabId = @T;`);
        await historial(pool, { entidad: 'TRABAJO', entidadId: t.TrabId, usuario: await usuarioActual(pool, req), accion: 'TAREA_AGREGADA', detalle: `${t0}${minutos ? ` (${minutos} min)` : ''}` });
        emitirST(req, { trabId: t.TrabId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'trabajos.agregarTarea'); }
};

// POST /trabajos/:id/comentarios { texto }
exports.comentarTrabajo = async (req, res) => {
    const comentario = texto(req.body?.texto, 4000);
    if (!comentario) return res.status(400).json({ success: false, error: 'Escribí el comentario.' });
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool, { abierto: false });
        if (!t) return;
        await historial(pool, { entidad: 'TRABAJO', entidadId: t.TrabId, usuario: await usuarioActual(pool, req), accion: 'COMENTARIO', detalle: comentario });
        emitirST(req, { trabId: t.TrabId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'trabajos.comentar'); }
};

// POST /trabajos/:id/adjuntos (multipart)
exports.adjuntarTrabajo = async (req, res) => {
    const files = req.files || [];
    try {
        const pool = await getPool();
        const t = await trabajoParaAccion(req, res, pool, { abierto: false });
        if (!t) { limpiarTemporales(files); return; }
        if (!files.length) return res.status(400).json({ success: false, error: 'No llegó ningún archivo.' });
        const usuario = await usuarioActual(pool, req);
        const adj = await guardarAdjuntos(pool, { entidad: 'TRABAJO', entidadId: t.TrabId, files, usuario });
        if (adj.length) await historial(pool, { entidad: 'TRABAJO', entidadId: t.TrabId, usuario, accion: 'ADJUNTO', detalle: adj.map(a => a.NombreOriginal).join(', ') });
        emitirST(req, { trabId: t.TrabId });
        res.json({ success: true, data: adj });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'trabajos.adjuntar');
    }
};

// POST /solicitudes/:id/seguimiento { nota } → el seguimiento de una solicitud quedó hecho
exports.seguimientoHecho = async (req, res) => {
    if (!exigirTecnico(req, res, 'marcar seguimientos')) return;
    const solId = idNum(req.params.id);
    if (!solId) return res.status(400).json({ success: false, error: 'Solicitud inválida.' });
    try {
        const pool = await getPool();
        const usuario = await usuarioActual(pool, req);
        const nota = texto(req.body?.nota, 500);
        const u = await pool.request().input('Id', sql.Int, solId).input('UN', sql.NVarChar(150), usuario.nombre).input('N', sql.NVarChar(500), nota)
            .query(`UPDATE dbo.ST_Solicitudes SET SeguimientoHechoFecha = GETDATE(), SeguimientoHechoPor = @UN, SeguimientoResultado = @N,
                        FechaActualizacion = GETDATE()
                    WHERE SolId = @Id AND RequiereSeguimiento = 1 AND SeguimientoHechoFecha IS NULL`);
        if (!u.rowsAffected[0]) return res.status(409).json({ success: false, error: 'La solicitud no tiene un seguimiento pendiente.' });
        await historial(pool, { entidadId: solId, usuario, accion: 'SEGUIMIENTO', detalle: nota || 'Seguimiento hecho' });
        emitirST(req, { solId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'seguimientoHecho'); }
};

// Para el job diario y las pruebas
exports._semanaDe = semanaDe;
exports._sumarIntervalo = sumarIntervalo;
