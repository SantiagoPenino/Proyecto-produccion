// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — Planificación (fase 3, docs/desarrollos/plan-integracion.md §6). Reglas: spec-C §1.
//
// Tandas: períodos de 1 a 4 semanas con proyectos, grupos de proyectos y las tareas elegidas de cada uno.
// Lo que está en una tanda abierta está "planificado"; el resto, dormido.
// Regla "una tarea, una tanda abierta": al sumar una tarea a una tanda se saca de cualquier otra abierta.
// La garantiza la base (índice único filtrado UQ_DesTandaTareas_UnaAbierta) y todo va en transacción.
// Leer: el equipo. Cambiar: el editor (como en el prototipo).
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const fabrica = require('../services/desarrollos/fabrica');
const { texto, idNum, fechaISO, hoyUY, usuarioActual, exigir, bitacora, emitir, responderError } = require('../services/desarrollos/comun');
const { etapaActualDB } = require('../services/desarrollos/proyectos');

const HORIZONTES = [14, 28, 56, 91, 0];
const sumarDias = (iso, n) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
};
const diaSemana = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // 0 domingo … 6 sábado
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');

async function leerConfigPlan(db) {
    const r = await db.request().query(`SELECT Clave, Valor FROM dbo.DesConfig WHERE Clave IN ('plan_horizonte', 'plan_tanda', 'orden_quien', 'orden_fecha')`);
    const c = Object.fromEntries(r.recordset.map(x => [x.Clave, x.Valor]));
    return {
        plan: { horizonte: Number(c.plan_horizonte ?? fabrica.PLAN.horizonte), tanda: Number(c.plan_tanda ?? fabrica.PLAN.tanda) },
        ordenQuien: c.orden_quien || null, ordenFecha: c.orden_fecha || null,
    };
}

async function leerTandas(db) {
    const tandas = (await db.request().query(`
        SELECT TandaID AS id, Nombre AS nombre, CONVERT(CHAR(10), Inicio, 23) AS inicio, CONVERT(CHAR(10), Fin, 23) AS fin, Objetivo AS objetivo,
               Estado AS estado, CerradaEl AS cerradaEl, Resumen AS resumen
        FROM dbo.DesTandas ORDER BY Inicio, TandaID`)).recordset;
    const grupos = (await db.request().query('SELECT GrupoID AS id, TandaID AS tandaId, Nombre AS nombre, Orden AS orden FROM dbo.DesTandaGrupos ORDER BY Orden, GrupoID')).recordset;
    const proys = (await db.request().query(`
        SELECT tp.TandaID AS tandaId, tp.ProyectoID AS proyectoId, tp.GrupoID AS grupoId FROM dbo.DesTandaProyectos tp
        JOIN dbo.DesProyectos p ON p.ProyectoID = tp.ProyectoID AND p.Borrado = 0`)).recordset;
    const tareas = (await db.request().query(`
        SELECT tt.TandaID AS tandaId, tt.TareaID AS tareaId, tt.PendienteAlCerrar AS pendienteAlCerrar FROM dbo.DesTandaTareas tt
        JOIN dbo.DesTareas t ON t.TareaID = tt.TareaID JOIN dbo.DesProyectos p ON p.ProyectoID = t.ProyectoID AND p.Borrado = 0`)).recordset;
    return tandas.map(t => ({
        ...t,
        grupos: grupos.filter(g => g.tandaId === t.id).map(({ tandaId, ...g }) => g),
        proyectos: proys.filter(p => p.tandaId === t.id).map(({ tandaId, ...p }) => p),
        tareas: tareas.filter(x => x.tandaId === t.id).map(x => x.tareaId),
        pendientesAlCerrar: tareas.filter(x => x.tandaId === t.id && x.pendienteAlCerrar).map(x => x.tareaId),
    }));
}

async function respuesta(pool) {
    const [tandas, cfg, orden] = await Promise.all([
        leerTandas(pool), leerConfigPlan(pool),
        pool.request().query('SELECT o.ProyectoID FROM dbo.DesOrdenLista o JOIN dbo.DesProyectos p ON p.ProyectoID = o.ProyectoID AND p.Borrado = 0 ORDER BY o.Posicion'),
    ]);
    return { tandas, plan: cfg.plan, orden: { ids: orden.recordset.map(x => x.ProyectoID), quien: cfg.ordenQuien, fecha: cfg.ordenFecha } };
}

// GET /tandas → tandas (abiertas y cerradas), configuración del plan y orden manual de la lista
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver la planificación')) return;
        res.json({ success: true, data: await respuesta(pool) });
    } catch (err) { responderError(res, err, 'tandas'); }
};

// Envoltorio para las escrituras: editor, transacción, y al final la planificación entera.
// fn(tx, usuario) devuelve { error: [status, mensaje] } o datos extra para la respuesta.
async function escribir(req, res, que, fn) {
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', que)) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const r = (await fn(tx, usuario)) || {};
        if (r.error) { await rollbackSeguro(tx, `Desarrollos ${que}`); tx = null; return res.status(r.error[0]).json({ success: false, error: r.error[1] }); }
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'TANDA' });
        res.json({ success: true, data: await respuesta(pool), ...r });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, `Desarrollos ${que}`);
        responderError(res, err, que);
    }
}

async function tandaAbierta(tx, id) {
    const r = await tx.request().input('Id', sql.Int, id).query(`
        SELECT TandaID, Nombre, CONVERT(CHAR(10), Inicio, 23) AS Inicio, CONVERT(CHAR(10), Fin, 23) AS Fin, Estado
        FROM dbo.DesTandas WITH (UPDLOCK) WHERE TandaID = @Id`);
    return r.recordset[0] || null;
}
const nombreProyecto = async (tx, pid) => (await tx.request().input('P', sql.Int, pid).query('SELECT Nombre FROM dbo.DesProyectos WHERE ProyectoID = @P AND Borrado = 0')).recordset[0]?.Nombre || null;

// Suma tareas a una tanda abierta: las saca de las otras abiertas (dejando constancia) y vincula sus proyectos.
async function sumarTareas(tx, tanda, tareaIds, usuario) {
    if (!tareaIds.length) return 0;
    const lista = tareaIds.join(',');
    const pend = (await tx.request().query(`
        SELECT t.TareaID, t.ProyectoID FROM dbo.DesTareas t JOIN dbo.DesProyectos p ON p.ProyectoID = t.ProyectoID AND p.Borrado = 0
        WHERE t.TareaID IN (${lista}) AND t.Estado NOT IN ('HECHO', 'NO_APLICA')`)).recordset;
    if (!pend.length) return 0;
    const ids = pend.map(x => x.TareaID).join(',');
    const otras = (await tx.request().input('T', sql.Int, tanda.TandaID).query(`
        SELECT tt.TandaID, COUNT(*) AS n FROM dbo.DesTandaTareas tt WHERE tt.Abierta = 1 AND tt.TandaID <> @T AND tt.TareaID IN (${ids}) GROUP BY tt.TandaID`)).recordset;
    for (const o of otras) {
        await tx.request().input('T', sql.Int, o.TandaID).query(`DELETE FROM dbo.DesTandaTareas WHERE TandaID = @T AND TareaID IN (${ids})`);
        await bitacora(tx, { entidad: 'TANDA', entidadId: o.TandaID, accion: 'Pasó tareas', detalle: `${o.n} a ${tanda.Nombre}`, usuario });
    }
    for (const pid of [...new Set(pend.map(x => x.ProyectoID))]) {
        await tx.request().input('T', sql.Int, tanda.TandaID).input('P', sql.Int, pid).query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.DesTandaProyectos WHERE TandaID = @T AND ProyectoID = @P)
                INSERT INTO dbo.DesTandaProyectos (TandaID, ProyectoID) VALUES (@T, @P)`);
    }
    let n = 0;
    for (const x of pend) {
        const r = await tx.request().input('T', sql.Int, tanda.TandaID).input('X', sql.Int, x.TareaID).query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.DesTandaTareas WHERE TandaID = @T AND TareaID = @X)
                INSERT INTO dbo.DesTandaTareas (TandaID, TareaID, Abierta) VALUES (@T, @X, 1)`);
        n += r.rowsAffected.reduce((a, b) => a + b, 0) ? 1 : 0;
    }
    return n;
}

// ── Configuración y orden ────────────────────────────────────────────────────
// PUT /plan { horizonte, tanda }
exports.guardarPlan = (req, res) => escribir(req, res, 'cambiar la planificación', async (tx) => {
    const b = req.body || {};
    for (const [clave, valor, validos] of [['plan_horizonte', b.horizonte, HORIZONTES], ['plan_tanda', b.tanda, [1, 2, 3, 4]]]) {
        if (valor === undefined) continue;
        const n = Number(valor);
        if (!validos.includes(n)) return { error: [400, 'Valor inválido.'] };
        await tx.request().input('C', sql.VarChar(40), clave).input('V', sql.NVarChar(sql.MAX), String(n)).query(`
            MERGE dbo.DesConfig AS t USING (SELECT @C AS Clave) AS s ON t.Clave = s.Clave
            WHEN MATCHED THEN UPDATE SET Valor = @V, FechaActualizado = GETDATE() WHEN NOT MATCHED THEN INSERT (Clave, Valor) VALUES (@C, @V);`);
    }
    return {};
});

// PUT /orden { ids } → orden manual de la lista de desarrollo (los que no vienen quedan sin orden)
exports.guardarOrden = (req, res) => escribir(req, res, 'ordenar la lista', async (tx, usuario) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(idNum).filter(Boolean))];
    const validos = ids.length ? new Set((await tx.request().query(`SELECT ProyectoID FROM dbo.DesProyectos WHERE Borrado = 0 AND ProyectoID IN (${ids.join(',')})`)).recordset.map(x => x.ProyectoID)) : new Set();
    await tx.request().query('DELETE FROM dbo.DesOrdenLista');
    let pos = 0;
    for (const id of ids.filter(x => validos.has(x))) {
        await tx.request().input('P', sql.Int, id).input('O', sql.Int, ++pos).query('INSERT INTO dbo.DesOrdenLista (ProyectoID, Posicion) VALUES (@P, @O)');
    }
    for (const [clave, valor] of [['orden_quien', usuario.nombre], ['orden_fecha', new Date().toISOString()]]) {
        await tx.request().input('C', sql.VarChar(40), clave).input('V', sql.NVarChar(sql.MAX), valor).query(`
            MERGE dbo.DesConfig AS t USING (SELECT @C AS Clave) AS s ON t.Clave = s.Clave
            WHEN MATCHED THEN UPDATE SET Valor = @V, FechaActualizado = GETDATE() WHEN NOT MATCHED THEN INSERT (Clave, Valor) VALUES (@C, @V);`);
    }
    return {};
});

// ── Tandas ───────────────────────────────────────────────────────────────────
// POST /tandas → la próxima tanda: arranca el lunes después de la última abierta (o el próximo lunes)
// y dura lo que diga el plan. No se crea más allá del horizonte.
exports.crear = (req, res) => escribir(req, res, 'crear tandas', async (tx, usuario) => {
    const { plan } = await leerConfigPlan(tx);
    const hoy = hoyUY();
    const ult = (await tx.request().query(`SELECT TOP 1 CONVERT(CHAR(10), Fin, 23) AS Fin FROM dbo.DesTandas WITH (UPDLOCK, HOLDLOCK) WHERE Estado = 'ABIERTA' ORDER BY Inicio DESC, TandaID DESC`)).recordset[0];
    let ini = ult ? sumarDias(ult.Fin, 1) : (diaSemana(hoy) === 1 ? hoy : sumarDias(hoy, ((8 - diaSemana(hoy)) % 7) || 7));
    if (diaSemana(ini) === 6) ini = sumarDias(ini, 2);
    else if (diaSemana(ini) === 0) ini = sumarDias(ini, 1);
    const limite = plan.horizonte ? sumarDias(hoy, plan.horizonte) : '9999-12-31';
    if (ini > limite) return { error: [400, `Esa tanda empezaría el ${fmtD(ini)}, después del horizonte de planificación. Si querés planificar más adelante, ampliá el horizonte.`] };
    const sem = plan.tanda;
    const total = (await tx.request().query('SELECT COUNT(*) AS n FROM dbo.DesTandas')).recordset[0].n;
    const r = await tx.request().input('N', sql.NVarChar(60), `Tanda ${total + 1}`).input('I', sql.VarChar(10), ini).input('F', sql.VarChar(10), sumarDias(ini, sem * 7 - 3))
        .query(`INSERT INTO dbo.DesTandas (Nombre, Inicio, Fin, Estado) OUTPUT INSERTED.TandaID VALUES (@N, CONVERT(DATE, @I, 23), CONVERT(DATE, @F, 23), 'ABIERTA')`);
    const id = r.recordset[0].TandaID;
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Creó la tanda', detalle: `${sem} ${sem === 1 ? 'semana' : 'semanas'}`, usuario });
    return { tandaId: id };
});

// PUT /tandas/:id { nombre, inicio, fin, objetivo } (solo abiertas)
exports.editar = (req, res) => escribir(req, res, 'cambiar tandas', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const t = id && await tandaAbierta(tx, id);
    if (!t) return { error: [404, 'Esa tanda ya no existe.'] };
    if (t.Estado !== 'ABIERTA') return { error: [409, 'La tanda está cerrada.'] };
    const b = req.body || {};
    const nuevo = { Nombre: t.Nombre, Inicio: t.Inicio, Fin: t.Fin };
    const cambios = [];
    if ('nombre' in b) { const v = texto(b.nombre, 60); if (v && v !== t.Nombre) { nuevo.Nombre = v; cambios.push('nombre'); } }
    if ('inicio' in b) { const v = fechaISO(b.inicio); if (!v) return { error: [400, 'Poné la fecha de inicio.'] }; if (v !== t.Inicio) { nuevo.Inicio = v; cambios.push('inicio'); } }
    if ('fin' in b) { const v = fechaISO(b.fin); if (!v) return { error: [400, 'El fin no puede ser antes del inicio.'] }; if (v !== t.Fin) { nuevo.Fin = v; cambios.push('fin'); } }
    if (nuevo.Fin < nuevo.Inicio) return { error: [400, 'El fin no puede ser antes del inicio.'] };
    let objetivo;
    if ('objetivo' in b) { objetivo = texto(b.objetivo, 200); cambios.push('objetivo'); }
    if (!cambios.length) return {};
    const r2 = tx.request().input('Id', sql.Int, id).input('N', sql.NVarChar(60), nuevo.Nombre).input('I', sql.VarChar(10), nuevo.Inicio).input('F', sql.VarChar(10), nuevo.Fin);
    let extra = '';
    if (objetivo !== undefined) { r2.input('O', sql.NVarChar(200), objetivo); extra = ', Objetivo = @O'; }
    await r2.query(`UPDATE dbo.DesTandas SET Nombre = @N, Inicio = CONVERT(DATE, @I, 23), Fin = CONVERT(DATE, @F, 23)${extra}, FechaActualizado = GETDATE() WHERE TandaID = @Id`);
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: cambios.length === 1 ? `Editó ${cambios[0]}` : 'Editó', detalle: cambios.join(', '), usuario });
    return {};
});

// DELETE /tandas/:id → borra la tanda (los proyectos y las tareas no se tocan)
exports.borrar = (req, res) => escribir(req, res, 'borrar tandas', async (tx) => {
    const id = idNum(req.params.id);
    if (!id || !await tandaAbierta(tx, id)) return { error: [404, 'Esa tanda ya no existe.'] };
    await tx.request().input('T', sql.Int, id).query(`
        DELETE FROM dbo.DesTandaTareas WHERE TandaID = @T; DELETE FROM dbo.DesTandaProyectos WHERE TandaID = @T;
        DELETE FROM dbo.DesTandaGrupos WHERE TandaID = @T; DELETE FROM dbo.DesBitacora WHERE Entidad = 'TANDA' AND EntidadID = @T;
        DELETE FROM dbo.DesTandas WHERE TandaID = @T;`);
    return {};
});

// POST /tandas/:id/vincular { proyectoId, grupoId } → vincula el proyecto con las tareas pendientes de
// su etapa actual (sacándolas de otras tandas abiertas). grupoId presente (o null) lo pone en ese grupo.
exports.vincular = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const pid = idNum(req.body?.proyectoId);
    const t = id && await tandaAbierta(tx, id);
    if (!t) return { error: [404, 'Esa tanda ya no existe.'] };
    if (t.Estado !== 'ABIERTA') return { error: [409, 'La tanda está cerrada.'] };
    const nombre = pid && await nombreProyecto(tx, pid);
    if (!nombre) return { error: [404, 'Ese proyecto ya no existe.'] };
    const etapa = await etapaActualDB(tx, pid);
    const est = (await tx.request().input('P', sql.Int, pid).query('SELECT Estado FROM dbo.DesProyectos WHERE ProyectoID = @P')).recordset[0].Estado;
    const refs = etapa && est !== 'CANCELADO' ? (await tx.request().input('P', sql.Int, pid).input('E', sql.Int, etapa.etapaId).query(`
        SELECT TareaID FROM dbo.DesTareas WHERE ProyectoID = @P AND EtapaID = @E AND Estado NOT IN ('HECHO', 'NO_APLICA')`)).recordset.map(x => x.TareaID) : [];
    await tx.request().input('T', sql.Int, id).input('P', sql.Int, pid).query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.DesTandaProyectos WHERE TandaID = @T AND ProyectoID = @P)
            INSERT INTO dbo.DesTandaProyectos (TandaID, ProyectoID) VALUES (@T, @P)`);
    if (req.body && 'grupoId' in req.body) {
        const g = idNum(req.body.grupoId);
        if (g && !(await tx.request().input('G', sql.Int, g).input('T', sql.Int, id).query('SELECT 1 AS Si FROM dbo.DesTandaGrupos WHERE GrupoID = @G AND TandaID = @T')).recordset.length) return { error: [400, 'Ese grupo no es de esta tanda.'] };
        await tx.request().input('T', sql.Int, id).input('P', sql.Int, pid).input('G', sql.Int, g).query('UPDATE dbo.DesTandaProyectos SET GrupoID = @G WHERE TandaID = @T AND ProyectoID = @P');
    }
    const n = await sumarTareas(tx, t, refs, usuario);
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Vinculó', detalle: nombre, usuario });
    return { mensaje: n ? `«${nombre}» vinculado con ${n} ${n === 1 ? 'tarea' : 'tareas'} de ${etapa.nombre}. Tildá o destildá las que quieras.` : `«${nombre}» vinculado. Elegí sus tareas.` };
});

// POST /tandas/:id/tareas { agregar: [ids], quitar: [ids], accion }
const ACCIONES = ['Sumó una tarea', 'Sumó una etapa', 'Sacó una tarea', 'Sacó una etapa'];
exports.tareas = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const t = id && await tandaAbierta(tx, id);
    if (!t) return { error: [404, 'Esa tanda ya no existe.'] };
    if (t.Estado !== 'ABIERTA') return { error: [409, 'La tanda está cerrada.'] };
    const agregar = [...new Set((req.body?.agregar || []).map(idNum).filter(Boolean))];
    const quitar = [...new Set((req.body?.quitar || []).map(idNum).filter(Boolean))];
    const n = await sumarTareas(tx, t, agregar, usuario);
    if (quitar.length) await tx.request().input('T', sql.Int, id).query(`DELETE FROM dbo.DesTandaTareas WHERE TandaID = @T AND TareaID IN (${quitar.join(',')})`);
    const accion = ACCIONES.includes(req.body?.accion) ? req.body.accion : (agregar.length ? 'Sumó tareas' : 'Sacó tareas');
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion, detalle: `${agregar.length ? `${n} sumadas` : ''}${agregar.length && quitar.length ? ', ' : ''}${quitar.length ? `${quitar.length} sacadas` : ''}`, usuario });
    return {};
});

// POST /tandas/:id/desvincular { proyectoId } → saca el proyecto, sus tareas y su grupo de la tanda
exports.desvincular = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const pid = idNum(req.body?.proyectoId);
    const t = id && await tandaAbierta(tx, id);
    if (!t) return { error: [404, 'Esa tanda ya no existe.'] };
    if (t.Estado !== 'ABIERTA') return { error: [409, 'La tanda está cerrada.'] };
    await tx.request().input('T', sql.Int, id).input('P', sql.Int, pid).query(`
        DELETE tt FROM dbo.DesTandaTareas tt JOIN dbo.DesTareas x ON x.TareaID = tt.TareaID WHERE tt.TandaID = @T AND x.ProyectoID = @P;
        DELETE FROM dbo.DesTandaProyectos WHERE TandaID = @T AND ProyectoID = @P;`);
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Desvinculó', detalle: (await nombreProyecto(tx, pid)) || 'un proyecto', usuario });
    return {};
});

// Grupos: POST /tandas/:id/grupos · PUT /tandas/:id/grupos/:gid { nombre } · DELETE /tandas/:id/grupos/:gid
// PUT /tandas/:id/proyectos/:pid { grupoId } → mueve un proyecto vinculado a un grupo (null = sin grupo)
exports.crearGrupo = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const t = id && await tandaAbierta(tx, id);
    if (!t || t.Estado !== 'ABIERTA') return { error: [404, 'Esa tanda no está abierta.'] };
    const n = (await tx.request().input('T', sql.Int, id).query('SELECT COUNT(*) AS n, ISNULL(MAX(Orden), 0) AS o FROM dbo.DesTandaGrupos WHERE TandaID = @T')).recordset[0];
    const r = await tx.request().input('T', sql.Int, id).input('N', sql.NVarChar(60), texto(req.body?.nombre, 60) || `Grupo ${n.n + 1}`).input('O', sql.Int, n.o + 1)
        .query('INSERT INTO dbo.DesTandaGrupos (TandaID, Nombre, Orden) OUTPUT INSERTED.GrupoID VALUES (@T, @N, @O)');
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Creó un grupo', detalle: null, usuario });
    return { grupoId: r.recordset[0].GrupoID };
});
exports.renombrarGrupo = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const gid = idNum(req.params.gid);
    const nombre = texto(req.body?.nombre, 60);
    if (!nombre) return { error: [400, 'El grupo tiene que tener nombre.'] };
    const r = await tx.request().input('G', sql.Int, gid).input('T', sql.Int, id).input('N', sql.NVarChar(60), nombre)
        .query(`UPDATE g SET Nombre = @N FROM dbo.DesTandaGrupos g JOIN dbo.DesTandas t ON t.TandaID = g.TandaID AND t.Estado = 'ABIERTA' WHERE g.GrupoID = @G AND g.TandaID = @T`);
    if (!r.rowsAffected[0]) return { error: [404, 'Ese grupo no existe.'] };
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Renombró un grupo', detalle: nombre, usuario });
    return {};
});
exports.borrarGrupo = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const gid = idNum(req.params.gid);
    await tx.request().input('G', sql.Int, gid).input('T', sql.Int, id).query(`
        UPDATE dbo.DesTandaProyectos SET GrupoID = NULL WHERE TandaID = @T AND GrupoID = @G;
        DELETE FROM dbo.DesTandaGrupos WHERE GrupoID = @G AND TandaID = @T;`);
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Deshizo un grupo', detalle: null, usuario });
    return {};
});
exports.moverAGrupo = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const pid = idNum(req.params.pid);
    const gid = idNum(req.body?.grupoId);
    if (gid && !(await tx.request().input('G', sql.Int, gid).input('T', sql.Int, id).query('SELECT 1 AS Si FROM dbo.DesTandaGrupos WHERE GrupoID = @G AND TandaID = @T')).recordset.length) return { error: [400, 'Ese grupo no es de esta tanda.'] };
    const r = await tx.request().input('T', sql.Int, id).input('P', sql.Int, pid).input('G', sql.Int, gid).query('UPDATE dbo.DesTandaProyectos SET GrupoID = @G WHERE TandaID = @T AND ProyectoID = @P');
    if (!r.rowsAffected[0]) return { error: [404, 'Ese proyecto no está en la tanda.'] };
    const grupo = gid ? (await tx.request().input('G', sql.Int, gid).query('SELECT Nombre FROM dbo.DesTandaGrupos WHERE GrupoID = @G')).recordset[0].Nombre : null;
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Agrupó', detalle: `${await nombreProyecto(tx, pid)} → ${grupo || 'sin grupo'}`, usuario });
    return {};
});

// POST /tandas/:id/cerrar { pasar } → la cierra con su resumen. Con pasar, lo pendiente (y sus grupos)
// pasa a la próxima tanda abierta, o a una nueva que arranca el lunes siguiente.
exports.cerrar = (req, res) => escribir(req, res, 'cerrar tandas', async (tx, usuario) => {
    const id = idNum(req.params.id);
    const pasar = !!req.body?.pasar;
    const t = id && await tandaAbierta(tx, id);
    if (!t) return { error: [404, 'Esa tanda ya no existe.'] };
    if (t.Estado !== 'ABIERTA') return { error: [409, 'La tanda ya está cerrada.'] };
    const refs = (await tx.request().input('T', sql.Int, id).query(`
        SELECT tt.TareaID, x.ProyectoID, x.Estado FROM dbo.DesTandaTareas tt JOIN dbo.DesTareas x ON x.TareaID = tt.TareaID
        JOIN dbo.DesProyectos p ON p.ProyectoID = x.ProyectoID AND p.Borrado = 0 WHERE tt.TandaID = @T`)).recordset;
    const pendientes = refs.filter(r => r.Estado !== 'HECHO' && r.Estado !== 'NO_APLICA');
    const resumen = `${refs.length - pendientes.length} de ${refs.length} tareas hechas`;
    // Primero se cierra (las tareas dejan de estar "abiertas"), así pueden entrar en otra tanda
    await tx.request().input('T', sql.Int, id).input('R', sql.NVarChar(100), resumen).query(`
        UPDATE dbo.DesTandas SET Estado = 'CERRADA', CerradaEl = GETDATE(), Resumen = @R, FechaActualizado = GETDATE() WHERE TandaID = @T;
        UPDATE tt SET Abierta = 0, PendienteAlCerrar = CASE WHEN x.Estado IN ('HECHO', 'NO_APLICA') THEN 0 ELSE 1 END
        FROM dbo.DesTandaTareas tt JOIN dbo.DesTareas x ON x.TareaID = tt.TareaID WHERE tt.TandaID = @T;`);
    await bitacora(tx, { entidad: 'TANDA', entidadId: id, accion: 'Cerró la tanda', detalle: resumen, usuario });

    let destino = null;
    if (pasar && pendientes.length) {
        const proyectosPend = [...new Set(pendientes.map(p => p.ProyectoID))];
        let nx = (await tx.request().input('I', sql.VarChar(10), t.Inicio).input('T', sql.Int, id).query(`
            SELECT TOP 1 TandaID, Nombre FROM dbo.DesTandas WITH (UPDLOCK) WHERE Estado = 'ABIERTA' AND TandaID <> @T AND Inicio > CONVERT(DATE, @I, 23) ORDER BY Inicio, TandaID`)).recordset[0];
        if (!nx) {
            const inicio = sumarDias(t.Fin, 3);
            const sem = Math.max(1, Math.round((diasEntre(t.Inicio, t.Fin) + 3) / 7));
            const total = (await tx.request().query('SELECT COUNT(*) AS n FROM dbo.DesTandas')).recordset[0].n;
            const r = await tx.request().input('N', sql.NVarChar(60), `Tanda ${total + 1}`).input('I', sql.VarChar(10), inicio).input('F', sql.VarChar(10), sumarDias(inicio, sem * 7 - 3))
                .query(`INSERT INTO dbo.DesTandas (Nombre, Inicio, Fin, Estado) OUTPUT INSERTED.TandaID, INSERTED.Nombre VALUES (@N, CONVERT(DATE, @I, 23), CONVERT(DATE, @F, 23), 'ABIERTA')`);
            nx = r.recordset[0];
            await bitacora(tx, { entidad: 'TANDA', entidadId: nx.TandaID, accion: 'Creó la tanda', detalle: `con lo pendiente de ${t.Nombre}`, usuario });
        } else {
            await bitacora(tx, { entidad: 'TANDA', entidadId: nx.TandaID, accion: 'Recibió lo pendiente', detalle: `de ${t.Nombre}`, usuario });
        }
        // Grupos: copias nuevas con los proyectos que tienen algo pendiente
        const grupos = (await tx.request().input('T', sql.Int, id).query('SELECT GrupoID, Nombre FROM dbo.DesTandaGrupos WHERE TandaID = @T ORDER BY Orden, GrupoID')).recordset;
        const enGrupo = (await tx.request().input('T', sql.Int, id).query('SELECT ProyectoID, GrupoID FROM dbo.DesTandaProyectos WHERE TandaID = @T AND GrupoID IS NOT NULL')).recordset;
        const grupoNuevo = new Map();
        let orden = (await tx.request().input('T', sql.Int, nx.TandaID).query('SELECT ISNULL(MAX(Orden), 0) AS o FROM dbo.DesTandaGrupos WHERE TandaID = @T')).recordset[0].o;
        for (const g of grupos) {
            if (!enGrupo.some(x => x.GrupoID === g.GrupoID && proyectosPend.includes(x.ProyectoID))) continue;
            const r = await tx.request().input('T', sql.Int, nx.TandaID).input('N', sql.NVarChar(60), g.Nombre).input('O', sql.Int, ++orden)
                .query('INSERT INTO dbo.DesTandaGrupos (TandaID, Nombre, Orden) OUTPUT INSERTED.GrupoID VALUES (@T, @N, @O)');
            grupoNuevo.set(g.GrupoID, r.recordset[0].GrupoID);
        }
        for (const pid of proyectosPend) {
            const g = enGrupo.find(x => x.ProyectoID === pid);
            await tx.request().input('T', sql.Int, nx.TandaID).input('P', sql.Int, pid).input('G', sql.Int, g ? grupoNuevo.get(g.GrupoID) || null : null).query(`
                IF NOT EXISTS (SELECT 1 FROM dbo.DesTandaProyectos WHERE TandaID = @T AND ProyectoID = @P)
                    INSERT INTO dbo.DesTandaProyectos (TandaID, ProyectoID, GrupoID) VALUES (@T, @P, @G)`);
        }
        await sumarTareas(tx, { TandaID: nx.TandaID, Nombre: nx.Nombre }, pendientes.map(p => p.TareaID), usuario);
        destino = nx.TandaID;
    }
    return { resumen, destino };
});

// POST /tareas/:id/a-tanda → suma la tarea a la tanda actual (la en curso; si no, la vencida; si no, la primera abierta)
exports.tareaATanda = (req, res) => escribir(req, res, 'planificar', async (tx, usuario) => {
    const tareaId = idNum(req.params.id);
    const hoy = hoyUY();
    const abiertas = (await tx.request().query(`SELECT TandaID, Nombre, CONVERT(CHAR(10), Inicio, 23) AS Inicio, CONVERT(CHAR(10), Fin, 23) AS Fin FROM dbo.DesTandas WITH (UPDLOCK) WHERE Estado = 'ABIERTA' ORDER BY Inicio, TandaID`)).recordset;
    const actual = abiertas.find(t => t.Inicio <= hoy && t.Fin >= hoy) || abiertas.find(t => t.Fin < hoy) || abiertas[0];
    if (!actual) return { error: [409, 'No hay una tanda abierta.'] };
    const n = await sumarTareas(tx, actual, [tareaId], usuario);
    if (!n) return { error: [400, 'Esa tarea ya está hecha o no existe.'] };
    await bitacora(tx, { entidad: 'TANDA', entidadId: actual.TandaID, accion: 'Sumó una tarea', detalle: null, usuario });
    return { mensaje: `Tarea sumada a ${actual.Nombre}.` };
});

// GET /muestras/resumen → para Inicio: cuántas muestras hay en cada estado
exports.resumenMuestras = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver las muestras')) return;
        const r = await pool.request().query(`
            SELECT e.EstadoID AS id, e.Nombre AS nombre, e.Tono AS tono, e.Orden AS orden, COUNT(m.MuestraID) AS n
            FROM dbo.DesMuestraEstados e LEFT JOIN dbo.DesMuestras m ON m.EstadoID = e.EstadoID AND m.Borrado = 0
            GROUP BY e.EstadoID, e.Nombre, e.Tono, e.Orden
            UNION ALL
            SELECT NULL, 'Sin estado', 'gris', 999, COUNT(*) FROM dbo.DesMuestras WHERE Borrado = 0 AND EstadoID IS NULL`);
        const porEstado = r.recordset.filter(x => x.n > 0).sort((a, b) => a.orden - b.orden);
        res.json({ success: true, data: { total: porEstado.reduce((a, x) => a + x.n, 0), porEstado } });
    } catch (err) { responderError(res, err, 'resumen de muestras'); }
};
