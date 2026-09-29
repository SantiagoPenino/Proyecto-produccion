// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — mantenimientos (etapa 3): generación de trabajos a partir de los planes.
// Lo usan el controller (stMantenimientoController.js) y el job diario (jobs/servicioTecnico.job.js).
//
// Regla de los planes: cada plan activo tiene SIEMPRE un trabajo abierto (pendiente o en curso).
// Cuando se cierra (realizado, no realizado o cancelado) se genera el siguiente:
//   - realizado: N días/semanas/meses después del día en que se hizo;
//   - no realizado o cancelado: N después de la fecha que tenía programada.
// Si esa fecha ya pasó, queda para hoy. Las fechas son días de Uruguay ('AAAA-MM-DD').
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { hoyUY } = require('./servicioTecnicoComun');

const UNIDADES = ['DIA', 'SEMANA', 'MES'];
const TIPOS_TRABAJO = ['MANTENIMIENTO', 'TAREA'];
const ESTADOS_ABIERTOS = ['PENDIENTE', 'EN_CURSO'];

// 'AAAA-MM-DD' + N unidades (fin de mes: el 31 + 1 mes = último día del mes siguiente).
function sumarIntervalo(fechaISO, valor, unidad) {
    const [y, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const n = Math.max(1, parseInt(valor, 10) || 1);
    if (unidad === 'SEMANA') dt.setUTCDate(dt.getUTCDate() + 7 * n);
    else if (unidad === 'MES') {
        const dia = dt.getUTCDate();
        dt.setUTCDate(1);
        dt.setUTCMonth(dt.getUTCMonth() + n);
        const ultimo = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
        dt.setUTCDate(Math.min(dia, ultimo));
    } else dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
}

const cadaTexto = (valor, unidad) => {
    const n = parseInt(valor, 10) || 1;
    const u = { DIA: ['día', 'días'], SEMANA: ['semana', 'semanas'], MES: ['mes', 'meses'] }[unidad] || ['', ''];
    return n === 1 ? `cada ${u[0]}` : `cada ${n} ${u[1]}`;
};

// Pasos de un procedimiento (para copiarlos como tareas).
async function pasosDe(tx, procId) {
    if (!procId) return [];
    const r = await tx.request().input('P', sql.Int, procId)
        .query('SELECT Orden, Texto, Detalle, MinutosEstimados FROM dbo.ST_ProcedimientoPasos WHERE ProcId = @P ORDER BY Orden, PasoId');
    return r.recordset;
}

/**
 * Crea un trabajo del calendario con sus tareas (las del procedimiento, o las que se pasen).
 * `tx` puede ser el pool o una transacción. Devuelve el TrabId.
 */
async function crearTrabajo(tx, {
    tipo = 'MANTENIMIENTO', planId = null, procId = null, equipoId = null, equipoTexto = null,
    titulo, descripcion = null, fecha, tecnico = null, minutosEstimados = null, paraMaquina = false,
    tareas = null, creadoPor = null,
}) {
    const pasos = tareas || await pasosDe(tx, procId);
    const minutos = minutosEstimados != null ? minutosEstimados
        : pasos.reduce((s, p) => s + (parseInt(p.MinutosEstimados ?? p.minutos, 10) || 0), 0);
    const r = await tx.request()
        .input('Tipo', sql.VarChar(15), tipo).input('Plan', sql.Int, planId).input('Proc', sql.Int, procId)
        .input('Eq', sql.Int, equipoId).input('EqT', sql.NVarChar(150), equipoId ? null : equipoTexto)
        .input('Tit', sql.NVarChar(200), titulo).input('Desc', sql.NVarChar(sql.MAX), descripcion)
        .input('F', sql.VarChar(10), fecha)
        .input('Tec', sql.Int, tecnico?.id || null).input('TecN', sql.NVarChar(150), tecnico?.nombre || null)
        .input('Min', sql.Int, minutos || 0).input('Para', sql.Bit, !!paraMaquina && !!equipoId)
        .input('U', sql.Int, creadoPor?.id || null).input('UN', sql.NVarChar(150), creadoPor?.nombre || null)
        .query(`INSERT INTO dbo.ST_Trabajos (Tipo, PlanId, ProcId, EquipoId, EquipoTexto, Titulo, Descripcion, FechaProgramada, FechaOriginal,
                    TecnicoId, TecnicoNombre, MinutosEstimados, ParaMaquina, CreadoPorId, CreadoPorNombre)
                OUTPUT INSERTED.TrabId
                VALUES (@Tipo, @Plan, @Proc, @Eq, @EqT, @Tit, @Desc, CAST(@F AS DATE), CAST(@F AS DATE),
                    @Tec, @TecN, @Min, @Para, @U, @UN)`);
    const trabId = r.recordset[0].TrabId;
    let orden = 1;
    for (const p of pasos) {
        const textoPaso = String(p.Texto ?? p.texto ?? '').trim().slice(0, 500);
        if (!textoPaso) continue;
        await tx.request()
            .input('T', sql.Int, trabId).input('O', sql.Int, orden++)
            .input('Tx', sql.NVarChar(500), textoPaso)
            .input('D', sql.NVarChar(sql.MAX), p.Detalle ?? p.detalle ?? null)
            .input('M', sql.Int, parseInt(p.MinutosEstimados ?? p.minutos, 10) || 0)
            .query('INSERT INTO dbo.ST_TrabajoTareas (TrabId, Orden, Texto, Detalle, MinutosEstimados) VALUES (@T, @O, @Tx, @D, @M)');
    }
    return trabId;
}

// Si el plan está activo y no tiene trabajo abierto, genera el de su próxima fecha. Devuelve el TrabId creado o null.
async function asegurarTrabajoDePlan(tx, planId, creadoPor = null) {
    const r = await tx.request().input('P', sql.Int, planId).query(`
        SELECT p.PlanId, p.Titulo, p.Descripcion, p.EquipoId, p.EquipoTexto, p.ProcId, p.TecnicoId, p.TecnicoNombre,
               CONVERT(VARCHAR(10), p.ProximaFecha, 23) AS ProximaFecha, p.ParaMaquina, p.Activo,
               (SELECT COUNT(*) FROM dbo.ST_Trabajos t WHERE t.PlanId = p.PlanId AND t.Estado IN ('PENDIENTE', 'EN_CURSO')) AS Abiertos
        FROM dbo.ST_Planes p WITH (UPDLOCK) WHERE p.PlanId = @P`);
    const p = r.recordset[0];
    if (!p || !p.Activo || p.Abiertos > 0) return null;
    return crearTrabajo(tx, {
        tipo: 'MANTENIMIENTO', planId: p.PlanId, procId: p.ProcId, equipoId: p.EquipoId, equipoTexto: p.EquipoTexto,
        titulo: p.Titulo, descripcion: p.Descripcion, fecha: p.ProximaFecha,
        tecnico: p.TecnicoId ? { id: p.TecnicoId, nombre: p.TecnicoNombre } : null,
        paraMaquina: p.ParaMaquina, creadoPor: creadoPor || { id: null, nombre: 'Plan de mantenimiento' },
    });
}

// Todos los planes activos sin trabajo abierto (lo corre el job diario y el calendario).
async function asegurarTodosLosPlanes(pool) {
    const r = await pool.request().query(`
        SELECT p.PlanId FROM dbo.ST_Planes p
        WHERE p.Activo = 1 AND NOT EXISTS (SELECT 1 FROM dbo.ST_Trabajos t WHERE t.PlanId = p.PlanId AND t.Estado IN ('PENDIENTE', 'EN_CURSO'))`);
    let creados = 0;
    for (const { PlanId } of r.recordset) {
        try { if (await asegurarTrabajoDePlan(pool, PlanId)) creados++; }
        catch (err) { logger.error(`[ServicioTecnico] plan ${PlanId}: no se pudo generar el trabajo: ${err.message}`); }
    }
    return creados;
}

// Se cerró un trabajo de un plan: calcula la próxima fecha y genera el siguiente.
async function avanzarPlan(tx, { planId, realizado, fechaProgramada, creadoPor = null }) {
    if (!planId) return null;
    const r = await tx.request().input('P', sql.Int, planId)
        .query('SELECT CadaValor, CadaUnidad, Activo FROM dbo.ST_Planes WITH (UPDLOCK) WHERE PlanId = @P');
    const p = r.recordset[0];
    if (!p) return null;
    const hoy = hoyUY();
    const base = realizado ? hoy : String(fechaProgramada).slice(0, 10);
    let proxima = sumarIntervalo(base, p.CadaValor, p.CadaUnidad);
    if (proxima < hoy) proxima = hoy;
    await tx.request().input('P', sql.Int, planId).input('F', sql.VarChar(10), proxima)
        .query('UPDATE dbo.ST_Planes SET ProximaFecha = CAST(@F AS DATE) WHERE PlanId = @P');
    if (!p.Activo) return null;
    return asegurarTrabajoDePlan(tx, planId, creadoPor);
}

// Lectura de un trabajo con lo que necesitan el calendario y el detalle. `hoy` = día de Uruguay.
const SELECT_TRABAJO = `
    SELECT t.TrabId, t.Tipo, t.PlanId, t.ProcId, t.EquipoId, t.EquipoTexto, t.Titulo, t.Descripcion,
           CONVERT(VARCHAR(10), t.FechaProgramada, 23) AS FechaProgramada, CONVERT(VARCHAR(10), t.FechaOriginal, 23) AS FechaOriginal,
           t.TecnicoId, t.TecnicoNombre, t.Estado, t.VecesPospuesto, t.MinutosEstimados, t.MinutosReales,
           t.FechaInicio, t.FechaFin, t.Observaciones, t.Motivo, t.ParaMaquina, t.EstadoEquipoPrevio,
           t.CreadoPorNombre, t.FechaCreacion,
           e.Nombre AS EquipoNombre, e.Estado AS EquipoEstado, LTRIM(RTRIM(e.AreaID)) AS EquipoArea,
           p.Titulo AS PlanTitulo, p.CadaValor, p.CadaUnidad, pr.Titulo AS ProcTitulo,
           (SELECT COUNT(*) FROM dbo.ST_TrabajoTareas x WHERE x.TrabId = t.TrabId) AS TareasTotal,
           (SELECT COUNT(*) FROM dbo.ST_TrabajoTareas x WHERE x.TrabId = t.TrabId AND x.Hecha = 1) AS TareasHechas,
           CASE WHEN t.Estado IN ('PENDIENTE', 'EN_CURSO') AND t.FechaProgramada < CAST(@Hoy AS DATE) THEN 1 ELSE 0 END AS Vencido
    FROM dbo.ST_Trabajos t
    LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = t.EquipoId
    LEFT JOIN dbo.ST_Planes p ON p.PlanId = t.PlanId
    LEFT JOIN dbo.ST_Procedimientos pr ON pr.ProcId = t.ProcId`;

async function leerTrabajo(pool, trabId) {
    const r = await pool.request().input('Id', sql.Int, trabId).input('Hoy', sql.VarChar(10), hoyUY())
        .query(`${SELECT_TRABAJO} WHERE t.TrabId = @Id`);
    return r.recordset[0] || null;
}

module.exports = {
    UNIDADES, TIPOS_TRABAJO, ESTADOS_ABIERTOS, SELECT_TRABAJO,
    sumarIntervalo, cadaTexto, crearTrabajo, asegurarTrabajoDePlan, asegurarTodosLosPlanes, avanzarPlan, leerTrabajo,
};
