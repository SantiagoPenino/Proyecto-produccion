import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mail, Phone, AlertCircle, Pencil, Save, X, Search, Inbox,
    Loader2, Users, MousePointerClick, TrendingUp, LogOut, BarChart3, MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { socket } from '../../../services/socketService';
import Selector from '../../ui/Selector';

// Rediseño 09/10/2026: tema claro como Solicitudes y la Bandeja de Diseño. Los leads pasaron de tarjetas grises
// altas a una lista en un solo panel; el estado es una pestaña con su contador y hay buscador.

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
// Un solo formateador para toda la página: crear un Intl.DateTimeFormat por fila (había ~1.000 leads) era de lo
// más caro de cada render.
const FORMATO_FECHA = new Intl.DateTimeFormat('es-UY', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmt = (ts) => (ts ? FORMATO_FECHA.format(new Date(ts.replace('Z', ''))) : '—');

// La lista se dibuja de a tramos: al cambiar de pestaña se pintan los primeros PASO leads y el resto entra a medida
// que se baja (un IntersectionObserver mira el final de la lista). Antes se dibujaban los ~1.000 de golpe.
const PASO = 50;

// El contenedor que scrollea (la página corre dentro del layout, no en la ventana): el observer lo usa como raíz
// para empezar a cargar el tramo siguiente un poco antes de llegar al final.
const contenedorScroll = (el) => {
    for (let p = el?.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};

const formatOrigen = (o) => {
    if (!o) return 'Desconocido';
    if (o.toLowerCase() === 'catalogo_precios_modal') return 'Modal de precios';
    return o;
};

// wa.me pide el número internacional sin el 0 de adelante: 099 108 614 → 59899108614.
// Antes iba tal cual (wa.me/099108614) y WhatsApp no encontraba el número.
const linkWhatsApp = (cel) => {
    let d = String(cel || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = '598' + d.slice(1);
    else if (d.length === 8 && d.startsWith('9')) d = '598' + d;
    return `https://wa.me/${d}`;
};

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// El color va en el estado (no en la decoración)
const estados = [
    { id: 'NUEVO',             label: 'Nuevo',                 pill: 'bg-brand-cyan/10 text-brand-cyan',       dot: 'bg-brand-cyan' },
    { id: 'CONTACTADO',        label: 'Contactado',            pill: 'bg-amber-50 text-amber-700',             dot: 'bg-amber-500' },
    { id: 'PEDIDO_INICIADO',   label: 'Pedido iniciado',       pill: 'bg-brand-magenta/10 text-brand-magenta', dot: 'bg-brand-magenta' },
    { id: 'COMPRA_CONCRETADA', label: 'Compra concretada',     pill: 'bg-emerald-50 text-emerald-700',         dot: 'bg-emerald-500' },
    { id: 'PERDIDO',           label: 'Perdido / sin interés', pill: 'bg-slate-100 text-slate-500',            dot: 'bg-slate-400' },
];
const estadoDe = (id) => estados.find(e => e.id === id) || estados[0];

const ROTULO = 'text-[10px] font-black uppercase tracking-wider text-slate-400';
const PANEL = 'bg-white border border-slate-200 rounded-xl shadow-sm';
const CAMPO_FILTRO = 'px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white outline-none transition-colors hover:border-slate-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 placeholder:text-slate-400';
const BTN_PRINCIPAL = 'px-3 py-1.5 rounded-lg bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50';
const BTN_SECUNDARIO = 'px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold inline-flex items-center justify-center gap-1.5';
// Pestañas: línea de 1 px a la altura de una pestaña, como en Solicitudes y Configurar Productos
const TIRA_PESTANAS = 'sm:bg-[linear-gradient(#e2e8f0,#e2e8f0)] sm:bg-no-repeat sm:bg-[length:100%_1px] sm:bg-[position:0_calc(2.5rem_+_1px)]';
const pestana = (on) => `shrink-0 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-2 ${on ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`;

function PastillaEstado({ id }) {
    const e = estadoDe(id);
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${e.pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${e.dot}`} />
            {e.label}
        </span>
    );
}

// ────────────────────────────────────────────────
// Analíticas
// ────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub }) {
    return (
        <div className={`${PANEL} p-4 flex items-start gap-3`}>
            <Icon size={22} className="shrink-0 text-brand-cyan mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
                <p className={ROTULO}>{label}</p>
                <p className="text-2xl font-black text-slate-800 tabular-nums leading-tight mt-0.5">{value}</p>
                {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

function FunnelBar({ label, value, max, color }) {
    const pct = max > 0 ? (value / max) * 100 : 0;
    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-semibold text-slate-600">{label}</span>
                <span className="text-sm font-black text-slate-800 tabular-nums">{value}</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    className={`h-full rounded-full ${color}`}
                />
            </div>
        </div>
    );
}

function AnalyticsDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetch_ = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch('/api/analytics/summary', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Error al obtener métricas');
            setData(await res.json());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetch_();
        socket.on('leads:update', fetch_);
        socket.on('analytics:update', fetch_);
        return () => {
            socket.off('leads:update', fetch_);
            socket.off('analytics:update', fetch_);
        };
    }, []);

    if (loading && !data)
        return (
            <div className="flex flex-col items-center justify-center min-h-[350px]">
                <Loader2 className="w-7 h-7 text-brand-cyan animate-spin mb-3" />
                <p className="text-sm text-slate-400">Cargando métricas…</p>
            </div>
        );

    if (error)
        return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-600 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{error}</p>
            </div>
        );

    const max = data.modalOpen || 1;

    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard icon={MousePointerClick} label="Aperturas del modal" value={data.modalOpen} sub="sesiones únicas" />
                <KpiCard icon={Users} label="Leads generados" value={data.totalLeads} sub="enviaron sus datos" />
                <KpiCard icon={TrendingUp} label="Tasa de conversión" value={`${data.conversionRate}%`} sub="aperturas → envío" />
                <KpiCard icon={LogOut} label="Tasa de abandono" value={`${data.abandonRate}%`} sub="cerraron sin enviar" />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
                <div className={`${PANEL} p-5 space-y-5`}>
                    <h2 className={ROTULO}>Embudo de conversión</h2>
                    <FunnelBar label="Abrieron el modal" value={data.modalOpen} max={max} color="bg-brand-cyan" />
                    <FunnelBar label="Enviaron el formulario" value={data.formSubmit} max={max} color="bg-emerald-500" />
                    <FunnelBar label="Abandonaron" value={data.formAbandon} max={max} color="bg-brand-magenta" />
                </div>

                <div className={`${PANEL} p-5`}>
                    <h2 className={`${ROTULO} mb-5`}>Categorías más consultadas</h2>
                    {data.topCategories.length === 0 ? (
                        <p className="text-slate-400 text-sm">Sin clicks registrados aún.</p>
                    ) : (
                        <div className="space-y-4">
                            {data.topCategories.slice(0, 6).map(({ categoria, clicks }, i) => {
                                const maxClicks = data.topCategories[0].clicks;
                                const pct = (clicks / maxClicks) * 100;
                                return (
                                    <div key={categoria}>
                                        <div className="flex justify-between items-center mb-1.5 gap-3">
                                            <span className="text-sm font-semibold text-slate-600 truncate">{categoria}</span>
                                            <span className="text-sm font-black text-slate-800 tabular-nums shrink-0">{clicks} <span className="text-xs font-semibold text-slate-400">clicks</span></span>
                                        </div>
                                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${pct}%` }}
                                                transition={{ duration: 0.7, delay: i * 0.05, ease: 'easeOut' }}
                                                className="h-full rounded-full bg-brand-cyan"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

// ────────────────────────────────────────────────
// Gestión de leads
// ────────────────────────────────────────────────
// Columnas de la lista en escritorio (encabezado y filas usan la misma grilla)
const GRILLA = 'md:grid md:grid-cols-[150px_minmax(0,1.5fr)_minmax(0,0.9fr)_140px_minmax(0,1.4fr)_auto] md:items-center md:gap-4';

// memo: al editar o guardar una fila, las demás no se vuelven a dibujar (los callbacks llegan estables y reciben el id).
const FilaLead = memo(function FilaLead({ lead, editando, guardando, onEditar, onCancelar, onGuardar }) {
    const [estado, setEstado] = useState(lead.EstadoComercial || 'NUEVO');
    const [notas, setNotas] = useState(lead.NotasVentas || '');
    useEffect(() => {
        if (editando) { setEstado(lead.EstadoComercial || 'NUEVO'); setNotas(lead.NotasVentas || ''); }
    }, [editando, lead.EstadoComercial, lead.NotasVentas]);
    const wa = linkWhatsApp(lead.Celular);

    return (
        <div className={editando ? 'bg-brand-cyan/[0.03]' : 'hover:bg-slate-50/70 transition-colors'}>
            <div className={`${GRILLA} px-4 py-3.5 space-y-2.5 md:space-y-0`}>
                <div className="flex items-center justify-between md:block">
                    <PastillaEstado id={lead.EstadoComercial} />
                    <span className="md:hidden text-xs text-slate-400 tabular-nums">{fmt(lead.FechaCreacion)}</span>
                </div>

                <div className="min-w-0 space-y-1">
                    <a href={`mailto:${lead.Email}`} className="flex items-center gap-2 text-sm font-semibold text-slate-800 hover:text-brand-cyan transition-colors min-w-0" title={lead.Email}>
                        <Mail size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="truncate">{lead.Email || '—'}</span>
                    </a>
                    {lead.Celular && (
                        wa ? (
                            <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-600 transition-colors w-fit" title="Abrir en WhatsApp">
                                <Phone size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                                <span className="tabular-nums">{lead.Celular}</span>
                                <MessageCircle size={13} className="shrink-0 text-emerald-500" aria-hidden="true" />
                            </a>
                        ) : (
                            <span className="flex items-center gap-2 text-sm text-slate-600">
                                <Phone size={14} className="shrink-0 text-slate-400" aria-hidden="true" />{lead.Celular}
                            </span>
                        )
                    )}
                </div>

                <div className="min-w-0">
                    <span className="md:hidden mr-2 text-xs text-slate-400">Origen:</span>
                    <span className="inline-block max-w-full truncate rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 align-middle" title={formatOrigen(lead.Origen)}>
                        {formatOrigen(lead.Origen)}
                    </span>
                </div>

                <div className="hidden md:block text-xs text-slate-500 tabular-nums">{fmt(lead.FechaCreacion)}</div>

                <div className="min-w-0">
                    {lead.NotasVentas
                        ? <p className="text-sm text-slate-600 line-clamp-2 leading-snug" title={lead.NotasVentas}>{lead.NotasVentas}</p>
                        : <p className="text-sm text-slate-300">Sin notas</p>}
                </div>

                <div className="flex md:justify-end">
                    {!editando && (
                        <button type="button" onClick={() => onEditar(lead.LeadId)} className={`${BTN_SECUNDARIO} w-full md:w-auto`} title="Cambiar el estado o las notas">
                            <Pencil size={13} className="text-brand-cyan" aria-hidden="true" /> Editar
                        </button>
                    )}
                </div>
            </div>

            {editando && (
                <div className="px-4 pb-4">
                    <div className="rounded-xl border border-brand-cyan/30 bg-white p-3 flex flex-col md:flex-row gap-3">
                        <div className="md:w-56 shrink-0">
                            <p className={`${ROTULO} mb-1`}>Estado</p>
                            <Selector value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado comercial" anchoLista={240}>
                                {estados.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                            </Selector>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`${ROTULO} mb-1`}>Notas de venta</p>
                            <textarea
                                className={`${CAMPO_FILTRO} w-full min-h-[64px] resize-y`}
                                placeholder="Qué se habló, qué pidió, cuándo volver a llamar…"
                                value={notas}
                                onChange={(e) => setNotas(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="flex md:flex-col justify-end gap-2 md:pt-5">
                            <button type="button" disabled={guardando} onClick={() => onGuardar(lead.LeadId, estado, notas)} className={`${BTN_PRINCIPAL} flex-1 md:flex-none`}>
                                {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                            </button>
                            <button type="button" disabled={guardando} onClick={onCancelar} className={`${BTN_SECUNDARIO} flex-1 md:flex-none`}>
                                <X size={13} /> Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

function CRMTab({ leads, loading, editandoId, setEditandoId, guardandoId, handleUpdateStatus }) {
    const [filtroEstado, setFiltroEstado] = useState('ALL');
    const [busqueda, setBusqueda] = useState('');

    const conteo = useMemo(() => {
        const c = { ALL: leads.length };
        estados.forEach(e => { c[e.id] = 0; });
        leads.forEach(l => { const id = estadoDe(l.EstadoComercial).id; c[id] = (c[id] || 0) + 1; });
        return c;
    }, [leads]);

    // La pestaña y el buscador cambian al instante; la lista se recalcula con estas copias "diferidas", que React
    // procesa sin trabar el click ni el tipeo.
    const filtroDiferido = useDeferredValue(filtroEstado);
    const busquedaDiferida = useDeferredValue(busqueda);

    const visibles = useMemo(() => {
        const q = normalizar(busquedaDiferida.trim());
        const qDigitos = busquedaDiferida.replace(/\D/g, '');
        return leads.filter(l => {
            if (filtroDiferido !== 'ALL' && estadoDe(l.EstadoComercial).id !== filtroDiferido) return false;
            if (!q) return true;
            return normalizar(l.Email).includes(q)
                || normalizar(l.NotasVentas).includes(q)
                || normalizar(formatOrigen(l.Origen)).includes(q)
                || (qDigitos.length >= 3 && String(l.Celular || '').replace(/\D/g, '').includes(qDigitos));
        });
    }, [leads, filtroDiferido, busquedaDiferida]);

    // Tramos: se arranca con PASO filas y se vuelve a PASO al cambiar de pestaña o de búsqueda
    const [cuantos, setCuantos] = useState(PASO);
    useEffect(() => { setCuantos(PASO); }, [filtroDiferido, busquedaDiferida]);
    const hayMas = cuantos < visibles.length;
    const finRef = useRef(null);
    useEffect(() => {
        const fin = finRef.current;
        if (!fin || !hayMas) return undefined;
        const obs = new IntersectionObserver(
            (entradas) => { if (entradas.some(e => e.isIntersecting)) setCuantos(c => c + PASO); },
            { root: contenedorScroll(fin), rootMargin: '0px 0px 800px 0px' },
        );
        obs.observe(fin);
        return () => obs.disconnect();
    }, [hayMas, cuantos, visibles]);
    const mostrados = useMemo(() => visibles.slice(0, cuantos), [visibles, cuantos]);

    // Callbacks estables para que FilaLead (memo) no se redibuje entera en cada cambio
    const editar = useCallback((id) => setEditandoId(id), [setEditandoId]);
    const cancelar = useCallback(() => setEditandoId(null), [setEditandoId]);

    const filtros = [{ id: 'ALL', label: 'Todos' }, ...estados];
    const recalculando = filtroDiferido !== filtroEstado || busquedaDiferida !== busqueda;

    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Estados como pestañas con contador (en el celular, un desplegable) + buscador a la derecha */}
            <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 ${TIRA_PESTANAS}`}>
                <div className="w-full sm:hidden">
                    <Selector value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} aria-label="Estado" anchoLista={260}>
                        {filtros.map(f => <option key={f.id} value={f.id}>{`${f.label} (${conteo[f.id] || 0})`}</option>)}
                    </Selector>
                </div>
                <div className="hidden sm:flex items-center overflow-x-auto no-scrollbar">
                    {filtros.map(f => {
                        const on = filtroEstado === f.id;
                        return (
                            <button key={f.id} type="button" onClick={() => setFiltroEstado(f.id)} aria-current={on ? 'page' : undefined} className={pestana(on)}>
                                {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                                {f.label}
                                <span className={`rounded-full px-1.5 min-w-[1.25rem] text-center text-[11px] tabular-nums ${on ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-slate-100 text-slate-500'}`}>
                                    {conteo[f.id] || 0}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="relative w-full sm:w-72 sm:ml-auto">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                    <input
                        type="search"
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Buscar email, teléfono o nota"
                        className={`${CAMPO_FILTRO} w-full pl-9`}
                    />
                </div>
            </div>

            {visibles.length === 0 && !loading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400 rounded-xl border border-dashed border-slate-300 bg-white">
                    <Inbox size={28} className="text-slate-300" aria-hidden="true" />
                    <p className="text-sm">{busqueda ? 'Ningún lead coincide con la búsqueda.' : 'No hay leads en este estado.'}</p>
                </div>
            ) : (
                <div className={`${PANEL} overflow-hidden transition-opacity ${recalculando ? 'opacity-60' : ''}`}>
                    <div className={`hidden ${GRILLA} px-4 py-2.5 bg-slate-50 border-b border-slate-200`}>
                        <span className={ROTULO}>Estado</span>
                        <span className={ROTULO}>Contacto</span>
                        <span className={ROTULO}>Origen</span>
                        <span className={ROTULO}>Fecha</span>
                        <span className={ROTULO}>Notas de venta</span>
                        <span className="w-[86px]" />
                    </div>
                    <div className="divide-y divide-slate-100">
                        {mostrados.map(lead => (
                            <FilaLead
                                key={lead.LeadId}
                                lead={lead}
                                editando={editandoId === lead.LeadId}
                                guardando={guardandoId === lead.LeadId}
                                onEditar={editar}
                                onCancelar={cancelar}
                                onGuardar={handleUpdateStatus}
                            />
                        ))}
                    </div>
                    {/* Marca del final: cuando se acerca a la vista, entra el tramo siguiente */}
                    {hayMas && (
                        <div ref={finRef} className="flex items-center justify-center gap-2 py-3 border-t border-slate-100 text-xs text-slate-400">
                            <Loader2 size={13} className="animate-spin text-brand-cyan" /> Cargando más…
                        </div>
                    )}
                    <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-400">
                        {visibles.length === leads.length ? `${leads.length} leads` : `${visibles.length} de ${leads.length} leads`}
                        {hayMas && ` · mostrando ${mostrados.length}`}
                    </div>
                </div>
            )}
        </motion.div>
    );
}

// ────────────────────────────────────────────────
// Vista principal
// ────────────────────────────────────────────────
const TABS = [
    { id: 'crm', label: 'Gestión de leads', icon: Users },
    { id: 'analytics', label: 'Analíticas', icon: BarChart3 },
];

export default function LeadsCRMView() {
    const [activeTab, setActiveTab] = useState('crm');
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editandoId, setEditandoId] = useState(null);
    const [guardandoId, setGuardandoId] = useState(null);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch('/api/analytics/leads', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Error al obtener leads');
            setLeads(await res.json());
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLeads();
        socket.on('leads:update', fetchLeads);
        return () => socket.off('leads:update', fetchLeads);
    }, []);

    // useCallback: va directo a cada FilaLead (memo); con una función nueva por render se redibujaban todas
    const handleUpdateStatus = useCallback(async (leadId, newStatus, newNotes) => {
        setGuardandoId(leadId);
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`/api/analytics/leads/${leadId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ estadoComercial: newStatus, notasVentas: newNotes }),
            });
            if (!res.ok) throw new Error('Error al actualizar lead');
            setLeads(prev => prev.map(l =>
                l.LeadId === leadId
                    ? { ...l, EstadoComercial: newStatus, NotasVentas: newNotes, UltimaActualizacion: new Date().toISOString() }
                    : l
            ));
            setEditandoId(null);
            toast.success('Lead actualizado');
        } catch (err) {
            toast.error('No se pudo actualizar: ' + err.message);
        } finally {
            setGuardandoId(null);
        }
    }, []);

    if (loading && !leads.length && !error)
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-7 h-7 text-brand-cyan animate-spin mb-3" />
                <p className="text-sm text-slate-400">Cargando CRM de leads…</p>
            </div>
        );

    return (
        <div className="p-3 md:p-6 space-y-5">
            {/* Encabezado como el de Solicitudes: ícono de Lucide en brand-cyan y sin fondo */}
            <div className="flex items-center gap-3">
                <Users size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">CRM de leads</h1>
                    <p className="text-sm text-slate-400">Gestión comercial y seguimiento de los contactos que llegan desde la web.</p>
                </div>
            </div>

            <div className="flex items-center gap-1 border-b border-slate-200">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined} className={`${pestana(activeTab === id)} -mb-px`}>
                        <Icon size={16} aria-hidden="true" />
                        {label}
                    </button>
                ))}
            </div>

            {error && activeTab === 'crm' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p>{error}</p>
                </div>
            )}

            <AnimatePresence mode="wait">
                {activeTab === 'crm' ? (
                    <CRMTab
                        key="crm"
                        leads={leads}
                        loading={loading}
                        editandoId={editandoId}
                        setEditandoId={setEditandoId}
                        guardandoId={guardandoId}
                        handleUpdateStatus={handleUpdateStatus}
                    />
                ) : (
                    <AnalyticsDashboard key="analytics" />
                )}
            </AnimatePresence>
        </div>
    );
}
