// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — Catálogo técnico (fase 4, docs/desarrollos/plan-integracion.md §6). Reglas: spec-C §5.
//
// Capacidades (qué necesitan los productos y qué conviene desarrollar primero), Variantes de cada producto
// (moldes, TizadaPro, ERP, con su lista de tareas) y Opciones de slot (lo que ofrece cada molde). Tablas
// propias por ahora: el enlace con TIZADA PRO se suma después de hablar con Yoania. Ver: todo el equipo.
// Cambiar: el editor.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { texto, idNum, fechaISO, norm, usuarioActual, exigir, bitacora, emitir, responderError } = require('../services/desarrollos/comun');
const { crearVariante } = require('../services/desarrollos/altas');

const AMBITOS = ['PRENDA', 'PLANO'];
const V_ESTADO = { PROPUESTA: 'Propuesta', EN_DESARROLLO: 'En desarrollo', MUESTRA: 'En muestra', LISTA: 'Lista', DESCARTADA: 'Descartada' };
const V_MOLDES = { NO: 'Sin molde', GENERADA: 'Generada por el motor', DE_ALTA: 'De alta en moldes' };
const V_TIZADA = { SIN_VERIFICAR: 'Sin verificar', NO: 'No cargada', CARGADA: 'Cargada' };
const V_ERP = { SIN_VERIFICAR: 'Sin verificar', NO: 'No habilitada', HABILITADA: 'Habilitada para la venta' };
const O_ESTADO = ['RECETA', 'MOLDE', 'FALTA'];
const PEDIDO_ABIERTO = "('NUEVA', 'EN_EVALUACION', 'POSPUESTA')";
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');

const leerCombinacion = (json) => { try { const c = JSON.parse(json || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch { return {}; } };

async function leerVariantes(db, id = null) {
    const req = db.request();
    let filtro = 'v.Borrado = 0 AND p.Borrado = 0';
    if (id) { req.input('Id', sql.Int, id); filtro += ' AND v.VarianteID = @Id'; }
    const variantes = (await req.query(`
        SELECT v.VarianteID AS id, v.ProyectoID AS proyectoId, v.Nombre AS nombre, v.CombinacionJson AS comb, v.Libre AS libre, v.Origen AS origen,
               v.SolicitudID AS solicitudId, v.Estado AS estado, v.Moldes AS moldes, v.Tizada AS tizada, v.TizadaNombre AS tizadaNombre, v.Erp AS erp,
               v.ResponsableUsuarioID AS responsableId, COALESCE(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), NULLIF(LTRIM(RTRIM(u.Usuario)), ''), v.ResponsableTexto) AS responsable,
               CONVERT(CHAR(10), v.Fecha, 23) AS fecha, v.Nota AS nota, v.FechaAlta AS creado
        FROM dbo.DesVariantes v JOIN dbo.DesProyectos p ON p.ProyectoID = v.ProyectoID
        LEFT JOIN dbo.Usuarios u ON u.IdUsuario = v.ResponsableUsuarioID
        WHERE ${filtro} ORDER BY v.ProyectoID, v.Orden, v.VarianteID`)).recordset;
    if (!variantes.length) return [];
    const tareas = (await db.request().query(`
        SELECT t.VarTareaID AS id, t.VarianteID AS varianteId, t.EtapaClave AS etapa, t.Nombre AS nombre, t.Estado AS estado,
               COALESCE(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), NULLIF(LTRIM(RTRIM(u.Usuario)), ''), t.ResponsableTexto) AS responsable,
               CONVERT(CHAR(10), t.Fecha, 23) AS fecha, t.HechoEl AS hechoEl
        FROM dbo.DesVarianteTareas t LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.ResponsableUsuarioID
        WHERE t.VarianteID IN (${variantes.map(v => v.id).join(',')}) ORDER BY t.Orden, t.VarTareaID`)).recordset;
    return variantes.map(({ comb, ...v }) => ({
        ...v,
        combinacion: leerCombinacion(comb),
        tareas: tareas.filter(t => t.varianteId === v.id).map(({ varianteId, ...t }) => t),
    }));
}

// GET /catalogo → todo lo de la pantalla (son listas chicas)
exports.leer = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver el catálogo técnico')) return;
        const capacidades = (await pool.request().query(`
            SELECT CapacidadID AS id, Clave AS clave, Nombre AS nombre, Familia AS familia, Ambito AS ambito, Nota AS nota, Resuelta AS resuelta
            FROM dbo.DesCapacidades WHERE Borrado = 0 ORDER BY Nombre`)).recordset;
        // Uso: de proyectos no borrados y de pedidos no borrados (la pantalla decide cuáles cuentan)
        const uso = (await pool.request().query(`
            SELECT u.CapacidadID AS capacidadId, u.Entidad AS entidad, u.EntidadID AS entidadId, u.Relacion AS relacion
            FROM dbo.DesCapacidadUso u JOIN dbo.DesCapacidades k ON k.CapacidadID = u.CapacidadID AND k.Borrado = 0
            WHERE (u.Entidad = 'PROYECTO' AND EXISTS (SELECT 1 FROM dbo.DesProyectos p WHERE p.ProyectoID = u.EntidadID AND p.Borrado = 0))
               OR (u.Entidad = 'SOLICITUD' AND EXISTS (SELECT 1 FROM dbo.DesSolicitudes s WHERE s.SolicitudID = u.EntidadID AND s.Borrado = 0 AND s.Estado IN ${PEDIDO_ABIERTO}))`)).recordset;
        const pedidos = (await pool.request().query(`
            SELECT s.SolicitudID AS id, s.Numero AS numero, s.Titulo AS titulo FROM dbo.DesSolicitudes s
            WHERE s.Borrado = 0 AND s.Estado IN ${PEDIDO_ABIERTO}
              AND EXISTS (SELECT 1 FROM dbo.DesCapacidadUso u WHERE u.Entidad = 'SOLICITUD' AND u.EntidadID = s.SolicitudID)`)).recordset;
        const opciones = (await pool.request().query(`
            SELECT OpcionID AS id, Molde AS molde, MoldeNombre AS moldeNombre, Slot AS slot, SlotNombre AS slotNombre, Codigo AS codigo, CodigoCasa AS codigoCasa,
                   Nombre AS nombre, Estado AS estado, Habilitada AS habilitada, PorDefecto AS porDefecto, Nota AS nota
            FROM dbo.DesOpcionesSlot ORDER BY MoldeNombre, SlotNombre, Codigo`)).recordset;
        const opcProy = (await pool.request().query(`
            SELECT op.OpcionID AS opcionId, op.ProyectoID AS proyectoId FROM dbo.DesOpcionProyectos op
            JOIN dbo.DesProyectos p ON p.ProyectoID = op.ProyectoID AND p.Borrado = 0`)).recordset;
        const variantes = await leerVariantes(pool);
        res.json({
            success: true,
            data: {
                capacidades, uso, pedidos, variantes,
                opciones: opciones.map(o => ({ ...o, proyectos: opcProy.filter(x => x.opcionId === o.id).map(x => x.proyectoId) })),
            },
        });
    } catch (err) { responderError(res, err, 'catálogo técnico'); }
};

// ── Capacidades ─────────────────────────────────────────────────────────────
function datosCapacidad(b) {
    return {
        nombre: texto(b.nombre, 80),
        familia: texto(b.familia, 60),
        ambito: AMBITOS.includes(String(b.ambito || '').toUpperCase()) ? String(b.ambito).toUpperCase() : 'PRENDA',
        nota: texto(b.nota, 200),
    };
}
const leerCapacidad = async (db, id) => (await db.request().input('Id', sql.Int, id).query(`
    SELECT CapacidadID AS id, Clave AS clave, Nombre AS nombre, Familia AS familia, Ambito AS ambito, Nota AS nota, Resuelta AS resuelta
    FROM dbo.DesCapacidades WHERE CapacidadID = @Id AND Borrado = 0`)).recordset[0] || null;

// POST /catalogo/capacidades { nombre, familia, ambito, nota }
// La clave sale del nombre (abertura_lateral), como en el prototipo. Si ya hay una con esa clave no se pisa
// (el prototipo la pisaba y la volvía «por desarrollar», spec-C §7.31); si estaba borrada, vuelve.
exports.crearCapacidad = async (req, res) => {
    const d = datosCapacidad(req.body || {});
    if (!d.nombre) return res.status(400).json({ success: false, error: 'Poné un nombre.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const clave = (norm(d.nombre).replace(/ /g, '_') || `c${Date.now().toString(36)}`).slice(0, 100);
        const existe = (await pool.request().input('C', sql.VarChar(100), clave).query('SELECT CapacidadID, Borrado FROM dbo.DesCapacidades WHERE Clave = @C')).recordset[0];
        if (existe && !existe.Borrado) return res.status(409).json({ success: false, error: 'Ya hay una capacidad con ese nombre.' });
        const r = pool.request().input('C', sql.VarChar(100), clave).input('N', sql.NVarChar(80), d.nombre).input('F', sql.NVarChar(60), d.familia)
            .input('A', sql.VarChar(10), d.ambito).input('Nota', sql.NVarChar(200), d.nota);
        let id;
        if (existe) {
            id = existe.CapacidadID;
            await r.input('Id', sql.Int, id).query(`UPDATE dbo.DesCapacidades SET Nombre = @N, Familia = @F, Ambito = @A, Nota = @Nota, Resuelta = 0, Borrado = 0,
                FechaActualizado = GETDATE() WHERE CapacidadID = @Id`);
        } else {
            id = (await r.query(`INSERT INTO dbo.DesCapacidades (Clave, Nombre, Familia, Ambito, Nota) OUTPUT INSERTED.CapacidadID
                VALUES (@C, @N, @F, @A, @Nota)`)).recordset[0].CapacidadID;
        }
        await bitacora(pool, { entidad: 'CAPACIDAD', entidadId: id, accion: 'Creó la capacidad', detalle: d.nombre, usuario });
        emitir(req, { entidad: 'CATALOGO' });
        res.json({ success: true, data: await leerCapacidad(pool, id) });
    } catch (err) { responderError(res, err, 'crear capacidad'); }
};

// PUT /catalogo/capacidades/:id { nombre, familia, ambito, nota } o { resuelta }
exports.editarCapacidad = async (req, res) => {
    const id = idNum(req.params.id);
    const b = req.body || {};
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const antes = await leerCapacidad(pool, id);
        if (!antes) return res.status(404).json({ success: false, error: 'Esa capacidad ya no existe.' });
        if (b.resuelta !== undefined) {
            await pool.request().input('Id', sql.Int, id).input('R', sql.Bit, !!b.resuelta)
                .query('UPDATE dbo.DesCapacidades SET Resuelta = @R, FechaActualizado = GETDATE() WHERE CapacidadID = @Id');
            await bitacora(pool, { entidad: 'CAPACIDAD', entidadId: id, accion: b.resuelta ? 'Marcó resuelta' : 'Marcó por desarrollar', detalle: antes.nombre, usuario });
        } else {
            const d = datosCapacidad(b);
            if (!d.nombre) return res.status(400).json({ success: false, error: 'Poné un nombre.' });
            await pool.request().input('Id', sql.Int, id).input('N', sql.NVarChar(80), d.nombre).input('F', sql.NVarChar(60), d.familia)
                .input('A', sql.VarChar(10), d.ambito).input('Nota', sql.NVarChar(200), d.nota)
                .query('UPDATE dbo.DesCapacidades SET Nombre = @N, Familia = @F, Ambito = @A, Nota = @Nota, FechaActualizado = GETDATE() WHERE CapacidadID = @Id');
            const cambios = [['nombre', antes.nombre, d.nombre], ['familia', antes.familia, d.familia], ['ámbito', antes.ambito, d.ambito], ['nota', antes.nota, d.nota]]
                .filter(([, a, n]) => (a || null) !== (n || null)).map(([k, , n]) => `${k}: ${n || '—'}`);
            if (cambios.length) await bitacora(pool, { entidad: 'CAPACIDAD', entidadId: id, accion: 'Editó', detalle: cambios.join(' · '), usuario });
        }
        emitir(req, { entidad: 'CATALOGO' });
        res.json({ success: true, data: await leerCapacidad(pool, id) });
    } catch (err) { responderError(res, err, 'editar capacidad'); }
};

// DELETE /catalogo/capacidades/:id → solo si nadie la necesita (proyectos no cancelados o pedidos abiertos). Queda marcada borrada.
exports.borrarCapacidad = async (req, res) => {
    const id = idNum(req.params.id);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const c = await leerCapacidad(pool, id);
        if (!c) return res.status(404).json({ success: false, error: 'Esa capacidad ya no existe.' });
        const n = (await pool.request().input('Id', sql.Int, id).query(`
            SELECT (SELECT COUNT(*) FROM dbo.DesCapacidadUso u JOIN dbo.DesProyectos p ON p.ProyectoID = u.EntidadID AND p.Borrado = 0 AND p.Estado <> 'CANCELADO'
                    WHERE u.CapacidadID = @Id AND u.Entidad = 'PROYECTO' AND u.Relacion = 'REQUIERE')
                 + (SELECT COUNT(*) FROM dbo.DesCapacidadUso u JOIN dbo.DesSolicitudes s ON s.SolicitudID = u.EntidadID AND s.Borrado = 0 AND s.Estado IN ${PEDIDO_ABIERTO}
                    WHERE u.CapacidadID = @Id AND u.Entidad = 'SOLICITUD' AND u.Relacion = 'REQUIERE') AS n`)).recordset[0].n;
        if (n) return res.status(409).json({ success: false, error: `La necesitan ${n}: no se puede borrar.` });
        await pool.request().input('Id', sql.Int, id).query('UPDATE dbo.DesCapacidades SET Borrado = 1, FechaActualizado = GETDATE() WHERE CapacidadID = @Id');
        await bitacora(pool, { entidad: 'CAPACIDAD', entidadId: id, accion: 'Borró la capacidad', detalle: c.nombre, usuario });
        emitir(req, { entidad: 'CATALOGO' });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'borrar capacidad'); }
};

// POST /catalogo/capacidades/resueltas { ids } → «Marcarlas como resueltas» (desarrollos terminados que las resuelven)
exports.marcarResueltas = async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(idNum).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No hay capacidades para marcar.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const r = await pool.request().query(`UPDATE dbo.DesCapacidades SET Resuelta = 1, FechaActualizado = GETDATE()
            OUTPUT INSERTED.CapacidadID, INSERTED.Nombre WHERE CapacidadID IN (${ids.join(',')}) AND Borrado = 0 AND Resuelta = 0`);
        for (const c of r.recordset) await bitacora(pool, { entidad: 'CAPACIDAD', entidadId: c.CapacidadID, accion: 'Marcó resuelta', detalle: `${c.Nombre} (desarrollo terminado)`, usuario });
        emitir(req, { entidad: 'CATALOGO' });
        res.json({ success: true, data: { marcadas: r.recordset.length } });
    } catch (err) { responderError(res, err, 'marcar resueltas'); }
};

// PUT /proyectos/:id/capacidades { relacion: 'REQUIERE' | 'RESUELVE', ids } → reemplaza lo que el proyecto necesita o resuelve
exports.capacidadesProyecto = async (req, res) => {
    const pid = idNum(req.params.id);
    const relacion = req.body?.relacion === 'RESUELVE' ? 'RESUELVE' : 'REQUIERE';
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(idNum).filter(Boolean))];
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const p = (await tx.request().input('P', sql.Int, pid).query('SELECT Nombre FROM dbo.DesProyectos WHERE ProyectoID = @P AND Borrado = 0')).recordset[0];
        if (!p) { await rollbackSeguro(tx, 'Desarrollos capacidades'); tx = null; return res.status(404).json({ success: false, error: 'Ese proyecto ya no existe.' }); }
        const validas = ids.length ? (await tx.request().query(`SELECT CapacidadID AS id, Nombre AS nombre FROM dbo.DesCapacidades WHERE Borrado = 0 AND CapacidadID IN (${ids.join(',')})`)).recordset : [];
        // Solo se tocan las capacidades vivas: las borradas que tuviera quedan como estaban
        await tx.request().input('P', sql.Int, pid).input('R', sql.VarChar(10), relacion).query(`
            DELETE u FROM dbo.DesCapacidadUso u JOIN dbo.DesCapacidades k ON k.CapacidadID = u.CapacidadID AND k.Borrado = 0
            WHERE u.Entidad = 'PROYECTO' AND u.EntidadID = @P AND u.Relacion = @R`);
        for (const c of validas) {
            await tx.request().input('C', sql.Int, c.id).input('P', sql.Int, pid).input('R', sql.VarChar(10), relacion)
                .query("INSERT INTO dbo.DesCapacidadUso (CapacidadID, Entidad, EntidadID, Relacion) VALUES (@C, 'PROYECTO', @P, @R)");
        }
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: pid, accion: relacion === 'REQUIERE' ? 'Capacidades' : 'Resuelve', detalle: validas.map(c => c.nombre).join(', ') || 'ninguna', usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id: pid });
        res.json({ success: true, data: { ids: validas.map(c => c.id) } });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos capacidades');
        responderError(res, err, 'capacidades del proyecto');
    }
};

// ── Variantes ───────────────────────────────────────────────────────────────
// POST /catalogo/variantes { proyectoId, nombre, combinacion: { slot: codigo }, libre }
exports.crearVariante = async (req, res) => {
    const b = req.body || {};
    const pid = idNum(b.proyectoId);
    const nombre = texto(b.nombre, 120);
    if (!pid) return res.status(400).json({ success: false, error: 'Elegí el producto.' });
    if (!nombre) return res.status(400).json({ success: false, error: 'Poné un nombre.' });
    const combinacion = {};
    for (const [slot, codigo] of Object.entries(b.combinacion && typeof b.combinacion === 'object' ? b.combinacion : {})) {
        const s = texto(slot, 60);
        const c = texto(codigo, 30);
        if (s && c && s !== 'libre') combinacion[s] = c;
    }
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const p = (await tx.request().input('P', sql.Int, pid).query("SELECT Nombre, LiderUsuarioID FROM dbo.DesProyectos WHERE ProyectoID = @P AND Borrado = 0 AND Estado <> 'CANCELADO'")).recordset[0];
        if (!p) { await rollbackSeguro(tx, 'Desarrollos variante'); tx = null; return res.status(404).json({ success: false, error: 'Ese producto ya no existe o está cancelado.' }); }
        const id = await crearVariante(tx, { proyectoId: pid, nombre, combinacion, libre: texto(b.libre, 200), origen: 'equipo', estado: 'PROPUESTA', responsableId: p.LiderUsuarioID });
        await bitacora(tx, { entidad: 'PROYECTO', entidadId: pid, accion: 'Variantes', detalle: `variante nueva: ${nombre}`, usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id: pid });
        res.json({ success: true, data: (await leerVariantes(pool, id))[0] });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos variante');
        responderError(res, err, 'crear variante');
    }
};

// PUT /catalogo/variantes/:id { nombre?, estado?, moldes?, tizada?, tizadaNombre?, erp?, responsableId?, fecha?, nota? }
exports.editarVariante = async (req, res) => {
    const id = idNum(req.params.id);
    const b = req.body || {};
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const v = (await leerVariantes(pool, id))[0];
        if (!v) return res.status(404).json({ success: false, error: 'Esa variante ya no existe.' });
        const sets = [];
        const cambios = [];
        const r = pool.request().input('Id', sql.Int, id);
        const lista = (campo, col, valores) => {
            if (b[campo] === undefined) return null;
            const val = String(b[campo] || '').toUpperCase();
            if (!valores[val]) return 'Valor inválido.';
            if (val !== v[campo]) { sets.push(`${col} = @${col}`); r.input(col, sql.VarChar(14), val); cambios.push(`${campo === 'estado' ? 'estado' : campo === 'moldes' ? 'moldes' : campo === 'tizada' ? 'TizadaPro' : 'ERP'}: ${valores[val]}`); }
            return null;
        };
        const err = lista('estado', 'Estado', V_ESTADO) || lista('moldes', 'Moldes', V_MOLDES) || lista('tizada', 'Tizada', V_TIZADA) || lista('erp', 'Erp', V_ERP);
        if (err) return res.status(400).json({ success: false, error: err });
        if (b.nombre !== undefined) {
            const n = texto(b.nombre, 120);
            if (n && n !== v.nombre) { sets.push('Nombre = @Nombre'); r.input('Nombre', sql.NVarChar(120), n); cambios.push(`nombre: ${n}`); } // vacío: queda el de antes
        }
        if (b.tizadaNombre !== undefined) {
            const n = texto(b.tizadaNombre, 80);
            if ((n || null) !== (v.tizadaNombre || null)) { sets.push('TizadaNombre = @TizadaNombre'); r.input('TizadaNombre', sql.NVarChar(80), n); cambios.push(`nombre en TizadaPro: ${n || '—'}`); }
        }
        if (b.nota !== undefined) {
            const n = texto(b.nota, 300);
            if ((n || null) !== (v.nota || null)) { sets.push('Nota = @Nota'); r.input('Nota', sql.NVarChar(300), n); cambios.push('nota'); }
        }
        if (b.fecha !== undefined) {
            const f = fechaISO(b.fecha);
            if (f !== (v.fecha || null)) { sets.push('Fecha = CONVERT(DATE, @Fecha, 23)'); r.input('Fecha', sql.VarChar(10), f); cambios.push(`fecha: ${fmtD(f) || '—'}`); }
        }
        if (b.responsableId !== undefined) {
            const u = idNum(b.responsableId);
            if (u !== (v.responsableId || null)) {
                const nom = u ? (await pool.request().input('U', sql.Int, u).query("SELECT COALESCE(NULLIF(LTRIM(RTRIM(Nombre)), ''), Usuario) AS n FROM dbo.Usuarios WHERE IdUsuario = @U")).recordset[0]?.n : null;
                if (u && !nom) return res.status(400).json({ success: false, error: 'Esa persona no existe.' });
                sets.push('ResponsableUsuarioID = @Resp, ResponsableTexto = NULL'); r.input('Resp', sql.Int, u); cambios.push(`responsable: ${nom || 'sin asignar'}`);
            }
        }
        if (sets.length) {
            await r.query(`UPDATE dbo.DesVariantes SET ${sets.join(', ')}, FechaActualizado = GETDATE() WHERE VarianteID = @Id`);
            await bitacora(pool, { entidad: 'PROYECTO', entidadId: v.proyectoId, accion: 'Variantes', detalle: `«${v.nombre}»: ${cambios.join(' · ')}`, usuario });
            emitir(req, { entidad: 'PROYECTO', id: v.proyectoId });
        }
        res.json({ success: true, data: (await leerVariantes(pool, id))[0] });
    } catch (err) { responderError(res, err, 'editar variante'); }
};

// DELETE /catalogo/variantes/:id → queda marcada borrada
exports.borrarVariante = async (req, res) => {
    const id = idNum(req.params.id);
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const v = (await leerVariantes(pool, id))[0];
        if (!v) return res.status(404).json({ success: false, error: 'Esa variante ya no existe.' });
        await pool.request().input('Id', sql.Int, id).query('UPDATE dbo.DesVariantes SET Borrado = 1, FechaActualizado = GETDATE() WHERE VarianteID = @Id');
        await bitacora(pool, { entidad: 'PROYECTO', entidadId: v.proyectoId, accion: 'Variantes', detalle: `borró la variante «${v.nombre}»`, usuario });
        emitir(req, { entidad: 'PROYECTO', id: v.proyectoId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'borrar variante'); }
};

// PUT /catalogo/variantes/:id/tareas/:tareaId { hecho } → como una tarea de proyecto: al hacerla, la siguiente
// pendiente pasa a «en curso». Después: sin pendientes → la variante queda Lista; si era Propuesta → En desarrollo.
exports.tareaVariante = async (req, res) => {
    const id = idNum(req.params.id);
    const tareaId = idNum(req.params.tareaId);
    const hecho = !!req.body?.hecho;
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const v = (await leerVariantes(pool, id))[0];
        const t = v?.tareas.find(x => x.id === tareaId);
        if (!v || !t) return res.status(404).json({ success: false, error: 'Esa tarea ya no existe.' });
        tx = new sql.Transaction(pool);
        await tx.begin();
        if (hecho) {
            await tx.request().input('T', sql.Int, tareaId).query("UPDATE dbo.DesVarianteTareas SET Estado = 'HECHO', HechoEl = ISNULL(HechoEl, GETDATE()) WHERE VarTareaID = @T");
            const i = v.tareas.findIndex(x => x.id === tareaId);
            const sig = v.tareas.slice(i + 1).find(x => x.estado !== 'HECHO' && x.estado !== 'NO_APLICA');
            if (sig?.estado === 'PENDIENTE') await tx.request().input('T', sql.Int, sig.id).query("UPDATE dbo.DesVarianteTareas SET Estado = 'EN_CURSO' WHERE VarTareaID = @T");
        } else {
            await tx.request().input('T', sql.Int, tareaId).query("UPDATE dbo.DesVarianteTareas SET Estado = 'PENDIENTE', HechoEl = NULL WHERE VarTareaID = @T");
        }
        const quedan = (await tx.request().input('V', sql.Int, id).query("SELECT COUNT(*) AS n FROM dbo.DesVarianteTareas WHERE VarianteID = @V AND Estado NOT IN ('HECHO', 'NO_APLICA')")).recordset[0].n;
        const estado = !quedan && v.estado !== 'LISTA' ? 'LISTA' : (v.estado === 'PROPUESTA' ? 'EN_DESARROLLO' : v.estado);
        if (estado !== v.estado) await tx.request().input('V', sql.Int, id).input('E', sql.VarChar(14), estado).query('UPDATE dbo.DesVariantes SET Estado = @E, FechaActualizado = GETDATE() WHERE VarianteID = @V');
        await bitacora(tx, {
            entidad: 'PROYECTO', entidadId: v.proyectoId, accion: hecho ? 'Completó' : 'Editó',
            detalle: `${t.nombre} (variante «${v.nombre}»)${hecho ? '' : ': pendiente'}${estado !== v.estado ? ` · la variante pasó a ${V_ESTADO[estado]}` : ''}`, usuario,
        });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'PROYECTO', id: v.proyectoId });
        res.json({ success: true, data: (await leerVariantes(pool, id))[0] });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos tarea de variante');
        responderError(res, err, 'tarea de variante');
    }
};

// ── Opciones de slot ────────────────────────────────────────────────────────
// PUT /catalogo/opciones/:id { estado?, habilitada?, nota? } (no hay alta ni baja: vienen de la importación)
exports.editarOpcion = async (req, res) => {
    const id = idNum(req.params.id);
    const b = req.body || {};
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'cambiar el catálogo')) return;
        const usuario = await usuarioActual(pool, req);
        const o = (await pool.request().input('Id', sql.Int, id).query('SELECT Clave, Estado, Habilitada, Nota, Codigo, SlotNombre, Slot FROM dbo.DesOpcionesSlot WHERE OpcionID = @Id')).recordset[0];
        if (!o) return res.status(404).json({ success: false, error: 'Esa opción ya no existe.' });
        const sets = [];
        const cambios = [];
        const r = pool.request().input('Id', sql.Int, id);
        if (b.estado !== undefined) {
            const e = String(b.estado || '').toUpperCase();
            if (!O_ESTADO.includes(e)) return res.status(400).json({ success: false, error: 'Estado inválido.' });
            if (e !== o.Estado) { sets.push('Estado = @E'); r.input('E', sql.VarChar(10), e); cambios.push(`estado: ${e.toLowerCase()}`); }
        }
        if (b.habilitada !== undefined && !!b.habilitada !== !!o.Habilitada) { sets.push('Habilitada = @H'); r.input('H', sql.Bit, !!b.habilitada); cambios.push(b.habilitada ? 'habilitada' : 'no habilitada'); }
        if (b.nota !== undefined) {
            const n = texto(b.nota, 200);
            if ((n || null) !== (o.Nota || null)) { sets.push('Nota = @N'); r.input('N', sql.NVarChar(200), n); cambios.push('nota'); }
        }
        if (sets.length) {
            await r.query(`UPDATE dbo.DesOpcionesSlot SET ${sets.join(', ')}, FechaActualizado = GETDATE() WHERE OpcionID = @Id`);
            await bitacora(pool, { entidad: 'OPCION', entidadId: id, accion: 'Editó', detalle: `${o.SlotNombre || o.Slot} ${o.Codigo}: ${cambios.join(' · ')}`, usuario });
            emitir(req, { entidad: 'CATALOGO' });
        }
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'editar opción'); }
};
