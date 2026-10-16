// Reglas calculadas de Desarrollos, iguales a las del prototipo de Felipe (docs/desarrollos/spec-A §2.7
// y spec-B §0.2, §2.3). No se guardan: se calculan al mostrar.

// Hoy como 'AAAA-MM-DD' local (DP.hoy)
export const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Días entre dos fechas 'AAAA-MM-DD', de mediodía a mediodía (como `dias` de los módulos)
export const dias = (a, b) => Math.round((new Date(`${String(b).slice(0, 10)}T12:00`) - new Date(`${String(a).slice(0, 10)}T12:00`)) / 86400000);
// Fecha local 'AAAA-MM-DD' de un momento (ISO con hora)
export const diaDe = (momento) => {
    if (!momento) return '';
    const d = new Date(momento);
    if (Number.isNaN(d.getTime())) return String(momento).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Puntaje = (3 × estratégico + 2 × comercial) ÷ (complejidad + recursos) + urgencia, con un decimal.
// Cada criterio 1..5 (vacío = 3). Urgencia: fecha límite a 7 días o menos (o vencida) +3; a 30 o menos +1,5.
// La fecha límite se toma como medianoche UTC, igual que el prototipo.
export const puntaje = (o) => {
    const E = +o.estrategico || 3;
    const C = +o.comercial || 3;
    const X = +o.complejidad || 3;
    const R = +o.recursos || 3;
    let urg = 0;
    if (o.fechaLimite) {
        const d = (new Date(o.fechaLimite) - new Date()) / 86400000;
        urg = d <= 7 ? 3 : d <= 30 ? 1.5 : 0;
    }
    return Math.round(((3 * E + 2 * C) / (X + R) + urg) * 10) / 10;
};
export const fmtPuntaje = (n) => String(n).replace('.', ',');

// "Recomendado para atender" de la Bandeja: el puntaje, +5 si es una orden, +4 vencido o +2 a 7 días,
// +3 si es un pospuesto al que ya le llegó la fecha de revisión, y hasta +3 por antigüedad (1 cada 14 días).
export const recBandeja = (s) => {
    const h = hoy();
    let r = puntaje(s);
    if (s.tipo === 'ORDEN') r += 5;
    if (s.fechaLimite) {
        const d = dias(h, s.fechaLimite);
        r += d < 0 ? 4 : d <= 7 ? 2 : 0;
    }
    if (s.estado === 'POSPUESTA' && s.fechaRevision && s.fechaRevision <= h) r += 3;
    if (s.creado) r += Math.min(3, dias(diaDe(s.creado), h) / 14);
    return r;
};

// Tipos de pedido: [valor, etiqueta del formulario, etiqueta corta]
export const TIPOS_PEDIDO = [
    ['SOLICITUD', 'Pedido', 'Pedido'],
    ['IDEA', 'Idea', 'Idea'],
    ['ORDEN', 'Orden (hay que hacerla)', 'Orden'],
    ['CORRECCION', 'Corrección de un producto', 'Corrección'],
    ['VARIANTE', 'Variante de un producto', 'Variante'],
];
export const tipoCorto = (t) => TIPOS_PEDIDO.find(x => x[0] === t)?.[2] || t;

export const ABIERTOS = ['NUEVA', 'EN_EVALUACION'];
export const esAbierto = (s) => ABIERTOS.includes(s.estado);
export const ETIQUETA_ESTADO = { POSPUESTA: 'Pospuesta', APROBADA: 'Aprobada', RECHAZADA: 'Descartada' };

// Criterios del puntaje: [clave, etiqueta, texto de 1, texto de 5]
export const CRITERIOS = [
    ['estrategico', 'Estratégico', 'nada', 'clave'],
    ['comercial', 'Comercial', 'poco', 'mucho'],
    ['complejidad', 'Complejidad', 'simple', 'compleja'],
    ['recursos', 'Recursos', 'pocos', 'muchos'],
];

// Normaliza para buscar: minúsculas, sin tildes (DP.norm)
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Todas las palabras de la búsqueda tienen que aparecer
export const coincide = (q, ...campos) => {
    const palabras = norm(q).split(' ').filter(Boolean);
    if (!palabras.length) return true;
    const texto = norm(campos.filter(Boolean).join(' '));
    return palabras.every(p => texto.includes(p));
};

// ── Proyectos y tareas (spec-A §2.7, spec-B §3, spec-C §2) ────────────────────
export const ESTADOS_TAREA = [
    ['PENDIENTE', 'Pendiente'], ['EN_CURSO', 'En curso'], ['EN_ESPERA', 'En espera'], ['HECHO', 'Hecho'], ['NO_APLICA', 'No aplica'],
];
export const etiquetaEstadoTarea = (e) => (e === 'BLOQUEADA' ? 'Bloqueada' : ESTADOS_TAREA.find(x => x[0] === e)?.[1] || e);
export const pendiente = (t) => t.estado !== 'HECHO' && t.estado !== 'NO_APLICA';

// Suma n días hábiles (lunes a viernes, sin feriados, como el prototipo) a 'AAAA-MM-DD'.
export const diasHabiles = (s, n) => {
    const d = new Date(`${String(s).slice(0, 10)}T12:00`);
    let k = Math.max(0, Math.round(n));
    while (k > 0) {
        d.setDate(d.getDate() + 1);
        const dia = d.getDay();
        if (dia !== 0 && dia !== 6) k--;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Fechas sugeridas de las tareas pendientes (DP.fechasSugeridas): se encadenan desde el inicio del
// proyecto con la duración en días hábiles y las dependencias; nunca antes de hoy. La fecha confirmada
// manda para encadenar. Devuelve { tareaId: 'AAAA-MM-DD' }.
export const fechasSugeridas = (p) => {
    const h = hoy();
    let cur = String(p.fechaInicio || diaDe(p.creado) || h).slice(0, 10);
    const fin = {};
    const out = {};
    for (const t of p.tareas || []) {
        if (t.estado === 'NO_APLICA') continue;
        if (t.estado === 'HECHO') {
            const f = String(diaDe(t.hechoEl) || t.fecha || cur).slice(0, 10);
            fin[t.id] = f;
            cur = f;
            continue;
        }
        let base = cur;
        if (t.depende?.length) {
            const previas = t.depende.map(d => fin[d]).filter(Boolean);
            if (previas.length) base = previas.sort().pop();
        }
        const inicio = base < h ? h : base;
        const sug = diasHabiles(inicio, Math.max(1, +t.diasHabiles || 1));
        const f = t.fecha || sug;
        out[t.id] = sug;
        fin[t.id] = f;
        if (!(f < cur)) cur = f;
    }
    return out;
};

// Bloqueada: depende de tareas que siguen pendientes (no se guarda)
export const bloqueos = (t, tareas) => (t.depende || []).map(id => tareas.find(x => x.id === id)).filter(x => x && pendiente(x));
export const estadoVisible = (t, tareas) => (pendiente(t) && bloqueos(t, tareas).length ? 'BLOQUEADA' : t.estado);
// ¿a depende de b, directa o indirectamente? (para no armar ciclos)
export const dependeDe = (a, b, tareas, vistos = new Set()) => {
    if (vistos.has(a.id)) return false;
    vistos.add(a.id);
    return (a.depende || []).some(id => id === b.id || dependeDe(tareas.find(x => x.id === id) || { id }, b, tareas, vistos));
};

export const atrasada = (t) => !!t.fecha && t.fecha < hoy() && pendiente(t);

// "Recomendado para atender" de Proyectos y Planificación: el puntaje, hasta +4 por tareas atrasadas,
// +4 vencido o +2 a 14 días, +2 si está en una tanda abierta, +1 si la tarea actual no tiene responsable,
// −3 en pausa y hasta +2 por antigüedad (1 cada 30 días).
export const recProyecto = (p) => {
    const h = hoy();
    let r = puntaje(p) + Math.min(4, 2 * (p.atrasadas || 0));
    if (p.fechaLimite) {
        const d = dias(h, p.fechaLimite);
        r += d < 0 ? 4 : d <= 14 ? 2 : 0;
    }
    if (p.tandas?.length) r += 2;
    if (p.tareaActual && !p.tareaActual.responsable) r += 1;
    if (p.estado === 'PAUSADO') r -= 3;
    if (p.creado) r += Math.min(2, dias(diaDe(p.creado), h) / 30);
    return r;
};

// Link de Google Calendar para un evento de día completo
export const gcal = (titulo, fecha, detalle = '') => {
    const ini = String(fecha).replace(/-/g, '');
    const d = new Date(`${fecha}T12:00`);
    d.setDate(d.getDate() + 1);
    const finStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titulo)}&dates=${ini}/${finStr}&details=${encodeURIComponent(detalle)}`;
};

// Nombre de la etapa actual de un proyecto (o Terminado / Cancelado)
export const nombreEtapaActual = (p) => (p.etapaActual === 'TERMINADO' ? 'Terminado' : p.etapaActual === 'CANCELADO' ? 'Cancelado'
    : p.etapas?.find(e => e.id === p.etapaActual)?.nombre || '—');
export const colorEtapaActual = (p) => (p.etapaActual === 'TERMINADO' ? '#1f8a4c' : p.etapaActual === 'CANCELADO' ? '#a1a1aa'
    : p.etapas?.find(e => e.id === p.etapaActual)?.color || '#a1a1aa');

// ── Tandas (spec-C §1.2) ──────────────────────────────────────────────────────
// Estado visible: cerrada, próxima (empieza después de hoy), vencida (terminó y no se cerró) o en curso
export const estadoTanda = (t) => {
    const h = hoy();
    if (t.estado === 'CERRADA') return 'cerrada';
    if (t.inicio > h) return 'proxima';
    if (t.fin < h) return 'vencida';
    return 'en_curso';
};
export const ETIQUETA_TANDA = { cerrada: 'Cerrada', proxima: 'Próxima', vencida: 'Terminó: cerrala', en_curso: 'En curso' };
// La tanda "actual": la abierta en curso; si no, la primera vencida; si no, la primera abierta
export const tandaActual = (tandas) => {
    const abiertas = (tandas || []).filter(t => t.estado !== 'CERRADA').sort((a, b) => a.inicio.localeCompare(b.inicio));
    return abiertas.find(t => estadoTanda(t) === 'en_curso') || abiertas.find(t => estadoTanda(t) === 'vencida') || abiertas[0] || null;
};
// Google Calendar para un período (día completo de inicio a fin)
export const gcalRango = (titulo, inicio, fin, detalle = '') => {
    const d = new Date(`${fin}T12:00`);
    d.setDate(d.getDate() + 1);
    const finStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titulo)}&dates=${String(inicio).replace(/-/g, '')}/${finStr}&details=${encodeURIComponent(detalle)}`;
};
