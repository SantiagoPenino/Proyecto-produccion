// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — máquinas (etapa 2). Plan: docs/servicio-tecnico-plan.md
//
// Ficha de cada máquina (ConfigEquipos): estado, solicitudes, historial de fallas, historial de
// estados e historial de CAMBIOS (qué se cambió, cuándo y por qué — ST_CambiosEquipo, script
// docs/servicio-tecnico/st-etapa2.sql). Leer: cualquier usuario interno. Registrar/editar
// cambios: técnicos (área SERVICIO) o Admin; borrar un cambio: solo Admin.
//
// La "parada" de una máquina se mide con las solicitudes que la reportaron parada: minutos desde
// que se pidió hasta que se finalizó (o hasta ahora si sigue abierta). Si dos solicitudes abiertas
// reportan la misma máquina parada al mismo tiempo, ese tramo cuenta dos veces.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rutaAdjunto } = require('../middleware/multerServicioTecnico');
const {
    codigo, esAdmin, texto, idNum, fechaISO, hoyUY, numero, responderError, exigirTecnico, emitirST,
    usuarioActual, historial, leerHistorial, guardarAdjuntos, limpiarTemporales,
} = require('../services/servicioTecnicoComun');

const TIPOS_CAMBIO = ['REPUESTO', 'CABEZAL', 'SOFTWARE', 'CALIBRACION', 'CONFIGURACION', 'MEJORA', 'REUBICACION', 'ALTA_BAJA', 'OTRO'];
const ETIQUETA_TIPO = {
    REPUESTO: 'Repuesto', CABEZAL: 'Cabezal', SOFTWARE: 'Firmware / software', CALIBRACION: 'Calibración',
    CONFIGURACION: 'Configuración', MEJORA: 'Mejora', REUBICACION: 'Reubicación', ALTA_BAJA: 'Alta / baja', OTRO: 'Otro',
};
const MONEDAS = ['UYU', 'USD'];

// Minutos de parada de una solicitud: los guardados al finalizar o, si sigue abierta, hasta ahora.
const SQL_PARADA = `ISNULL(s.MinutosParada, CASE WHEN s.Estado <> 'FINALIZADA' AND s.MaquinaNoTrabaja = 1
                    THEN DATEDIFF(MINUTE, s.FechaSolicitud, GETDATE()) END)`;

// GET /equipos?inactivas=1 → máquinas con su resumen
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('Todas', sql.Bit, req.query.inactivas === '1').query(`
            SELECT e.EquipoID, LTRIM(RTRIM(e.Nombre)) AS Nombre, LTRIM(RTRIM(e.AreaID)) AS AreaID, a.Nombre AS AreaNombre,
                   e.Estado, e.Activo,
                   x.Abiertas, x.AbiertasParada, x.Fallas90, x.UltimaFalla, x.MinutosParada90,
                   c.Cambios, CONVERT(VARCHAR(10), c.UltimoCambio, 23) AS UltimoCambio
            FROM dbo.ConfigEquipos e
            LEFT JOIN dbo.Areas a ON a.AreaID = e.AreaID
            OUTER APPLY (
                SELECT SUM(CASE WHEN s.Estado <> 'FINALIZADA' THEN 1 ELSE 0 END) AS Abiertas,
                       SUM(CASE WHEN s.Estado <> 'FINALIZADA' AND s.MaquinaNoTrabaja = 1 THEN 1 ELSE 0 END) AS AbiertasParada,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -90, GETDATE()) AND ISNULL(s.Resultado, '') <> 'CANCELADA' THEN 1 ELSE 0 END) AS Fallas90,
                       MAX(s.FechaSolicitud) AS UltimaFalla,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -90, GETDATE()) THEN ${SQL_PARADA} END) AS MinutosParada90
                FROM dbo.ST_Solicitudes s WHERE s.EquipoId = e.EquipoID
            ) x
            OUTER APPLY (
                SELECT COUNT(*) AS Cambios, MAX(ce.Fecha) AS UltimoCambio FROM dbo.ST_CambiosEquipo ce WHERE ce.EquipoId = e.EquipoID
            ) c
            WHERE e.Activo = 1 OR @Todas = 1
            ORDER BY LTRIM(RTRIM(e.AreaID)), LTRIM(RTRIM(e.Nombre))`);
        res.json({
            success: true,
            data: r.recordset.map(m => ({
                ...m,
                Abiertas: m.Abiertas || 0, AbiertasParada: m.AbiertasParada || 0,
                Fallas90: m.Fallas90 || 0, MinutosParada90: m.MinutosParada90 || 0,
            })),
            tiposCambio: TIPOS_CAMBIO.map(t => ({ value: t, label: ETIQUETA_TIPO[t] })),
        });
    } catch (err) { responderError(res, err, 'equipos.listar'); }
};

// GET /equipos/:id → ficha completa
exports.ficha = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Máquina inválida.' });
    try {
        const pool = await getPool();
        const eq = await pool.request().input('E', sql.Int, id).query(`
            SELECT e.EquipoID, LTRIM(RTRIM(e.Nombre)) AS Nombre, LTRIM(RTRIM(e.AreaID)) AS AreaID, a.Nombre AS AreaNombre,
                   e.Estado, e.EstadoProceso, e.Activo, e.Capacidad, e.Velocidad,
                   e.Cabezales, e.VelocidadValor, e.VelocidadUnidad, e.MinutosPreparacion,
                   e.CabezalesReal, e.VelocidadValorReal, e.MinutosPreparacionReal
            FROM dbo.ConfigEquipos e LEFT JOIN dbo.Areas a ON a.AreaID = e.AreaID
            WHERE e.EquipoID = @E`);
        if (!eq.recordset.length) return res.status(404).json({ success: false, error: 'No existe la máquina.' });

        const [sols, stats, cambios, adjCambios, estados] = await Promise.all([
            pool.request().input('E', sql.Int, id).query(`
                SELECT TOP 300 s.SolId, s.Titulo, s.Categoria, s.Prioridad, s.Estado, s.Resultado, s.MaquinaNoTrabaja,
                       s.FechaSolicitud, s.FechaFin, s.TecnicoNombre, s.SolicitanteNombre, s.TrabajoRealizado,
                       ${SQL_PARADA} AS MinutosParada,
                       DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaFin) AS MinutosResolucion
                FROM dbo.ST_Solicitudes s WHERE s.EquipoId = @E
                ORDER BY CASE WHEN s.Estado = 'FINALIZADA' THEN 1 ELSE 0 END, s.FechaSolicitud DESC`),
            pool.request().input('E', sql.Int, id).query(`
                SELECT SUM(CASE WHEN s.Estado <> 'FINALIZADA' THEN 1 ELSE 0 END) AS Abiertas,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -30, GETDATE()) AND ISNULL(s.Resultado, '') <> 'CANCELADA' THEN 1 ELSE 0 END) AS Fallas30,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -90, GETDATE()) AND ISNULL(s.Resultado, '') <> 'CANCELADA' THEN 1 ELSE 0 END) AS Fallas90,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -365, GETDATE()) AND ISNULL(s.Resultado, '') <> 'CANCELADA' THEN 1 ELSE 0 END) AS Fallas365,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -90, GETDATE()) THEN ${SQL_PARADA} END) AS MinutosParada90,
                       SUM(CASE WHEN s.FechaSolicitud >= DATEADD(DAY, -365, GETDATE()) THEN ${SQL_PARADA} END) AS MinutosParada365,
                       AVG(CASE WHEN s.Estado = 'FINALIZADA' AND s.Resultado <> 'CANCELADA' AND s.FechaFin >= DATEADD(DAY, -365, GETDATE())
                                THEN CAST(DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaFin) AS FLOAT) END) AS MinutosResolucionProm
                FROM dbo.ST_Solicitudes s WHERE s.EquipoId = @E`),
            pool.request().input('E', sql.Int, id).query(`
                SELECT c.CamId, CONVERT(VARCHAR(10), c.Fecha, 23) AS Fecha, c.Tipo, c.Descripcion, c.Motivo, c.SolId,
                       c.Costo, c.Moneda, c.UsuarioId, c.UsuarioNombre, c.FechaRegistro, s.Titulo AS SolTitulo
                FROM dbo.ST_CambiosEquipo c LEFT JOIN dbo.ST_Solicitudes s ON s.SolId = c.SolId
                WHERE c.EquipoId = @E ORDER BY c.Fecha DESC, c.CamId DESC`),
            pool.request().input('E', sql.Int, id).query(`
                SELECT ad.AdjId, ad.EntidadId AS CamId, ad.NombreOriginal, ad.Mime, ad.Bytes, ad.UsuarioNombre, ad.Fecha
                FROM dbo.ST_Adjuntos ad JOIN dbo.ST_CambiosEquipo c ON c.CamId = ad.EntidadId
                WHERE ad.Entidad = 'CAMBIO' AND c.EquipoId = @E ORDER BY ad.Fecha`),
            leerHistorial(pool, 'EQUIPO', id),
        ]);
        const adjPorCambio = {};
        adjCambios.recordset.forEach(a => { (adjPorCambio[a.CamId] = adjPorCambio[a.CamId] || []).push(a); });
        const st = stats.recordset[0] || {};
        // Costo de los cambios del último año, por moneda.
        const haceUnAnio = hoyUY(new Date(Date.now() - 365 * 86400000));
        const costos = {};
        cambios.recordset.forEach(c => {
            if (c.Costo != null && c.Fecha >= haceUnAnio) costos[c.Moneda || 'UYU'] = (costos[c.Moneda || 'UYU'] || 0) + Number(c.Costo);
        });
        res.json({
            success: true,
            data: {
                ...eq.recordset[0],
                resumen: {
                    abiertas: st.Abiertas || 0, fallas30: st.Fallas30 || 0, fallas90: st.Fallas90 || 0, fallas365: st.Fallas365 || 0,
                    minutosParada90: st.MinutosParada90 || 0, minutosParada365: st.MinutosParada365 || 0,
                    minutosResolucionProm: st.MinutosResolucionProm != null ? Math.round(st.MinutosResolucionProm) : null,
                    costoCambios365: costos,
                },
                solicitudes: sols.recordset.map(s => ({ ...s, Codigo: codigo(s.SolId) })),
                cambios: cambios.recordset.map(c => ({
                    ...c, TipoLabel: ETIQUETA_TIPO[c.Tipo] || c.Tipo, SolCodigo: c.SolId ? codigo(c.SolId) : null, adjuntos: adjPorCambio[c.CamId] || [],
                })),
                estados,
            },
            tiposCambio: TIPOS_CAMBIO.map(t => ({ value: t, label: ETIQUETA_TIPO[t] })),
        });
    } catch (err) { responderError(res, err, 'equipos.ficha'); }
};

// Valida y normaliza los datos de un cambio. Devuelve { datos } o { error }.
async function leerDatosCambio(pool, b, { parcial = false } = {}) {
    const d = {};
    if (!parcial || 'fecha' in b) {
        d.fecha = b.fecha ? fechaISO(b.fecha) : hoyUY();
        if (!d.fecha) return { error: 'Fecha inválida.' };
        if (d.fecha > hoyUY()) return { error: 'La fecha del cambio no puede ser futura.' };
    }
    if (!parcial || 'tipo' in b) {
        d.tipo = String(b.tipo || '').toUpperCase();
        if (!TIPOS_CAMBIO.includes(d.tipo)) return { error: 'Elegí el tipo de cambio.' };
    }
    if (!parcial || 'descripcion' in b) {
        d.descripcion = texto(b.descripcion, 8000);
        if (!d.descripcion) return { error: 'Describí el cambio.' };
    }
    if (!parcial || 'motivo' in b) d.motivo = texto(b.motivo, 1000);
    if (!parcial || 'solId' in b) {
        d.solId = idNum(b.solId);
        if (b.solId && !d.solId) return { error: 'Solicitud inválida.' };
        if (d.solId) {
            const s = await pool.request().input('S', sql.Int, d.solId).query('SELECT SolId FROM dbo.ST_Solicitudes WHERE SolId = @S');
            if (!s.recordset.length) return { error: `No existe la solicitud ${codigo(d.solId)}.` };
        }
    }
    // Costo y moneda van juntos (sin costo no hay moneda).
    if (!parcial || 'costo' in b) {
        d.costo = numero(b.costo);
        if (b.costo !== undefined && b.costo !== '' && b.costo !== null && d.costo === null) return { error: 'Costo inválido.' };
        if (d.costo != null && d.costo < 0) return { error: 'El costo no puede ser negativo.' };
        d.moneda = d.costo != null ? (MONEDAS.includes(String(b.moneda || '').toUpperCase()) ? String(b.moneda).toUpperCase() : 'UYU') : null;
    }
    return { datos: d };
}

// POST /equipos/:id/cambios (multipart: campos + adjuntos) → técnicos
exports.crearCambio = async (req, res) => {
    const files = req.files || [];
    const equipoId = idNum(req.params.id);
    if (!exigirTecnico(req, res, 'registrar cambios en una máquina')) { limpiarTemporales(files); return; }
    if (!equipoId) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Máquina inválida.' }); }
    try {
        const pool = await getPool();
        const eq = await pool.request().input('E', sql.Int, equipoId).query('SELECT LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.ConfigEquipos WHERE EquipoID = @E');
        if (!eq.recordset.length) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe la máquina.' }); }
        const { datos: d, error } = await leerDatosCambio(pool, req.body || {});
        if (error) { limpiarTemporales(files); return res.status(400).json({ success: false, error }); }
        const usuario = await usuarioActual(pool, req);

        const ins = await pool.request()
            .input('E', sql.Int, equipoId).input('F', sql.VarChar(10), d.fecha).input('T', sql.VarChar(20), d.tipo)
            .input('D', sql.NVarChar(sql.MAX), d.descripcion).input('M', sql.NVarChar(1000), d.motivo)
            .input('S', sql.Int, d.solId).input('C', sql.Decimal(18, 2), d.costo).input('Mon', sql.VarChar(3), d.moneda)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`INSERT INTO dbo.ST_CambiosEquipo (EquipoId, Fecha, Tipo, Descripcion, Motivo, SolId, Costo, Moneda, UsuarioId, UsuarioNombre)
                    OUTPUT INSERTED.CamId
                    VALUES (@E, CAST(@F AS DATE), @T, @D, @M, @S, @C, @Mon, @U, @UN)`);
        const camId = ins.recordset[0].CamId;
        await guardarAdjuntos(pool, { entidad: 'CAMBIO', entidadId: camId, files, usuario });
        if (d.solId) {
            await historial(pool, { entidadId: d.solId, usuario, accion: 'MAQUINA', detalle: `Cambio registrado en ${eq.recordset[0].Nombre}: ${ETIQUETA_TIPO[d.tipo]} — ${d.descripcion}`, motivo: d.motivo });
        }
        emitirST(req, { equipoId, solId: d.solId || undefined });
        logger.info(`[ServicioTecnico] Cambio ${camId} (${d.tipo}) en máquina ${equipoId} por ${usuario.nombre}`);
        res.json({ success: true, data: { CamId: camId } });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'equipos.crearCambio');
    }
};

// PUT /cambios/:camId → técnicos (queda en el historial de la máquina qué se corrigió)
exports.editarCambio = async (req, res) => {
    if (!exigirTecnico(req, res, 'editar cambios de una máquina')) return;
    const camId = idNum(req.params.camId);
    if (!camId) return res.status(400).json({ success: false, error: 'Cambio inválido.' });
    try {
        const pool = await getPool();
        const act = await pool.request().input('C', sql.Int, camId).query(`
            SELECT CamId, EquipoId, CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, Tipo, Descripcion, Motivo, SolId, Costo, Moneda
            FROM dbo.ST_CambiosEquipo WHERE CamId = @C`);
        const c = act.recordset[0];
        if (!c) return res.status(404).json({ success: false, error: 'No existe el cambio.' });
        const { datos: d, error } = await leerDatosCambio(pool, req.body || {}, { parcial: true });
        if (error) return res.status(400).json({ success: false, error });

        const columnas = { fecha: ['Fecha', sql.VarChar(10)], tipo: ['Tipo', sql.VarChar(20)], descripcion: ['Descripcion', sql.NVarChar(sql.MAX)],
            motivo: ['Motivo', sql.NVarChar(1000)], solId: ['SolId', sql.Int], costo: ['Costo', sql.Decimal(18, 2)], moneda: ['Moneda', sql.VarChar(3)] };
        const r = pool.request().input('C', sql.Int, camId);
        const sets = [];
        const cambios = [];
        for (const [k, v] of Object.entries(d)) {
            const [col, tipo] = columnas[k];
            const anterior = c[col] == null ? null : (col === 'Costo' ? Number(c[col]) : c[col]);
            if ((anterior ?? null) === (v ?? null)) continue;
            sets.push(col === 'Fecha' ? `${col} = CAST(@${col} AS DATE)` : `${col} = @${col}`);
            r.input(col, tipo, v);
            cambios.push(`${col}: ${anterior ?? '—'} → ${v ?? '—'}`);
        }
        if (!sets.length) return res.json({ success: true });
        await r.query(`UPDATE dbo.ST_CambiosEquipo SET ${sets.join(', ')} WHERE CamId = @C`);
        const usuario = await usuarioActual(pool, req);
        await historial(pool, { entidad: 'EQUIPO', entidadId: c.EquipoId, usuario, accion: 'CAMBIO_EDITADO', detalle: `Cambio del ${c.Fecha.split('-').reverse().join('/')}: ${cambios.join(' · ')}` });
        emitirST(req, { equipoId: c.EquipoId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'equipos.editarCambio'); }
};

// DELETE /cambios/:camId → solo Admin (queda anotado en el historial de la máquina)
exports.borrarCambio = async (req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ success: false, error: 'Solo un administrador puede borrar un cambio.' });
    const camId = idNum(req.params.camId);
    if (!camId) return res.status(400).json({ success: false, error: 'Cambio inválido.' });
    try {
        const pool = await getPool();
        const act = await pool.request().input('C', sql.Int, camId)
            .query(`SELECT EquipoId, CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, Tipo, Descripcion FROM dbo.ST_CambiosEquipo WHERE CamId = @C`);
        const c = act.recordset[0];
        if (!c) return res.status(404).json({ success: false, error: 'No existe el cambio.' });
        const adj = await pool.request().input('C', sql.Int, camId)
            .query(`SELECT Archivo FROM dbo.ST_Adjuntos WHERE Entidad = 'CAMBIO' AND EntidadId = @C`);
        await pool.request().input('C', sql.Int, camId).query(`
            DELETE FROM dbo.ST_Adjuntos WHERE Entidad = 'CAMBIO' AND EntidadId = @C;
            DELETE FROM dbo.ST_CambiosEquipo WHERE CamId = @C;`);
        for (const a of adj.recordset) {
            try { fs.unlinkSync(rutaAdjunto('CAMBIO', camId, a.Archivo)); } catch (_) { /* ya no estaba */ }
        }
        const usuario = await usuarioActual(pool, req);
        await historial(pool, {
            entidad: 'EQUIPO', entidadId: c.EquipoId, usuario, accion: 'CAMBIO_BORRADO',
            detalle: `${ETIQUETA_TIPO[c.Tipo] || c.Tipo} del ${c.Fecha.split('-').reverse().join('/')}: ${c.Descripcion}`,
        });
        emitirST(req, { equipoId: c.EquipoId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'equipos.borrarCambio'); }
};

// POST /cambios/:camId/adjuntos (multipart) → técnicos
exports.adjuntarCambio = async (req, res) => {
    const files = req.files || [];
    if (!exigirTecnico(req, res, 'adjuntar en un cambio')) { limpiarTemporales(files); return; }
    const camId = idNum(req.params.camId);
    if (!camId) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Cambio inválido.' }); }
    if (!files.length) return res.status(400).json({ success: false, error: 'No llegó ningún archivo.' });
    try {
        const pool = await getPool();
        const c = await pool.request().input('C', sql.Int, camId).query('SELECT EquipoId FROM dbo.ST_CambiosEquipo WHERE CamId = @C');
        if (!c.recordset.length) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe el cambio.' }); }
        const usuario = await usuarioActual(pool, req);
        const adj = await guardarAdjuntos(pool, { entidad: 'CAMBIO', entidadId: camId, files, usuario });
        emitirST(req, { equipoId: c.recordset[0].EquipoId });
        res.json({ success: true, data: adj });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'equipos.adjuntarCambio');
    }
};

exports.TIPOS_CAMBIO = TIPOS_CAMBIO;
exports.ETIQUETA_TIPO = ETIQUETA_TIPO;
