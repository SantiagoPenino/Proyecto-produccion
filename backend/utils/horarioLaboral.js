// =============================================================================
// Horas laborales de un área (26/10/2026, plan INF-SIS-2026-04).
//
// Cuenta cuánto tiempo de un intervalo cae dentro del horario laboral del área
// (Configuración › Horario laboral = dbo.ConfigHorarioLaboral) sin los feriados
// (dbo.CalendarioFeriados). Lo usa el ciclo en planta de cada orden
// (services/cicloPlantaService.js).
//
// - Hora de Uruguay: UTC−3 fijo, sin horario de verano desde 2015 (igual que la
//   disponibilidad de máquinas de Servicio Técnico, stEquiposController).
// - Un turno con HoraFin <= HoraInicio pasa la medianoche y sigue al día siguiente
//   (mismo criterio que horasEntre de Planificación).
// - Un feriado saca los turnos que EMPIEZAN ese día.
// - Área sin horario cargado: lunes a viernes de 9 a 17 (y tieneHorario() = false,
//   para que la pantalla lo avise).
// - Los instantes son los Date que devuelve el driver (ms reales): en producción el SQL
//   guarda UTC y el driver lee con useUTC (config/db.js).
// =============================================================================
const UY_MS = 3 * 3600000;
const DIA_MS = 24 * 3600000;

// El portal guarda algunas órdenes con otro código que la planta (mismo mapa que getOrdersByArea):
// si un código no tiene horario propio, se usa el de su equivalente.
const EQUIVALENTES = {
    DF: ['DTF'], DTF: ['DF'],
    SB: ['SUB'], SUB: ['SB'],
    DIRECTA: ['IMD', 'XMD'], IMD: ['DIRECTA', 'XMD'], XMD: ['DIRECTA', 'IMD'],
};
const HORARIO_POR_DEFECTO = [1, 2, 3, 4, 5].map(d => ({ DiaSemana: d, HoraInicio: '09:00', HoraFin: '17:00' }));

const norm = (a) => String(a || '').trim().toUpperCase();
const aMs = (x) => (x instanceof Date ? x.getTime() : Number(x));
const minutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
// 'AAAA-MM-DD' de Uruguay del instante ms
const diaUY = (ms) => new Date(ms - UY_MS).toISOString().slice(0, 10);
const sumarDias = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const diaSemanaISO = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
};
// ms del instante 'AAAA-MM-DD' + minutos desde la medianoche, hora de Uruguay
const instanteUY = (iso, mins) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) + mins * 60000 + UY_MS;
};
// Une tramos [inicio, fin) que se pisan o se tocan.
function unirTramos(tramos) {
    const orden = tramos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of orden) {
        const ult = out[out.length - 1];
        if (ult && a <= ult[1]) ult[1] = Math.max(ult[1], b);
        else out.push([a, b]);
    }
    return out;
}
const sumaMin = (tramos) => tramos.reduce((t, [a, b]) => t + (b - a), 0) / 60000;

/**
 * @param {{ horarios: Array<{AreaID, DiaSemana, HoraInicio, HoraFin}>, feriados: string[] }} datos
 *        HoraInicio/HoraFin como 'HH:MM'; feriados como 'AAAA-MM-DD'. Solo las filas activas.
 */
function crearCalendario({ horarios = [], feriados = [] } = {}) {
    const porArea = new Map();   // área → { dia ISO → [[iniMin, finMin]] }
    for (const h of horarios) {
        const area = norm(h.AreaID);
        if (!porArea.has(area)) porArea.set(area, {});
        const dias = porArea.get(area);
        const ini = minutos(h.HoraInicio);
        let fin = minutos(h.HoraFin);
        if (fin <= ini) fin += 24 * 60;          // pasa la medianoche
        (dias[Number(h.DiaSemana)] = dias[Number(h.DiaSemana)] || []).push([ini, fin]);
    }
    const porDefecto = {};
    for (const h of HORARIO_POR_DEFECTO) porDefecto[h.DiaSemana] = [[minutos(h.HoraInicio), minutos(h.HoraFin)]];
    const fer = new Set(feriados.map(f => String(f).slice(0, 10)));

    const codigoConHorario = (area) => {
        const a = norm(area);
        if (porArea.has(a)) return a;
        return (EQUIVALENTES[a] || []).find(e => porArea.has(e)) || null;
    };
    const diasDe = (area) => { const c = codigoConHorario(area); return c ? porArea.get(c) : porDefecto; };

    // Tramos de trabajo del área dentro de [desde, hasta), unidos.
    function tramos(area, desde, hasta) {
        const a = aMs(desde), b = aMs(hasta);
        if (!(b > a)) return [];
        const dias = diasDe(area);
        const out = [];
        // Desde el día anterior: un turno nocturno que arrancó ayer puede seguir hoy.
        for (let f = sumarDias(diaUY(a), -1), ultimo = diaUY(b); f <= ultimo; f = sumarDias(f, 1)) {
            if (fer.has(f)) continue;
            for (const [ini, fin] of dias[diaSemanaISO(f)] || []) {
                const x = Math.max(instanteUY(f, ini), a), y = Math.min(instanteUY(f, fin), b);
                if (y > x) out.push([x, y]);
            }
        }
        return unirTramos(out);
    }

    return {
        tramos,
        tieneHorario: (area) => codigoConHorario(area) !== null,
        /** Minutos laborales entre dos instantes (Date o ms). */
        minutosLaborales: (area, desde, hasta) => sumaMin(tramos(area, desde, hasta)),
        /** Minutos laborales de varias ventanas [[desde, hasta]] dentro de [limiteDesde, limiteHasta]; las que se pisan cuentan una vez. */
        minutosEnVentanas(area, ventanas, limiteDesde, limiteHasta) {
            const lim = [aMs(limiteDesde), aMs(limiteHasta)];
            const recortadas = unirTramos(ventanas.map(([x, y]) => [Math.max(aMs(x), lim[0]), Math.min(aMs(y), lim[1])]));
            return recortadas.reduce((t, [x, y]) => t + sumaMin(tramos(area, x, y)), 0);
        },
        /** Minutos de una jornada típica: promedio de los días que tienen horario. */
        minutosJornada(area) {
            const dias = Object.values(diasDe(area));
            if (!dias.length) return 8 * 60;
            return dias.reduce((t, tr) => t + sumaMin(unirTramos(tr.map(([i, f]) => [i * 60000, f * 60000]))), 0) / dias.length;
        },
    };
}

// Calendario de la base, guardado 5 minutos en memoria. invalidarCalendario() al guardar un horario o un feriado.
let cache = null;
const VIGENCIA_MS = 5 * 60000;
async function obtenerCalendario(pool) {
    if (cache && Date.now() - cache.cuando < VIGENCIA_MS) return cache.calendario;
    const [hor, fer] = [
        await pool.request().query(`
            SELECT LTRIM(RTRIM(AreaID)) AS AreaID, DiaSemana,
                   CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio, CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
            FROM dbo.ConfigHorarioLaboral WHERE Activo = 1`),
        await pool.request().query('SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha FROM dbo.CalendarioFeriados'),
    ];
    const calendario = crearCalendario({ horarios: hor.recordset, feriados: fer.recordset.map(f => f.Fecha) });
    cache = { cuando: Date.now(), calendario };
    return calendario;
}
const invalidarCalendario = () => { cache = null; };

module.exports = { crearCalendario, obtenerCalendario, invalidarCalendario, unirTramos, UY_MS };
