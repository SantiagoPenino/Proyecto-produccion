// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — Muestras (fase 4, docs/desarrollos/plan-integracion.md §6). Reglas: spec-C §4.
//
// Cada muestra física mandada a producir: sus órdenes (enlazadas a Ordenes cuando el número existe, con
// su estado en vivo), los proyectos a los que pertenece, estado, tildes, ronda, fecha, comentario y fotos
// (adjuntos MUESTRA). Cargar y cambiar muestras: el equipo (también los colaboradores, como en el
// prototipo). Las listas de estados y tildes: el editor.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { texto, idNum, fechaISO, norm, usuarioActual, exigir, bitacora, emitir, responderError } = require('../services/desarrollos/comun');

const TONOS = ['gris', 'azul', 'ambar', 'verde', 'rojo'];
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');
const titulo = (ordenes) => (ordenes.length ? ordenes.map(o => [o.numero ? `#${o.numero}` : '', o.nombre || ''].filter(Boolean).join(' ')).join(' · ') : 'Muestra sin orden');

async function leerMuestras(db, id = null) {
    const req = db.request();
    let filtro = 'm.Borrado = 0';
    if (id) { req.input('Id', sql.Int, id); filtro = 'm.MuestraID = @Id AND m.Borrado = 0'; }
    const muestras = (await req.query(`
        SELECT m.MuestraID AS id, m.EstadoID AS estadoId, CONVERT(CHAR(10), m.FechaEnvio, 23) AS fechaEnvio, m.Ronda AS ronda, m.Comentario AS comentario,
               COALESCE(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), m.AutorTexto) AS quien, m.FechaAlta AS creado, m.FechaActualizado AS actualizado
        FROM dbo.DesMuestras m LEFT JOIN dbo.Usuarios u ON u.IdUsuario = m.AutorUsuarioID
        WHERE ${filtro} ORDER BY m.FechaAlta DESC, m.MuestraID DESC`)).recordset;
    if (!muestras.length) return [];
    const lista = muestras.map(m => m.id).join(',');
    const ordenes = (await db.request().query(`
        SELECT mo.MuestraID AS muestraId, mo.Numero AS numero, mo.Nombre AS nombre, mo.OrdenID AS ordenId,
               LTRIM(RTRIM(o.Estado)) AS ordenEstado, LTRIM(RTRIM(o.AreaID)) AS ordenArea
        FROM dbo.DesMuestraOrdenes mo LEFT JOIN dbo.Ordenes o ON o.OrdenID = mo.OrdenID
        WHERE mo.MuestraID IN (${lista}) ORDER BY mo.Orden, mo.MuestraOrdenID`)).recordset;
    const proys = (await db.request().query(`
        SELECT mp.MuestraID AS muestraId, mp.ProyectoID AS proyectoId FROM dbo.DesMuestraProyectos mp
        JOIN dbo.DesProyectos p ON p.ProyectoID = mp.ProyectoID AND p.Borrado = 0 WHERE mp.MuestraID IN (${lista}) ORDER BY mp.Orden`)).recordset;
    const tildes = (await db.request().query(`SELECT MuestraID AS muestraId, TildeID AS tildeId FROM dbo.DesMuestraTildesMarcadas WHERE MuestraID IN (${lista})`)).recordset;
    const fotos = (await db.request().query(`
        SELECT AdjuntoID AS id, EntidadID AS muestraId, NombreOriginal AS nombre, Mime AS tipo FROM dbo.DesAdjuntos
        WHERE Entidad = 'MUESTRA' AND Borrado = 0 AND EntidadID IN (${lista}) ORDER BY AdjuntoID`)).recordset;
    return muestras.map(m => ({
        ...m,
        ordenes: ordenes.filter(o => o.muestraId === m.id).map(({ muestraId, ...o }) => o),
        proyectos: proys.filter(p => p.muestraId === m.id).map(p => p.proyectoId),
        tildes: tildes.filter(t => t.muestraId === m.id).map(t => t.tildeId),
        fotos: fotos.filter(f => f.muestraId === m.id).map(({ muestraId, ...f }) => f),
    }));
}

// GET /muestras
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver las muestras')) return;
        res.json({ success: true, data: await leerMuestras(pool) });
    } catch (err) { responderError(res, err, 'muestras'); }
};

// GET /ordenes/:codigo → una orden del sistema por su número (para enlazarla a una muestra)
exports.orden = async (req, res) => {
    const codigo = texto(req.params.codigo, 40);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'buscar órdenes')) return;
        const r = await pool.request().input('C', sql.VarChar(40), codigo).query(`
            SELECT TOP 1 o.OrdenID AS ordenId, LTRIM(RTRIM(o.CodigoOrden)) AS codigo, LTRIM(RTRIM(o.AreaID)) AS area, LTRIM(RTRIM(o.Estado)) AS estado,
                   LTRIM(RTRIM(o.DescripcionTrabajo)) AS descripcion
            FROM dbo.Ordenes o WHERE o.CodigoOrden = @C ORDER BY o.OrdenID`);
        if (!r.recordset.length) return res.status(404).json({ success: false, error: 'No hay una orden con ese número.' });
        res.json({ success: true, data: r.recordset[0] });
    } catch (err) { responderError(res, err, 'orden'); }
};

// Valida y limpia lo que manda la pantalla
function datosMuestra(b) {
    const ordenes = (Array.isArray(b.ordenes) ? b.ordenes : [])
        .map(o => ({ numero: texto(o?.numero, 40), nombre: texto(o?.nombre, 120) }))
        .filter(o => o.numero || o.nombre);
    if (!ordenes.length) return { error: 'Poné al menos un número o nombre de orden.' };
    const ronda = b.ronda === '' || b.ronda == null ? null : parseInt(b.ronda, 10);
    return {
        ordenes,
        proyectos: [...new Set((Array.isArray(b.proyectos) ? b.proyectos : []).map(idNum).filter(Boolean))],
        estadoId: idNum(b.estadoId),
        fechaEnvio: fechaISO(b.fechaEnvio),
        ronda: Number.isInteger(ronda) && ronda >= 1 && ronda <= 99 ? ronda : null,
        tildes: [...new Set((Array.isArray(b.tildes) ? b.tildes : []).map(idNum).filter(Boolean))],
        comentario: texto(b.comentario, 2000),
    };
}

// Escribe órdenes (enlazando las que existen), proyectos y tildes de una muestra
async function escribirRelaciones(tx, muestraId, d) {
    await tx.request().input('M', sql.Int, muestraId).query(`
        DELETE FROM dbo.DesMuestraOrdenes WHERE MuestraID = @M; DELETE FROM dbo.DesMuestraProyectos WHERE MuestraID = @M;
        DELETE FROM dbo.DesMuestraTildesMarcadas WHERE MuestraID = @M;`);
    for (const [i, o] of d.ordenes.entries()) {
        const ordenId = o.numero ? (await tx.request().input('C', sql.VarChar(40), o.numero)
            .query('SELECT TOP 1 OrdenID FROM dbo.Ordenes WHERE CodigoOrden = @C ORDER BY OrdenID')).recordset[0]?.OrdenID || null : null;
        await tx.request().input('M', sql.Int, muestraId).input('O', sql.Int, ordenId).input('N', sql.VarChar(40), o.numero).input('Nom', sql.NVarChar(120), o.nombre).input('X', sql.Int, i + 1)
            .query('INSERT INTO dbo.DesMuestraOrdenes (MuestraID, OrdenID, Numero, Nombre, Orden) VALUES (@M, @O, @N, @Nom, @X)');
    }
    for (const [i, pid] of d.proyectos.entries()) {
        await tx.request().input('M', sql.Int, muestraId).input('P', sql.Int, pid).input('X', sql.Int, i + 1).query(`
            IF EXISTS (SELECT 1 FROM dbo.DesProyectos WHERE ProyectoID = @P AND Borrado = 0)
                INSERT INTO dbo.DesMuestraProyectos (MuestraID, ProyectoID, Orden) VALUES (@M, @P, @X)`);
    }
    for (const t of d.tildes) {
        await tx.request().input('M', sql.Int, muestraId).input('T', sql.Int, t).query(`
            IF EXISTS (SELECT 1 FROM dbo.DesMuestraTildes WHERE TildeID = @T AND Activo = 1)
                INSERT INTO dbo.DesMuestraTildesMarcadas (MuestraID, TildeID) VALUES (@M, @T)`);
    }
}

async function validarEstado(tx, estadoId) {
    if (!estadoId) return true;
    return (await tx.request().input('E', sql.Int, estadoId).query('SELECT 1 AS Si FROM dbo.DesMuestraEstados WHERE EstadoID = @E AND Activo = 1')).recordset.length > 0;
}

// POST /muestras y PUT /muestras/:id { ordenes, proyectos, estadoId, fechaEnvio, ronda, tildes, comentario }
exports.guardar = async (req, res) => {
    const id = req.params.id ? idNum(req.params.id) : null;
    if (req.params.id && !id) return res.status(400).json({ success: false, error: 'Muestra inválida.' });
    const d = datosMuestra(req.body || {});
    if (d.error) return res.status(400).json({ success: false, error: d.error });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'cargar muestras')) return;
        const usuario = await usuarioActual(pool, req);
        const antes = id ? (await leerMuestras(pool, id))[0] : null;
        if (id && !antes) return res.status(404).json({ success: false, error: 'Esa muestra ya no existe.' });
        tx = new sql.Transaction(pool);
        await tx.begin();
        if (!await validarEstado(tx, d.estadoId)) { await rollbackSeguro(tx, 'Desarrollos muestra'); tx = null; return res.status(400).json({ success: false, error: 'Estado inválido.' }); }
        let muestraId = id;
        const r = tx.request().input('E', sql.Int, d.estadoId).input('F', sql.VarChar(10), d.fechaEnvio).input('R', sql.Int, d.ronda).input('C', sql.NVarChar(2000), d.comentario);
        if (id) {
            await r.input('Id', sql.Int, id).query('UPDATE dbo.DesMuestras SET EstadoID = @E, FechaEnvio = CONVERT(DATE, @F, 23), Ronda = @R, Comentario = @C, FechaActualizado = GETDATE() WHERE MuestraID = @Id');
        } else {
            muestraId = (await r.input('U', sql.Int, usuario.id).query(`
                INSERT INTO dbo.DesMuestras (EstadoID, FechaEnvio, Ronda, Comentario, AutorUsuarioID) OUTPUT INSERTED.MuestraID
                VALUES (@E, CONVERT(DATE, @F, 23), @R, @C, @U)`)).recordset[0].MuestraID;
        }
        await escribirRelaciones(tx, muestraId, d);
        if (!id) {
            await bitacora(tx, { entidad: 'MUESTRA', entidadId: muestraId, accion: 'Registró la muestra', detalle: titulo(d.ordenes), usuario });
        } else {
            // Qué cambió, como el prototipo: "órdenes: … · estado: … · fecha: …"
            const cambios = [];
            if (titulo(antes.ordenes) !== titulo(d.ordenes)) cambios.push(`órdenes: ${titulo(d.ordenes)}`);
            if ([...antes.proyectos].sort().join() !== [...d.proyectos].sort().join()) {
                const nombres = d.proyectos.length ? (await tx.request().query(`SELECT Nombre FROM dbo.DesProyectos WHERE ProyectoID IN (${d.proyectos.join(',')}) AND Borrado = 0`)).recordset.map(x => x.Nombre) : [];
                cambios.push(`proyectos: ${nombres.join(', ') || 'ninguno'}`);
            }
            if ((antes.estadoId || null) !== (d.estadoId || null)) {
                const e = d.estadoId ? (await tx.request().input('E', sql.Int, d.estadoId).query('SELECT Nombre FROM dbo.DesMuestraEstados WHERE EstadoID = @E')).recordset[0]?.Nombre : null;
                cambios.push(`estado: ${e || 'sin estado'}`);
            }
            if ((antes.fechaEnvio || null) !== d.fechaEnvio) cambios.push(`fecha: ${fmtD(d.fechaEnvio) || '—'}`);
            if ((antes.ronda ?? null) !== d.ronda) cambios.push(`ronda: ${d.ronda ?? '—'}`);
            if ([...antes.tildes].sort().join() !== [...d.tildes].sort().join()) cambios.push('tildes');
            if ((antes.comentario || null) !== d.comentario) cambios.push('comentario');
            if (cambios.length) await bitacora(tx, { entidad: 'MUESTRA', entidadId: muestraId, accion: 'Editó', detalle: cambios.join(' · '), usuario });
        }
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'MUESTRA', id: muestraId });
        res.json({ success: true, data: (await leerMuestras(pool, muestraId))[0] });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos muestra');
        responderError(res, err, 'guardar muestra');
    }
};

// PUT /muestras/:id/estado { estadoId }
exports.estado = async (req, res) => {
    const id = idNum(req.params.id);
    const estadoId = idNum(req.body?.estadoId);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'cambiar muestras')) return;
        const usuario = await usuarioActual(pool, req);
        const e = (await pool.request().input('E', sql.Int, estadoId).query('SELECT Nombre FROM dbo.DesMuestraEstados WHERE EstadoID = @E AND Activo = 1')).recordset[0];
        if (!e) return res.status(400).json({ success: false, error: 'Estado inválido.' });
        const r = await pool.request().input('Id', sql.Int, id).input('E', sql.Int, estadoId)
            .query('UPDATE dbo.DesMuestras SET EstadoID = @E, FechaActualizado = GETDATE() WHERE MuestraID = @Id AND Borrado = 0');
        if (!r.rowsAffected[0]) return res.status(404).json({ success: false, error: 'Esa muestra ya no existe.' });
        await bitacora(pool, { entidad: 'MUESTRA', entidadId: id, accion: 'Estado', detalle: e.Nombre, usuario });
        emitir(req, { entidad: 'MUESTRA', id });
        res.json({ success: true, data: (await leerMuestras(pool, id))[0] });
    } catch (err) { responderError(res, err, 'estado de muestra'); }
};

// PUT /muestras/:id/tildes { tildeId, marcado }
exports.tilde = async (req, res) => {
    const id = idNum(req.params.id);
    const tildeId = idNum(req.body?.tildeId);
    const marcado = !!req.body?.marcado;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'cambiar muestras')) return;
        const usuario = await usuarioActual(pool, req);
        const t = (await pool.request().input('T', sql.Int, tildeId).query('SELECT Nombre FROM dbo.DesMuestraTildes WHERE TildeID = @T AND Activo = 1')).recordset[0];
        if (!t) return res.status(400).json({ success: false, error: 'Tilde inválido.' });
        if (!(await leerMuestras(pool, id)).length) return res.status(404).json({ success: false, error: 'Esa muestra ya no existe.' });
        await pool.request().input('M', sql.Int, id).input('T', sql.Int, tildeId).query(marcado
            ? 'IF NOT EXISTS (SELECT 1 FROM dbo.DesMuestraTildesMarcadas WHERE MuestraID = @M AND TildeID = @T) INSERT INTO dbo.DesMuestraTildesMarcadas (MuestraID, TildeID) VALUES (@M, @T)'
            : 'DELETE FROM dbo.DesMuestraTildesMarcadas WHERE MuestraID = @M AND TildeID = @T');
        await pool.request().input('M', sql.Int, id).query('UPDATE dbo.DesMuestras SET FechaActualizado = GETDATE() WHERE MuestraID = @M');
        await bitacora(pool, { entidad: 'MUESTRA', entidadId: id, accion: marcado ? 'Tildó' : 'Destildó', detalle: t.Nombre, usuario });
        emitir(req, { entidad: 'MUESTRA', id });
        res.json({ success: true, data: (await leerMuestras(pool, id))[0] });
    } catch (err) { responderError(res, err, 'tilde de muestra'); }
};

// DELETE /muestras/:id → queda marcada borrada
exports.borrar = async (req, res) => {
    const id = idNum(req.params.id);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'borrar muestras')) return;
        const usuario = await usuarioActual(pool, req);
        const r = await pool.request().input('Id', sql.Int, id).query('UPDATE dbo.DesMuestras SET Borrado = 1 WHERE MuestraID = @Id AND Borrado = 0');
        if (!r.rowsAffected[0]) return res.status(404).json({ success: false, error: 'Esa muestra ya no existe.' });
        await bitacora(pool, { entidad: 'MUESTRA', entidadId: id, accion: 'Borró', detalle: 'la muestra', usuario });
        emitir(req, { entidad: 'MUESTRA', id });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'borrar muestra'); }
};

// POST /muestras/pegar { filas: [{ numero, nombre, marcada, comentario }], estadoSi, estadoNo, proyectoId }
// Carga masiva desde la planilla: una muestra por fila; las órdenes que ya están cargadas no se repiten.
exports.pegar = async (req, res) => {
    const filas = (Array.isArray(req.body?.filas) ? req.body.filas : []).map(f => ({
        numero: texto(f?.numero, 40), nombre: texto(f?.nombre, 120), marcada: !!f?.marcada, comentario: texto(f?.comentario, 2000),
    })).filter(f => f.numero || f.nombre);
    if (!filas.length) return res.status(400).json({ success: false, error: 'No encontré filas para cargar.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'cargar muestras')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const estadoSi = idNum(req.body?.estadoSi);
        const estadoNo = idNum(req.body?.estadoNo);
        if (!await validarEstado(tx, estadoSi) || !await validarEstado(tx, estadoNo)) { await rollbackSeguro(tx, 'Desarrollos pegar muestras'); tx = null; return res.status(400).json({ success: false, error: 'Estado inválido.' }); }
        const vistos = new Set((await tx.request().query(`
            SELECT mo.Numero FROM dbo.DesMuestraOrdenes mo JOIN dbo.DesMuestras m ON m.MuestraID = mo.MuestraID AND m.Borrado = 0 WHERE mo.Numero IS NOT NULL`)).recordset.map(x => norm(x.Numero)));
        const proyectoId = idNum(req.body?.proyectoId);
        let cargadas = 0;
        let repetidas = 0;
        for (const f of filas) {
            if (f.numero && vistos.has(norm(f.numero))) { repetidas++; continue; }
            if (f.numero) vistos.add(norm(f.numero));
            const mid = (await tx.request().input('E', sql.Int, f.marcada ? estadoSi : estadoNo).input('C', sql.NVarChar(2000), f.comentario).input('U', sql.Int, usuario.id)
                .query('INSERT INTO dbo.DesMuestras (EstadoID, Comentario, AutorUsuarioID) OUTPUT INSERTED.MuestraID VALUES (@E, @C, @U)')).recordset[0].MuestraID;
            await escribirRelaciones(tx, mid, { ordenes: [{ numero: f.numero, nombre: f.nombre }], proyectos: proyectoId ? [proyectoId] : [], tildes: [] });
            await bitacora(tx, { entidad: 'MUESTRA', entidadId: mid, accion: 'Registró la muestra (pegada desde planilla)', detalle: titulo([f]), usuario });
            cargadas++;
        }
        await tx.commit();
        tx = null;
        if (cargadas) emitir(req, { entidad: 'MUESTRA' });
        res.json({ success: true, data: { cargadas, repetidas } });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos pegar muestras');
        responderError(res, err, 'pegar muestras');
    }
};

// GET /muestras/listas → estados y tildes con cuántas muestras los usan
exports.listas = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver las muestras')) return;
        const [estados, tildes] = await Promise.all([
            pool.request().query(`SELECT e.EstadoID AS id, e.Nombre AS nombre, e.Tono AS tono,
                (SELECT COUNT(*) FROM dbo.DesMuestras m WHERE m.EstadoID = e.EstadoID AND m.Borrado = 0) AS usos
                FROM dbo.DesMuestraEstados e WHERE e.Activo = 1 ORDER BY e.Orden, e.EstadoID`),
            pool.request().query(`SELECT t.TildeID AS id, t.Nombre AS nombre,
                (SELECT COUNT(*) FROM dbo.DesMuestraTildesMarcadas x JOIN dbo.DesMuestras m ON m.MuestraID = x.MuestraID AND m.Borrado = 0 WHERE x.TildeID = t.TildeID) AS usos
                FROM dbo.DesMuestraTildes t WHERE t.Activo = 1 ORDER BY t.Orden, t.TildeID`),
        ]);
        res.json({ success: true, data: { estados: estados.recordset, tildes: tildes.recordset } });
    } catch (err) { responderError(res, err, 'listas de muestras'); }
};

// PUT /muestras/listas { estados: [{ id?, nombre, tono }], tildes: [{ id?, nombre }] } → el editor.
// El orden de los estados es el del recorrido. Uno que usan muestras no se puede quitar.
exports.guardarListas = async (req, res) => {
    const estados = (Array.isArray(req.body?.estados) ? req.body.estados : []).map(e => ({ id: idNum(e?.id), nombre: texto(e?.nombre, 60), tono: TONOS.includes(e?.tono) ? e.tono : 'gris' }));
    const tildes = (Array.isArray(req.body?.tildes) ? req.body.tildes : []).map(t => ({ id: idNum(t?.id), nombre: texto(t?.nombre, 40) }));
    if (!estados.length) return res.status(400).json({ success: false, error: 'Tiene que haber al menos un estado.' });
    if ([...estados, ...tildes].some(x => !x.nombre)) return res.status(400).json({ success: false, error: 'Hay un nombre vacío.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar las listas de muestras')) return;
        tx = new sql.Transaction(pool);
        await tx.begin();
        const fin = async (error) => { await rollbackSeguro(tx, 'Desarrollos listas muestras'); tx = null; return res.status(409).json({ success: false, error }); };
        const actualesE = (await tx.request().query(`SELECT e.EstadoID, e.Nombre, (SELECT COUNT(*) FROM dbo.DesMuestras m WHERE m.EstadoID = e.EstadoID AND m.Borrado = 0) AS usos FROM dbo.DesMuestraEstados e WHERE e.Activo = 1`)).recordset;
        for (const e of actualesE.filter(a => !estados.some(x => x.id === a.EstadoID))) {
            if (e.usos) return fin(`«${e.Nombre}» lo usan ${e.usos} muestras: cambialas de estado antes de quitarlo.`);
            await tx.request().input('E', sql.Int, e.EstadoID).query('UPDATE dbo.DesMuestraEstados SET Activo = 0 WHERE EstadoID = @E');
        }
        for (const [i, e] of estados.entries()) {
            if (e.id && actualesE.some(a => a.EstadoID === e.id)) {
                await tx.request().input('E', sql.Int, e.id).input('N', sql.NVarChar(60), e.nombre).input('T', sql.VarChar(8), e.tono).input('O', sql.Int, i + 1)
                    .query('UPDATE dbo.DesMuestraEstados SET Nombre = @N, Tono = @T, Orden = @O WHERE EstadoID = @E');
            } else {
                await tx.request().input('C', sql.VarChar(40), `e${Date.now().toString(36)}${i}`).input('N', sql.NVarChar(60), e.nombre).input('T', sql.VarChar(8), e.tono).input('O', sql.Int, i + 1)
                    .query('INSERT INTO dbo.DesMuestraEstados (Clave, Nombre, Tono, Orden) VALUES (@C, @N, @T, @O)');
            }
        }
        const actualesT = (await tx.request().query(`SELECT t.TildeID, t.Nombre, (SELECT COUNT(*) FROM dbo.DesMuestraTildesMarcadas x JOIN dbo.DesMuestras m ON m.MuestraID = x.MuestraID AND m.Borrado = 0 WHERE x.TildeID = t.TildeID) AS usos FROM dbo.DesMuestraTildes t WHERE t.Activo = 1`)).recordset;
        for (const t of actualesT.filter(a => !tildes.some(x => x.id === a.TildeID))) {
            if (t.usos) return fin(`«${t.Nombre}» lo tienen ${t.usos} muestras: destildalas antes de quitarlo.`);
            await tx.request().input('T', sql.Int, t.TildeID).query('UPDATE dbo.DesMuestraTildes SET Activo = 0 WHERE TildeID = @T');
        }
        for (const [i, t] of tildes.entries()) {
            if (t.id && actualesT.some(a => a.TildeID === t.id)) {
                await tx.request().input('T', sql.Int, t.id).input('N', sql.NVarChar(40), t.nombre).input('O', sql.Int, i + 1).query('UPDATE dbo.DesMuestraTildes SET Nombre = @N, Orden = @O WHERE TildeID = @T');
            } else {
                await tx.request().input('C', sql.VarChar(40), `t${Date.now().toString(36)}${i}`).input('N', sql.NVarChar(40), t.nombre).input('O', sql.Int, i + 1)
                    .query('INSERT INTO dbo.DesMuestraTildes (Clave, Nombre, Orden) VALUES (@C, @N, @O)');
            }
        }
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'TIPOS' }); // los catálogos de la pantalla se recargan
        res.json({ success: true });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos listas muestras');
        responderError(res, err, 'guardar listas de muestras');
    }
};
