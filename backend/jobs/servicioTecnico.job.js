// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — job diario (07:30, hora de Montevideo). Plan: docs/servicio-tecnico-plan.md
//   1. Cada plan activo tiene su próximo trabajo generado.
//   2. A cada técnico: "hoy tenés N trabajos" (los sin asignar, al encargado).
//   3. Lo que quedó vencido ayer: al técnico asignado (o al encargado).
//   4. Los seguimientos de solicitudes que son para hoy: al técnico de la solicitud (o al encargado).
//   5. Los lunes, el reporte de la semana anterior al encargado (o a los técnicos).
// Los avisos van a la campanita y como push (services/notificacionesService.js).
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { notificar } = require('../services/notificacionesService');
const { MODULO, hoyUY, encargado, codigo, tecnicos } = require('../services/servicioTecnicoComun');
const { asegurarTodosLosPlanes } = require('../services/stMantenimientoService');

const JOB_ID = 'servicio-tecnico-diario';
const HORA_CORRIDA = '30 7 * * *';
let ioGlobal = null;

const fmtDia = (iso) => String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const fmtMin = (m) => {
    const n = Math.round(m || 0);
    if (n < 60) return `${n} min`;
    return `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`;
};
const restarDias = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - n);
    return dt.toISOString().slice(0, 10);
};
const diaAnterior = (iso) => restarDias(iso, 1);

async function run() {
    const pool = await getPool();
    const hoy = hoyUY();
    const ayer = diaAnterior(hoy);
    const io = ioGlobal;
    const enc = await encargado(pool);
    const resumen = { planesGenerados: 0, avisosHoy: 0, vencidos: 0, seguimientos: 0 };

    resumen.planesGenerados = await asegurarTodosLosPlanes(pool);

    // 2. Lo de hoy, por técnico (los sin asignar, al encargado)
    const deHoy = await pool.request().input('Hoy', sql.VarChar(10), hoy).query(`
        SELECT TecnicoId, COUNT(*) AS N, SUM(MinutosEstimados) AS Min
        FROM dbo.ST_Trabajos
        WHERE Estado IN ('PENDIENTE', 'EN_CURSO') AND FechaProgramada = CAST(@Hoy AS DATE)
        GROUP BY TecnicoId`);
    for (const f of deHoy.recordset) {
        const destino = f.TecnicoId || enc?.id;
        if (!destino) continue;
        await notificar({
            usuarioIds: [destino], modulo: MODULO, io,
            titulo: f.TecnicoId
                ? `Hoy tenés ${f.N} trabajo${f.N === 1 ? '' : 's'} de servicio técnico`
                : `Hoy hay ${f.N} trabajo${f.N === 1 ? '' : 's'} sin asignar`,
            texto: `Tiempo estimado: ${fmtMin(f.Min)}`,
            url: '/servicio-tecnico?seccion=semana', tag: `st-hoy-${hoy}`,
        });
        resumen.avisosHoy++;
    }

    // 3. Vencidos desde ayer (se avisa una sola vez: el primer día que están vencidos)
    const vencidos = await pool.request().input('Ayer', sql.VarChar(10), ayer).query(`
        SELECT TrabId, Titulo, TecnicoId FROM dbo.ST_Trabajos
        WHERE Estado IN ('PENDIENTE', 'EN_CURSO') AND FechaProgramada = CAST(@Ayer AS DATE)`);
    for (const t of vencidos.recordset) {
        const destinos = [t.TecnicoId, enc?.id].filter(Boolean);
        if (!destinos.length) continue;
        await notificar({
            usuarioIds: destinos, modulo: MODULO, io,
            titulo: `Quedó vencido: ${t.Titulo}`,
            texto: `Era para ayer (${fmtDia(ayer)}). Hacelo o posponelo con el motivo.`,
            url: `/servicio-tecnico?trab=${t.TrabId}`, tag: `st-trab-${t.TrabId}`,
        });
        resumen.vencidos++;
    }

    // 4. Seguimientos de solicitudes para hoy
    const seg = await pool.request().input('Hoy', sql.VarChar(10), hoy).query(`
        SELECT SolId, Titulo, TecnicoId, SeguimientoNota FROM dbo.ST_Solicitudes
        WHERE RequiereSeguimiento = 1 AND SeguimientoHechoFecha IS NULL AND FechaSeguimiento = CAST(@Hoy AS DATE)`);
    for (const s of seg.recordset) {
        const destino = s.TecnicoId || enc?.id;
        if (!destino) continue;
        await notificar({
            usuarioIds: [destino], modulo: MODULO, io,
            titulo: `Seguimiento para hoy: ${codigo(s.SolId)}`,
            texto: `${s.Titulo}${s.SeguimientoNota ? ` — ${s.SeguimientoNota}` : ''}`,
            url: `/servicio-tecnico?sol=${s.SolId}`, tag: `st-${s.SolId}`,
        });
        resumen.seguimientos++;
    }

    // 5. Los lunes: el reporte de la semana anterior, al encargado (o a los técnicos si no hay encargado).
    const [y, m, d] = hoy.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) {
        const lunesPasado = restarDias(hoy, 7);
        const destinos = enc ? [enc.id] : (await tecnicos(pool)).map(t => t.id);
        if (destinos.length) {
            await notificar({
                usuarioIds: destinos, modulo: MODULO, io,
                titulo: 'Reporte semanal de Servicio Técnico',
                texto: `Semana del ${fmtDia(lunesPasado)} al ${fmtDia(diaAnterior(hoy))}: fallas, mantenimientos, proyectos, tiempos e insumos.`,
                url: `/servicio-tecnico?seccion=reportes&semana=${lunesPasado}`, tag: `st-semanal-${lunesPasado}`,
            });
            resumen.reporteSemanal = true;
        }
    }

    logger.info(`[SERVICIO-TECNICO] Job diario: ${JSON.stringify(resumen)}`);
    return resumen;
}

function proximaCorrida() {
    const ahora = new Date();
    const prox = new Date(ahora);
    prox.setHours(7, 30, 0, 0);
    if (prox <= ahora) prox.setDate(prox.getDate() + 1);
    return prox;
}

function startServicioTecnicoJob(io) {
    ioGlobal = io || null;
    const cron = require('node-cron');
    const reg = require('./jobRegistry');
    if (!reg.getAll().some(j => j.id === JOB_ID)) {
        reg.registrar(JOB_ID, {
            nombre: 'Servicio Técnico — avisos del día',
            descripcion: 'Genera los mantenimientos de los planes que falten y avisa a cada técnico lo que tiene hoy, lo que quedó vencido ayer y los seguimientos del día.',
            schedule: 'Todos los días a las 07:30',
        });
    }
    reg.setFn(JOB_ID, run);

    const ejecutar = async () => {
        reg.marcarInicio(JOB_ID);
        try {
            reg.marcarOk(JOB_ID, await run());
        } catch (e) {
            reg.marcarError(JOB_ID, e);
            logger.error(`[SERVICIO-TECNICO] ❌ Job diario: ${e.message}`);
        }
        reg.setProximaEjecucion(JOB_ID, proximaCorrida());
    };
    cron.schedule(HORA_CORRIDA, ejecutar, { timezone: 'America/Montevideo' });
    reg.setProximaEjecucion(JOB_ID, proximaCorrida());
    logger.info('⏱️ [CRON] Servicio Técnico — avisos del día: todos los días a las 07:30.');
}

module.exports = { run, startServicioTecnicoJob };
