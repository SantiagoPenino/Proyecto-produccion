// Servicio Técnico — etiquetas, colores y formatos compartidos (docs/servicio-tecnico-plan.md).
import { Printer, Monitor, Wifi, AppWindow, Zap, CircleHelp } from 'lucide-react';

export const CATEGORIAS = [
    { value: 'MAQUINA', label: 'Máquina de producción', corto: 'Máquina', Icono: Printer },
    { value: 'PC', label: 'PC / computadora', corto: 'PC', Icono: Monitor },
    { value: 'RED', label: 'Internet / red', corto: 'Internet', Icono: Wifi },
    { value: 'SOFTWARE', label: 'Software / sistema', corto: 'Software', Icono: AppWindow },
    { value: 'INSTALACIONES', label: 'Instalaciones (luz, aire, agua)', corto: 'Instalaciones', Icono: Zap },
    { value: 'OTRO', label: 'Otro', corto: 'Otro', Icono: CircleHelp },
];
export const categoria = (v) => CATEGORIAS.find(c => c.value === v) || CATEGORIAS[CATEGORIAS.length - 1];

export const PRIORIDADES = [
    { value: 'BAJA', label: 'Baja', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', boton: 'bg-emerald-500 text-white' },
    { value: 'MEDIA', label: 'Media', chip: 'bg-amber-50 text-amber-700 border-amber-200', boton: 'bg-amber-500 text-white' },
    { value: 'ALTA', label: 'Alta', chip: 'bg-orange-50 text-orange-700 border-orange-200', boton: 'bg-orange-500 text-white' },
    { value: 'CRITICA', label: 'Crítica', chip: 'bg-red-50 text-red-700 border-red-200', boton: 'bg-red-600 text-white' },
];
export const prioridad = (v) => PRIORIDADES.find(p => p.value === v) || PRIORIDADES[1];

export const ESTADOS = {
    PENDIENTE: { label: 'Pendiente', chip: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
    EN_CURSO: { label: 'En curso', chip: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30' },
    EN_ESPERA: { label: 'En espera', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
    DERIVADA: { label: 'Derivada', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
    FINALIZADA: { label: 'Finalizada', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
export const estado = (v) => ESTADOS[v] || ESTADOS.PENDIENTE;

export const RESULTADOS = [
    { value: 'RESUELTA', label: 'Resuelta', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { value: 'PARCIAL', label: 'Resuelta en parte', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
    { value: 'NO_RESUELTA', label: 'No resuelta', chip: 'bg-red-50 text-red-700 border-red-200' },
    { value: 'CANCELADA', label: 'Cancelada', chip: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
];
export const resultado = (v) => RESULTADOS.find(r => r.value === v);

// Estados de la máquina (los mismos de Configuración → Equipos).
export const ESTADOS_EQUIPO = {
    DISPONIBLE: { label: 'Disponible', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    MANTENIMIENTO: { label: 'Mantenimiento', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
    OCUPADO: { label: 'Ocupado', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
    FALLA: { label: 'Falla', chip: 'bg-red-50 text-red-700 border-red-200' },
};
export const estadoEquipo = (v) => {
    const k = String(v || '').trim().toUpperCase();
    return ESTADOS_EQUIPO[k] || { label: k === 'OK' || !k ? 'Disponible' : k, chip: 'bg-zinc-100 text-zinc-600 border-zinc-200' };
};

// Proyectos.
export const ESTADOS_PROYECTO = {
    PLANIFICADO: { label: 'Planificado', chip: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
    EN_CURSO: { label: 'En curso', chip: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30' },
    EN_PAUSA: { label: 'En pausa', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
    TERMINADO: { label: 'Terminado', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    CANCELADO: { label: 'Cancelado', chip: 'bg-zinc-100 text-zinc-400 border-zinc-200' },
};

// Plata: "US$ 1.250" / "$ 3.400,50".
export const fmtPlata = (n, moneda) => (n == null ? '' : `${moneda === 'USD' ? 'US$' : '$'} ${Number(n).toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
export const fmtCantidad = (n) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: 3 });

// Trabajos del calendario (mantenimientos y tareas).
export const ESTADOS_TRABAJO = {
    PENDIENTE: { label: 'Pendiente', chip: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
    EN_CURSO: { label: 'En curso', chip: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30' },
    REALIZADO: { label: 'Realizado', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    NO_REALIZADO: { label: 'No realizado', chip: 'bg-red-50 text-red-700 border-red-200' },
    CANCELADO: { label: 'Cancelado', chip: 'bg-zinc-100 text-zinc-400 border-zinc-200' },
};
// Estado a mostrar: los pendientes pueden estar además vencidos o pospuestos.
export const estadoTrabajo = (t) => {
    if (['PENDIENTE', 'EN_CURSO'].includes(t.Estado) && t.Vencido) return { label: 'Vencido', chip: 'bg-red-50 text-red-700 border-red-200' };
    if (t.Estado === 'PENDIENTE' && t.VecesPospuesto > 0) return { label: `Pospuesto${t.VecesPospuesto > 1 ? ` ×${t.VecesPospuesto}` : ''}`, chip: 'bg-amber-50 text-amber-700 border-amber-200' };
    return ESTADOS_TRABAJO[t.Estado] || ESTADOS_TRABAJO.PENDIENTE;
};
export const TIPOS_TRABAJO = { MANTENIMIENTO: 'Mantenimiento', TAREA: 'Tarea' };
// Franja horaria de un trabajo (30/09): de 06:00 a 22:00, por hora, de al menos 1 hora.
export const HORAS_FRANJA = Array.from({ length: 17 }, (_, i) => `${String(6 + i).padStart(2, '0')}:00`);
export const franjaTexto = (t) => (t?.HoraDesde && t?.HoraHasta ? `${t.HoraDesde}–${t.HoraHasta}` : '');
export const UNIDADES = [
    { value: 'DIA', singular: 'día', plural: 'días' },
    { value: 'SEMANA', singular: 'semana', plural: 'semanas' },
    { value: 'MES', singular: 'mes', plural: 'meses' },
];
export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Fechas 'AAAA-MM-DD' (días de Uruguay) sin pasar por zonas horarias.
export const sumarDias = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
};
export const lunesDe = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return sumarDias(iso, -((dow + 6) % 7));
};
export const diaCorto = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

export const ACCIONES = {
    CREADA: 'Creada',
    TOMADA: 'Tomada',
    ASIGNADA: 'Asignada',
    ESTADO: 'Cambio de estado',
    DERIVADA: 'Derivada',
    COMENTARIO: 'Comentario',
    ADJUNTO: 'Adjuntó',
    FINALIZADA: 'Finalizada',
    REABIERTA: 'Reabierta',
    EDITADA: 'Editada',
    MAQUINA: 'Máquina',
    SEGUIMIENTO: 'Seguimiento hecho',
    // trabajos
    CREADO: 'Programado',
    EDITADO: 'Editado',
    POSPUESTO: 'Pospuesto',
    REPROGRAMADO: 'Reprogramado',
    EMPEZADO: 'Empezado',
    REALIZADO: 'Realizado',
    NO_REALIZADO: 'No realizado',
    CANCELADO: 'Cancelado',
    TAREA_AGREGADA: 'Tarea agregada',
    INSUMO: 'Insumo usado',
    AVANCE: 'Avance',
};

// Fecha corta DD/MM/YY HH:mm (24h) — mismo criterio que el resto del sistema.
export const fmtFecha = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 'AAAA-MM-DD' → 'DD/MM/AAAA' (las fechas sin hora vienen como texto para no correrse de día).
export const fmtDia = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');

// Minutos → "45 min", "3 h 20 min", "2 d 4 h".
export const fmtDuracion = (min) => {
    if (min == null || isNaN(min)) return '';
    const m = Math.max(0, Math.round(min));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
    const d = Math.floor(h / 24);
    return `${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
};

export const haceCuanto = (v) => {
    if (!v) return '';
    const min = (Date.now() - new Date(v).getTime()) / 60000;
    if (min < 1) return 'recién';
    return `hace ${fmtDuracion(min)}`;
};

export const hoyISO = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const mensajeError = (e, porDefecto = 'Algo salió mal') => e?.response?.data?.error || e?.message || porDefecto;
