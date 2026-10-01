// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — mantenimientos (etapa 3): generación de trabajos a partir de los planes.
// Lo usan el controller (stMantenimientoController.js) y el job diario (jobs/servicioTecnico.job.js).
//
// Regla de los planes: cada plan activo tiene SIEMPRE un trabajo abierto (pendiente o en curso).
// Cuando se cierra (realizado, no realizado o cancelado) se genera el siguiente:
//   - realizado: N días/semanas/meses después del día en que se hizo, o de la fecha que tenía
//     programada si se hizo antes (adelantarlo no puede traer el siguiente para el mismo día);
//   - no realizado o cancelado: N después de la fecha que tenía programada.
// Si esa fecha ya pasó, queda para hoy. Las fechas son días de Uruguay ('AAAA-MM-DD').
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { hoyUY } = require('./servicioTecnicoComun');

const UNIDADES = ['DIA', 'SEMANA', 'MES'];
const TIPOS_TRABAJO = ['MANTENIMIENTO', 'TAREA'];
const ESTADOS_ABIERTOS = ['PENDIENTE', 'EN_CURSO'];

// Columnas del 30/09: se agregan solas la primera vez (idempotente, una vez por proceso), así no hace
// falta otro script para el deploy.
//   ST_Trabajos.HoraDesde / HoraHasta ('HH:MM'): franja horaria del trabajo.
//   ST_Planes.DiasSemana ('1,3,5': 1 = lunes … 7 = domingo): mantenimiento que se repite esos días de
//   cada semana, en vez de "cada N días/semanas/meses". Más la franja y el tiempo estimado del plan,
//   que pasan a cada trabajo que genera.
let esquemaListo = false;
async function asegurarEsquemaMantenimiento(pool) {
    if (esquemaListo) return;
    await pool.request().query(`
        IF COL_LENGTH('dbo.ST_Trabajos', 'HoraDesde') IS NULL ALTER TABLE dbo.ST_Trabajos ADD HoraDesde VARCHAR(5) NULL;
        IF COL_LENGTH('dbo.ST_Trabajos', 'HoraHasta') IS NULL ALTER TABLE dbo.ST_Trabajos ADD HoraHasta VARCHAR(5) NULL;
        IF COL_LENGTH('dbo.ST_Planes', 'DiasSemana') IS NULL ALTER TABLE dbo.ST_Planes ADD DiasSemana VARCHAR(20) NULL;
        IF COL_LENGTH('dbo.ST_Planes', 'HoraDesde') IS NULL ALTER TABLE dbo.ST_Planes ADD HoraDesde VARCHAR(5) NULL;
        IF COL_LENGTH('dbo.ST_Planes', 'HoraHasta') IS NULL ALTER TABLE dbo.ST_Planes ADD HoraHasta VARCHAR(5) NULL;
        IF COL_LENGTH('dbo.ST_Planes', 'MinutosEstimados') IS NULL ALTER TABLE dbo.ST_Planes ADD MinutosEstimados INT NULL;`);
    esquemaListo = true;
}

// ── Días de la semana de un plan ─────────────────────────────────────────────
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// '1,3,5' o [1, 3, 5] → [1, 3, 5] (sin repetidos, ordenados; 1 = lunes … 7 = domingo)
const leerDias = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
    .map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 7))].sort((a, b) => a - b);
const sumarDiasISO = (iso, n) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
};
const diaDeSemana = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
};
// El primer día marcado desde `desde` (incluido)
function proximoDiaMarcado(desde, dias) {
    for (let i = 0; i < 7; i++) {
        const f = sumarDiasISO(desde, i);
        if (dias.includes(diaDeSemana(f))) return f;
    }
    return desde;
}
const diasTexto = (dias) => {
    if (dias.length === 7) return 'todos los días';
    const n = dias.map(x => DIAS_CORTOS[x - 1]);
    return `los ${n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0]}`;
};

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

const cadaTexto = (valor, unidad, diasSemana = null) => {
    const dias = leerDias(diasSemana);
    if (dias.length) return diasTexto(dias);
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
    tareas = null, creadoPor = null, horaDesde = null, horaHasta = null,
}) {
    const pasos = tareas || await pasosDe(tx, procId);
    const minutos = minutosEstimados != null ? minutosEstimados
        : pasos.reduce((s, p) => s + (parseInt(p.MinutosEstimados ?? p.minutos, 10) || 0), 0);
    // La franja solo va si vino: los trabajos de los planes (job diario) no tocan esas columnas
    const conHora = !!(horaDesde && horaHasta);
    const r = await tx.request()
        .input('Tipo', sql.VarChar(15), tipo).input('Plan', sql.Int, planId).input('Proc', sql.Int, procId)
        .input('Eq', sql.Int, equipoId).input('EqT', sql.NVarChar(150), equipoId ? null : equipoTexto)
        .input('Tit', sql.NVarChar(200), titulo).input('Desc', sql.NVarChar(sql.MAX), descripcion)
        .input('F', sql.VarChar(10), fecha)
        .input('Tec', sql.Int, tecnico?.id || null).input('TecN', sql.NVarChar(150), tecnico?.nombre || null)
        .input('Min', sql.Int, minutos || 0).input('Para', sql.Bit, !!paraMaquina && !!equipoId)
        .input('U', sql.Int, creadoPor?.id || null).input('UN', sql.NVarChar(150), creadoPor?.nombre || null)
        .input('HD', sql.VarChar(5), conHora ? horaDesde : null).input('HH', sql.VarChar(5), conHora ? horaHasta : null)
        .query(`INSERT INTO dbo.ST_Trabajos (Tipo, PlanId, ProcId, EquipoId, EquipoTexto, Titulo, Descripcion, FechaProgramada, FechaOriginal,
                    TecnicoId, TecnicoNombre, MinutosEstimados, ParaMaquina, CreadoPorId, CreadoPorNombre${conHora ? ', HoraDesde, HoraHasta' : ''})
                OUTPUT INSERTED.TrabId
                VALUES (@Tipo, @Plan, @Proc, @Eq, @EqT, @Tit, @Desc, CAST(@F AS DATE), CAST(@F AS DATE),
                    @Tec, @TecN, @Min, @Para, @U, @UN${conHora ? ', @HD, @HH' : ''})`);
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
               p.HoraDesde, p.HoraHasta, p.MinutosEstimados,
               (SELECT COUNT(*) FROM dbo.ST_Trabajos t WHERE t.PlanId = p.PlanId AND t.Estado IN ('PENDIENTE', 'EN_CURSO')) AS Abiertos
        FROM dbo.ST_Planes p WITH (UPDLOCK) WHERE p.PlanId = @P`);
    const p = r.recordset[0];
    if (!p || !p.Activo || p.Abiertos > 0) return null;
    return crearTrabajo(tx, {
        tipo: 'MANTENIMIENTO', planId: p.PlanId, procId: p.ProcId, equipoId: p.EquipoId, equipoTexto: p.EquipoTexto,
        titulo: p.Titulo, descripcion: p.Descripcion, fecha: p.ProximaFecha,
        tecnico: p.TecnicoId ? { id: p.TecnicoId, nombre: p.TecnicoNombre } : null,
        paraMaquina: p.ParaMaquina, creadoPor: creadoPor || { id: null, nombre: 'Plan de mantenimiento' },
        horaDesde: p.HoraDesde, horaHasta: p.HoraHasta, minutosEstimados: p.MinutosEstimados ?? null,
    });
}

// Todos los planes activos sin trabajo abierto (lo corre el job diario y el calendario).
async function asegurarTodosLosPlanes(pool) {
    await asegurarEsquemaMantenimiento(pool);
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
        .query('SELECT CadaValor, CadaUnidad, DiasSemana, Activo FROM dbo.ST_Planes WITH (UPDLOCK) WHERE PlanId = @P');
    const p = r.recordset[0];
    if (!p) return null;
    const hoy = hoyUY();
    const programada = /^\d{4}-\d{2}-\d{2}/.test(String(fechaProgramada || '')) ? String(fechaProgramada).slice(0, 10) : hoy;
    let proxima;
    const dias = leerDias(p.DiasSemana);
    if (dias.length) {
        // Por días de la semana: el próximo día marcado después del que se cerró, y nunca antes de hoy
        const desde = sumarDiasISO(programada, 1);
        proxima = proximoDiaMarcado(desde > hoy ? desde : hoy, dias);
    } else {
        // Realizado antes de su fecha: se cuenta desde la fecha programada. Contando desde el día en que se
        // hizo, un plan cada 3 días programado para el 03/10 y hecho el 30/09 volvía a caer el 03/10 (30/09).
        const base = realizado ? (programada > hoy ? programada : hoy) : programada;
        proxima = sumarIntervalo(base, p.CadaValor, p.CadaUnidad);
        if (proxima < hoy) proxima = hoy;
    }
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
           t.CreadoPorNombre, t.FechaCreacion, t.HoraDesde, t.HoraHasta,
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
    await asegurarEsquemaMantenimiento(pool);
    const r = await pool.request().input('Id', sql.Int, trabId).input('Hoy', sql.VarChar(10), hoyUY())
        .query(`${SELECT_TRABAJO} WHERE t.TrabId = @Id`);
    return r.recordset[0] || null;
}

module.exports = {
    UNIDADES, TIPOS_TRABAJO, ESTADOS_ABIERTOS, SELECT_TRABAJO,
    sumarIntervalo, cadaTexto, crearTrabajo, asegurarTrabajoDePlan, asegurarTodosLosPlanes, avanzarPlan, leerTrabajo,
    asegurarEsquemaMantenimiento, leerDias, proximoDiaMarcado, diasTexto,
};
