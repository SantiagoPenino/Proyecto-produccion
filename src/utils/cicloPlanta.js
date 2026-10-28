// Formatos del ciclo en planta (tiempo de respuesta de las áreas, plan INF-SIS-2026-04). Los minutos son LABORALES:
// del horario del área, sin feriados ni espera del cliente.

// 45 min · 9 h 30 min · 12 h
export function fmtDuracion(min) {
    if (min == null || Number.isNaN(Number(min))) return '—';
    const m = Math.max(0, Math.round(Number(min)));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
}

// Minutos laborales → días hábiles del área: «1,2 días hábiles». corto → «1,2 d háb.»
export function fmtDiasHabiles(min, minutosJornada, { corto = false } = {}) {
    if (min == null || !minutosJornada) return '—';
    const n = (Number(min) / Number(minutosJornada)).toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (corto) return `${n} d háb.`;
    return `${n} ${n === '1,0' ? 'día hábil' : 'días hábiles'}`;
}

// (27/10/2026) El ciclo en la unidad que se entiende: menos de una jornada del área va en horas («6 h 15 min»); desde
// una jornada, en días hábiles («1,2 días hábiles»). «0,3 días hábiles» no le decía nada a nadie.
export const superaJornada = (min, minutosJornada) => !!minutosJornada && Number(min) >= Number(minutosJornada);
export function fmtCiclo(min, minutosJornada, opciones) {
    return superaJornada(min, minutosJornada) ? fmtDiasHabiles(min, minutosJornada, opciones) : fmtDuracion(min);
}

// Etiqueta corta para las barras de las semanas: «45 min» · «6,3 h»
export function fmtHorasCorto(min) {
    if (min == null) return '—';
    const m = Math.max(0, Math.round(Number(min)));
    if (m < 60) return `${m} min`;
    return `${(m / 60).toLocaleString('es-UY', { maximumFractionDigits: 1 })} h`;
}

// Reloj de pared, para comparar: «14 h 22 min» o, con más de dos días, «21,8 días»
export function fmtCorridos(min) {
    if (min == null) return '—';
    const m = Number(min);
    if (m >= 2 * 1440) return `${(m / 1440).toLocaleString('es-UY', { maximumFractionDigits: 1 })} días`;
    return fmtDuracion(m);
}

export const ORIGEN_INICIO = {
    INGRESO: 'desde que ingresó',
    IMPRESION_EUV: 'desde que ECO UV terminó de imprimir',
    LIBERADA: 'desde que se liberó (esperaba a otra orden)',
};

// Texto del tooltip de la celda «Ciclo» y del detalle de la orden
export function tituloCiclo(c) {
    if (!c) return '';
    const partes = [`${fmtDuracion(c.minutos)} laborales ${ORIGEN_INICIO[c.origen] || ''} hasta que quedó pronta`];
    if (c.espera > 0) partes.push(`sin ${fmtDuracion(c.espera)} de espera del cliente`);
    partes.push(`${fmtCorridos(c.corridos)} corridos`);
    return partes.join(' · ');
}
