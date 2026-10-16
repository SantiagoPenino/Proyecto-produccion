// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — Proyectos y Tareas (fase 2, docs/desarrollos/plan-integracion.md §6).
// Reglas y textos: docs/desarrollos/spec-B §3 (proyectos y ficha) y spec-C §2 (tareas).
//
// Leer: el equipo. Cambiar (datos, tareas, cancelar, borrar, plantilla): el editor, como en el prototipo.
// Arreglos del plan (§7): la tarea "Pide REF" pide el artículo del maestro y solo en desarrollos de
// producto; el código no se repite; borrar = marcar borrado; las fechas de terminado y cancelado se
// guardan; y se avisa al responsable de una tarea y a quien pidió el desarrollo cuando termina o se cancela.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { notificar } = require('../services/notificacionesService');
const fabrica = require('../services/desarrollos/fabrica');
const {
    texto, idNum, fechaISO, escaparLike, hoyUY, codigoSolicitud, usuarioActual, exigir, bitacora, emitir, responderError,
} = require('../services/desarrollos/comun');
const { leerPlantilla, crearProyecto } = require('../services/desarrollos/altas');
const { leerProyectos, resumen, etapaActualDB, registrarCambioEtapa, PENDIENTE } = require('../services/desarrollos/proyectos');

const MODULO = 'DESARROLLOS';
const ESTADOS_TAREA = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', EN_ESPERA: 'En espera', HECHO: 'Hecho', NO_APLICA: 'No aplica' };
const urlProyecto = (id) => `/desarrollos/proyectos?abrir=${id}`;
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');
const nombreLinea = (areaId) => fabrica.LINEAS.find(l => l.areaId === areaId)?.nombre || areaId || 'Sin línea';

async function enEquipo(db, usuarioId) {
    const r = await db.request().input('U', sql.Int, usuarioId)
        .query(`SELECT LTRIM(RTRIM(ISNULL(NULLIF(u.Nombre, ''), u.Usuario))) AS Nombre FROM dbo.DesEquipo e JOIN dbo.Usuarios u ON u.IdUsuario = e.UsuarioID
                WHERE e.UsuarioID = @U AND e.Activo = 1 AND ISNULL(u.Activo, 1) = 1`);
    return r.recordset[0]?.Nombre || null;
}

// El pedido que dio origen al proyecto (no las variantes, que apuntan al producto padre)
async function pedidoDeOrigen(db, proyectoId) {
    const r = await db.request().input('P', sql.Int, proyectoId).query(`
        SELECT TOP 1 SolicitudID, Numero, Titulo, PedidoPorUsuarioID FROM dbo.DesSolicitudes
        WHERE ProyectoCreadoID = @P AND VarianteCreadaID IS NULL AND Borrado = 0 ORDER BY SolicitudID`);
    return r.recordset[0] || null;
}
async function avisarAlQuePidio(req, proyectoId, usuario, titulo, cuerpo) {
    try {
        const pool = await getPool();
        const s = await pedidoDeOrigen(pool, proyectoId);
        if (!s?.PedidoPorUsuarioID || s.PedidoPorUsuarioID === usuario.id) return;
        notificar({
            usuarioIds: [s.PedidoPorUsuarioID], modulo: MODULO, io: req.app.get('socketio'), tag: `des-sol-${s.SolicitudID}`,
            titulo: titulo(codigoSolicitud(s.Numero)), texto: `${s.Titulo} — ${cuerpo}`, url: `/desarrollos/pedidos?abrir=${s.SolicitudID}`,
        });
    } catch (err) { logger.warn(`[Desarrollos] aviso al que pidió: ${err.message}`); }
}

const conResumen = (p) => ({ ...p, ...resumen(p) });
async function proyectoCompleto(db, id) {
    const [p] = await leerProyectos(db, { ids: [id] });
    if (!p) return null;
    const adj = await db.request().input('S', sql.Int, p.solicitudId || 0)
        .query(`SELECT COUNT(*) AS n FROM dbo.DesAdjuntos WHERE Entidad = 'SOLICITUD' AND EntidadID = @S AND Borrado = 0`);
    return { ...conResumen(p), archivosPedido: adj.recordset[0].n };
}

// ── Lectura ──────────────────────────────────────────────────────────────────
// GET /proyectos → todos (en curso, terminados y cancelados) con sus tareas y el resumen. Proyectos,
// Tareas y Archivo filtran en la pantalla.
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver los proyectos')) return;
        const lista = await leerProyectos(pool);
        res.json({ success: true, data: lista.map(conResumen) });
    } catch (err) { responderError(res, err, 'proyectos'); }
};

// GET /proyectos/:id → la ficha
exports.ficha = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver los proyectos')) return;
        const p = await proyectoCompleto(pool, id);
        if (!p || p.borrado) return res.status(404).json({ success: false, error: 'Ese proyecto ya no existe.' });
        res.json({ success: true, data: p });
    } catch (err) { responderError(res, err, 'ficha'); }
};

// GET /articulos?q= → artículos del maestro para enlazar al proyecto
exports.articulos = async (req, res) => {
    const q = texto(req.query.q, 60);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'buscar artículos')) return;
        if (!q || q.length < 2) return res.json({ success: true, data: [] });
        const r = await pool.request().input('Q', sql.NVarChar(80), `%${escaparLike(q)}%`).query(`
            SELECT TOP 20 a.ProIdProducto AS id, LTRIM(RTRIM(a.CodArticulo)) AS codigo, LTRIM(RTRIM(a.Descripcion)) AS nombre,
                   LTRIM(RTRIM(s.Articulo)) AS familia
            FROM dbo.Articulos a LEFT JOIN dbo.StockArt s ON LTRIM(RTRIM(s.CodStock)) = LTRIM(RTRIM(a.CodStock))
            WHERE a.CodArticulo LIKE @Q OR a.Descripcion LIKE @Q
            ORDER BY CASE WHEN a.CodArticulo LIKE @Q THEN 0 ELSE 1 END, a.CodArticulo`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'articulos'); }
};

// ── Alta directa ("+ Nuevo proyecto") ─────────────────────────────────────────
// POST /proyectos { nombre, plantillaId, lineaAreaId, liderId, fechaInicio }
exports.crear = async (req, res) => {
    const b = req.body || {};
    const nombre = texto(b.nombre, 120);
    if (!nombre) return res.status(400).json({ success: false, error: 'Poné un nombre.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'crear proyectos')) return;
        const usuario = await usuarioActual(pool, req);
        const liderId = idNum(b.liderId) || usuario.id;
        if (liderId !== usuario.id && !await enEquipo(pool, liderId)) return res.status(400).json({ success: false, error: 'El responsable tiene que ser del equipo de desarrollo.' });
        tx = new sql.Transaction(pool);
        await tx.begin();
        let plantilla = idNum(b.plantillaId) ? await leerPlantilla(tx, { plantillaId: idNum(b.plantillaId) }) : await leerPlantilla(tx, { clave: 'prenda' });
        if (plantilla?.Para === 'VARIANTE') plantilla = null;
        if (!plantilla) { await rollbackSeguro(tx, 'Desarrollos nuevo proyecto'); tx = null; return res.status(400).json({ success: false, error: 'Elegí una plantilla.' }); }
        const tipoProducto = (await tx.request().query("SELECT TipoID FROM dbo.DesTiposDesarrollo WHERE Clave = 'producto'")).recordset[0]?.TipoID;
        const lineas = fabrica.LINEAS.map(l => l.areaId);
        const creado = await crearProyecto(tx, plantilla, {
            nombre, tipo: plantilla.Para === 'CORRECCION' ? 'CORRECCION' : 'NUEVO', tipoOrigen: 'equipo', origen: 'manual',
            tipoId: plantilla.TipoID || tipoProducto, liderId, lineaAreaId: lineas.includes(b.lineaAreaId) ? b.lineaAreaId : null,
        }, liderId);
        const inicio = fechaISO(b.fechaInicio);
        if (inicio && inicio !== hoyUY()) {
            await tx.request().input('P', sql.Int, creado.proyectoId).input('I', sql.VarChar(10), inicio)
                .query('UPDATE dbo.DesProyectos SET FechaInicio = CONVERT(DATE, @I, 23) WHERE ProyectoID = @P');
        }
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: creado.proyectoId, accion: 'Creó el proyecto', detalle: `${nombre} · plantilla ${plantilla.Nombre}`, usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id: creado.proyectoId });
        res.json({ success: true, data: await proyectoCompleto(pool, creado.proyectoId) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos nuevo proyecto');
        responderError(res, err, 'crear proyecto');
    }
};

// ── Datos del proyecto ───────────────────────────────────────────────────────
const CRITERIOS = { estrategico: 'Estratégico', comercial: 'Comercial', complejidad: 'Complejidad', recursos: 'Recursos' };

// PUT /proyectos/:id { nombre, notas, codigo, tipoId, lineaAreaId, liderId, proIdProducto, familia, etiquetaId,
//                      proveedor, costoEstimado, fechaInicio, fechaLimite, estado: ACTIVO|PAUSADO, estrategico… }
// Solo cambia lo que viene. Cada cambio queda en el historial.
exports.guardar = async (req, res) => {
    const id = idNum(req.params.id);
    const b = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar proyectos')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const fin = async (status, error) => { await rollbackSeguro(tx, 'Desarrollos guardar proyecto'); tx = null; return res.status(status).json({ success: false, error }); };
        const p = (await tx.request().input('Id', sql.Int, id).query(`
            SELECT ProyectoID, Codigo, Nombre, Notas, TipoID, LineaAreaID, LiderUsuarioID, ProIdProducto, RefErpTexto, Familia, EtiquetaID,
                   Proveedor, CostoEstimado, CONVERT(CHAR(10), FechaInicio, 23) AS FechaInicio, CONVERT(CHAR(10), FechaLimite, 23) AS FechaLimite,
                   Estado, Estrategico, Comercial, Complejidad, Recursos
            FROM dbo.DesProyectos WITH (UPDLOCK) WHERE ProyectoID = @Id AND Borrado = 0`)).recordset[0];
        if (!p) return fin(404, 'Ese proyecto ya no existe.');

        const sets = {};
        const cambios = [];
        const puntajes = [];
        const cambia = (col, valor, etiqueta) => {
            if ((p[col] ?? null) === (valor ?? null)) return;
            sets[col] = valor ?? null;
            if (etiqueta) cambios.push(etiqueta);
        };
        if ('nombre' in b) {
            const v = texto(b.nombre, 120);
            if (!v) return fin(400, 'El proyecto tiene que tener nombre.');
            cambia('Nombre', v, `nombre: ${v}`);
        }
        if ('notas' in b) cambia('Notas', texto(b.notas, 20000), 'detalle actualizado');
        if ('codigo' in b) {
            const v = texto(b.codigo, 20)?.toUpperCase();
            if (!v) return fin(400, 'El proyecto tiene que tener código.');
            if (v !== p.Codigo) {
                const otro = (await tx.request().input('C', sql.VarChar(20), v).input('Id', sql.Int, id)
                    .query('SELECT TOP 1 Nombre FROM dbo.DesProyectos WHERE UPPER(LTRIM(RTRIM(Codigo))) = @C AND ProyectoID <> @Id AND Borrado = 0')).recordset[0];
                if (otro) return fin(409, `Ya hay otro proyecto con el código ${v} («${otro.Nombre}»).`);
                cambia('Codigo', v, `código: ${v}`);
            }
        }
        if ('tipoId' in b) {
            const t = (await tx.request().input('T', sql.Int, idNum(b.tipoId)).query('SELECT TipoID, Nombre FROM dbo.DesTiposDesarrollo WHERE TipoID = @T AND Activo = 1')).recordset[0];
            if (!t) return fin(400, 'Tipo de desarrollo inválido.');
            cambia('TipoID', t.TipoID, `tipo de desarrollo: ${t.Nombre}`);
        }
        if ('lineaAreaId' in b) {
            const v = fabrica.LINEAS.some(l => l.areaId === b.lineaAreaId) ? b.lineaAreaId : null;
            cambia('LineaAreaID', v, `línea: ${nombreLinea(v)}`);
        }
        if ('liderId' in b) {
            const v = idNum(b.liderId);
            const nombre = v ? await enEquipo(tx, v) : null;
            if (v && !nombre) return fin(400, 'El responsable tiene que ser del equipo de desarrollo.');
            cambia('LiderUsuarioID', v, `responsable: ${nombre || '(ninguno)'}`);
        }
        if ('proIdProducto' in b) {
            const v = idNum(b.proIdProducto);
            let cod = null;
            if (v) {
                cod = (await tx.request().input('A', sql.Int, v).query('SELECT LTRIM(RTRIM(CodArticulo)) AS c FROM dbo.Articulos WHERE ProIdProducto = @A')).recordset[0]?.c;
                if (!cod) return fin(400, 'Ese artículo no existe en el maestro.');
            }
            if (v !== (p.ProIdProducto ?? null)) {
                sets.ProIdProducto = v;
                if (v) sets.RefErpTexto = null;
                cambios.push(`artículo: ${cod || '(ninguno)'}`);
            }
        }
        if ('familia' in b) cambia('Familia', texto(b.familia, 60), `familia: ${texto(b.familia, 60) || '(ninguna)'}`);
        if ('etiquetaId' in b) {
            const v = idNum(b.etiquetaId);
            const n = v ? (await tx.request().input('E', sql.Int, v).query('SELECT Nombre FROM dbo.ProductoEtiqueta WHERE EtiquetaID = @E')).recordset[0]?.Nombre : null;
            if (v && !n) return fin(400, 'Etiqueta inválida.');
            cambia('EtiquetaID', v, `etiqueta: ${n || '(ninguna)'}`);
        }
        if ('proveedor' in b) cambia('Proveedor', texto(b.proveedor, 80), `proveedor: ${texto(b.proveedor, 80) || '(ninguno)'}`);
        if ('costoEstimado' in b) cambia('CostoEstimado', texto(b.costoEstimado, 40), `costo estimado: ${texto(b.costoEstimado, 40) || '(ninguno)'}`);
        if ('fechaInicio' in b) cambia('FechaInicio', fechaISO(b.fechaInicio), `inicio: ${fmtD(fechaISO(b.fechaInicio)) || '(sin fecha)'}`);
        if ('fechaLimite' in b) cambia('FechaLimite', fechaISO(b.fechaLimite), `fecha límite: ${fmtD(fechaISO(b.fechaLimite)) || '(sin fecha)'}`);
        if ('estado' in b) {
            const v = String(b.estado || '').toUpperCase();
            if (!['ACTIVO', 'PAUSADO'].includes(v)) return fin(400, 'El estado es Activo o En pausa (para cancelar está el botón).');
            if (p.Estado === 'CANCELADO') return fin(409, 'Está cancelado: reactivalo primero.');
            cambia('Estado', v, `estado: ${v === 'PAUSADO' ? 'En pausa' : 'Activo'}`);
        }
        for (const [k, etiqueta] of Object.entries(CRITERIOS)) {
            if (!(k in b)) continue;
            const v = parseInt(b[k], 10);
            if (!(v >= 1 && v <= 5)) return fin(400, 'Cada criterio va de 1 a 5.');
            const col = k[0].toUpperCase() + k.slice(1);
            if ((p[col] || 3) !== v) { sets[col] = v; puntajes.push(`${etiqueta}: ${p[col] || 3} → ${v}`); }
        }
        if (!Object.keys(sets).length) { await rollbackSeguro(tx, 'Desarrollos guardar proyecto'); tx = null; return res.json({ success: true, data: await proyectoCompleto(pool, id), sinCambios: true }); }

        const req2 = tx.request().input('Id', sql.Int, id);
        const asignaciones = [];
        const TIPOS = {
            Codigo: sql.VarChar(20), Nombre: sql.NVarChar(120), Notas: sql.NVarChar(sql.MAX), TipoID: sql.Int, LineaAreaID: sql.VarChar(20),
            LiderUsuarioID: sql.Int, ProIdProducto: sql.Int, RefErpTexto: sql.NVarChar(40), Familia: sql.NVarChar(60), EtiquetaID: sql.Int,
            Proveedor: sql.NVarChar(80), CostoEstimado: sql.NVarChar(40), Estado: sql.VarChar(10),
            Estrategico: sql.TinyInt, Comercial: sql.TinyInt, Complejidad: sql.TinyInt, Recursos: sql.TinyInt,
        };
        for (const [col, v] of Object.entries(sets)) {
            if (col === 'FechaInicio' || col === 'FechaLimite') { req2.input(col, sql.VarChar(10), v); asignaciones.push(`${col} = CONVERT(DATE, @${col}, 23)`); }
            else { req2.input(col, TIPOS[col], v); asignaciones.push(`${col} = @${col}`); }
        }
        await req2.query(`UPDATE dbo.DesProyectos SET ${asignaciones.join(', ')}, FechaActualizado = GETDATE() WHERE ProyectoID = @Id`);
        if (cambios.length) await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Editó', detalle: cambios.join(' · '), usuario });
        if (puntajes.length) await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Puntaje', detalle: puntajes.join(' · '), usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id });
        res.json({ success: true, data: await proyectoCompleto(pool, id) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos guardar proyecto');
        responderError(res, err, 'guardar proyecto');
    }
};

// Saca el proyecto de las tandas: de las abiertas (al cancelar) o de todas (al borrar).
async function sacarDeTandas(tx, proyectoId, soloAbiertas) {
    const cond = soloAbiertas ? "AND t.Estado = 'ABIERTA'" : '';
    await tx.request().input('P', sql.Int, proyectoId).query(`
        DELETE tt FROM dbo.DesTandaTareas tt JOIN dbo.DesTandas t ON t.TandaID = tt.TandaID JOIN dbo.DesTareas x ON x.TareaID = tt.TareaID
        WHERE x.ProyectoID = @P ${cond};
        DELETE tp FROM dbo.DesTandaProyectos tp JOIN dbo.DesTandas t ON t.TandaID = tp.TandaID WHERE tp.ProyectoID = @P ${cond};`);
}

// POST /proyectos/:id/cancelar
exports.cancelar = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cancelar proyectos')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const r = await tx.request().input('Id', sql.Int, id).query(`
            UPDATE dbo.DesProyectos SET Estado = 'CANCELADO', FechaCancelado = GETDATE(), FechaActualizado = GETDATE()
            OUTPUT INSERTED.Nombre WHERE ProyectoID = @Id AND Borrado = 0 AND Estado <> 'CANCELADO'`);
        if (!r.recordset.length) { await rollbackSeguro(tx, 'Desarrollos cancelar'); tx = null; return res.status(409).json({ success: false, error: 'No existe o ya está cancelado.' }); }
        await sacarDeTandas(tx, id, true);
        await tx.request().input('P', sql.Int, id).query("INSERT INTO dbo.DesHistorialEtapas (ProyectoID, EtapaID, Etapa) VALUES (@P, NULL, 'Cancelado')");
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Canceló', detalle: 'el proyecto', usuario });
        await tx.commit();
        tx = null;
        avisarAlQuePidio(req, id, usuario, (c) => `Se canceló el desarrollo de tu pedido ${c}`, 'el proyecto se canceló');
        emitir(req, { entidad: 'PROYECTO', id });
        res.json({ success: true, data: await proyectoCompleto(pool, id) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos cancelar');
        responderError(res, err, 'cancelar');
    }
};

// POST /proyectos/:id/reactivar
exports.reactivar = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'reactivar proyectos')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const r = await tx.request().input('Id', sql.Int, id).query(`
            UPDATE dbo.DesProyectos SET Estado = 'ACTIVO', FechaCancelado = NULL, FechaActualizado = GETDATE()
            OUTPUT INSERTED.Nombre WHERE ProyectoID = @Id AND Borrado = 0 AND Estado = 'CANCELADO'`);
        if (!r.recordset.length) { await rollbackSeguro(tx, 'Desarrollos reactivar'); tx = null; return res.status(409).json({ success: false, error: 'Solo se reactiva un proyecto cancelado.' }); }
        const etapa = await etapaActualDB(tx, id);
        await tx.request().input('P', sql.Int, id).input('E', sql.Int, etapa?.etapaId || null).input('N', sql.NVarChar(40), etapa ? etapa.nombre : 'Terminado')
            .query('INSERT INTO dbo.DesHistorialEtapas (ProyectoID, EtapaID, Etapa) VALUES (@P, @E, @N)');
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Reactivó', detalle: 'el proyecto', usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id });
        res.json({ success: true, data: await proyectoCompleto(pool, id) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos reactivar');
        responderError(res, err, 'reactivar');
    }
};

// DELETE /proyectos/:id → lo marca borrado y lo saca de todas las tandas y del orden de la lista
exports.borrar = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'borrar proyectos')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const r = await tx.request().input('Id', sql.Int, id)
            .query('UPDATE dbo.DesProyectos SET Borrado = 1, FechaBorrado = GETDATE() OUTPUT INSERTED.Nombre WHERE ProyectoID = @Id AND Borrado = 0');
        if (!r.recordset.length) { await rollbackSeguro(tx, 'Desarrollos borrar'); tx = null; return res.status(404).json({ success: false, error: 'Ese proyecto ya no existe.' }); }
        await sacarDeTandas(tx, id, false);
        await tx.request().input('P', sql.Int, id).query('DELETE FROM dbo.DesOrdenLista WHERE ProyectoID = @P');
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Borró', detalle: r.recordset[0].Nombre, usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id });
        res.json({ success: true });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos borrar');
        responderError(res, err, 'borrar proyecto');
    }
};

// POST /proyectos/:id/plantilla { nombre } → guarda las etapas y tareas del proyecto como plantilla nueva.
// Conserva el tipo de desarrollo (el prototipo lo perdía, plan §7.9).
exports.guardarComoPlantilla = async (req, res) => {
    const id = idNum(req.params.id);
    const nombre = texto(req.body?.nombre, 60);
    if (!id) return res.status(400).json({ success: false, error: 'Proyecto inválido.' });
    if (!nombre) return res.status(400).json({ success: false, error: 'Poné el nombre de la plantilla.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'guardar plantillas')) return;
        const usuario = await usuarioActual(pool, req);
        const [p] = await leerProyectos(pool, { ids: [id] });
        if (!p) return res.status(404).json({ success: false, error: 'Ese proyecto ya no existe.' });
        if (!p.tareas.length) return res.status(400).json({ success: false, error: 'El proyecto no tiene tareas para guardar.' });
        tx = new sql.Transaction(pool);
        await tx.begin();
        const orden = (await tx.request().query('SELECT ISNULL(MAX(Orden), 0) + 1 AS n FROM dbo.DesPlantillas')).recordset[0].n;
        const r = await tx.request()
            .input('N', sql.NVarChar(60), nombre).input('Para', sql.VarChar(12), p.tipo === 'CORRECCION' ? 'CORRECCION' : 'PRODUCTO')
            .input('T', sql.Int, p.tipoId).input('D', sql.NVarChar(200), `Guardada desde el proyecto ${p.nombre}`.slice(0, 200)).input('O', sql.Int, orden)
            .query('INSERT INTO dbo.DesPlantillas (Nombre, Para, TipoID, Descripcion, Orden) OUTPUT INSERTED.PlantillaID VALUES (@N, @Para, @T, @D, @O)');
        const plantillaId = r.recordset[0].PlantillaID;
        const etapaNueva = new Map();
        for (const e of p.etapas) {
            const re = await tx.request().input('P', sql.Int, plantillaId).input('C', sql.VarChar(40), e.clave).input('N', sql.NVarChar(40), e.nombre)
                .input('Col', sql.VarChar(7), e.color).input('O', sql.Int, e.orden)
                .query('INSERT INTO dbo.DesPlantillaEtapas (PlantillaID, Clave, Nombre, Color, Orden) OUTPUT INSERTED.EtapaID VALUES (@P, @C, @N, @Col, @O)');
            etapaNueva.set(e.id, re.recordset[0].EtapaID);
        }
        const ordenEtapa = new Map();
        for (const t of p.tareas) {
            const eid = etapaNueva.get(t.etapaId);
            ordenEtapa.set(eid, (ordenEtapa.get(eid) || 0) + 1);
            await tx.request().input('P', sql.Int, plantillaId).input('E', sql.Int, eid).input('N', sql.NVarChar(120), t.nombre)
                .input('D', sql.Int, t.diasHabiles || 1).input('Ent', sql.NVarChar(80), t.entregable || null)
                .input('R', sql.Bit, !!t.pideRef).input('Erp', sql.Bit, !!t.marcaErp).input('O', sql.Int, ordenEtapa.get(eid))
                .query(`INSERT INTO dbo.DesPlantillaTareas (PlantillaID, EtapaID, Nombre, DiasHabiles, Entregable, PideRef, MarcaErp, Orden)
                        VALUES (@P, @E, @N, @D, @Ent, @R, @Erp, @O)`);
        }
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Guardó como plantilla', detalle: nombre, usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PLANTILLA', id: plantillaId });
        res.json({ success: true, data: { plantillaId } });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos guardar como plantilla');
        responderError(res, err, 'guardar como plantilla');
    }
};

// ── Tareas ───────────────────────────────────────────────────────────────────
async function tareaConProyecto(tx, tareaId) {
    const r = await tx.request().input('Id', sql.Int, tareaId).query(`
        SELECT t.TareaID, t.ProyectoID, t.EtapaID, t.Nombre, t.Orden, t.Estado, t.ResponsableUsuarioID, t.ResponsableTexto,
               CONVERT(CHAR(10), t.Fecha, 23) AS Fecha, t.DiasHabiles, t.Entregable, t.Nota, t.PideRef,
               p.Estado AS EstadoProyecto, p.ProIdProducto, p.RefErpTexto, p.Nombre AS NombreProyecto, p.Codigo, tp.EsProducto
        FROM dbo.DesTareas t WITH (UPDLOCK)
        JOIN dbo.DesProyectos p ON p.ProyectoID = t.ProyectoID AND p.Borrado = 0
        JOIN dbo.DesTiposDesarrollo tp ON tp.TipoID = p.TipoID
        WHERE t.TareaID = @Id`);
    return r.recordset[0] || null;
}

// Tareas del proyecto en orden (etapa y posición)
async function ordenadas(tx, proyectoId) {
    return (await tx.request().input('P', sql.Int, proyectoId).query(`
        SELECT t.TareaID, t.Estado, t.Nombre FROM dbo.DesTareas t JOIN dbo.DesProyectoEtapas e ON e.EtapaID = t.EtapaID
        WHERE t.ProyectoID = @P ORDER BY e.Orden, t.Orden, t.TareaID`)).recordset;
}

// Al completar una tarea: la primera pendiente (que no sea esta), si va después y está "Pendiente",
// pasa a "En curso" (setStep del prototipo). `soloDespues = false` es la variante del alta en el ERP.
async function avanzarSiguiente(tx, proyectoId, tareaId, soloDespues = true) {
    const ts = await ordenadas(tx, proyectoId);
    const idx = ts.findIndex(t => t.TareaID === tareaId);
    const sig = ts.find(t => t.TareaID !== tareaId && PENDIENTE(t.Estado));
    if (!sig || sig.Estado !== 'PENDIENTE') return;
    if (soloDespues && ts.indexOf(sig) < idx) return;
    await tx.request().input('T', sql.Int, sig.TareaID).query("UPDATE dbo.DesTareas SET Estado = 'EN_CURSO', FechaActualizado = GETDATE() WHERE TareaID = @T");
}

// ¿`desde` llega a `hasta` siguiendo dependencias? (para no armar ciclos)
const llega = (grafo, desde, hasta, vistos = new Set()) => {
    if (desde === hasta) return true;
    if (vistos.has(desde)) return false;
    vistos.add(desde);
    return (grafo.get(desde) || []).some(d => llega(grafo, d, hasta, vistos));
};

const tieneArticulo = (t) => !!(t.ProIdProducto || t.RefErpTexto);
const faltaArticulo = (t) => t.PideRef && t.EsProducto && !tieneArticulo(t);

// Avisos después de guardar: al nuevo responsable (si no es quien cambió) y a quien pidió, si terminó.
function avisosTarea(req, t, usuario, { responsableNuevo, terminadoAhora }) {
    if (responsableNuevo && responsableNuevo !== usuario.id) {
        notificar({
            usuarioIds: [responsableNuevo], modulo: MODULO, io: req.app.get('socketio'), tag: `des-tarea-${t.TareaID}`,
            titulo: 'Te asignaron una tarea', texto: `${t.Nombre} · ${t.NombreProyecto} (${t.Codigo})`, url: urlProyecto(t.ProyectoID),
        });
    }
    if (terminadoAhora) avisarAlQuePidio(req, t.ProyectoID, usuario, (c) => `Tu pedido ${c} está listo`, `el proyecto ${t.Codigo} terminó`);
}

// PUT /tareas/:id { estado, responsableId, fecha, nombre, etapaId, diasHabiles, entregable, nota, depende: [ids] }
exports.editarTarea = async (req, res) => {
    const id = idNum(req.params.id);
    const b = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Tarea inválida.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar tareas')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const fin = async (status, error, extra = {}) => { await rollbackSeguro(tx, 'Desarrollos tarea'); tx = null; return res.status(status).json({ success: false, error, ...extra }); };
        const t = await tareaConProyecto(tx, id);
        if (!t) return fin(404, 'Esa tarea ya no existe.');
        const antes = await etapaActualDB(tx, t.ProyectoID);
        const nombreT = t.Nombre;
        const sets = {};
        const cambios = [];
        let responsableNuevo = null;
        let completa = false;

        if ('nombre' in b) {
            const v = texto(b.nombre, 120);
            if (!v) return fin(400, 'La tarea tiene que tener nombre.');
            if (v !== t.Nombre) { sets.Nombre = v; cambios.push(`paso renombrado: ${v}`); }
        }
        if ('estado' in b) {
            const v = String(b.estado || '').toUpperCase();
            if (!ESTADOS_TAREA[v]) return fin(400, 'Estado inválido.');
            if (v !== t.Estado) {
                if (v === 'HECHO' && faltaArticulo(t)) return fin(400, 'Para dar el alta hace falta elegir el artículo del ERP.', { codigo: 'FALTA_ARTICULO' });
                sets.Estado = v;
                completa = v === 'HECHO';
                cambios.push(`${nombreT}: ${ESTADOS_TAREA[t.Estado]} → ${ESTADOS_TAREA[v]}`);
            }
        }
        if ('responsableId' in b) {
            const v = idNum(b.responsableId);
            const nombre = v ? await enEquipo(tx, v) : null;
            if (v && !nombre) return fin(400, 'El responsable tiene que ser del equipo de desarrollo.');
            if (v !== (t.ResponsableUsuarioID ?? null) || (!v && t.ResponsableTexto)) {
                sets.ResponsableUsuarioID = v;
                sets.ResponsableTexto = null;
                responsableNuevo = v;
                cambios.push(`${nombreT}: responsable ${nombre || '(ninguno)'}`);
            }
        }
        if ('fecha' in b) {
            const v = fechaISO(b.fecha);
            if (v !== (t.Fecha ?? null)) { sets.Fecha = v; cambios.push(`${nombreT}: fecha ${fmtD(v) || '(sin fecha)'}`); }
        }
        if ('diasHabiles' in b) {
            const v = Math.max(0, Math.min(120, parseInt(b.diasHabiles, 10) || 0));
            if (v !== t.DiasHabiles) { sets.DiasHabiles = v; cambios.push(`${nombreT}: ${v} ${v === 1 ? 'día' : 'días'}`); }
        }
        if ('entregable' in b) {
            const v = texto(b.entregable, 80);
            if (v !== (t.Entregable ?? null)) { sets.Entregable = v; cambios.push(`${nombreT}: entregable ${v || '(ninguno)'}`); }
        }
        if ('nota' in b) {
            const v = texto(b.nota, 300);
            if (v !== (t.Nota ?? null)) { sets.Nota = v; cambios.push(`${nombreT}: nota`); }
        }
        if ('etapaId' in b) {
            const v = idNum(b.etapaId);
            const e = (await tx.request().input('E', sql.Int, v).input('P', sql.Int, t.ProyectoID)
                .query('SELECT EtapaID, Nombre FROM dbo.DesProyectoEtapas WHERE EtapaID = @E AND ProyectoID = @P')).recordset[0];
            if (!e) return fin(400, 'Esa etapa no es de este proyecto.');
            if (e.EtapaID !== t.EtapaID) {
                // Pasa al final de la nueva etapa (como xInsertar)
                const n = (await tx.request().input('E', sql.Int, e.EtapaID).query('SELECT ISNULL(MAX(Orden), 0) + 1 AS n FROM dbo.DesTareas WHERE EtapaID = @E')).recordset[0].n;
                sets.EtapaID = e.EtapaID;
                sets.Orden = n;
                cambios.push(`${nombreT}: etapa ${e.Nombre}`);
            }
        }
        let dependeNueva = null;
        if ('depende' in b) {
            const ids = [...new Set((Array.isArray(b.depende) ? b.depende : []).map(idNum).filter(Boolean))].filter(x => x !== id);
            const delProyecto = (await tx.request().input('P', sql.Int, t.ProyectoID).query('SELECT TareaID, Nombre FROM dbo.DesTareas WHERE ProyectoID = @P')).recordset;
            if (ids.some(x => !delProyecto.some(d => d.TareaID === x))) return fin(400, 'Solo puede depender de tareas del mismo proyecto.');
            const actuales = (await tx.request().input('P', sql.Int, t.ProyectoID).query(`
                SELECT d.TareaID, d.DependeDeTareaID FROM dbo.DesTareaDependencias d JOIN dbo.DesTareas x ON x.TareaID = d.TareaID WHERE x.ProyectoID = @P`)).recordset;
            const grafo = new Map();
            for (const d of actuales) if (d.TareaID !== id) { if (!grafo.has(d.TareaID)) grafo.set(d.TareaID, []); grafo.get(d.TareaID).push(d.DependeDeTareaID); }
            const ciclo = ids.find(x => llega(grafo, x, id));
            if (ciclo) return fin(400, `«${delProyecto.find(d => d.TareaID === ciclo).Nombre}» ya depende de esta tarea.`);
            const antesIds = actuales.filter(d => d.TareaID === id).map(d => d.DependeDeTareaID).sort((a, c) => a - c);
            if (antesIds.join() !== [...ids].sort((a, c) => a - c).join()) {
                dependeNueva = ids;
                cambios.push(`${nombreT}: depende de ${ids.length ? ids.map(x => delProyecto.find(d => d.TareaID === x).Nombre).join(', ') : '(nada)'}`);
            }
        }
        if (!cambios.length) { await rollbackSeguro(tx, 'Desarrollos tarea'); tx = null; return res.json({ success: true, data: await proyectoCompleto(pool, t.ProyectoID), sinCambios: true }); }

        const TIPOS = {
            Nombre: sql.NVarChar(120), Estado: sql.VarChar(10), ResponsableUsuarioID: sql.Int, ResponsableTexto: sql.NVarChar(120),
            DiasHabiles: sql.Int, Entregable: sql.NVarChar(80), Nota: sql.NVarChar(300), EtapaID: sql.Int, Orden: sql.Int,
        };
        const req2 = tx.request().input('Id', sql.Int, id);
        const asignaciones = [];
        for (const [col, v] of Object.entries(sets)) {
            if (col === 'Fecha') { req2.input(col, sql.VarChar(10), v); asignaciones.push('Fecha = CONVERT(DATE, @Fecha, 23)'); }
            else { req2.input(col, TIPOS[col], v); asignaciones.push(`${col} = @${col}`); }
        }
        if ('Estado' in sets) asignaciones.push(completa ? 'HechoEl = ISNULL(HechoEl, GETDATE())' : 'HechoEl = NULL');
        if (asignaciones.length) await req2.query(`UPDATE dbo.DesTareas SET ${asignaciones.join(', ')}, FechaActualizado = GETDATE() WHERE TareaID = @Id`);
        if (dependeNueva) {
            await tx.request().input('T', sql.Int, id).query('DELETE FROM dbo.DesTareaDependencias WHERE TareaID = @T');
            for (const d of dependeNueva) await tx.request().input('T', sql.Int, id).input('D', sql.Int, d).query('INSERT INTO dbo.DesTareaDependencias (TareaID, DependeDeTareaID) VALUES (@T, @D)');
        }
        let aviso = null;
        if (completa) {
            // Avisa (no frena) si dependía de tareas sin terminar
            const pend = (await tx.request().input('T', sql.Int, id).query(`
                SELECT x.Nombre FROM dbo.DesTareaDependencias d JOIN dbo.DesTareas x ON x.TareaID = d.DependeDeTareaID
                WHERE d.TareaID = @T AND x.Estado NOT IN ('HECHO', 'NO_APLICA')`)).recordset;
            if (pend.length) aviso = `Ojo: dependía de ${pend.map(x => `«${x.Nombre}»`).join(', ')}, que todavía no está hecho.`;
            await avanzarSiguiente(tx, t.ProyectoID, id);
        }
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: t.ProyectoID, accion: completa ? 'Completó' : 'Editó', detalle: cambios.join(' · '), usuario });
        const { terminadoAhora } = t.EstadoProyecto === 'CANCELADO' ? { terminadoAhora: false } : await registrarCambioEtapa(tx, t.ProyectoID, antes);
        await tx.commit();
        tx = null;
        avisosTarea(req, { ...t, Nombre: sets.Nombre || t.Nombre }, usuario, { responsableNuevo, terminadoAhora });
        emitir(req, { entidad: 'PROYECTO', id: t.ProyectoID });
        res.json({ success: true, data: await proyectoCompleto(pool, t.ProyectoID), aviso });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos tarea');
        responderError(res, err, 'editar tarea');
    }
};

// POST /tareas/:id/alta-erp { proIdProducto } → enlaza el artículo al proyecto y da la tarea por hecha
exports.altaErp = async (req, res) => {
    const id = idNum(req.params.id);
    const proId = idNum(req.body?.proIdProducto);
    if (!id) return res.status(400).json({ success: false, error: 'Tarea inválida.' });
    if (!proId) return res.status(400).json({ success: false, error: 'Elegí el artículo del ERP.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar tareas')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const fin = async (status, error) => { await rollbackSeguro(tx, 'Desarrollos alta ERP'); tx = null; return res.status(status).json({ success: false, error }); };
        const t = await tareaConProyecto(tx, id);
        if (!t) return fin(404, 'Esa tarea ya no existe.');
        const art = (await tx.request().input('A', sql.Int, proId).query('SELECT LTRIM(RTRIM(CodArticulo)) AS Cod FROM dbo.Articulos WHERE ProIdProducto = @A')).recordset[0];
        if (!art) return fin(400, 'Ese artículo no existe en el maestro.');
        const antes = await etapaActualDB(tx, t.ProyectoID);
        await tx.request().input('P', sql.Int, t.ProyectoID).input('A', sql.Int, proId)
            .query('UPDATE dbo.DesProyectos SET ProIdProducto = @A, RefErpTexto = NULL, FechaActualizado = GETDATE() WHERE ProyectoID = @P');
        await tx.request().input('T', sql.Int, id)
            .query("UPDATE dbo.DesTareas SET Estado = 'HECHO', HechoEl = ISNULL(HechoEl, GETDATE()), FechaActualizado = GETDATE() WHERE TareaID = @T");
        await avanzarSiguiente(tx, t.ProyectoID, id, false);
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: t.ProyectoID, accion: 'Alta en el ERP', detalle: `${t.Nombre}: ${ESTADOS_TAREA[t.Estado]} → Hecho · artículo: ${art.Cod}`, usuario });
        const { terminadoAhora } = t.EstadoProyecto === 'CANCELADO' ? { terminadoAhora: false } : await registrarCambioEtapa(tx, t.ProyectoID, antes);
        await tx.commit();
        tx = null;
        avisosTarea(req, t, usuario, { terminadoAhora });
        emitir(req, { entidad: 'PROYECTO', id: t.ProyectoID });
        res.json({ success: true, data: await proyectoCompleto(pool, t.ProyectoID) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos alta ERP');
        responderError(res, err, 'alta en el ERP');
    }
};

// POST /proyectos/:id/tareas { etapaId, nombre } → al final de la etapa, a nombre del responsable del proyecto
exports.nuevaTarea = async (req, res) => {
    const id = idNum(req.params.id);
    const nombre = texto(req.body?.nombre, 120);
    const etapaId = idNum(req.body?.etapaId);
    if (!id || !etapaId) return res.status(400).json({ success: false, error: 'Falta el proyecto o la etapa.' });
    if (!nombre) return res.status(400).json({ success: false, error: 'Escribí el nombre de la tarea.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'agregar tareas')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const p = (await tx.request().input('P', sql.Int, id).input('E', sql.Int, etapaId).query(`
            SELECT p.ProyectoID, p.LiderUsuarioID, p.Estado, e.Nombre AS Etapa FROM dbo.DesProyectos p
            JOIN dbo.DesProyectoEtapas e ON e.ProyectoID = p.ProyectoID AND e.EtapaID = @E
            WHERE p.ProyectoID = @P AND p.Borrado = 0`)).recordset[0];
        if (!p) { await rollbackSeguro(tx, 'Desarrollos nueva tarea'); tx = null; return res.status(404).json({ success: false, error: 'No existe el proyecto o la etapa.' }); }
        const antes = await etapaActualDB(tx, id);
        const orden = (await tx.request().input('E', sql.Int, etapaId).query('SELECT ISNULL(MAX(Orden), 0) + 1 AS n FROM dbo.DesTareas WHERE EtapaID = @E')).recordset[0].n;
        await tx.request().input('P', sql.Int, id).input('E', sql.Int, etapaId).input('N', sql.NVarChar(120), nombre).input('O', sql.Int, orden)
            .input('R', sql.Int, p.LiderUsuarioID)
            .query(`INSERT INTO dbo.DesTareas (ProyectoID, EtapaID, Nombre, Orden, Estado, ResponsableUsuarioID, DiasHabiles) VALUES (@P, @E, @N, @O, 'PENDIENTE', @R, 1)`);
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: id, accion: 'Agregó una tarea', detalle: `paso nuevo: ${nombre} (${p.Etapa})`, usuario });
        if (p.Estado !== 'CANCELADO') await registrarCambioEtapa(tx, id, antes);
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id });
        res.json({ success: true, data: await proyectoCompleto(pool, id) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos nueva tarea');
        responderError(res, err, 'nueva tarea');
    }
};

// POST /tareas/:id/mover { dir: -1 | 1 } → cambia de lugar con la vecina de la misma etapa
exports.moverTarea = async (req, res) => {
    const id = idNum(req.params.id);
    const dir = Number(req.body?.dir) < 0 ? -1 : 1;
    if (!id) return res.status(400).json({ success: false, error: 'Tarea inválida.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'reordenar tareas')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const t = await tareaConProyecto(tx, id);
        if (!t) { await rollbackSeguro(tx, 'Desarrollos mover'); tx = null; return res.status(404).json({ success: false, error: 'Esa tarea ya no existe.' }); }
        const antes = await etapaActualDB(tx, t.ProyectoID);
        const deEtapa = (await tx.request().input('E', sql.Int, t.EtapaID).query('SELECT TareaID, Orden FROM dbo.DesTareas WHERE EtapaID = @E ORDER BY Orden, TareaID')).recordset;
        const i = deEtapa.findIndex(x => x.TareaID === id);
        const vecina = deEtapa[i + dir];
        if (vecina) {
            // Se renumera la etapa entera (1, 2, 3…) con el cambio hecho: así no quedan órdenes repetidos
            [deEtapa[i], deEtapa[i + dir]] = [deEtapa[i + dir], deEtapa[i]];
            for (const [j, x] of deEtapa.entries()) await tx.request().input('T', sql.Int, x.TareaID).input('O', sql.Int, j + 1).query('UPDATE dbo.DesTareas SET Orden = @O WHERE TareaID = @T');
            await bitacora(tx, { entidad: 'PROYECTO', entidadId: t.ProyectoID, accion: 'Reordenó las tareas', detalle: t.Nombre, usuario });
            if (t.EstadoProyecto !== 'CANCELADO') await registrarCambioEtapa(tx, t.ProyectoID, antes);
        }
        await tx.commit();
        tx = null;
        if (vecina) emitir(req, { entidad: 'PROYECTO', id: t.ProyectoID });
        res.json({ success: true, data: await proyectoCompleto(pool, t.ProyectoID) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos mover');
        responderError(res, err, 'mover tarea');
    }
};

// DELETE /tareas/:id → quita la tarea (y sus dependencias y su lugar en las tandas)
exports.quitarTarea = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Tarea inválida.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'quitar tareas')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const t = await tareaConProyecto(tx, id);
        if (!t) { await rollbackSeguro(tx, 'Desarrollos quitar tarea'); tx = null; return res.status(404).json({ success: false, error: 'Esa tarea ya no existe.' }); }
        const antes = await etapaActualDB(tx, t.ProyectoID);
        await tx.request().input('T', sql.Int, id).query(`
            DELETE FROM dbo.DesTareaDependencias WHERE TareaID = @T OR DependeDeTareaID = @T;
            DELETE FROM dbo.DesTandaTareas WHERE TareaID = @T;
            DELETE FROM dbo.DesTareas WHERE TareaID = @T;`);
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: t.ProyectoID, accion: 'Quitó una tarea', detalle: `paso quitado: ${t.Nombre}`, usuario });
        const { terminadoAhora } = t.EstadoProyecto === 'CANCELADO' ? { terminadoAhora: false } : await registrarCambioEtapa(tx, t.ProyectoID, antes);
        await tx.commit();
        tx = null;
        avisosTarea(req, t, usuario, { terminadoAhora });
        emitir(req, { entidad: 'PROYECTO', id: t.ProyectoID });
        res.json({ success: true, data: await proyectoCompleto(pool, t.ProyectoID) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos quitar tarea');
        responderError(res, err, 'quitar tarea');
    }
};

// POST /tareas/confirmar-fechas { items: [{ tareaId, fecha }] } → confirma las fechas sugeridas de varias tareas
// sin fecha (las que ya tienen fecha no se tocan).
exports.confirmarFechas = async (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map(x => ({ id: idNum(x?.tareaId), fecha: fechaISO(x?.fecha) })).filter(x => x.id && x.fecha);
    if (!items.length) return res.status(400).json({ success: false, error: 'No hay fechas para confirmar.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'confirmar fechas')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const porProyecto = new Map();
        for (const it of items) {
            const r = await tx.request().input('T', sql.Int, it.id).input('F', sql.VarChar(10), it.fecha).query(`
                UPDATE t SET Fecha = CONVERT(DATE, @F, 23), FechaActualizado = GETDATE() OUTPUT INSERTED.ProyectoID
                FROM dbo.DesTareas t JOIN dbo.DesProyectos p ON p.ProyectoID = t.ProyectoID AND p.Borrado = 0
                WHERE t.TareaID = @T AND t.Fecha IS NULL AND t.Estado NOT IN ('HECHO', 'NO_APLICA')`);
            for (const x of r.recordset) porProyecto.set(x.ProyectoID, (porProyecto.get(x.ProyectoID) || 0) + 1);
        }
        for (const [pid, n] of porProyecto) await bitacora(tx, { entidad: 'PROYECTO', entidadId: pid, accion: 'Confirmó las fechas sugeridas', detalle: `${n} ${n === 1 ? 'tarea' : 'tareas'}`, usuario });
        await tx.commit();
        tx = null;
        for (const pid of porProyecto.keys()) emitir(req, { entidad: 'PROYECTO', id: pid });
        res.json({ success: true, confirmadas: [...porProyecto.values()].reduce((a, n) => a + n, 0) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos confirmar fechas');
        responderError(res, err, 'confirmar fechas');
    }
};
