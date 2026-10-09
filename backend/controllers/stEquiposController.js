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
const path = require('path');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rutaAdjunto } = require('../middleware/multerServicioTecnico');
const {
    codigo, esAdmin, texto, bool, idNum, fechaISO, hoyUY, numero, responderError, exigirTecnico, emitirST, avisarTableros,
    usuarioActual, historial, leerHistorial, guardarAdjuntos, leerAdjuntos, limpiarTemporales,
} = require('../services/servicioTecnicoComun');
const { tablas, leerFichaTecnica, aplicarCambioEnFicha, TIPOS: TIPOS_MAQUINA, ETIQUETA_TIPO_MAQUINA } = require('./stFichaEquipoController');

const TIPOS_CAMBIO = ['REPUESTO', 'CABEZAL', 'SOFTWARE', 'CALIBRACION', 'CONFIGURACION', 'MEJORA', 'REUBICACION', 'ALTA_BAJA', 'OTRO'];
const ETIQUETA_TIPO = {
    REPUESTO: 'Repuesto', CABEZAL: 'Cabezal', SOFTWARE: 'Firmware / software', CALIBRACION: 'Calibración',
    CONFIGURACION: 'Configuración', MEJORA: 'Mejora', REUBICACION: 'Reubicación', ALTA_BAJA: 'Alta / baja', OTRO: 'Otro',
};
const MONEDAS = ['UYU', 'USD'];

// Minutos de parada de una solicitud: los guardados al finalizar o, si sigue abierta, hasta ahora.
const SQL_PARADA = `ISNULL(s.MinutosParada, CASE WHEN s.Estado <> 'FINALIZADA' AND s.MaquinaNoTrabaja = 1
                    THEN DATEDIFF(MINUTE, s.FechaSolicitud, GETDATE()) END)`;

// Alertas que salen de la ficha técnica (parte 4, 08/10): cabezales para cambiar (impresoras: "Reemplazar";
// bordadoras: "Fuera de servicio"), herramientas para cambiar (corte) y los días que le quedan a la garantía
// (null sin fecha de instalación o sin meses). Misma cuenta de vencimiento que la página (fichaTecnicaCampos.garantia).
function alertasDeFicha(json, hoy) {
    let d = {};
    try { d = JSON.parse(json || '{}') || {}; } catch (_) { d = {}; }
    const contar = (filas, estados) => (Array.isArray(filas) ? filas.filter(f => f && estados.includes(f.estado)).length : 0);
    const imp = contar(d.imp?.posiciones, ['Reemplazar']);
    const bor = contar(d.bor?.cabezales, ['Fuera de servicio']);
    let garantiaDias = null;
    const fi = /^\d{4}-\d{2}-\d{2}$/.test(String(d.gar?.fechaInstalacion || '')) ? d.gar.fechaInstalacion : null;
    const meses = parseInt(d.gar?.meses, 10);
    if (fi && Number.isInteger(meses) && meses >= 0) {
        const [y, m, dia] = fi.split('-').map(Number);
        const vence = new Date(Date.UTC(y, m - 1 + meses, dia));
        if (vence.getUTCDate() !== dia) vence.setUTCDate(0); // 31/01 + 1 mes = 28 o 29/02, como en la página
        const [hy, hm, hd] = hoy.split('-').map(Number);
        garantiaDias = Math.round((vence.getTime() - Date.UTC(hy, hm - 1, hd)) / 86400000);
    }
    return {
        CabezalesReemplazar: imp + bor, CabezalesSeccion: imp ? 'imp' : bor ? 'bor' : null,
        HerramientasReemplazar: contar(d.cor?.herramientas, ['Reemplazar']),
        GarantiaDias: garantiaDias,
    };
}

// ── Disponibilidad (parte 4, 08/10) ─────────────────────────────────────────
// De las horas que la máquina tenía que trabajar según el horario de su área en Planificación (ConfigHorarioLaboral,
// sin los feriados de CalendarioFeriados), qué parte NO estuvo parada por una falla. Las paradas se cuentan solo
// dentro del horario (una rotura el viernes a la tarde no suma el fin de semana) y, si dos solicitudes la reportan
// parada a la vez, ese tramo cuenta una sola vez. Los turnos que pasan la medianoche (HoraFin <= HoraInicio) siguen
// al día siguiente, como horasEntre de Planificación. Ojo: usa el horario de HOY también para los días pasados.
const UY_MS = 3 * 3600000; // Uruguay: UTC−3, sin horario de verano desde 2015
const instanteUY = (fecha, hhmm) => {
    const [y, m, d] = fecha.split('-').map(Number);
    const [hh, mm] = String(hhmm).split(':').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) + UY_MS;
};
const sumarDiasISO = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const diaSemanaISO = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
};
// Une tramos [inicio, fin) que se pisan o se tocan.
const unirTramos = (tramos) => {
    const orden = tramos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of orden) {
        const ult = out[out.length - 1];
        if (ult && a <= ult[1]) ult[1] = Math.max(ult[1], b);
        else out.push([a, b]);
    }
    return out;
};
// horarios: [{ DiaSemana, HoraInicio 'HH:MM', HoraFin 'HH:MM' }] · feriados: Set de 'AAAA-MM-DD' · paradas: [[inicioMs, finMs]]
// desde / hoy: 'AAAA-MM-DD' (Uruguay) · ahora: ms. Devuelve { sinHorario } o { porcentaje, minutosProgramados, minutosParados }.
function disponibilidadDe({ horarios, feriados, paradas, desde, hoy, ahora }) {
    if (!horarios.length) return { sinHorario: true };
    const inicio = instanteUY(desde, '00:00');
    const tramos = [];
    for (let f = desde; f <= hoy; f = sumarDiasISO(f, 1)) {
        if (feriados.has(f)) continue;
        const dia = diaSemanaISO(f);
        for (const h of horarios.filter(x => Number(x.DiaSemana) === dia)) {
            const a = instanteUY(f, h.HoraInicio);
            let b = instanteUY(f, h.HoraFin);
            if (b <= a) b += 24 * 3600000;
            const a2 = Math.max(a, inicio), b2 = Math.min(b, ahora);
            if (b2 > a2) tramos.push([a2, b2]);
        }
    }
    const trabajo = unirTramos(tramos);
    const programado = trabajo.reduce((t, [a, b]) => t + (b - a), 0);
    if (programado <= 0) return { sinHorario: false, porcentaje: null, minutosProgramados: 0, minutosParados: 0 };
    let parado = 0;
    for (const [pa, pb] of unirTramos(paradas)) {
        for (const [ta, tb] of trabajo) {
            const x = Math.max(pa, ta), y = Math.min(pb, tb);
            if (y > x) parado += y - x;
        }
    }
    return {
        sinHorario: false,
        porcentaje: Math.round(1000 * (programado - parado) / programado) / 10,
        minutosProgramados: Math.round(programado / 60000),
        minutosParados: Math.round(parado / 60000),
    };
}

// GET /equipos?inactivas=1 → máquinas con su resumen y sus alertas
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        // Ficha técnica (08/10, st-ficha-tecnica.sql): tipo, marca y modelo para la lista y la columna de la
        // página de la máquina. Sin el script, vienen vacíos.
        const t = await tablas(pool);
        const conFicha = t.ficha;
        const hoy = hoyUY();
        const r = await pool.request().input('Todas', sql.Bit, req.query.inactivas === '1').input('Hoy', sql.VarChar(10), hoy).query(`
            SELECT e.EquipoID, LTRIM(RTRIM(e.Nombre)) AS Nombre, LTRIM(RTRIM(e.AreaID)) AS AreaID, a.Nombre AS AreaNombre,
                   e.Estado, e.Activo,
                   CASE WHEN e.VelocidadValor IS NULL THEN 1 ELSE 0 END AS SinCapacidad,
                   ${conFicha ? 'f.Tipo, f.Marca, f.Modelo, CASE WHEN f.EquipoId IS NULL THEN 0 ELSE 1 END AS TieneFicha, f.Datos'
                              : 'NULL AS Tipo, NULL AS Marca, NULL AS Modelo, 0 AS TieneFicha, NULL AS Datos'},
                   x.Abiertas, x.AbiertasParada, x.Fallas90, x.UltimaFalla, x.MinutosParada90,
                   c.Cambios, CONVERT(VARCHAR(10), c.UltimoCambio, 23) AS UltimoCambio,
                   tv.MantenimientosVencidos,
                   ${t.repuestos ? 'rp.RepuestosCriticos, rp.RepuestosAlerta' : '0 AS RepuestosCriticos, 0 AS RepuestosAlerta'}
            FROM dbo.ConfigEquipos e
            LEFT JOIN dbo.Areas a ON a.AreaID = e.AreaID
            ${conFicha ? 'LEFT JOIN dbo.ST_FichaEquipo f ON f.EquipoId = e.EquipoID' : ''}
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
            -- Alertas (parte 4): mantenimientos vencidos (de un plan o tipo Mantenimiento; las tareas sueltas no son
            -- preventivo) y repuestos con la regla del /stock (stInsumosController.estadoRepuesto)
            OUTER APPLY (
                SELECT COUNT(*) AS MantenimientosVencidos FROM dbo.ST_Trabajos tr
                WHERE tr.EquipoId = e.EquipoID AND tr.Estado IN ('PENDIENTE', 'EN_CURSO') AND tr.FechaProgramada < CAST(@Hoy AS DATE)
                  AND (tr.PlanId IS NOT NULL OR tr.Tipo = 'MANTENIMIENTO')
            ) tv
            ${t.repuestos ? `OUTER APPLY (
                SELECT SUM(CASE WHEN s.Stock <= 0 OR (v.CantidadCritica > 0 AND s.Stock <= v.CantidadCritica) THEN 1 ELSE 0 END) AS RepuestosCriticos,
                       SUM(CASE WHEN s.Stock > 0 AND NOT (v.CantidadCritica > 0 AND s.Stock <= v.CantidadCritica)
                                 AND v.CantidadAlerta > 0 AND s.Stock <= v.CantidadAlerta THEN 1 ELSE 0 END) AS RepuestosAlerta
                FROM dbo.ST_EquipoRepuestos rep
                JOIN dbo.Wms_Variantes v ON v.VarId = rep.VarId
                CROSS APPLY (SELECT ISNULL(SUM(et.CantidadActual), 0) AS Stock FROM dbo.Wms_Etiquetas et WHERE et.VarId = v.VarId AND et.Estado = 'activo') s
                WHERE rep.EquipoId = e.EquipoID
            ) rp` : ''}
            WHERE e.Activo = 1 OR @Todas = 1
            ORDER BY LTRIM(RTRIM(e.AreaID)), LTRIM(RTRIM(e.Nombre))`);
        // Áreas en las que se puede dar de alta una máquina desde acá (las productivas).
        const areas = await pool.request().query(`
            SELECT LTRIM(RTRIM(AreaID)) AS AreaID, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.Areas WHERE Productiva = 1 ORDER BY Nombre`);
        res.json({
            success: true,
            data: r.recordset.map(({ Datos, ...m }) => ({
                ...m,
                Abiertas: m.Abiertas || 0, AbiertasParada: m.AbiertasParada || 0,
                Fallas90: m.Fallas90 || 0, MinutosParada90: m.MinutosParada90 || 0,
                MantenimientosVencidos: m.MantenimientosVencidos || 0,
                RepuestosCriticos: m.RepuestosCriticos || 0, RepuestosAlerta: m.RepuestosAlerta || 0,
                ...alertasDeFicha(Datos, hoy),
            })),
            areas: areas.recordset,
            tiposCambio: TIPOS_CAMBIO.map(t => ({ value: t, label: ETIQUETA_TIPO[t] })),
        });
    } catch (err) { responderError(res, err, 'equipos.listar'); }
};

// POST /equipos → técnicos (08/10). { nombre, areaId, tipo, esImpresora }. Alta de una máquina desde Servicio
// Técnico, con los mismos valores que Configuración → Equipos (areasController.addPrinter): activa, disponible,
// detenida y sin capacidad (se carga en su ficha; hasta entonces Planificación no la cuenta). "Pasa por otra máquina
// antes de Control" (SeparacionImpresion, antes "Es impresora": al finalizar, el lote pasa a la calandra del área, en
// TPU al samurai) se elige acá solo al crearla: después se cambia únicamente en Configuración, porque de eso dependen
// las áreas. El tipo queda confirmado en su ficha técnica.
exports.crearEquipo = async (req, res) => {
    if (!exigirTecnico(req, res, 'dar de alta una máquina')) return;
    const b = req.body || {};
    const nombre = texto(b.nombre, 100);
    const areaId = texto(b.areaId, 20);
    const tipo = b.tipo ? String(b.tipo).toUpperCase() : null;
    const esImpresora = bool(b.esImpresora);
    if (!nombre) return res.status(400).json({ success: false, error: 'Poné el nombre de la máquina.' });
    if (!areaId) return res.status(400).json({ success: false, error: 'Elegí el área.' });
    if (!tipo || !TIPOS_MAQUINA.includes(tipo)) return res.status(400).json({ success: false, error: 'Elegí el tipo de máquina.' });
    try {
        const pool = await getPool();
        const a = await pool.request().input('A', sql.VarChar(20), areaId).query(`
            SELECT LTRIM(RTRIM(AreaID)) AS AreaID, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.Areas WHERE LTRIM(RTRIM(AreaID)) = @A AND Productiva = 1`);
        if (!a.recordset.length) return res.status(400).json({ success: false, error: 'Área inválida.' });
        const area = a.recordset[0];
        const repetida = await pool.request().input('A', sql.VarChar(20), area.AreaID).input('N', sql.NVarChar(100), nombre).query(`
            SELECT 1 AS x FROM dbo.ConfigEquipos WHERE LTRIM(RTRIM(AreaID)) = @A AND Activo = 1 AND LTRIM(RTRIM(Nombre)) = @N`);
        if (repetida.recordset.length) return res.status(400).json({ success: false, error: `Ya hay una máquina «${nombre}» en ${area.Nombre}.` });
        const t = await tablas(pool);
        const usuario = await usuarioActual(pool, req);

        const tx = new sql.Transaction(pool);
        await tx.begin();
        let equipoId;
        try {
            const ins = await tx.request()
                .input('A', sql.VarChar(20), area.AreaID).input('N', sql.NVarChar(100), nombre)
                .input('SepImp', sql.Bit, esImpresora ? 1 : 0)
                .query(`INSERT INTO dbo.ConfigEquipos (AreaID, Nombre, Activo, Capacidad, Velocidad, Estado, EstadoProceso, SeparacionImpresion)
                        OUTPUT INSERTED.EquipoID
                        VALUES (@A, @N, 1, 100, 10, 'DISPONIBLE', 'DETENIDO', @SepImp)`);
            equipoId = ins.recordset[0].EquipoID;
            if (t.ficha) {
                await tx.request().input('E', sql.Int, equipoId).input('T', sql.VarChar(20), tipo)
                    .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
                    .query(`INSERT INTO dbo.ST_FichaEquipo (EquipoId, Tipo, Datos, UsuarioId, UsuarioNombre) VALUES (@E, @T, N'{}', @U, @UN)`);
            }
            await historial(tx, {
                entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'ALTA',
                detalle: `Máquina creada en ${area.Nombre} · ${ETIQUETA_TIPO_MAQUINA[tipo]} · pasa por otra máquina antes de Control: ${esImpresora ? 'sí' : 'no'}`,
            });
            await tx.commit();
        } catch (e) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } throw e; }
        emitirST(req, { equipoId });
        avisarTableros(req, equipoId); // las áreas y Planeación listan sus máquinas
        logger.info(`[ServicioTecnico] Máquina ${equipoId} «${nombre}» creada en ${area.AreaID} por ${usuario.nombre}`);
        res.json({ success: true, data: { EquipoID: equipoId } });
    } catch (err) { responderError(res, err, 'equipos.crear'); }
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
        const { fichaTecnica, catalogos } = await leerFichaTecnica(pool, id, eq.recordset[0].AreaID);
        const documentos = await leerAdjuntos(pool, 'EQUIPO', id); // fotos, manuales y otros archivos (parte 3)
        const adjPorCambio = {};
        adjCambios.recordset.forEach(a => { (adjPorCambio[a.CamId] = adjPorCambio[a.CamId] || []).push(a); });
        const st = stats.recordset[0] || {};
        // Indicadores (parte 4, 08/10), con las fallas del último año que no se cancelaron (las mismas que cuenta
        // "Fallas"). Entre fallas: el promedio entre una y la siguiente = (última − primera) / (cantidad − 1); hace falta
        // más de una. Reparación: el promedio de minutos de parada de las que pararon la máquina y ya se cerraron.
        const desdeAnio = Date.now() - 365 * 86400000;
        const delAnio = sols.recordset.filter(s => s.Resultado !== 'CANCELADA' && new Date(s.FechaSolicitud).getTime() >= desdeAnio);
        const fechas = delAnio.map(s => new Date(s.FechaSolicitud).getTime()).sort((a, b) => a - b);
        const mtbf = fechas.length >= 2 ? Math.round((fechas[fechas.length - 1] - fechas[0]) / (fechas.length - 1) / 60000) : null;
        const paradas = delAnio.filter(s => s.Estado === 'FINALIZADA' && s.MaquinaNoTrabaja && s.MinutosParada != null);
        const mttr = paradas.length ? Math.round(paradas.reduce((a, s) => a + Number(s.MinutosParada), 0) / paradas.length) : null;

        // Disponibilidad: los últimos 90 días, o desde la primera solicitud del módulo de Servicio Técnico si es más
        // nueva (antes no se anotaban las paradas y la máquina daría 100 % sin serlo).
        const ahora = Date.now();
        const hoy = hoyUY();
        const [horarioArea, primeraSol] = await Promise.all([
            pool.request().input('A', sql.VarChar(20), eq.recordset[0].AreaID || '').query(`
                SELECT DiaSemana, CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio, CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
                FROM dbo.ConfigHorarioLaboral WHERE LTRIM(RTRIM(AreaID)) = @A AND Activo = 1`),
            // Sin los tickets viejos migrados (LegacyTicketId): no anotaban si la máquina quedaba parada.
            pool.request().query('SELECT MIN(FechaSolicitud) AS Primera FROM dbo.ST_Solicitudes WHERE LegacyTicketId IS NULL'),
        ]);
        let desdeDisp = sumarDiasISO(hoy, -89);
        const primera = primeraSol.recordset[0]?.Primera;
        if (primera && hoyUY(new Date(primera)) > desdeDisp) desdeDisp = hoyUY(new Date(primera));
        const feriadosDisp = await pool.request().input('D', sql.VarChar(10), desdeDisp).input('H', sql.VarChar(10), hoy).query(`
            SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha FROM dbo.CalendarioFeriados WHERE Fecha BETWEEN CAST(@D AS DATE) AND CAST(@H AS DATE)`);
        const tramosParada = sols.recordset
            .filter(s => s.MaquinaNoTrabaja && s.Resultado !== 'CANCELADA')
            .map(s => {
                const ini = new Date(s.FechaSolicitud).getTime();
                const fin = s.FechaFin ? new Date(s.FechaFin).getTime()
                    : s.Estado !== 'FINALIZADA' ? ahora
                    : s.MinutosParada != null ? ini + Number(s.MinutosParada) * 60000 : ini;
                return [ini, fin];
            });
        const disponibilidad = {
            desde: desdeDisp,
            ...disponibilidadDe({
                horarios: horarioArea.recordset, feriados: new Set(feriadosDisp.recordset.map(f => f.Fecha)),
                paradas: tramosParada, desde: desdeDisp, hoy, ahora,
            }),
        };
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
                    mtbfMinutos: mtbf, mtbfFallas: fechas.length, mttrMinutos: mttr, mttrFallas: paradas.length,
                    disponibilidad,
                },
                solicitudes: sols.recordset.map(s => ({ ...s, Codigo: codigo(s.SolId) })),
                cambios: cambios.recordset.map(c => ({
                    ...c, TipoLabel: ETIQUETA_TIPO[c.Tipo] || c.Tipo, SolCodigo: c.SolId ? codigo(c.SolId) : null, adjuntos: adjPorCambio[c.CamId] || [],
                })),
                estados,
                fichaTecnica,
                documentos,
            },
            catalogos,
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
        // Parte 2 de la ficha técnica (08/10): un cambio de cabezal o de firmware/software también actualiza la
        // ficha, si el técnico lo pidió (campo "ficha", JSON: { cabezal: {seccion, pos, serie} } | { software: {firmware, version} }).
        // Si eso falla, el cambio queda registrado igual y se avisa.
        let fichaActualizada = null;
        let fichaError = false;
        if (req.body?.ficha && (d.tipo === 'CABEZAL' || d.tipo === 'SOFTWARE')) {
            try {
                const extra = typeof req.body.ficha === 'string' ? JSON.parse(req.body.ficha) : req.body.ficha;
                fichaActualizada = await aplicarCambioEnFicha(pool, {
                    equipoId, usuario, fecha: d.fecha,
                    cabezal: d.tipo === 'CABEZAL' ? extra?.cabezal : null,
                    software: d.tipo === 'SOFTWARE' ? extra?.software : null,
                });
            } catch (e) {
                fichaError = true;
                logger.warn(`[ServicioTecnico] Cambio ${camId}: no se pudo actualizar la ficha técnica: ${e.message}`);
            }
        }
        emitirST(req, { equipoId, solId: d.solId || undefined });
        logger.info(`[ServicioTecnico] Cambio ${camId} (${d.tipo}) en máquina ${equipoId} por ${usuario.nombre}`);
        res.json({ success: true, data: { CamId: camId, fichaActualizada, fichaError } });
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

// ── Documentos de la máquina (ficha técnica, parte 3, 08/10) ─────────────────
// Fotos (la máquina, la placa de datos, las conexiones), manuales en PDF, videos cortos: ST_Adjuntos con Entidad
// 'EQUIPO' (las fotos pasan a WebP 80 al subir, como todo Servicio Técnico). Los enlaces a manuales van en la
// ficha (sección "Manuales y enlaces", Datos.doc). Se leen con la máquina (GET /equipos/:id); subir, renombrar y
// borrar: técnicos o Admin. Todo queda en el historial de la máquina.

// Archivo de esta máquina, o null.
async function documentoDe(pool, equipoId, adjId) {
    const r = await pool.request().input('A', sql.Int, adjId).input('E', sql.Int, equipoId).query(`
        SELECT AdjId, Archivo, NombreOriginal FROM dbo.ST_Adjuntos WHERE AdjId = @A AND Entidad = 'EQUIPO' AND EntidadId = @E`);
    return r.recordset[0] || null;
}

// POST /equipos/:id/adjuntos (multipart: adjuntos)
exports.adjuntarEquipo = async (req, res) => {
    const files = req.files || [];
    if (!exigirTecnico(req, res, 'subir archivos de una máquina')) { limpiarTemporales(files); return; }
    const equipoId = idNum(req.params.id);
    if (!equipoId) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Máquina inválida.' }); }
    if (!files.length) return res.status(400).json({ success: false, error: 'No llegó ningún archivo.' });
    try {
        const pool = await getPool();
        const eq = await pool.request().input('E', sql.Int, equipoId).query('SELECT EquipoID FROM dbo.ConfigEquipos WHERE EquipoID = @E');
        if (!eq.recordset.length) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe la máquina.' }); }
        const usuario = await usuarioActual(pool, req);
        const adj = await guardarAdjuntos(pool, { entidad: 'EQUIPO', entidadId: equipoId, files, usuario });
        if (adj.length) {
            await historial(pool, {
                entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'DOCUMENTO',
                detalle: `${adj.length === 1 ? 'Archivo agregado' : `${adj.length} archivos agregados`}: ${adj.map(a => a.NombreOriginal).join(', ')}`.slice(0, 4000),
            });
        }
        emitirST(req, { equipoId });
        res.json({ success: true, data: adj });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'equipos.adjuntar');
    }
};

// PUT /equipos/:id/adjuntos/:adjId { nombre } → el nombre que se muestra. Conserva la extensión del archivo (al
// descargarlo, el nombre es este).
exports.renombrarAdjuntoEquipo = async (req, res) => {
    if (!exigirTecnico(req, res, 'renombrar archivos de una máquina')) return;
    const equipoId = idNum(req.params.id);
    const adjId = idNum(req.params.adjId);
    let nombre = texto(req.body?.nombre, 200);
    if (!equipoId || !adjId) return res.status(400).json({ success: false, error: 'Archivo inválido.' });
    if (!nombre) return res.status(400).json({ success: false, error: 'Poné un nombre.' });
    try {
        const pool = await getPool();
        const a = await documentoDe(pool, equipoId, adjId);
        if (!a) return res.status(404).json({ success: false, error: 'Ese archivo ya no está en la máquina.' });
        const ext = path.extname(a.Archivo || '');
        if (ext && !nombre.toLowerCase().endsWith(ext.toLowerCase())) nombre = `${nombre}${ext}`;
        if (nombre !== a.NombreOriginal) {
            await pool.request().input('A', sql.Int, adjId).input('N', sql.NVarChar(260), nombre)
                .query('UPDATE dbo.ST_Adjuntos SET NombreOriginal = @N WHERE AdjId = @A');
            const usuario = await usuarioActual(pool, req);
            await historial(pool, { entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'DOCUMENTO', detalle: `Archivo renombrado: ${a.NombreOriginal} → ${nombre}` });
            emitirST(req, { equipoId });
        }
        res.json({ success: true, data: { NombreOriginal: nombre } });
    } catch (err) { responderError(res, err, 'equipos.renombrarAdjunto'); }
};

// DELETE /equipos/:id/adjuntos/:adjId → borra el archivo (de la base y del disco)
exports.borrarAdjuntoEquipo = async (req, res) => {
    if (!exigirTecnico(req, res, 'borrar archivos de una máquina')) return;
    const equipoId = idNum(req.params.id);
    const adjId = idNum(req.params.adjId);
    if (!equipoId || !adjId) return res.status(400).json({ success: false, error: 'Archivo inválido.' });
    try {
        const pool = await getPool();
        const a = await documentoDe(pool, equipoId, adjId);
        if (!a) return res.status(404).json({ success: false, error: 'Ese archivo ya no está en la máquina.' });
        await pool.request().input('A', sql.Int, adjId).query('DELETE FROM dbo.ST_Adjuntos WHERE AdjId = @A');
        try { fs.unlinkSync(rutaAdjunto('EQUIPO', equipoId, a.Archivo)); } catch (_) { /* ya no estaba */ }
        const usuario = await usuarioActual(pool, req);
        await historial(pool, { entidad: 'EQUIPO', entidadId: equipoId, usuario, accion: 'DOCUMENTO', detalle: `Archivo borrado: ${a.NombreOriginal}` });
        emitirST(req, { equipoId });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'equipos.borrarAdjunto'); }
};

exports.TIPOS_CAMBIO = TIPOS_CAMBIO;
exports.ETIQUETA_TIPO = ETIQUETA_TIPO;
exports._alertasDeFicha = alertasDeFicha;
exports._disponibilidadDe = disponibilidadDe;
