// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — reportes (etapa 5). Plan: docs/servicio-tecnico-plan.md
//
// GET /reportes/resumen?desde=&hasta=  → técnicos (tomadas, resueltas, finalizadas, derivadas y por
//   qué, tiempos, trabajos), máquinas que más fallan, quién reporta más, fallas por tipo, insumos.
// GET /reportes/semanal?semana=AAAA-MM-DD → lo anterior para esa semana (lunes a domingo) más
//   mantenimientos y tareas, proyectos (avances) y la lista de fallas de la semana.
//
// Criterios (los mismos en todo el módulo):
//   - "Tomadas": veces que un técnico tomó una solicitud (si pasó por dos técnicos, cuenta para los dos).
//   - "Finalizadas": solicitudes cerradas en el período, a nombre del técnico que la tenía.
//   - "Resueltas": finalizadas con resultado Resuelta (aparte: en parte, no resuelta, cancelada).
//   - "Derivadas": veces que el técnico la derivó, con el motivo que escribió.
//   - Fallas de una máquina: solicitudes pedidas en el período, sin contar las canceladas (duplicadas).
//   - Parada: minutos desde que se pidió hasta que se finalizó (o hasta ahora) de las que la reportaron parada.
// Fechas: días de Uruguay ('AAAA-MM-DD'), ambos inclusive.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const { codigo, fechaISO, hoyUY, responderError, exigirTecnico, tecnicos } = require('../services/servicioTecnicoComun');

const sumarDias = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
};
const lunesDe = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return sumarDias(iso, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
};
const redondear = (n) => (n == null ? null : Math.round(Number(n)));
const RANGO = 'BETWEEN CAST(@Desde AS DATE) AND CAST(@Hasta AS DATE)'; // para columnas DATE
const EN_RANGO = (col) => `(${col} >= CAST(@Desde AS DATE) AND ${col} < DATEADD(DAY, 1, CAST(@Hasta AS DATE)))`; // DATETIME
const SQL_PARADA = `ISNULL(s.MinutosParada, CASE WHEN s.Estado <> 'FINALIZADA' AND s.MaquinaNoTrabaja = 1
                    THEN DATEDIFF(MINUTE, s.FechaSolicitud, GETDATE()) END)`;

// Todo lo del período. `pool` + rango 'AAAA-MM-DD'.
async function datosPeriodo(pool, desde, hasta) {
    const req = () => pool.request().input('Desde', sql.VarChar(10), desde).input('Hasta', sql.VarChar(10), hasta);
    const [tomadas, finalizadas, derivaciones, trabTec, pospuestos, maquinas, titulosMaq, solicitantes, categorias, totales, insumos, insumosTop, tecs] = await Promise.all([
        req().query(`SELECT h.UsuarioId, MAX(h.UsuarioNombre) AS Nombre, COUNT(*) AS Tomadas
                     FROM dbo.ST_Historial h WHERE h.Entidad = 'SOLICITUD' AND h.Accion = 'TOMADA' AND ${EN_RANGO('h.Fecha')}
                     GROUP BY h.UsuarioId`),
        req().query(`SELECT s.TecnicoId, MAX(s.TecnicoNombre) AS Nombre, COUNT(*) AS Finalizadas,
                            SUM(CASE WHEN s.Resultado = 'RESUELTA' THEN 1 ELSE 0 END) AS Resueltas,
                            SUM(CASE WHEN s.Resultado = 'PARCIAL' THEN 1 ELSE 0 END) AS Parciales,
                            SUM(CASE WHEN s.Resultado = 'NO_RESUELTA' THEN 1 ELSE 0 END) AS NoResueltas,
                            SUM(CASE WHEN s.Resultado = 'CANCELADA' THEN 1 ELSE 0 END) AS Canceladas,
                            AVG(CASE WHEN s.Resultado <> 'CANCELADA' AND s.FechaTomada IS NOT NULL THEN CAST(DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaTomada) AS FLOAT) END) AS RespuestaProm,
                            AVG(CASE WHEN s.Resultado <> 'CANCELADA' THEN CAST(DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaFin) AS FLOAT) END) AS ResolucionProm
                     FROM dbo.ST_Solicitudes s
                     WHERE s.Estado = 'FINALIZADA' AND s.TecnicoId IS NOT NULL AND ${EN_RANGO('s.FechaFin')}
                     GROUP BY s.TecnicoId`),
        req().query(`SELECT h.UsuarioId, h.UsuarioNombre, h.EntidadId AS SolId, h.Fecha, h.Detalle, h.Motivo, h.AUsuarioNombre, s.Titulo
                     FROM dbo.ST_Historial h LEFT JOIN dbo.ST_Solicitudes s ON s.SolId = h.EntidadId
                     WHERE h.Entidad = 'SOLICITUD' AND h.Accion = 'DERIVADA' AND ${EN_RANGO('h.Fecha')}
                     ORDER BY h.Fecha DESC`),
        req().query(`SELECT t.TecnicoId, MAX(t.TecnicoNombre) AS Nombre,
                            SUM(CASE WHEN t.Estado = 'REALIZADO' THEN 1 ELSE 0 END) AS Realizados,
                            SUM(CASE WHEN t.Estado = 'NO_REALIZADO' THEN 1 ELSE 0 END) AS NoRealizados,
                            SUM(CASE WHEN t.Estado = 'REALIZADO' THEN t.MinutosReales END) AS MinReales,
                            SUM(CASE WHEN t.Estado = 'REALIZADO' THEN t.MinutosEstimados END) AS MinEstimados
                     FROM dbo.ST_Trabajos t
                     WHERE t.Estado IN ('REALIZADO', 'NO_REALIZADO') AND t.TecnicoId IS NOT NULL AND ${EN_RANGO('t.FechaFin')}
                     GROUP BY t.TecnicoId`),
        req().query(`SELECT h.UsuarioId, COUNT(*) AS Pospuestos
                     FROM dbo.ST_Historial h WHERE h.Entidad = 'TRABAJO' AND h.Accion = 'POSPUESTO' AND ${EN_RANGO('h.Fecha')}
                     GROUP BY h.UsuarioId`),
        req().query(`SELECT s.EquipoId, LTRIM(RTRIM(e.Nombre)) AS Nombre, LTRIM(RTRIM(e.AreaID)) AS AreaID, e.Estado,
                            COUNT(*) AS Fallas,
                            SUM(CASE WHEN s.Prioridad IN ('ALTA', 'CRITICA') THEN 1 ELSE 0 END) AS Graves,
                            SUM(CASE WHEN s.MaquinaNoTrabaja = 1 THEN 1 ELSE 0 END) AS Paradas,
                            SUM(${SQL_PARADA}) AS MinutosParada,
                            MAX(s.FechaSolicitud) AS Ultima
                     FROM dbo.ST_Solicitudes s JOIN dbo.ConfigEquipos e ON e.EquipoID = s.EquipoId
                     WHERE ${EN_RANGO('s.FechaSolicitud')} AND ISNULL(s.Resultado, '') <> 'CANCELADA'
                     GROUP BY s.EquipoId, e.Nombre, e.AreaID, e.Estado
                     ORDER BY COUNT(*) DESC, SUM(${SQL_PARADA}) DESC`),
        req().query(`SELECT s.EquipoId, s.Titulo, COUNT(*) AS N
                     FROM dbo.ST_Solicitudes s
                     WHERE s.EquipoId IS NOT NULL AND ${EN_RANGO('s.FechaSolicitud')} AND ISNULL(s.Resultado, '') <> 'CANCELADA'
                     GROUP BY s.EquipoId, s.Titulo`),
        req().query(`SELECT MAX(s.SolicitanteId) AS SolicitanteId, MAX(s.SolicitanteNombre) AS Nombre, MAX(UPPER(LTRIM(RTRIM(u.AreaUsuario)))) AS Area,
                            COUNT(*) AS Solicitudes,
                            SUM(CASE WHEN s.Categoria = 'MAQUINA' THEN 1 ELSE 0 END) AS DeMaquinas,
                            SUM(CASE WHEN s.Resultado = 'CANCELADA' THEN 1 ELSE 0 END) AS Canceladas,
                            SUM(CASE WHEN s.Prioridad IN ('ALTA', 'CRITICA') THEN 1 ELSE 0 END) AS Graves
                     FROM dbo.ST_Solicitudes s LEFT JOIN dbo.Usuarios u ON u.IdUsuario = s.SolicitanteId
                     WHERE ${EN_RANGO('s.FechaSolicitud')}
                     GROUP BY ISNULL(CAST(s.SolicitanteId AS VARCHAR(20)), 'txt:' + ISNULL(s.SolicitanteNombre, ''))
                     ORDER BY COUNT(*) DESC`),
        req().query(`SELECT s.Categoria, COUNT(*) AS N FROM dbo.ST_Solicitudes s WHERE ${EN_RANGO('s.FechaSolicitud')} GROUP BY s.Categoria ORDER BY COUNT(*) DESC`),
        req().query(`SELECT
                        (SELECT COUNT(*) FROM dbo.ST_Solicitudes s WHERE ${EN_RANGO('s.FechaSolicitud')}) AS Nuevas,
                        (SELECT COUNT(*) FROM dbo.ST_Solicitudes s WHERE s.Estado = 'FINALIZADA' AND ${EN_RANGO('s.FechaFin')}) AS Finalizadas,
                        (SELECT COUNT(*) FROM dbo.ST_Solicitudes s WHERE s.Estado = 'FINALIZADA' AND s.Resultado = 'RESUELTA' AND ${EN_RANGO('s.FechaFin')}) AS Resueltas,
                        (SELECT COUNT(*) FROM dbo.ST_Solicitudes s WHERE s.Estado <> 'FINALIZADA') AS AbiertasAhora,
                        (SELECT AVG(CAST(DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaTomada) AS FLOAT)) FROM dbo.ST_Solicitudes s
                            WHERE s.FechaTomada IS NOT NULL AND ${EN_RANGO('s.FechaSolicitud')}) AS RespuestaProm,
                        (SELECT AVG(CAST(DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaFin) AS FLOAT)) FROM dbo.ST_Solicitudes s
                            WHERE s.Estado = 'FINALIZADA' AND s.Resultado <> 'CANCELADA' AND ${EN_RANGO('s.FechaFin')}) AS ResolucionProm,
                        (SELECT SUM(${SQL_PARADA}) FROM dbo.ST_Solicitudes s WHERE ${EN_RANGO('s.FechaSolicitud')}) AS MinutosParada,
                        (SELECT COUNT(*) FROM dbo.ST_Historial h WHERE h.Entidad = 'SOLICITUD' AND h.Accion = 'DERIVADA' AND ${EN_RANGO('h.Fecha')}) AS Derivaciones`),
        req().query(`SELECT ISNULL(u.Moneda, 'UYU') AS Moneda, COUNT(*) AS Usos, SUM(u.CostoTotal) AS Total
                     FROM dbo.ST_InsumosUso u WHERE ${EN_RANGO('u.Fecha')} GROUP BY ISNULL(u.Moneda, 'UYU')`),
        req().query(`SELECT TOP 10 u.VarId, MAX(u.Nombre) AS Nombre, MAX(u.Unidad) AS Unidad, ISNULL(u.Moneda, 'UYU') AS Moneda,
                            SUM(u.Cantidad) AS Cantidad, SUM(u.CostoTotal) AS Total, COUNT(*) AS Usos
                     FROM dbo.ST_InsumosUso u WHERE ${EN_RANGO('u.Fecha')}
                     GROUP BY u.VarId, ISNULL(u.Moneda, 'UYU') ORDER BY SUM(u.CostoTotal) DESC`),
        tecnicos(pool),
    ]);

    // Técnicos: todos los del área + cualquiera que haya tenido actividad (ej. un Admin).
    const porTec = new Map();
    const fila = (id, nombre) => {
        if (!porTec.has(id)) porTec.set(id, { id, nombre, tomadas: 0, finalizadas: 0, resueltas: 0, parciales: 0, noResueltas: 0, canceladas: 0,
            derivadas: 0, motivos: [], respuestaProm: null, resolucionProm: null, trabajosRealizados: 0, trabajosNoRealizados: 0,
            minutosReales: 0, minutosEstimados: 0, pospuestos: 0 });
        const f = porTec.get(id);
        if (!f.nombre && nombre) f.nombre = nombre;
        return f;
    };
    tecs.forEach(t => fila(t.id, t.nombre));
    tomadas.recordset.forEach(r => { fila(r.UsuarioId, r.Nombre).tomadas = r.Tomadas; });
    finalizadas.recordset.forEach(r => Object.assign(fila(r.TecnicoId, r.Nombre), {
        finalizadas: r.Finalizadas, resueltas: r.Resueltas, parciales: r.Parciales, noResueltas: r.NoResueltas, canceladas: r.Canceladas,
        respuestaProm: redondear(r.RespuestaProm), resolucionProm: redondear(r.ResolucionProm),
    }));
    derivaciones.recordset.forEach(r => {
        const f = fila(r.UsuarioId, r.UsuarioNombre);
        f.derivadas++;
        f.motivos.push({ solId: r.SolId, codigo: codigo(r.SolId), titulo: r.Titulo, fecha: r.Fecha, a: r.AUsuarioNombre || String(r.Detalle || '').replace(/^A (servicio externo: )?/, ''), motivo: r.Motivo });
    });
    trabTec.recordset.forEach(r => Object.assign(fila(r.TecnicoId, r.Nombre), {
        trabajosRealizados: r.Realizados, trabajosNoRealizados: r.NoRealizados, minutosReales: r.MinReales || 0, minutosEstimados: r.MinEstimados || 0,
    }));
    pospuestos.recordset.forEach(r => { if (porTec.has(r.UsuarioId)) porTec.get(r.UsuarioId).pospuestos = r.Pospuestos; });
    const listaTec = [...porTec.values()].filter(t => t.id != null)
        .sort((a, b) => (b.finalizadas + b.tomadas + b.trabajosRealizados) - (a.finalizadas + a.tomadas + a.trabajosRealizados));

    // Máquinas con sus fallas más repetidas.
    const titulos = {};
    titulosMaq.recordset.forEach(r => { (titulos[r.EquipoId] = titulos[r.EquipoId] || []).push({ titulo: r.Titulo, n: r.N }); });
    const listaMaq = maquinas.recordset.map(m => ({
        ...m, MinutosParada: m.MinutosParada || 0,
        titulos: (titulos[m.EquipoId] || []).sort((a, b) => b.n - a.n).slice(0, 3),
    }));

    const tot = totales.recordset[0] || {};
    return {
        desde, hasta,
        totales: { ...tot, RespuestaProm: redondear(tot.RespuestaProm), ResolucionProm: redondear(tot.ResolucionProm), MinutosParada: tot.MinutosParada || 0 },
        tecnicos: listaTec,
        maquinas: listaMaq,
        solicitantes: solicitantes.recordset,
        categorias: categorias.recordset,
        insumos: { porMoneda: insumos.recordset, top: insumosTop.recordset },
    };
}

// GET /reportes/resumen?desde=&hasta= (por defecto: los últimos 30 días)
exports.resumen = async (req, res) => {
    if (!exigirTecnico(req, res, 'ver los reportes')) return;
    const hoy = hoyUY();
    const hasta = fechaISO(req.query.hasta) || hoy;
    const desde = fechaISO(req.query.desde) || sumarDias(hasta, -29);
    if (hasta < desde) return res.status(400).json({ success: false, error: 'Rango de fechas inválido.' });
    try {
        const pool = await getPool();
        res.json({ success: true, data: await datosPeriodo(pool, desde, hasta) });
    } catch (err) { responderError(res, err, 'reportes.resumen'); }
};

// GET /reportes/semanal?semana=AAAA-MM-DD (cualquier día de la semana; por defecto la anterior)
exports.semanal = async (req, res) => {
    if (!exigirTecnico(req, res, 'ver los reportes')) return;
    const hoy = hoyUY();
    const base = fechaISO(req.query.semana) || sumarDias(hoy, -7);
    const desde = lunesDe(base);
    const hasta = sumarDias(desde, 6);
    try {
        const pool = await getPool();
        const req2 = () => pool.request().input('Desde', sql.VarChar(10), desde).input('Hasta', sql.VarChar(10), hasta).input('Hoy', sql.VarChar(10), hoy);
        const [periodo, trabajos, pospuestos, avances, cambiosProy, activos, fallas, usos] = await Promise.all([
            datosPeriodo(pool, desde, hasta),
            req2().query(`SELECT t.Estado, t.Tipo, COUNT(*) AS N, SUM(t.MinutosEstimados) AS MinEst, SUM(t.MinutosReales) AS MinReal
                          FROM dbo.ST_Trabajos t WHERE t.FechaProgramada ${RANGO}
                          GROUP BY t.Estado, t.Tipo`),
            req2().query(`SELECT h.EntidadId AS TrabId, t.Titulo, h.Fecha, h.UsuarioNombre, h.Detalle, h.Motivo
                          FROM dbo.ST_Historial h JOIN dbo.ST_Trabajos t ON t.TrabId = h.EntidadId
                          WHERE h.Entidad = 'TRABAJO' AND h.Accion = 'POSPUESTO' AND ${EN_RANGO('h.Fecha')}
                          ORDER BY h.Fecha`),
            req2().query(`SELECT h.EntidadId AS ProyId, p.Titulo, p.Progreso, p.Estado, h.Fecha, h.UsuarioNombre, h.Detalle
                          FROM dbo.ST_Historial h JOIN dbo.ST_Proyectos p ON p.ProyId = h.EntidadId
                          WHERE h.Entidad = 'PROYECTO' AND h.Accion = 'AVANCE' AND ${EN_RANGO('h.Fecha')}
                          ORDER BY p.Titulo, h.Fecha`),
            req2().query(`SELECT h.EntidadId AS ProyId, p.Titulo, h.Fecha, h.UsuarioNombre, h.Detalle, h.Motivo
                          FROM dbo.ST_Historial h JOIN dbo.ST_Proyectos p ON p.ProyId = h.EntidadId
                          WHERE h.Entidad = 'PROYECTO' AND h.Accion = 'ESTADO' AND ${EN_RANGO('h.Fecha')}
                          ORDER BY h.Fecha`),
            req2().query(`SELECT p.ProyId, p.Titulo, p.Estado, p.Progreso, p.ResponsableNombre, CONVERT(VARCHAR(10), p.FechaEstimadaFin, 23) AS FechaEstimadaFin,
                                 CASE WHEN p.FechaEstimadaFin < CAST(@Hoy AS DATE) THEN 1 ELSE 0 END AS Atrasado
                          FROM dbo.ST_Proyectos p WHERE p.Estado IN ('PLANIFICADO', 'EN_CURSO', 'EN_PAUSA') ORDER BY p.Titulo`),
            req2().query(`SELECT s.SolId, s.Titulo, s.Categoria, s.Prioridad, s.Estado, s.Resultado, s.FechaSolicitud, s.FechaFin,
                                 s.TecnicoNombre, s.SolicitanteNombre, e.Nombre AS EquipoNombre, s.EquipoTexto, ${SQL_PARADA} AS MinutosParada
                          FROM dbo.ST_Solicitudes s LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = s.EquipoId
                          WHERE ${EN_RANGO('s.FechaSolicitud')} OR (s.Estado = 'FINALIZADA' AND ${EN_RANGO('s.FechaFin')})
                          ORDER BY s.FechaSolicitud`),
            req2().query(`SELECT u.Fecha, u.Nombre, u.Unidad, u.Cantidad, u.CostoTotal, u.Moneda, u.UsuarioNombre, e.Nombre AS EquipoNombre, u.SolId
                          FROM dbo.ST_InsumosUso u LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = u.EquipoId
                          WHERE ${EN_RANGO('u.Fecha')} ORDER BY u.Fecha`),
        ]);
        // Mantenimientos y tareas de la semana por estado.
        const trab = { programados: 0, realizados: 0, noRealizados: 0, cancelados: 0, pendientes: 0, minEstimadosRealizados: 0, minReales: 0, porTipo: {} };
        trabajos.recordset.forEach(r => {
            trab.programados += r.N;
            if (r.Estado === 'REALIZADO') { trab.realizados += r.N; trab.minEstimadosRealizados += r.MinEst || 0; trab.minReales += r.MinReal || 0; }
            else if (r.Estado === 'NO_REALIZADO') trab.noRealizados += r.N;
            else if (r.Estado === 'CANCELADO') trab.cancelados += r.N;
            else trab.pendientes += r.N;
            trab.porTipo[r.Tipo] = (trab.porTipo[r.Tipo] || 0) + r.N;
        });
        res.json({
            success: true,
            data: {
                ...periodo, hoy,
                trabajos: { ...trab, pospuestos: pospuestos.recordset },
                proyectos: { avances: avances.recordset, cambios: cambiosProy.recordset, activos: activos.recordset },
                fallas: fallas.recordset.map(f => ({ ...f, Codigo: codigo(f.SolId) })),
                usos: usos.recordset,
            },
        });
    } catch (err) { responderError(res, err, 'reportes.semanal'); }
};

exports._lunesDe = lunesDe;
exports._sumarDias = sumarDias;
