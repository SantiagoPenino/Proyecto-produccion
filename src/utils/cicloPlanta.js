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

// (28/10/2026) Pasos del ciclo, en el orden en que ocurren. Los minutos de cada orden van al paso en el que estaba
// según sus marcas (backend/services/cicloPlantaService.js, pasosDe); desde el 29/10 manda el tilde «impresa» de la
// orden, no los botones del lote. Las esperas en ámbar, la máquina en brand-cyan, el control en verde y la falla en
// magenta; «En lote, sin inicio marcado» en gris porque es espera e impresión mezcladas.
export const PASOS_CICLO = [
    { id: 'material', label: 'Hasta recibir el material', color: 'bg-violet-300', ayuda: 'Desde que ECO UV terminó de imprimir hasta que se escaneó el material en Terminaciones. Se suele escanear al terminar, así que incluye buena parte del trabajo.' },
    { id: 'diseno', label: 'Diseño', color: 'bg-violet-400', ayuda: 'Hasta que se aprueba el boceto, sin la espera del cliente.' },
    { id: 'lote', label: 'Esperando lote', color: 'bg-amber-300', ayuda: 'Desde que entra (o la sacan de un lote) hasta que la ponen en un lote.' },
    { id: 'espera', label: 'Esperando máquina', color: 'bg-amber-500', ayuda: 'En un lote o asignada a la máquina, antes de que el lote marque «Iniciar producción». Incluye las pausas.' },
    { id: 'en_lote', label: 'En lote, sin inicio marcado', color: 'bg-zinc-400', ayuda: 'La orden quedó tildada impresa sin que el lote marcara «Iniciar producción» antes: ese rato es espera más impresión y no hay marca para separarlas.' },
    { id: 'produccion', label: 'En producción', color: 'bg-brand-cyan', ayuda: 'Desde que el lote marcó «Iniciar producción» hasta que la orden quedó tildada impresa. Si no la tildaron ni se marcó «Fin impresión», hasta Pronto.' },
    { id: 'cola_calandra', label: 'Esperando calandra', color: 'bg-orange-400', ayuda: 'Desde que quedó impresa (o el lote pasó a calandra) hasta que arrancó la calandra.' },
    { id: 'calandra', label: 'Calandra', color: 'bg-sky-600', ayuda: 'Desde que arrancó la calandra.' },
    { id: 'control', label: 'Control y calidad', color: 'bg-emerald-500', ayuda: 'Desde que la orden quedó tildada impresa (o «Fin impresión» del lote) hasta Pronto. Incluye esperar a que la controlen.' },
    { id: 'falla', label: 'Con falla', color: 'bg-brand-magenta', ayuda: 'Desde que se reportó la falla hasta que la orden siguió.' },
];
export const PASO_CICLO = Object.fromEntries(PASOS_CICLO.map(p => [p.id, p]));

// { lote: 95, espera: 40 } → [{ ...paso, minutos }] en el orden de PASOS_CICLO, sin los vacíos
export const listaPasos = (pasos) => (pasos ? PASOS_CICLO.filter(p => pasos[p.id] > 0).map(p => ({ ...p, minutos: pasos[p.id] })) : []);
// «Esperando lote 1 h 35 min · En producción 40 min»
export const textoPasos = (pasos) => listaPasos(pasos).map(p => `${p.label} ${fmtDuracion(p.minutos)}`).join(' · ');

// Texto del tooltip de la celda «Ciclo» y del detalle de la orden
export function tituloCiclo(c) {
    if (!c) return '';
    const partes = [`${fmtDuracion(c.minutos)} laborales ${ORIGEN_INICIO[c.origen] || ''} hasta que quedó pronta`];
    if (c.espera > 0) partes.push(`sin ${fmtDuracion(c.espera)} de espera del cliente`);
    partes.push(`${fmtCorridos(c.corridos)} corridos`);
    const pasos = textoPasos(c.pasos);
    return partes.join(' · ') + (pasos ? `\nPor paso: ${pasos}` : '');
}
