// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — ficha técnica de máquinas (08/10).
// Plan: docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md · script: docs/servicio-tecnico/st-ficha-tecnica.sql
//
// ST_FichaEquipo: una fila por máquina. Tipo, marca, modelo, serie, año y local en columnas; el resto en
// Datos (JSON), un objeto por sección: { dim: {...}, ele: {...}, imp: { ..., posiciones: [...] }, ... }.
// Qué secciones y campos tiene cada tipo lo define el front (servicio-tecnico/fichaTecnicaCampos.js);
// acá se guarda lo que llega, validado como objeto.
//
// La CAPACIDAD (cabezales, velocidad, unidad y preparación, estándar y real) sigue en ConfigEquipos
// porque la lee Planificación (velocidad × cabezales). Desde el 08/10 se edita solo acá: Configuración →
// Equipos la muestra sin poder cambiarla. Leer: cualquier usuario interno; guardar: técnicos o Admin.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { texto, idNum, numero, responderError, exigirTecnico, emitirST, usuarioActual, historial } = require('../services/servicioTecnicoComun');

const TIPOS = ['IMPRESORA', 'CALANDRA', 'BORDADORA', 'LASER', 'CORTE', 'COSTURA', 'OTRA'];
const ETIQUETA_TIPO_MAQUINA = {
    IMPRESORA: 'Impresora', CALANDRA: 'Calandra / prensa térmica', BORDADORA: 'Bordadora', LASER: 'Corte láser',
    CORTE: 'Corte', COSTURA: 'Máquina de coser', OTRA: 'Otra',
};
const MAX_DATOS = 200000; // caracteres del JSON entero

// ¿Qué tablas hay? La ficha, los locales (st-locales.sql) y el catálogo de costura de Configurar Productos.
// Se guarda en memoria cuando ya está todo; si falta algo se vuelve a mirar (es una consulta mínima).
let tablasListas = null;
async function tablas(pool) {
    if (tablasListas) return tablasListas;
    const r = await pool.request().query(`
        SELECT CASE WHEN OBJECT_ID('dbo.ST_FichaEquipo') IS NULL THEN 0 ELSE 1 END AS ficha,
               CASE WHEN OBJECT_ID('dbo.ST_EquipoRepuestos') IS NULL THEN 0 ELSE 1 END AS repuestos,
               CASE WHEN OBJECT_ID('dbo.Locales') IS NULL THEN 0 ELSE 1 END AS locales,
               CASE WHEN OBJECT_ID('dbo.MaquinasCostura') IS NULL THEN 0 ELSE 1 END AS maquinasCostura,
               CASE WHEN COL_LENGTH('dbo.CosturasISO', 'MaquinaCosturaID') IS NULL THEN 0 ELSE 1 END AS costurasISO`);
    const x = r.recordset[0];
    const t = { ficha: !!x.ficha, repuestos: !!x.repuestos, locales: !!x.locales, maquinasCostura: !!x.maquinasCostura, costurasISO: !!x.costurasISO };
    if (Object.values(t).every(Boolean)) tablasListas = t;
    return t;
}

const esObjeto = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const leerDatos = (s) => { try { const o = JSON.parse(s || '{}'); return esObjeto(o) ? o : {}; } catch (_) { return {}; } };

// Ficha técnica de una máquina + catálogos que usa el formulario (para stEquiposController.ficha).
async function leerFichaTecnica(pool, equipoId, areaId) {
    const t = await tablas(pool);
    const [fila, unidades, unidadesArea, maqCostura, costuras] = await Promise.all([
        t.ficha ? pool.request().input('E', sql.Int, equipoId).query(`
            SELECT f.Tipo, f.Marca, f.Modelo, f.Serie, f.Anio, f.LocalId, f.LocalOtro, f.Datos, f.FechaModif, f.UsuarioNombre
                   ${t.locales ? ', LTRIM(RTRIM(l.Nombre)) AS LocalNombre' : ', NULL AS LocalNombre'}
            FROM dbo.ST_FichaEquipo f ${t.locales ? 'LEFT JOIN dbo.Locales l ON l.Id = f.LocalId' : ''}
            WHERE f.EquipoId = @E`) : null,
        pool.request().query(`SELECT DISTINCT LTRIM(RTRIM(VelocidadUnidad)) AS U FROM dbo.ConfigEquipos WHERE NULLIF(LTRIM(RTRIM(VelocidadUnidad)), '') IS NOT NULL`),
        // Planificación suma las velocidades de las máquinas activas del área: tienen que tener la misma unidad.
        pool.request().input('E', sql.Int, equipoId).input('A', sql.VarChar(20), areaId || '').query(`
            SELECT DISTINCT LTRIM(RTRIM(VelocidadUnidad)) AS U FROM dbo.ConfigEquipos
            WHERE LTRIM(RTRIM(AreaID)) = @A AND Activo = 1 AND EquipoID <> @E AND VelocidadValor IS NOT NULL AND NULLIF(LTRIM(RTRIM(VelocidadUnidad)), '') IS NOT NULL`),
        t.maquinasCostura ? pool.request().query(`SELECT MaquinaCosturaID AS Id, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.MaquinasCostura WHERE Activo = 1 ORDER BY Orden, Nombre`) : null,
        t.costurasISO ? pool.request().query(`SELECT MaquinaCosturaID AS MaqId, CodigoISO, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.CosturasISO WHERE Activo = 1 AND MaquinaCosturaID IS NOT NULL ORDER BY CodigoISO`) : null,
    ]);
    const f = fila?.recordset[0];
    return {
        fichaTecnica: {
            disponible: t.ficha,
            Tipo: f?.Tipo || null, Marca: f?.Marca || '', Modelo: f?.Modelo || '', Serie: f?.Serie || '', Anio: f?.Anio ?? null,
            LocalId: f?.LocalId ?? null, LocalOtro: f?.LocalOtro || '', LocalNombre: f?.LocalNombre || null,
            Datos: leerDatos(f?.Datos), FechaModif: f?.FechaModif || null, UsuarioNombre: f?.UsuarioNombre || null,
        },
        catalogos: {
            unidades: unidades.recordset.map(u => u.U),
            unidadesArea: unidadesArea.recordset.map(u => u.U),
            maquinasCostura: maqCostura ? maqCostura.recordset : [],
            costurasISO: costuras ? costuras.recordset : [],
        },
    };
}

// Lee la fila de la ficha dentro de la transacción (bloqueada hasta el commit). null si no hay.
async function filaEnTx(tx, equipoId) {
    const r = await tx.request().input('E', sql.Int, equipoId).query(`
        SELECT Tipo, Marca, Modelo, Serie, Anio, LocalId, LocalOtro, Datos FROM dbo.ST_FichaEquipo WITH (UPDLOCK, HOLDLOCK) WHERE EquipoId = @E`);
    return r.recordset[0] || null;
}

async function escribirFila(tx, equipoId, existe, f, usuario) {
    const datos = JSON.stringify(f.Datos || {});
    if (datos.length > MAX_DATOS) { const e = new Error('La ficha es demasiado grande.'); e.status = 400; throw e; }
    await tx.request()
        .input('E', sql.Int, equipoId).input('T', sql.VarChar(20), f.Tipo).input('Ma', sql.NVarChar(100), f.Marca)
        .input('Mo', sql.NVarChar(100), f.Modelo).input('S', sql.NVarChar(100), f.Serie).input('A', sql.SmallInt, f.Anio)
        .input('L', sql.Int, f.LocalId).input('LO', sql.NVarChar(150), f.LocalOtro).input('D', sql.NVarChar(sql.MAX), datos)
        .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
        .query(existe
            ? `UPDATE dbo.ST_FichaEquipo SET Tipo = @T, Marca = @Ma, Modelo = @Mo, Serie = @S, Anio = @A, LocalId = @L, LocalOtro = @LO,
                      Datos = @D, FechaModif = GETDATE(), UsuarioId = @U, UsuarioNombre = @UN WHERE EquipoId = @E`
            : `INSERT INTO dbo.ST_FichaEquipo (EquipoId, Tipo, Marca, Modelo, Serie, Anio, LocalId, LocalOtro, Datos, UsuarioId, UsuarioNombre)
               VALUES (@E, @T, @Ma, @Mo, @S, @A, @L, @LO, @D, @U, @UN)`);
}

const filaVacia = () => ({ Tipo: null, Marca: null, Modelo: null, Serie: null, Anio: null, LocalId: null, LocalOtro: null, Datos: {} });
const deFila = (r) => (r ? { ...r, Datos: leerDatos(r.Datos) } : filaVacia());

// Valida la sección Identificación (va a columnas). Devuelve { campos } o { error }.
async function leerIdentificacion(pool, v, t) {
    const tipo = v.tipo ? String(v.tipo).toUpperCase() : null;
    if (tipo && !TIPOS.includes(tipo)) return { error: 'Tipo de máquina inválido.' };
    let anio = null;
    if (v.anio !== undefined && v.anio !== null && String(v.anio).trim() !== '') {
        anio = parseInt(v.anio, 10);
        if (!Number.isInteger(anio) || anio < 1950 || anio > 2100) return { error: 'Año de fabricación inválido.' };
    }
    let localId = null; let localOtro = null;
    if (v.localId) {
        localId = idNum(v.localId);
        if (!localId || !t.locales) return { error: 'Local inválido.' };
        const l = await pool.request().input('L', sql.Int, localId).query('SELECT LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.Locales WHERE Id = @L');
        if (!l.recordset.length) return { error: 'Local inválido.' };
        if (l.recordset[0].Nombre.toLowerCase() === 'otro') {
            localOtro = texto(v.localOtro, 150);
            if (!localOtro) return { error: 'Especificá el local.' };
        }
    }
    return {
        campos: {
            Tipo: tipo, Marca: texto(v.marca, 100), Modelo: texto(v.modelo, 100), Serie: texto(v.serie, 100), Anio: anio,
            LocalId: localId, LocalOtro: localOtro,
        },
        ubicacion: texto(v.ubicacion, 300),
    };
}

// Lo que es de CADA máquina y no se copia a otra (tiene que coincidir con fichaTecnicaCampos.js):
// campos sueltos por sección y, en las tablas (cabezales, herramientas), n.º de serie, fecha y estado.
const PROPIOS = { ident: ['ubicacion'], sw: ['ip', 'licencia'], gar: ['fechaInstalacion', 'factura'], las: ['fechaTubo'], cal: ['cambioManta'] };
function limpiarCopia(datos) {
    const d = JSON.parse(JSON.stringify(datos || {}));
    Object.entries(PROPIOS).forEach(([sec, campos]) => { if (esObjeto(d[sec])) campos.forEach(c => { delete d[sec][c]; }); });
    Object.values(d).forEach(sec => {
        if (!esObjeto(sec)) return;
        Object.values(sec).forEach(v => {
            if (!Array.isArray(v)) return;
            v.forEach(fila => {
                if (!esObjeto(fila)) return;
                if ('serie' in fila) fila.serie = '';
                if ('fecha' in fila) fila.fecha = '';
                if ('estado' in fila) fila.estado = 'Operativo';
            });
        });
    });
    return d;
}

// PUT /equipos/:id/ficha → técnicos.
//   { seccion, titulo, valores, resumen: ['Firmware: 1.08 → 1.10', ...] }: guarda UNA sección (las demás no se tocan,
//     así dos técnicos pueden editar secciones distintas a la vez). seccion 'ident' va a las columnas.
//   { copiarDe: equipoId }: reemplaza la ficha entera por la de otra máquina, sin lo propio de cada una.
exports.guardarFicha = async (req, res) => {
    const equipoId = idNum(req.params.id);
    if (!exigirTecnico(req, res, 'editar la ficha técnica')) return;
    if (!equipoId) return res.status(400).json({ success: false, error: 'Máquina inválida.' });
    const b = req.body || {};
    try {
        const pool = await getPool();
        const t = await tablas(pool);
        if (!t.ficha) return res.status(503).json({ success: false, error: 'Falta correr docs/servicio-tecnico/st-ficha-tecnica.sql en la base.' });
        const eq = await pool.request().input('E', sql.Int, equipoId).query('SELECT LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.ConfigEquipos WHERE EquipoID = @E');
        if (!eq.recordset.length) return res.status(404).json({ success: false, error: 'No existe la máquina.' });
        const usuario = await usuarioActual(pool, req);

        // Copiar de otra máquina
        if (b.copiarDe !== undefined) {
            const origenId = idNum(b.copiarDe);
            if (!origenId || origenId === equipoId) return res.status(400).json({ success: false, error: 'Elegí otra máquina para copiar.' });
            const o = await pool.request().input('E', sql.Int, origenId).query(`
                SELECT f.Tipo, f.Marca, f.Modelo, f.Anio, f.LocalId, f.LocalOtro, f.Datos, LTRIM(RTRIM(e.Nombre)) AS Nombre
                FROM dbo.ST_FichaEquipo f JOIN dbo.ConfigEquipos e ON e.EquipoID = f.EquipoId WHERE f.EquipoId = @E`);
            if (!o.recordset.length) return res.status(400).json({ success: false, error: 'Esa máquina no tiene ficha técnica.' });
            const og = o.recordset[0];
            const tx = new sql.Transaction(pool);
            await tx.begin();
            try {
                const actual = await filaEnTx(tx, equipoId);
                await escribirFila(tx, equipoId, !!actual, {
                    Tipo: og.Tipo, Marca: og.Marca, Modelo: og.Modelo, Serie: null, Anio: og.Anio, LocalId: og.LocalId, LocalOtro: og.LocalOtro,
                    Datos: limpiarCopia(leerDatos(og.Datos)),
                }, usuario);
                await historial(tx, { entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'FICHA', detalle: `Ficha técnica copiada de ${og.Nombre}` });
                await tx.commit();
            } catch (e) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } throw e; }
            emitirST(req, { equipoId });
            logger.info(`[ServicioTecnico] Ficha de la máquina ${equipoId} copiada de ${origenId} por ${usuario.nombre}`);
            return res.json({ success: true });
        }

        // Una sección
        const seccion = String(b.seccion || '');
        if (!/^[a-z]{2,10}$/.test(seccion)) return res.status(400).json({ success: false, error: 'Sección inválida.' });
        if (!esObjeto(b.valores)) return res.status(400).json({ success: false, error: 'Faltan los datos de la sección.' });
        let ident = null;
        if (seccion === 'ident') {
            ident = await leerIdentificacion(pool, b.valores, t);
            if (ident.error) return res.status(400).json({ success: false, error: ident.error });
        }
        const resumen = (Array.isArray(b.resumen) ? b.resumen : []).map(s => texto(s, 400)).filter(Boolean).slice(0, 40);
        const titulo = texto(b.titulo, 80) || seccion;

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const actual = await filaEnTx(tx, equipoId);
            const f = deFila(actual);
            if (ident) {
                Object.assign(f, ident.campos);
                f.Datos.ident = { ...(esObjeto(f.Datos.ident) ? f.Datos.ident : {}), ubicacion: ident.ubicacion };
            } else {
                f.Datos[seccion] = b.valores;
            }
            await escribirFila(tx, equipoId, !!actual, f, usuario);
            await historial(tx, {
                entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'FICHA',
                detalle: `${titulo}${resumen.length ? `: ${resumen.join(' · ')}` : ''}`.slice(0, 4000),
            });
            await tx.commit();
        } catch (e) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } throw e; }
        emitirST(req, { equipoId });
        res.json({ success: true });
    } catch (err) {
        if (err.status === 400) return res.status(400).json({ success: false, error: err.message });
        responderError(res, err, 'ficha.guardar');
    }
};

// Capacidad (ConfigEquipos) — mismas columnas que antes editaba Configuración → Equipos.
const CAMPOS_CAPACIDAD = [
    // [clave del body, columna, etiqueta, tipo]
    ['cabezales', 'Cabezales', 'Cabezales / estaciones', 'int'],
    ['velocidadValor', 'VelocidadValor', 'Velocidad', 'dec'],
    ['velocidadUnidad', 'VelocidadUnidad', 'Unidad', 'txt'],
    ['minutosPreparacion', 'MinutosPreparacion', 'Preparación (min)', 'int'],
    ['cabezalesReal', 'CabezalesReal', 'Cabezales funcionando', 'int'],
    ['velocidadValorReal', 'VelocidadValorReal', 'Velocidad real', 'dec'],
    ['minutosPreparacionReal', 'MinutosPreparacionReal', 'Preparación real (min)', 'int'],
];
const EXTRAS_CAPACIDAD = [['horasTurno', 'Horas por turno'], ['condicion', 'Condición de medición']];
const mostrar = (v) => (v === null || v === undefined || String(v).trim() === '' ? '—' : String(v).trim());
// Valor de la base comparable con el que llegó (número, o texto sin espacios; vacío = null).
const comparable = (v, tipo) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    return tipo === 'txt' ? String(v).trim() : Number(v);
};

// PUT /equipos/:id/capacidad → técnicos. { cabezales, velocidadValor, velocidadUnidad, minutosPreparacion,
// cabezalesReal, velocidadValorReal, minutosPreparacionReal, extra: { horasTurno, condicion } }. Se mandan
// todos (vacío = sin dato). `extra` va a la ficha técnica (Datos.cap) si está el script.
exports.guardarCapacidad = async (req, res) => {
    const equipoId = idNum(req.params.id);
    if (!exigirTecnico(req, res, 'cambiar la capacidad de una máquina')) return;
    if (!equipoId) return res.status(400).json({ success: false, error: 'Máquina inválida.' });
    const b = req.body || {};
    const v = {};
    for (const [k, , etiqueta, tipo] of CAMPOS_CAPACIDAD) {
        const crudo = b[k];
        if (tipo === 'txt') { v[k] = texto(crudo, 30); continue; }
        const n = numero(crudo);
        if (crudo !== undefined && crudo !== null && String(crudo).trim() !== '' && n === null) return res.status(400).json({ success: false, error: `${etiqueta}: no es un número.` });
        if (n !== null && (n < 0 || (tipo === 'int' && !Number.isInteger(n)))) return res.status(400).json({ success: false, error: `${etiqueta}: tiene que ser ${tipo === 'int' ? 'un entero ' : ''}mayor o igual a 0.` });
        v[k] = n;
    }
    if (v.cabezales === 0) return res.status(400).json({ success: false, error: 'Cabezales / estaciones: dejalo vacío o poné 1 o más.' });
    if (v.cabezales != null && v.cabezalesReal != null && v.cabezalesReal > v.cabezales) return res.status(400).json({ success: false, error: 'No puede haber más cabezales funcionando que los que tiene.' });
    if ((v.velocidadValor != null || v.velocidadValorReal != null) && !v.velocidadUnidad) return res.status(400).json({ success: false, error: 'Elegí la unidad de la velocidad.' });
    if (v.velocidadValor === 0) return res.status(400).json({ success: false, error: 'Velocidad: tiene que ser mayor a 0 (o dejarla vacía).' });
    let extra = null;
    if (esObjeto(b.extra)) {
        const ht = numero(b.extra.horasTurno);
        if (ht !== null && (ht <= 0 || ht > 24)) return res.status(400).json({ success: false, error: 'Horas por turno: entre 0 y 24.' });
        extra = { horasTurno: ht === null ? '' : String(ht), condicion: texto(b.extra.condicion, 300) || '' };
    }
    try {
        const pool = await getPool();
        const t = await tablas(pool);
        const usuario = await usuarioActual(pool, req);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        let cambios = [];
        try {
            const r = await tx.request().input('E', sql.Int, equipoId).query(`
                SELECT ${CAMPOS_CAPACIDAD.map(([, col]) => col).join(', ')} FROM dbo.ConfigEquipos WITH (UPDLOCK, HOLDLOCK) WHERE EquipoID = @E`);
            if (!r.recordset.length) { await tx.rollback(); return res.status(404).json({ success: false, error: 'No existe la máquina.' }); }
            const antes = r.recordset[0];
            cambios = CAMPOS_CAPACIDAD
                .filter(([k, col, , tipo]) => comparable(antes[col], tipo) !== v[k])
                .map(([k, col, etiqueta]) => `${etiqueta}: ${mostrar(antes[col])} → ${mostrar(v[k])}`);
            await tx.request().input('E', sql.Int, equipoId)
                .input('Cabezales', sql.Int, v.cabezales).input('VelocidadValor', sql.Decimal(10, 2), v.velocidadValor)
                .input('VelocidadUnidad', sql.VarChar(30), v.velocidadUnidad).input('MinutosPreparacion', sql.Int, v.minutosPreparacion)
                .input('CabezalesReal', sql.Int, v.cabezalesReal).input('VelocidadValorReal', sql.Decimal(18, 2), v.velocidadValorReal)
                .input('MinutosPreparacionReal', sql.Int, v.minutosPreparacionReal)
                .query(`UPDATE dbo.ConfigEquipos SET ${CAMPOS_CAPACIDAD.map(([, col]) => `${col} = @${col}`).join(', ')} WHERE EquipoID = @E`);
            if (extra && t.ficha) {
                const actual = await filaEnTx(tx, equipoId);
                const f = deFila(actual);
                const previo = esObjeto(f.Datos.cap) ? f.Datos.cap : {};
                EXTRAS_CAPACIDAD.forEach(([k, etiqueta]) => {
                    if ((previo[k] || '') !== extra[k]) cambios.push(`${etiqueta}: ${mostrar(previo[k])} → ${mostrar(extra[k])}`);
                });
                if (EXTRAS_CAPACIDAD.some(([k]) => (previo[k] || '') !== extra[k])) {
                    f.Datos.cap = { ...previo, ...extra };
                    await escribirFila(tx, equipoId, !!actual, f, usuario);
                }
            }
            if (cambios.length) {
                await historial(tx, { entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'CAPACIDAD', detalle: cambios.join(' · ').slice(0, 4000) });
            }
            await tx.commit();
        } catch (e) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } throw e; }
        emitirST(req, { equipoId });
        // Planificación y los tableros leen la capacidad: que se enteren.
        try { req.app.get('socketio')?.emit('lotes:updated', { equipoId, motivo: 'capacidad-equipo' }); } catch (_) { /* nada */ }
        if (cambios.length) logger.info(`[ServicioTecnico] Capacidad de la máquina ${equipoId} por ${usuario.nombre}: ${cambios.join(' · ')}`);
        res.json({ success: true, data: { cambios: cambios.length } });
    } catch (err) {
        if (err.status === 400) return res.status(400).json({ success: false, error: err.message });
        responderError(res, err, 'ficha.capacidad');
    }
};

// Un cambio registrado en la máquina que también actualiza su ficha (parte 2, 08/10), si el técnico lo pidió:
//   cabezal { seccion: 'imp' | 'bor', pos (desde 0), serie }: esa posición queda "Operativo", con el n.º de serie
//     nuevo (si lo puso) y, en las impresoras, colocada en la fecha del cambio.
//   software { firmware, version }: las versiones de "Software y conectividad".
// Devuelve el texto que quedó en el historial, o null si no cambió nada (o falta st-ficha-tecnica.sql).
const fmtDiaISO = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
async function aplicarCambioEnFicha(pool, { equipoId, usuario, fecha, cabezal = null, software = null }) {
    if (!(await tablas(pool)).ficha) return null;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const actual = await filaEnTx(tx, equipoId);
        const f = deFila(actual);
        const lineas = [];
        if (esObjeto(cabezal)) {
            const sec = cabezal.seccion === 'bor' ? 'bor' : 'imp';
            const clave = sec === 'bor' ? 'cabezales' : 'posiciones';
            const pos = parseInt(cabezal.pos, 10);
            if (Number.isInteger(pos) && pos >= 0 && pos < 64) {
                const datos = esObjeto(f.Datos[sec]) ? f.Datos[sec] : {};
                const filas = Array.isArray(datos[clave]) ? datos[clave].slice() : [];
                while (filas.length <= pos) filas.push(sec === 'bor' ? { serie: '', estado: 'Operativo', nota: '' } : { color: '', serie: '', fecha: '', estado: 'Operativo' });
                const antes = esObjeto(filas[pos]) ? filas[pos] : {};
                const nueva = { ...antes, estado: 'Operativo' };
                const serie = texto(cabezal.serie, 100);
                if (serie) nueva.serie = serie;
                if (sec === 'imp' && fecha) nueva.fecha = fecha;
                filas[pos] = nueva;
                f.Datos[sec] = { ...datos, [clave]: filas };
                const detalle = [];
                if ((antes.serie || '') !== (nueva.serie || '')) detalle.push(`n.º de serie ${antes.serie || '—'} → ${nueva.serie || '—'}`);
                if ((antes.estado || '') !== nueva.estado) detalle.push(`estado ${antes.estado || '—'} → ${nueva.estado}`);
                if (sec === 'imp' && (antes.fecha || '') !== (nueva.fecha || '')) detalle.push(`colocado el ${fmtDiaISO(nueva.fecha)}`);
                if (detalle.length) lineas.push(`${sec === 'bor' ? 'Bordado' : 'Cabezales de impresión'}: Cabezal ${pos + 1}, ${detalle.join(', ')}`);
            }
        }
        if (esObjeto(software)) {
            const sw = esObjeto(f.Datos.sw) ? { ...f.Datos.sw } : {};
            const detalle = [];
            [['firmware', 'Versión de firmware'], ['version', 'Versión del software']].forEach(([k, etiqueta]) => {
                if (!(k in software)) return;
                const v = texto(software[k], 100) || '';
                if ((sw[k] || '') !== v) { detalle.push(`${etiqueta}: ${sw[k] || '—'} → ${v || '—'}`); sw[k] = v; }
            });
            if (detalle.length) { f.Datos.sw = sw; lineas.push(`Software y conectividad: ${detalle.join(' · ')}`); }
        }
        if (!lineas.length) { await tx.rollback(); return null; }
        await escribirFila(tx, equipoId, !!actual, f, usuario);
        const resumen = `${lineas.join(' · ')} (por el cambio del ${fmtDiaISO(fecha)})`;
        await historial(tx, { entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'FICHA', detalle: resumen.slice(0, 4000) });
        await tx.commit();
        return resumen;
    } catch (e) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } throw e; }
}

exports.TIPOS = TIPOS;
exports.ETIQUETA_TIPO_MAQUINA = ETIQUETA_TIPO_MAQUINA;
exports.aplicarCambioEnFicha = aplicarCambioEnFicha;
exports.tablas = tablas;
exports.leerFichaTecnica = leerFichaTecnica;
exports.limpiarCopia = limpiarCopia;
