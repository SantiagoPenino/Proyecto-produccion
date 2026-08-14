const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ISO: 1=Lunes ... 7=Domingo — mismo criterio que usa sp_CalcularFechaEntrega.
// Genera la lista de fechas del rango a partir de strings 'YYYY-MM-DD', sin pasar por
// Date() con valores que vengan de la base (para no pisar el problema de zona horaria de
// src/utils/fechas.js: acá las fechas del calendario las generamos nosotros, no las leemos).
function generarDias(desdeStr, hastaStr) {
    const dias = [];
    let [y, m, d] = desdeStr.split('-').map(Number);
    const [yh, mh, dh] = hastaStr.split('-').map(Number);
    let cursor = Date.UTC(y, m - 1, d);
    const fin = Date.UTC(yh, mh - 1, dh);
    while (cursor <= fin) {
        const fecha = new Date(cursor);
        const yyyy = fecha.getUTCFullYear();
        const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(fecha.getUTCDate()).padStart(2, '0');
        const fechaStr = `${yyyy}-${mm}-${dd}`;
        const diaSemanaISO = ((fecha.getUTCDay() + 6) % 7) + 1; // getUTCDay: 0=Domingo..6=Sábado -> ISO 1=Lunes..7=Domingo
        dias.push({ fecha: fechaStr, diaSemanaISO });
        cursor += 86400000;
    }
    return dias;
}

function addDiasStr(fechaStr, dias) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + dias);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Horas decimales entre dos 'HH:MM'. Si HoraFin <= HoraInicio se asume que el turno cruza
// medianoche (ej. T2 17:00-02:00).
function horasEntre(horaInicioStr, horaFinStr) {
    const [hi, mi] = horaInicioStr.split(':').map(Number);
    const [hf, mf] = horaFinStr.split(':').map(Number);
    let minutos = (hf * 60 + mf) - (hi * 60 + mi);
    if (minutos <= 0) minutos += 24 * 60;
    return minutos / 60;
}

const NOMBRES_DIA = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };

// Prioridad de asignación, en este orden (pedido explícito del usuario 13-ago-2026):
//   1) urgente_atrasado — Urgente que ingresó ANTES de hoy y sigue sin producir
//   2) urgente_hoy      — Urgente que ingresó HOY antes de las 12 (mismo corte que CORTEURGENTE)
//   3) pendiente        — el resto (Urgente ingresado hoy después de las 12 + todo lo Normal),
//                         por fecha de ingreso
const GRUPOS = ['urgente_atrasado', 'urgente_hoy', 'pendiente'];
const GRUPO_LABEL = { urgente_atrasado: 'Urgente atrasado', urgente_hoy: 'Urgente de hoy', pendiente: 'Pendiente' };

function grupoDe(orden, hoyStr) {
    if (orden.Prioridad === 'Urgente' && orden.FechaIngreso < hoyStr) return 'urgente_atrasado';
    if (orden.Prioridad === 'Urgente' && orden.FechaIngreso === hoyStr && orden.HoraIngreso < 12) return 'urgente_hoy';
    return 'pendiente';
}

// Semáforo: compara el día en que la simulación de capacidad dice que se va a producir contra
// la FechaEstimadaEntrega (la promesa fija al cliente, ver sp_CalcularFechaEntrega). No mide si
// la orden en sí está urgente — mide si el plan de producción cumple lo prometido.
function semaforoDe(diaProyectado, fechaPrometida) {
    if (!fechaPrometida) return null;
    if (diaProyectado > fechaPrometida) return 'rojo';    // se produce DESPUÉS de lo prometido
    if (diaProyectado === fechaPrometida) return 'amarillo'; // justo en el límite, sin margen
    return 'verde';                                        // se produce con margen
}
const PESO_SEMAFORO = { rojo: 2, amarillo: 1, verde: 0 };
function peorSemaforo(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return PESO_SEMAFORO[a] >= PESO_SEMAFORO[b] ? a : b;
}

// Agenda de un área: por cada día del rango, si es laborable (según ConfigHorarioLaboral,
// con el mismo fallback Lunes-Viernes que usa sp_CalcularFechaEntrega si el área no tiene
// horario cargado) y qué órdenes tienen FechaEstimadaEntrega ese día.
exports.getAgenda = async (req, res) => {
    const { area } = req.query;
    let { desde, hasta } = req.query;
    if (!area) return res.status(400).json({ error: "Falta el parámetro 'area'." });

    const hoy = new Date();
    if (!desde) desde = hoy.toISOString().slice(0, 10);
    if (!hasta) {
        const h = new Date(desde + 'T00:00:00Z');
        h.setUTCDate(h.getUTCDate() + 13); // 14 días por defecto (incluyendo 'desde')
        hasta = h.toISOString().slice(0, 10);
    }

    try {
        const pool = await getPool();

        const [horarioRes, feriadosRes, ordenesRes] = await Promise.all([
            // HoraInicio/HoraFin son TIME: convertidas acá a 'HH:MM' — si no, el driver las
            // devuelve como Date anclado a 1970-01-01 y el front termina mostrando "1970-".
            pool.request().input('area', sql.VarChar(20), area)
                .query(`SELECT DiaSemana, Turno,
                               CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio,
                               CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
                        FROM dbo.ConfigHorarioLaboral WHERE AreaID = @area AND Activo = 1`),
            pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
                .query("SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, Descripcion FROM dbo.CalendarioFeriados WHERE Fecha BETWEEN @desde AND @hasta"),
            pool.request().input('area', sql.VarChar(20), area).input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
                .query(`
                    SELECT OrdenID, CodigoOrden, Cliente, DescripcionTrabajo, Prioridad, Magnitud, UM, Estado, EstadoenArea,
                           CONVERT(VARCHAR(10), FechaEstimadaEntrega, 23) AS FechaDia
                    FROM dbo.Ordenes
                    WHERE AreaID = @area
                      AND FechaEstimadaEntrega >= @desde AND FechaEstimadaEntrega < DATEADD(day, 1, @hasta)
                      AND ISNULL(Estado, '') <> 'Cancelado'
                    ORDER BY FechaEstimadaEntrega ASC
                `)
        ]);

        const horarios = horarioRes.recordset;
        const tieneHorario = horarios.length > 0;
        const feriados = new Map(feriadosRes.recordset.map(f => [f.Fecha, f.Descripcion]));
        const ordenesPorDia = new Map();
        for (const o of ordenesRes.recordset) {
            if (!ordenesPorDia.has(o.FechaDia)) ordenesPorDia.set(o.FechaDia, []);
            ordenesPorDia.get(o.FechaDia).push(o);
        }

        const dias = generarDias(desde, hasta).map(({ fecha, diaSemanaISO }) => {
            const esFeriado = feriados.has(fecha);
            const horariosDelDia = horarios.filter(h => h.DiaSemana === diaSemanaISO);
            const laborable = tieneHorario
                ? (horariosDelDia.length > 0 && !esFeriado)
                : (diaSemanaISO <= 5 && !esFeriado); // fallback: Lunes-Viernes, igual que el SP sin horario cargado
            const ordenes = ordenesPorDia.get(fecha) || [];

            return {
                fecha,
                diaSemanaISO,
                diaNombre: NOMBRES_DIA[diaSemanaISO],
                esFeriado,
                feriadoDescripcion: feriados.get(fecha) || null,
                laborable,
                horarios: horariosDelDia.map(h => ({ turno: h.Turno, horaInicio: h.HoraInicio, horaFin: h.HoraFin })),
                totalOrdenes: ordenes.length,
                ordenes
            };
        });

        res.json({ area, desde, hasta, tieneHorarioConfigurado: tieneHorario, dias });
    } catch (err) {
        logger.error("Error getting agenda de planificación:", err);
        res.status(500).json({ error: err.message });
    }
};

// Motor de capacidad vs carga pendiente de un área, proyectado día a día.
// "Terminado" = FechaPronto IS NOT NULL (lo que pasa después en logística no cuenta acá).
// Requiere que al menos una máquina activa del área tenga VelocidadValor cargado, y que esa
// velocidad esté en la MISMA unidad que Ordenes.Magnitud para esa área — si no, el número da
// mal aunque no truene. Por ahora eso vale para DF, EMB, ECOUV, SB y TPU (ver
// project_capacidad_planta.md); DIRECTA y EST quedan sin capacidad cargada a propósito.
// Función pura (sin req/res) para poder reusarla desde el endpoint Y desde el job de snapshot
// diario (capacidadDiaria.job.js).
//
// NO calibra contra el historial de FechaPronto (se probó y se sacó a pedido del usuario,
// 13-ago-2026): usar el Horario Laboral VIGENTE para calcular cuántas horas trabajó la planta
// en el pasado da un número retroactivo poco confiable en cuanto alguien edita el horario. La
// capacidad es siempre la Capacidad Instalada (ficha técnica de ConfigEquipos.VelocidadValor).
// "Esto empieza ahora": si en el futuro se quiere calibrar, calibrar solo con datos capturados
// desde hoy en adelante (HistoricoCapacidadDiaria), nunca reconstruyendo el pasado.
async function calcularSituacion(pool, area, { desde, dias }) {
    const hasta = addDiasStr(desde, dias - 1);

    const [maquinasRes, horarioRes, feriadosRes, ordenesRes] = await Promise.all([
        pool.request().input('area', sql.VarChar(20), area)
            .query("SELECT EquipoID, Nombre, VelocidadValor, VelocidadUnidad FROM dbo.ConfigEquipos WHERE AreaID = @area AND Activo = 1 AND VelocidadValor IS NOT NULL"),
        pool.request().input('area', sql.VarChar(20), area)
            .query(`SELECT DiaSemana, CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio, CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
                    FROM dbo.ConfigHorarioLaboral WHERE AreaID = @area AND Activo = 1`),
        pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
            .query("SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha FROM dbo.CalendarioFeriados WHERE Fecha BETWEEN @desde AND @hasta"),
        // Orden de asignación: Urgente atrasado (de antes de hoy) primero, después Urgente de
        // hoy ingresado antes de las 12 (mismo corte que CORTEURGENTE), después el resto por
        // fecha de ingreso. Ver GRUPOS/grupoDe más arriba.
        pool.request().input('area', sql.VarChar(20), area).input('hoy', sql.Date, desde)
            .query(`SELECT OrdenID, CodigoOrden, Cliente, Prioridad,
                           CONVERT(VARCHAR(10), FechaIngreso, 23) AS FechaIngreso,
                           DATEPART(HOUR, FechaIngreso) AS HoraIngreso,
                           CONVERT(VARCHAR(10), FechaEstimadaEntrega, 23) AS FechaPrometida,
                           TRY_CAST(Magnitud AS DECIMAL(18,2)) AS Magnitud
                    FROM dbo.Ordenes
                    WHERE AreaID = @area AND FechaPronto IS NULL AND ISNULL(Estado, '') <> 'Cancelado'
                    ORDER BY
                        CASE
                            WHEN Prioridad = 'Urgente' AND CAST(FechaIngreso AS DATE) < @hoy THEN 0
                            WHEN Prioridad = 'Urgente' AND CAST(FechaIngreso AS DATE) = @hoy AND DATEPART(HOUR, FechaIngreso) < 12 THEN 1
                            ELSE 2
                        END,
                        FechaIngreso ASC`)
    ]);

    const maquinas = maquinasRes.recordset;
    if (maquinas.length === 0) {
        return {
            area, tieneCapacidad: false,
            motivo: 'Ninguna máquina de esta área tiene Velocidad Real cargada (Configuración → Equipos).'
        };
    }

    const unidad = maquinas[0].VelocidadUnidad;
    const horarios = horarioRes.recordset;
    const feriados = new Set(feriadosRes.recordset.map(f => f.Fecha));

    const capacidadTeorica = maquinas.reduce((s, m) => s + Number(m.VelocidadValor), 0);
    const capacidadHoraria = capacidadTeorica;
    const fuenteCapacidad = 'teorica';

    const ordenes = ordenesRes.recordset
        .filter(o => o.Magnitud != null && o.Magnitud > 0)
        .map(o => ({ ...o, grupo: grupoDe(o, desde) }));
    const cargaPendienteTotal = ordenes.reduce((s, o) => s + o.Magnitud, 0);
    const ordenesUrgentes = ordenes.filter(o => o.Prioridad === 'Urgente');
    const cargaPendienteUrgente = ordenesUrgentes.reduce((s, o) => s + o.Magnitud, 0);
    const cargaPendienteNormal = cargaPendienteTotal - cargaPendienteUrgente;

    let colaIndex = 0;
    let colaRestante = ordenes.length ? ordenes[0].Magnitud : 0;
    let cargaAcumuladaRestante = cargaPendienteTotal;
    const ordenesConProyeccion = [];
    const diasResultado = [];

    const gruposVacios = () => Object.fromEntries(GRUPOS.map(g => [g, {
        metros: 0, cantidad: 0, semaforo: null,
        fechaIngresoMin: null, fechaIngresoMax: null,
        fechaPrometidaMin: null // la promesa más vieja del grupo — la más atrasada
    }]));

    for (const { fecha, diaSemanaISO } of generarDias(desde, hasta)) {
        const esFeriado = feriados.has(fecha);
        const horariosDelDia = horarios.filter(h => h.DiaSemana === diaSemanaISO);
        const horasLaborables = horariosDelDia.reduce((s, h) => s + horasEntre(h.HoraInicio, h.HoraFin), 0);
        const laborable = !esFeriado && horasLaborables > 0;
        const capacidadDia = laborable ? horasLaborables * capacidadHoraria : 0;

        let capacidadRestanteDia = capacidadDia;
        const gruposDia = gruposVacios();
        while (capacidadRestanteDia > 0 && colaIndex < ordenes.length) {
            const orden = ordenes[colaIndex];
            if (colaRestante <= capacidadRestanteDia) {
                capacidadRestanteDia -= colaRestante;
                cargaAcumuladaRestante -= colaRestante;
                const semaforo = semaforoDe(fecha, orden.FechaPrometida);
                ordenesConProyeccion.push({ ...orden, diaProyectado: fecha, semaforo });
                gruposDia[orden.grupo].metros += colaRestante;
                gruposDia[orden.grupo].cantidad += 1;
                gruposDia[orden.grupo].semaforo = peorSemaforo(gruposDia[orden.grupo].semaforo, semaforo);
                const fMin = gruposDia[orden.grupo].fechaIngresoMin;
                const fMax = gruposDia[orden.grupo].fechaIngresoMax;
                gruposDia[orden.grupo].fechaIngresoMin = (!fMin || orden.FechaIngreso < fMin) ? orden.FechaIngreso : fMin;
                gruposDia[orden.grupo].fechaIngresoMax = (!fMax || orden.FechaIngreso > fMax) ? orden.FechaIngreso : fMax;
                if (orden.FechaPrometida) {
                    const fpMin = gruposDia[orden.grupo].fechaPrometidaMin;
                    gruposDia[orden.grupo].fechaPrometidaMin = (!fpMin || orden.FechaPrometida < fpMin) ? orden.FechaPrometida : fpMin;
                }
                colaIndex++;
                colaRestante = colaIndex < ordenes.length ? ordenes[colaIndex].Magnitud : 0;
            } else {
                colaRestante -= capacidadRestanteDia;
                cargaAcumuladaRestante -= capacidadRestanteDia;
                capacidadRestanteDia = 0;
            }
        }

        for (const g of GRUPOS) gruposDia[g].metros = Math.round(gruposDia[g].metros * 100) / 100;

        diasResultado.push({
            fecha, diaSemanaISO, laborable, esFeriado,
            horasLaborables: Math.round(horasLaborables * 100) / 100,
            capacidadDia: Math.round(capacidadDia * 100) / 100,
            grupos: gruposDia,
            ordenesCompletadas: GRUPOS.reduce((s, g) => s + gruposDia[g].cantidad, 0),
            cargaAcumuladaRestante: Math.round(Math.max(0, cargaAcumuladaRestante) * 100) / 100
        });
        // OJO: antes cortaba acá apenas se vaciaba la cola ("no hace falta seguir
        // proyectando") — pero eso dejaba sin `grupos`/capacidadDia a los días siguientes
        // dentro de la ventana visible (agenda de 14 días), y la tarjeta se veía distinta
        // según si el área tenía backlog o no (bug real, visto en EMB: solo HOY mostraba la
        // caja de capacidad). Se sigue calculando todo el rango pedido — es aritmética en
        // memoria, no cuesta nada aunque el backlog ya esté en cero.
    }

    const fechaAgotamiento = diasResultado.find(d => d.cargaAcumuladaRestante <= 0 && cargaPendienteTotal > 0)?.fecha || null;

    return {
        area, tieneCapacidad: true, unidad,
        grupoLabels: GRUPO_LABEL,
        capacidadHoraria: Math.round(capacidadHoraria * 100) / 100,
        capacidadDiaHoy: diasResultado[0]?.fecha === desde ? diasResultado[0].capacidadDia : null,
        horasProduccionHoy: diasResultado[0]?.fecha === desde ? diasResultado[0].horasLaborables : null,
        fuenteCapacidad, // siempre 'teorica' (ficha técnica de ConfigEquipos.VelocidadValor) — sin calibración contra historial
        capacidadTeorica: Math.round(capacidadTeorica * 100) / 100,
        maquinas: maquinas.map(m => ({ nombre: m.Nombre, velocidad: m.VelocidadValor })),
        cargaPendienteTotal: Math.round(cargaPendienteTotal * 100) / 100,
        cargaPendienteUrgente: Math.round(cargaPendienteUrgente * 100) / 100,
        cargaPendienteNormal: Math.round(cargaPendienteNormal * 100) / 100,
        cantidadOrdenesPendientes: ordenes.length,
        cantidadOrdenesPendientesUrgente: ordenesUrgentes.length,
        fechaAgotamiento,
        horizonteAgotado: !fechaAgotamiento && cargaPendienteTotal > 0, // el backlog no se absorbe dentro del horizonte proyectado
        dias: diasResultado,
        ordenes: ordenesConProyeccion // uso interno (getDetalleGrupo) — getCapacidad lo saca antes de responder
    };
}

// Guarda (o actualiza) la foto del día para un área en HistoricoCapacidadDiaria. Se llama desde
// el job diario (capacidadDiaria.job.js) y, oportunistamente, desde getCapacidad — así el
// histórico empieza a llenarse desde ya sin depender de que el server se reinicie para que el
// cron arranque a correr.
async function upsertSnapshotDiario(pool, area, fecha, situacion) {
    if (!situacion.tieneCapacidad) return;
    await pool.request()
        .input('AreaID', sql.VarChar(20), area)
        .input('Fecha', sql.Date, fecha)
        .input('CapacidadDia', sql.Decimal(18, 2), situacion.capacidadDiaHoy)
        .input('Unidad', sql.VarChar(30), situacion.unidad)
        .input('FuenteCapacidad', sql.VarChar(20), situacion.fuenteCapacidad)
        .input('MetrosPendientesTotal', sql.Decimal(18, 2), situacion.cargaPendienteTotal)
        .input('MetrosPendientesUrgente', sql.Decimal(18, 2), situacion.cargaPendienteUrgente)
        .input('MetrosPendientesNormal', sql.Decimal(18, 2), situacion.cargaPendienteNormal)
        .input('CantidadOrdenesPendientes', sql.Int, situacion.cantidadOrdenesPendientes)
        .input('CantidadOrdenesPendientesUrgente', sql.Int, situacion.cantidadOrdenesPendientesUrgente)
        .query(`
            MERGE dbo.HistoricoCapacidadDiaria AS target
            USING (SELECT @AreaID AS AreaID, @Fecha AS Fecha) AS src
            ON target.AreaID = src.AreaID AND target.Fecha = src.Fecha
            WHEN MATCHED THEN UPDATE SET
                CapacidadDia = @CapacidadDia, Unidad = @Unidad, FuenteCapacidad = @FuenteCapacidad,
                MetrosPendientesTotal = @MetrosPendientesTotal, MetrosPendientesUrgente = @MetrosPendientesUrgente,
                MetrosPendientesNormal = @MetrosPendientesNormal, CantidadOrdenesPendientes = @CantidadOrdenesPendientes,
                CantidadOrdenesPendientesUrgente = @CantidadOrdenesPendientesUrgente, RegistradoEn = GETDATE()
            WHEN NOT MATCHED THEN INSERT
                (AreaID, Fecha, CapacidadDia, Unidad, FuenteCapacidad, MetrosPendientesTotal, MetrosPendientesUrgente,
                 MetrosPendientesNormal, CantidadOrdenesPendientes, CantidadOrdenesPendientesUrgente, RegistradoEn)
                VALUES (@AreaID, @Fecha, @CapacidadDia, @Unidad, @FuenteCapacidad, @MetrosPendientesTotal, @MetrosPendientesUrgente,
                        @MetrosPendientesNormal, @CantidadOrdenesPendientes, @CantidadOrdenesPendientesUrgente, GETDATE());
        `);
}

exports.getCapacidad = async (req, res) => {
    const { area } = req.query;
    if (!area) return res.status(400).json({ error: "Falta el parámetro 'area'." });

    let { desde } = req.query;
    const hoyStr = new Date().toISOString().slice(0, 10);
    const esHoy = !desde || desde === hoyStr;
    if (!desde) desde = hoyStr;
    const dias = Math.min(parseInt(req.query.dias) || 60, 120);

    try {
        const pool = await getPool();
        const situacion = await calcularSituacion(pool, area, { desde, dias });

        if (esHoy && situacion.tieneCapacidad) {
            // No bloquea la respuesta si falla — es un registro histórico, no algo crítico del pedido.
            upsertSnapshotDiario(pool, area, hoyStr, situacion).catch(e => logger.error('Error guardando snapshot diario:', e.message));
        }

        // El detalle orden-por-orden puede ser miles de filas (todo el backlog) — no viaja acá,
        // se pide bajo demanda por (fecha, grupo) con getDetalleGrupo.
        const { ordenes, ...situacionSinDetalle } = situacion;
        res.json(situacionSinDetalle);
    } catch (err) {
        logger.error("Error calculando capacidad de planificación:", err);
        res.status(500).json({ error: err.message });
    }
};

// Detalle orden-por-orden de un (fecha, grupo) puntual — para el click "mostrame qué órdenes
// componen esto" en cada tarjeta de día. Recalcula la simulación completa (misma que
// getCapacidad) y filtra; no cachea, pero es liviano (unas pocas queries + un loop en memoria).
exports.getDetalleGrupo = async (req, res) => {
    const { area, fecha, grupo } = req.query;
    if (!area || !fecha || !grupo) return res.status(400).json({ error: "Faltan parámetros: area, fecha, grupo." });
    if (!GRUPOS.includes(grupo)) return res.status(400).json({ error: `grupo inválido, debe ser uno de: ${GRUPOS.join(', ')}` });

    try {
        const pool = await getPool();
        const hoyStr = new Date().toISOString().slice(0, 10);
        // Necesita cubrir desde hoy hasta la fecha pedida para que la simulación llegue ahí.
        const [y, m, d] = fecha.split('-').map(Number);
        const [yh, mh, dh] = hoyStr.split('-').map(Number);
        const diasNecesarios = Math.max(1, Math.round((Date.UTC(y, m - 1, d) - Date.UTC(yh, mh - 1, dh)) / 86400000) + 1);

        const situacion = await calcularSituacion(pool, area, { desde: hoyStr, dias: Math.min(diasNecesarios, 120) });
        if (!situacion.tieneCapacidad) return res.json({ area, fecha, grupo, ordenes: [] });

        const ordenes = situacion.ordenes.filter(o => o.diaProyectado === fecha && o.grupo === grupo);
        res.json({ area, fecha, grupo, unidad: situacion.unidad, ordenes });
    } catch (err) {
        logger.error("Error obteniendo detalle de grupo:", err);
        res.status(500).json({ error: err.message });
    }
};

// Histórico de snapshots diarios de un área — para ver la tendencia (¿el backlog crece o baja?).
exports.getHistorico = async (req, res) => {
    const { area } = req.query;
    if (!area) return res.status(400).json({ error: "Falta el parámetro 'area'." });
    const dias = Math.min(parseInt(req.query.dias) || 30, 180);

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('area', sql.VarChar(20), area)
            .input('desde', sql.Date, addDiasStr(new Date().toISOString().slice(0, 10), -dias))
            .query(`SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, CapacidadDia, Unidad, FuenteCapacidad,
                           MetrosPendientesTotal, MetrosPendientesUrgente, MetrosPendientesNormal,
                           CantidadOrdenesPendientes, CantidadOrdenesPendientesUrgente
                    FROM dbo.HistoricoCapacidadDiaria
                    WHERE AreaID = @area AND Fecha >= @desde
                    ORDER BY Fecha ASC`);
        res.json({ area, dias: result.recordset });
    } catch (err) {
        logger.error("Error obteniendo histórico de capacidad:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.calcularSituacion = calcularSituacion;
exports.upsertSnapshotDiario = upsertSnapshotDiario;
