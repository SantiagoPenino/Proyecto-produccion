// Servicio Técnico → Locales (20/10/2026). Primera parte: plantas de cada local, a qué planta va cada máquina y
// la energía del local (potencia contratada con UTE y tarifa). Las cuentas de consumo y costo las hace la pantalla
// (src/components/servicio-tecnico/consumoLocal.js) con lo que devuelve GET /locales: así un "¿y si agrego esta
// máquina?" se calcula sin ir al servidor. Segunda parte: el plano de cada planta (ST_LocalPlantas.Contorno, un JSON
// que arma y entiende src/components/servicio-tecnico/planoLocal.js: paredes, puertas, columnas y dónde va cada máquina).
// Tablas: docs/servicio-tecnico/st-locales-energia.sql. Lo que se carga (energía, plantas, ubicación): técnicos y Admin.
const { getPool, sql } = require('../config/db');
const { idNum, texto, responderError, exigirTecnico, esTecnico, usuarioActual } = require('../services/servicioTecnicoComun');

const TIPOS_TARIFA = ['SIMPLE', 'DOBLE', 'TRIPLE'];
const MONEDAS = ['UYU', 'USD'];
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// ¿Está corrido el script? Se guarda en memoria cuando sí; si no, se vuelve a mirar en el próximo pedido.
let esquemaListo = false;
async function exigirEsquema(pool, res) {
    if (esquemaListo) return true;
    const r = await pool.request().query(`
        SELECT CASE WHEN OBJECT_ID('dbo.ST_LocalPlantas') IS NULL OR OBJECT_ID('dbo.ST_LocalEnergia') IS NULL
                         OR COL_LENGTH('dbo.ST_FichaEquipo', 'PlantaId') IS NULL THEN 0 ELSE 1 END AS ok`);
    if (r.recordset[0].ok) { esquemaListo = true; return true; }
    res.status(503).json({ success: false, error: 'Falta correr docs/servicio-tecnico/st-locales-energia.sql en la base.' });
    return false;
}

const leerJSON = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (_) { return {}; } };

// Número opcional ≥ 0 (acepta coma decimal). undefined = no vino; null = vacío; NaN = inválido.
const numOpcional = (v) => {
    if (v === undefined) return undefined;
    if (v === null || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
};

// GET /locales → locales con sus plantas y su energía, las máquinas activas con su ubicación y los datos de la ficha
// que hacen falta para las cuentas (dimensiones, consumo eléctrico, aire y extracción) y el horario de cada área.
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        const [loc, pla, ene, eq, hor] = await Promise.all([
            pool.request().query('SELECT Id, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.Locales ORDER BY Id'),
            pool.request().query(`SELECT PlantaId, LocalId, Nombre, Orden, CargaMaxKgM2, Contorno
                                  FROM dbo.ST_LocalPlantas WHERE Activa = 1 ORDER BY LocalId, Orden, PlantaId`),
            pool.request().query('SELECT * FROM dbo.ST_LocalEnergia'),
            pool.request().query(`
                SELECT e.EquipoID, LTRIM(RTRIM(e.Nombre)) AS Nombre, LTRIM(RTRIM(e.AreaID)) AS AreaID, a.Nombre AS AreaNombre, e.Estado,
                       f.Tipo, f.LocalId, f.LocalOtro, f.PlantaId, f.Datos
                FROM dbo.ConfigEquipos e
                LEFT JOIN dbo.Areas a ON a.AreaID = e.AreaID
                LEFT JOIN dbo.ST_FichaEquipo f ON f.EquipoId = e.EquipoID
                WHERE e.Activo = 1
                ORDER BY LTRIM(RTRIM(e.AreaID)), LTRIM(RTRIM(e.Nombre))`),
            pool.request().query(`
                SELECT LTRIM(RTRIM(AreaID)) AS AreaID, DiaSemana, CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio,
                       CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
                FROM dbo.ConfigHorarioLaboral WHERE Activo = 1`),
        ]);
        const plantaLocal = new Map(pla.recordset.map(p => [p.PlantaId, p.LocalId]));
        const horarios = {};
        for (const h of hor.recordset) (horarios[h.AreaID] = horarios[h.AreaID] || []).push({ DiaSemana: h.DiaSemana, HoraInicio: h.HoraInicio, HoraFin: h.HoraFin });
        res.json({
            success: true,
            data: {
                locales: loc.recordset,
                plantas: pla.recordset.map(({ Contorno, ...p }) => ({
                    ...p, CargaMaxKgM2: p.CargaMaxKgM2 == null ? null : Number(p.CargaMaxKgM2),
                    Plano: Contorno ? leerJSON(Contorno) : null,
                })),
                energia: ene.recordset.map(x => ({
                    ...x,
                    PotenciaContratadaKW: x.PotenciaContratadaKW == null ? null : Number(x.PotenciaContratadaKW),
                    PrecioSimple: x.PrecioSimple == null ? null : Number(x.PrecioSimple),
                    PrecioPunta: x.PrecioPunta == null ? null : Number(x.PrecioPunta),
                    PrecioLlano: x.PrecioLlano == null ? null : Number(x.PrecioLlano),
                    PrecioValle: x.PrecioValle == null ? null : Number(x.PrecioValle),
                    CargoPotenciaKW: x.CargoPotenciaKW == null ? null : Number(x.CargoPotenciaKW),
                    PuntaSoloHabiles: !!x.PuntaSoloHabiles,
                })),
                equipos: eq.recordset.map(({ Datos, PlantaId, ...m }) => {
                    const d = leerJSON(Datos);
                    // Una planta de otro local (la ficha cambió el local después) cuenta como "sin planta".
                    const planta = PlantaId && plantaLocal.get(PlantaId) === m.LocalId ? PlantaId : null;
                    return { ...m, PlantaId: planta, ficha: { dim: d.dim || {}, ele: d.ele || {}, ins: d.ins || {} } };
                }),
                horarios,
                puedeEditar: esTecnico(req),
            },
        });
    } catch (err) { responderError(res, err, 'locales.listar'); }
};

// PUT /locales/:id/energia → técnicos. Potencia contratada y tarifa del local (los campos que no vienen no cambian).
exports.guardarEnergia = async (req, res) => {
    try {
        if (!exigirTecnico(req, res, 'cargar la energía de un local')) return;
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        const localId = idNum(req.params.id);
        const b = req.body || {};
        const loc = await pool.request().input('L', sql.Int, localId).query('SELECT Id FROM dbo.Locales WHERE Id = @L');
        if (!loc.recordset.length) return res.status(404).json({ success: false, error: 'Ese local no existe.' });

        const tipo = b.TipoTarifa === undefined ? undefined : String(b.TipoTarifa || '').toUpperCase();
        if (tipo !== undefined && !TIPOS_TARIFA.includes(tipo)) return res.status(400).json({ success: false, error: 'La tarifa tiene que ser simple, doble o triple.' });
        const moneda = b.Moneda === undefined ? undefined : String(b.Moneda || '').toUpperCase();
        if (moneda !== undefined && !MONEDAS.includes(moneda)) return res.status(400).json({ success: false, error: 'La moneda tiene que ser UYU o USD.' });
        const nums = {};
        for (const k of ['PotenciaContratadaKW', 'PrecioSimple', 'PrecioPunta', 'PrecioLlano', 'PrecioValle', 'CargoPotenciaKW']) {
            nums[k] = numOpcional(b[k]);
            if (Number.isNaN(nums[k])) return res.status(400).json({ success: false, error: `«${k}» tiene que ser un número mayor o igual a 0.` });
        }
        const horas = {};
        for (const k of ['PuntaDesde', 'PuntaHasta', 'ValleDesde', 'ValleHasta']) {
            if (b[k] === undefined) { horas[k] = undefined; continue; }
            const v = String(b[k] || '').trim();
            if (v && !RE_HORA.test(v)) return res.status(400).json({ success: false, error: `«${k}» tiene que ser una hora (HH:MM).` });
            horas[k] = v || null;
        }

        const u = await usuarioActual(pool, req);
        const campos = { TipoTarifa: tipo, Moneda: moneda, ...nums, ...horas,
                         PuntaSoloHabiles: b.PuntaSoloHabiles === undefined ? undefined : !!b.PuntaSoloHabiles };
        const tipos = {
            TipoTarifa: sql.VarChar(10), Moneda: sql.VarChar(3), PotenciaContratadaKW: sql.Decimal(9, 2), PrecioSimple: sql.Decimal(10, 4),
            PrecioPunta: sql.Decimal(10, 4), PrecioLlano: sql.Decimal(10, 4), PrecioValle: sql.Decimal(10, 4), CargoPotenciaKW: sql.Decimal(10, 2),
            PuntaDesde: sql.VarChar(5), PuntaHasta: sql.VarChar(5), ValleDesde: sql.VarChar(5), ValleHasta: sql.VarChar(5), PuntaSoloHabiles: sql.Bit,
        };
        const vienen = Object.keys(campos).filter(k => campos[k] !== undefined);
        const rq = pool.request().input('L', sql.Int, localId).input('UN', sql.NVarChar(100), u.nombre);
        vienen.forEach(k => rq.input(k, tipos[k], campos[k]));
        const sets = vienen.map(k => `${k} = @${k}`);
        await rq.query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.ST_LocalEnergia WHERE LocalId = @L) INSERT INTO dbo.ST_LocalEnergia (LocalId) VALUES (@L);
            UPDATE dbo.ST_LocalEnergia SET ${[...sets, 'FechaModif = GETDATE()', 'UsuarioNombre = @UN'].join(', ')} WHERE LocalId = @L;`);
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'locales.guardarEnergia'); }
};

// POST /locales/:id/plantas → técnicos. { nombre } — va al final.
exports.crearPlanta = async (req, res) => {
    try {
        if (!exigirTecnico(req, res, 'agregar plantas')) return;
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        const localId = idNum(req.params.id);
        const nombre = texto(req.body?.nombre, 60);
        if (!nombre) return res.status(400).json({ success: false, error: 'Falta el nombre de la planta.' });
        const loc = await pool.request().input('L', sql.Int, localId).query('SELECT Id FROM dbo.Locales WHERE Id = @L');
        if (!loc.recordset.length) return res.status(404).json({ success: false, error: 'Ese local no existe.' });
        const r = await pool.request().input('L', sql.Int, localId).input('N', sql.NVarChar(60), nombre).query(`
            INSERT INTO dbo.ST_LocalPlantas (LocalId, Nombre, Orden)
            OUTPUT INSERTED.PlantaId
            SELECT @L, @N, ISNULL(MAX(Orden), -1) + 1 FROM dbo.ST_LocalPlantas WHERE LocalId = @L AND Activa = 1`);
        res.json({ success: true, data: { PlantaId: r.recordset[0].PlantaId } });
    } catch (err) { responderError(res, err, 'locales.crearPlanta'); }
};

// PUT /plantas/:id → técnicos. { nombre?, cargaMaxKgM2? }
exports.editarPlanta = async (req, res) => {
    try {
        if (!exigirTecnico(req, res, 'editar plantas')) return;
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        const plantaId = idNum(req.params.id);
        const b = req.body || {};
        const sets = []; const rq = pool.request().input('P', sql.Int, plantaId);
        if (b.nombre !== undefined) {
            const n = texto(b.nombre, 60);
            if (!n) return res.status(400).json({ success: false, error: 'El nombre de la planta no puede quedar vacío.' });
            sets.push('Nombre = @N'); rq.input('N', sql.NVarChar(60), n);
        }
        if (b.cargaMaxKgM2 !== undefined) {
            const c = numOpcional(b.cargaMaxKgM2);
            if (Number.isNaN(c)) return res.status(400).json({ success: false, error: 'La carga del piso tiene que ser un número mayor o igual a 0.' });
            sets.push('CargaMaxKgM2 = @C'); rq.input('C', sql.Decimal(8, 1), c);
        }
        if (!sets.length) return res.json({ success: true });
        const r = await rq.query(`UPDATE dbo.ST_LocalPlantas SET ${sets.join(', ')}, FechaModif = GETDATE() WHERE PlantaId = @P AND Activa = 1`);
        if (!r.rowsAffected[0]) return res.status(404).json({ success: false, error: 'Esa planta no existe.' });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'locales.editarPlanta'); }
};

// PUT /plantas/:id/plano → técnicos. { plano (objeto, o null para borrarlo), version }. `version` es el `guardado` del
// plano que se abrió: si alguien lo guardó después, 409 y no se pisa. La forma la cuida la pantalla (planoLocal.js);
// acá solo se ponen topes para que no entre cualquier cosa.
const TOPES_PLANO = { puntos: 500, paredes: 500, interiores: 500, aberturas: 500, elementos: 500, maquinas: 1000, habitaciones: 500 };
exports.guardarPlano = async (req, res) => {
    try {
        if (!exigirTecnico(req, res, 'dibujar el plano')) return;
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        const plantaId = idNum(req.params.id);
        const b = req.body || {};
        const act = await pool.request().input('P', sql.Int, plantaId)
            .query('SELECT Contorno FROM dbo.ST_LocalPlantas WHERE PlantaId = @P AND Activa = 1');
        if (!act.recordset.length) return res.status(404).json({ success: false, error: 'Esa planta no existe.' });
        const antes = act.recordset[0].Contorno ? leerJSON(act.recordset[0].Contorno) : null;
        if ((b.version || null) !== (antes?.guardado || null)) {
            return res.status(409).json({ success: false, error: `${antes?.por || 'Alguien'} guardó este plano mientras lo editabas. Cerrá el editor y abrilo de nuevo para ver cómo quedó.` });
        }
        let plano = null;
        if (b.plano != null) {
            if (typeof b.plano !== 'object' || Array.isArray(b.plano)) return res.status(400).json({ success: false, error: 'El plano no tiene la forma esperada.' });
            for (const [k, max] of Object.entries(TOPES_PLANO)) {
                if (b.plano[k] !== undefined && (!Array.isArray(b.plano[k]) || b.plano[k].length > max)) {
                    return res.status(400).json({ success: false, error: `El plano no tiene la forma esperada («${k}»).` });
                }
            }
            const u = await usuarioActual(pool, req);
            plano = { ...b.plano, guardado: new Date().toISOString(), por: u.nombre };
        }
        const txt = plano ? JSON.stringify(plano) : null;
        if (txt && txt.length > 1000000) return res.status(400).json({ success: false, error: 'El plano es demasiado grande.' });
        await pool.request().input('P', sql.Int, plantaId).input('C', sql.NVarChar(sql.MAX), txt)
            .query('UPDATE dbo.ST_LocalPlantas SET Contorno = @C, FechaModif = GETDATE() WHERE PlantaId = @P');
        res.json({ success: true, data: { guardado: plano?.guardado || null } });
    } catch (err) { responderError(res, err, 'locales.guardarPlano'); }
};

// DELETE /plantas/:id → técnicos. Solo si no tiene máquinas.
exports.borrarPlanta = async (req, res) => {
    try {
        if (!exigirTecnico(req, res, 'borrar plantas')) return;
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        const plantaId = idNum(req.params.id);
        const usadas = await pool.request().input('P', sql.Int, plantaId)
            .query('SELECT COUNT(*) AS n FROM dbo.ST_FichaEquipo WHERE PlantaId = @P');
        if (usadas.recordset[0].n > 0) {
            return res.status(409).json({ success: false, error: `La planta tiene ${usadas.recordset[0].n} máquina(s): pasalas a otra planta antes de borrarla.` });
        }
        const r = await pool.request().input('P', sql.Int, plantaId).query('DELETE FROM dbo.ST_LocalPlantas WHERE PlantaId = @P');
        if (!r.rowsAffected[0]) return res.status(404).json({ success: false, error: 'Esa planta no existe.' });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'locales.borrarPlanta'); }
};

// PUT /equipos/:id/ubicacion → técnicos. { localId, plantaId } — null en los dos = sin local. Se guarda en la ficha
// técnica (LocalId ya existía; PlantaId es nuevo). Si la máquina no tenía ficha, se le crea la fila vacía.
exports.guardarUbicacion = async (req, res) => {
    const equipoId = idNum(req.params.id);
    const localId = req.body?.localId == null || req.body.localId === '' ? null : idNum(req.body.localId);
    const plantaId = req.body?.plantaId == null || req.body.plantaId === '' ? null : idNum(req.body.plantaId);
    try {
        if (!exigirTecnico(req, res, 'ubicar máquinas')) return;
        const pool = await getPool();
        if (!(await exigirEsquema(pool, res))) return;
        if (plantaId && !localId) return res.status(400).json({ success: false, error: 'Para elegir la planta hay que elegir el local.' });
        const eq = await pool.request().input('E', sql.Int, equipoId).query('SELECT EquipoID FROM dbo.ConfigEquipos WHERE EquipoID = @E');
        if (!eq.recordset.length) return res.status(404).json({ success: false, error: 'Esa máquina no existe.' });
        if (localId) {
            const loc = await pool.request().input('L', sql.Int, localId).query('SELECT Id FROM dbo.Locales WHERE Id = @L');
            if (!loc.recordset.length) return res.status(404).json({ success: false, error: 'Ese local no existe.' });
        }
        if (plantaId) {
            const pl = await pool.request().input('P', sql.Int, plantaId).query('SELECT LocalId FROM dbo.ST_LocalPlantas WHERE PlantaId = @P AND Activa = 1');
            if (!pl.recordset.length || pl.recordset[0].LocalId !== localId) return res.status(400).json({ success: false, error: 'Esa planta no es de ese local.' });
        }
        const u = await usuarioActual(pool, req);
        await pool.request()
            .input('E', sql.Int, equipoId).input('L', sql.Int, localId).input('P', sql.Int, plantaId)
            .input('U', sql.Int, u.id).input('UN', sql.NVarChar(150), u.nombre)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.ST_FichaEquipo WHERE EquipoId = @E)
                    UPDATE dbo.ST_FichaEquipo
                    SET LocalId = @L, PlantaId = @P,
                        -- "Especifique" solo vale para el local "otro"
                        LocalOtro = CASE WHEN @L IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Locales WHERE Id = @L AND LOWER(LTRIM(RTRIM(Nombre))) = 'otro') THEN LocalOtro END,
                        FechaModif = GETDATE(), UsuarioId = @U, UsuarioNombre = @UN
                    WHERE EquipoId = @E;
                ELSE
                    INSERT INTO dbo.ST_FichaEquipo (EquipoId, LocalId, PlantaId, Datos, UsuarioId, UsuarioNombre)
                    VALUES (@E, @L, @P, '{}', @U, @UN);`);
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'locales.guardarUbicacion'); }
};
