// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — Plantillas y tipos de desarrollo (fase 2). Reglas: docs/desarrollos/spec-B §4.
// Leer: el equipo. Cambiar: el editor. Cambiar una plantilla no toca los proyectos que ya existen
// (copian etapas y tareas al crearse). Las fijas (prenda, correccion, variante) se editan pero no se
// borran ni cambian de "para". Arreglo del plan: un tipo de desarrollo en uso no se puede quitar.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { texto, idNum, usuarioActual, exigir, emitir, responderError } = require('../services/desarrollos/comun');
const fabrica = require('../services/desarrollos/fabrica');

const PARA = ['PRODUCTO', 'CORRECCION', 'VARIANTE'];
const COLOR = /^#[0-9a-fA-F]{6}$/;

async function leerPlantillas(db) {
    const plantillas = (await db.request().query(`
        SELECT PlantillaID AS id, Clave AS clave, Nombre AS nombre, Para AS para, TipoID AS tipoId, Descripcion AS descripcion,
               Fija AS fija, Orden AS orden, FechaActualizado AS actualizado
        FROM dbo.DesPlantillas WHERE Activo = 1 ORDER BY Orden, PlantillaID`)).recordset;
    const etapas = (await db.request().query(`
        SELECT e.EtapaID AS id, e.PlantillaID AS plantillaId, e.Clave AS clave, e.Nombre AS nombre, e.Color AS color, e.Orden AS orden
        FROM dbo.DesPlantillaEtapas e JOIN dbo.DesPlantillas p ON p.PlantillaID = e.PlantillaID AND p.Activo = 1 ORDER BY e.Orden, e.EtapaID`)).recordset;
    const tareas = (await db.request().query(`
        SELECT t.PlantillaTareaID AS id, t.PlantillaID AS plantillaId, t.EtapaID AS etapaId, t.Nombre AS nombre, t.DiasHabiles AS dias,
               t.Entregable AS entregable, t.PideRef AS pideRef, t.MarcaErp AS marcaErp, t.Orden AS orden
        FROM dbo.DesPlantillaTareas t JOIN dbo.DesPlantillas p ON p.PlantillaID = t.PlantillaID AND p.Activo = 1 ORDER BY t.Orden, t.PlantillaTareaID`)).recordset;
    return plantillas.map(p => ({
        ...p,
        etapas: etapas.filter(e => e.plantillaId === p.id),
        tareas: tareas.filter(t => t.plantillaId === p.id),
    }));
}

// GET /plantillas → todas, con etapas y tareas
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver las plantillas')) return;
        res.json({ success: true, data: await leerPlantillas(pool) });
    } catch (err) { responderError(res, err, 'plantillas'); }
};

// Valida lo que manda el editor. { nombre, para, tipoId, descripcion, etapas: [{ clave, nombre, color }],
// tareas: [{ etapa: índice en etapas, nombre, dias, entregable, pideRef, marcaErp }] }
// Las tareas sin nombre se descartan (como en el prototipo). Devuelve { error } o los datos limpios.
function validar(b) {
    const nombre = texto(b.nombre, 60);
    if (!nombre) return { error: 'Falta el nombre de la plantilla.' };
    // Una de las cinco de siempre conserva su clave (la usan los chips de Proyectos) solo si no se renombró;
    // renombrada pasa a ser una etapa propia, como en el prototipo.
    const etapas = (Array.isArray(b.etapas) ? b.etapas : []).map(e => {
        const nombre = texto(e?.nombre, 40);
        const fab = fabrica.ETAPAS.find(x => x.clave === e?.clave);
        return { clave: fab && fab.nombre === nombre ? fab.clave : null, nombre, color: COLOR.test(String(e?.color || '')) ? e.color : '#8a94a6' };
    });
    if (!etapas.length) return { error: 'Tiene que haber al menos una etapa.' };
    if (etapas.some(e => !e.nombre)) return { error: 'Hay una etapa sin nombre.' };
    const nombres = etapas.map(e => e.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length) return { error: 'Hay dos etapas con el mismo nombre.' };
    const tareas = (Array.isArray(b.tareas) ? b.tareas : [])
        .map(t => ({
            etapa: Number.isInteger(t?.etapa) ? t.etapa : -1, nombre: texto(t?.nombre, 120),
            dias: Math.max(0, Math.min(120, parseInt(t?.dias, 10) || 0)), entregable: texto(t?.entregable, 80),
            pideRef: !!t?.pideRef, marcaErp: !!t?.marcaErp,
        }))
        .filter(t => t.nombre);
    if (!tareas.length) return { error: 'Agregá al menos una tarea.' };
    if (tareas.some(t => t.etapa < 0 || t.etapa >= etapas.length)) return { error: 'Hay una tarea en una etapa que no existe.' };
    return { nombre, para: PARA.includes(b.para) ? b.para : 'PRODUCTO', tipoId: idNum(b.tipoId), descripcion: texto(b.descripcion, 200), etapas, tareas };
}

async function escribirContenido(tx, plantillaId, d) {
    await tx.request().input('P', sql.Int, plantillaId).query('DELETE FROM dbo.DesPlantillaTareas WHERE PlantillaID = @P; DELETE FROM dbo.DesPlantillaEtapas WHERE PlantillaID = @P;');
    const ids = [];
    for (const [i, e] of d.etapas.entries()) {
        const r = await tx.request().input('P', sql.Int, plantillaId).input('C', sql.VarChar(40), e.clave).input('N', sql.NVarChar(40), e.nombre)
            .input('Col', sql.VarChar(7), e.color).input('O', sql.Int, i + 1)
            .query('INSERT INTO dbo.DesPlantillaEtapas (PlantillaID, Clave, Nombre, Color, Orden) OUTPUT INSERTED.EtapaID VALUES (@P, @C, @N, @Col, @O)');
        ids.push(r.recordset[0].EtapaID);
    }
    const orden = new Map();
    for (const t of d.tareas) {
        const eid = ids[t.etapa];
        orden.set(eid, (orden.get(eid) || 0) + 1);
        await tx.request().input('P', sql.Int, plantillaId).input('E', sql.Int, eid).input('N', sql.NVarChar(120), t.nombre).input('D', sql.Int, t.dias)
            .input('Ent', sql.NVarChar(80), t.entregable).input('R', sql.Bit, t.pideRef).input('Erp', sql.Bit, t.marcaErp).input('O', sql.Int, orden.get(eid))
            .query(`INSERT INTO dbo.DesPlantillaTareas (PlantillaID, EtapaID, Nombre, DiasHabiles, Entregable, PideRef, MarcaErp, Orden)
                    VALUES (@P, @E, @N, @D, @Ent, @R, @Erp, @O)`);
    }
}

// POST /plantillas y PUT /plantillas/:id
exports.guardar = async (req, res) => {
    const id = req.params.id ? idNum(req.params.id) : null;
    if (req.params.id && !id) return res.status(400).json({ success: false, error: 'Plantilla inválida.' });
    const d = validar(req.body || {});
    if (d.error) return res.status(400).json({ success: false, error: d.error });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar las plantillas')) return;
        await usuarioActual(pool, req);
        if (d.tipoId) {
            const t = await pool.request().input('T', sql.Int, d.tipoId).query('SELECT 1 AS Si FROM dbo.DesTiposDesarrollo WHERE TipoID = @T AND Activo = 1');
            if (!t.recordset.length) return res.status(400).json({ success: false, error: 'Tipo de desarrollo inválido.' });
        }
        tx = new sql.Transaction(pool);
        await tx.begin();
        let plantillaId = id;
        if (id) {
            const p = (await tx.request().input('Id', sql.Int, id).query('SELECT Fija, Para FROM dbo.DesPlantillas WITH (UPDLOCK) WHERE PlantillaID = @Id AND Activo = 1')).recordset[0];
            if (!p) { await rollbackSeguro(tx, 'Desarrollos plantilla'); tx = null; return res.status(404).json({ success: false, error: 'Esa plantilla ya no existe.' }); }
            // Las fijas no cambian de "para": el sistema las usa para eso
            const para = p.Fija ? p.Para : d.para;
            await tx.request().input('Id', sql.Int, id).input('N', sql.NVarChar(60), d.nombre).input('Para', sql.VarChar(12), para)
                .input('T', sql.Int, d.tipoId).input('D', sql.NVarChar(200), d.descripcion)
                .query('UPDATE dbo.DesPlantillas SET Nombre = @N, Para = @Para, TipoID = @T, Descripcion = @D, FechaActualizado = GETDATE() WHERE PlantillaID = @Id');
        } else {
            if (d.para === 'VARIANTE') { await rollbackSeguro(tx, 'Desarrollos plantilla'); tx = null; return res.status(400).json({ success: false, error: 'La plantilla de variantes es una sola (la fija).' }); }
            const orden = (await tx.request().query('SELECT ISNULL(MAX(Orden), 0) + 1 AS n FROM dbo.DesPlantillas')).recordset[0].n;
            plantillaId = (await tx.request().input('N', sql.NVarChar(60), d.nombre).input('Para', sql.VarChar(12), d.para)
                .input('T', sql.Int, d.tipoId).input('D', sql.NVarChar(200), d.descripcion).input('O', sql.Int, orden)
                .query('INSERT INTO dbo.DesPlantillas (Nombre, Para, TipoID, Descripcion, Orden) OUTPUT INSERTED.PlantillaID VALUES (@N, @Para, @T, @D, @O)')).recordset[0].PlantillaID;
        }
        await escribirContenido(tx, plantillaId, d);
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PLANTILLA', id: plantillaId });
        res.json({ success: true, data: (await leerPlantillas(pool)).find(p => p.id === plantillaId) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos plantilla');
        responderError(res, err, 'guardar plantilla');
    }
};

// DELETE /plantillas/:id → la desactiva (los proyectos que la usaron conservan su nombre). No las fijas.
exports.borrar = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Plantilla inválida.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'borrar plantillas')) return;
        const r = await pool.request().input('Id', sql.Int, id)
            .query('UPDATE dbo.DesPlantillas SET Activo = 0, FechaActualizado = GETDATE() WHERE PlantillaID = @Id AND Activo = 1 AND Fija = 0');
        if (!r.rowsAffected[0]) return res.status(409).json({ success: false, error: 'No existe o es una de las fijas (prenda, corrección, variante).' });
        emitir(req, { entidad: 'PLANTILLA', id });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'borrar plantilla'); }
};

// PUT /tipos { tipos: [{ id?, nombre, esProducto }] } → la lista completa de tipos de desarrollo.
// Los que no vienen se desactivan, salvo que estén en uso. "Producto" no se quita ni deja de ser producto.
exports.guardarTipos = async (req, res) => {
    const lista = Array.isArray(req.body?.tipos) ? req.body.tipos : [];
    const tipos = lista.map(t => ({ id: idNum(t?.id), nombre: texto(t?.nombre, 60), esProducto: !!t?.esProducto }));
    if (!tipos.length) return res.status(400).json({ success: false, error: 'Tiene que haber al menos un tipo.' });
    if (tipos.some(t => !t.nombre)) return res.status(400).json({ success: false, error: 'Hay un tipo sin nombre.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar los tipos de desarrollo')) return;
        tx = new sql.Transaction(pool);
        await tx.begin();
        const fin = async (status, error) => { await rollbackSeguro(tx, 'Desarrollos tipos'); tx = null; return res.status(status).json({ success: false, error }); };
        const actuales = (await tx.request().query('SELECT TipoID, Clave, Nombre FROM dbo.DesTiposDesarrollo WITH (UPDLOCK) WHERE Activo = 1')).recordset;
        const producto = actuales.find(t => t.Clave === 'producto');
        if (producto) {
            const p = tipos.find(t => t.id === producto.TipoID);
            if (!p) return fin(400, '«Producto» no se puede quitar.');
            p.esProducto = true;
        }
        for (const t of actuales.filter(a => !tipos.some(x => x.id === a.TipoID))) {
            const uso = (await tx.request().input('T', sql.Int, t.TipoID).query(`SELECT
                (SELECT COUNT(*) FROM dbo.DesProyectos WHERE TipoID = @T AND Borrado = 0) + (SELECT COUNT(*) FROM dbo.DesSolicitudes WHERE TipoID = @T AND Borrado = 0) AS n,
                (SELECT COUNT(*) FROM dbo.DesPlantillas WHERE TipoID = @T AND Activo = 1) AS plantillas`)).recordset[0];
            if (uso.n) return fin(409, `«${t.Nombre}» lo usan ${uso.n} pedidos o proyectos: cambialos de tipo antes de quitarlo.`);
            if (uso.plantillas) return fin(409, `«${t.Nombre}» lo usan ${uso.plantillas} plantillas: cambiales el tipo antes de quitarlo.`);
            await tx.request().input('T', sql.Int, t.TipoID).query('UPDATE dbo.DesTiposDesarrollo SET Activo = 0 WHERE TipoID = @T');
        }
        for (const [i, t] of tipos.entries()) {
            if (t.id && actuales.some(a => a.TipoID === t.id)) {
                await tx.request().input('T', sql.Int, t.id).input('N', sql.NVarChar(60), t.nombre).input('P', sql.Bit, t.esProducto).input('O', sql.Int, i + 1)
                    .query('UPDATE dbo.DesTiposDesarrollo SET Nombre = @N, EsProducto = @P, Orden = @O WHERE TipoID = @T');
            } else {
                const clave = `t${Date.now().toString(36)}${i}`;
                await tx.request().input('C', sql.VarChar(40), clave).input('N', sql.NVarChar(60), t.nombre).input('P', sql.Bit, t.esProducto).input('O', sql.Int, i + 1)
                    .query('INSERT INTO dbo.DesTiposDesarrollo (Clave, Nombre, EsProducto, Orden) VALUES (@C, @N, @P, @O)');
            }
        }
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'TIPOS' });
        const r = await pool.request().query('SELECT TipoID AS id, Clave AS clave, Nombre AS nombre, EsProducto AS esProducto FROM dbo.DesTiposDesarrollo WHERE Activo = 1 ORDER BY Orden, TipoID');
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos tipos');
        responderError(res, err, 'guardar tipos');
    }
};
