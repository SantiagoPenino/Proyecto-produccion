import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    PackageOpen, AlertTriangle, RotateCw, Hourglass, Clock, Ban, Send, ChevronDown, ChevronUp, Search,
    Loader2, Inbox, ShoppingBasket, RefreshCw,
} from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, tarjetas blancas con borde, íconos de
// Lucide en brand-cyan sin fondo; el color del canasto queda solo como una franja de estado (OK / aviso / error).
// Las tarjetas de canasto funcionan como pestañas y sus órdenes se ven abajo, en la misma pantalla (antes se abrían
// en una ventana y la pantalla quedaba con seis tarjetas y el resto vacío). Las órdenes se dibujan de a 50 y en el
// celular van en tarjetas. Buscar, marcar, marcar todas y «Enviar a» (de a una o en masa) siguen igual.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';

// ─── Canastos disponibles (orden fijo de visualización) ──────────────────────
const CANASTOS_DEFINIDOS = [
    { id: 'Canasto Produccion',    label: 'Canasto Producción',    icon: PackageOpen,   color: 'emerald' },
    { id: 'Canasto Falla',         label: 'Canasto Falla',         icon: AlertTriangle, color: 'rose'    },
    { id: 'Canasto Reposiciones',  label: 'Canasto Reposiciones',  icon: RotateCw,      color: 'cyan'    },
    { id: 'Canasto Incompletos',   label: 'Canasto Incompletos',   icon: Hourglass,     color: 'amber'   },
    { id: 'Esperando Reposición',  label: 'Esperando Reposición',  icon: Clock,         color: 'cyan'    },
    { id: 'Cancelado',             label: 'Cancelados',            icon: Ban,           color: 'rose'    },
];

// Franja de color del canasto: emerald / amber / rose para los que son un estado; el resto, brand-cyan.
const COLOR_MAP = {
    emerald: { barra: 'bg-emerald-500' },
    amber:   { barra: 'bg-amber-400' },
    rose:    { barra: 'bg-rose-500' },
    cyan:    { barra: 'bg-brand-cyan' },
};

// Chip del estado de la orden dentro del canasto
const claseEstado = (o) => (
    o.Estado === 'Produccion' ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30' :
    o.Estado === 'Pendiente'  ? 'bg-zinc-100 text-zinc-600 border-zinc-200' :
    (o.Estado === 'Pronto' || o.EstadoenArea === 'Pronto') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    'bg-zinc-100 text-zinc-500 border-zinc-200'
);

// Listas de a 50 (patrón useDeAPoco de Reportes): al acercarse al final se agregan 50 más; vuelve a 50 cuando
// cambia la lista. El margen de 600 px se mide contra el contenedor que scrollea de verdad.
const DE_A = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(lista) {
    const [cuantos, setCuantos] = useState(DE_A);
    useEffect(() => { setCuantos(DE_A); }, [lista]);
    const centinela = useRef(null);
    const total = lista.length;
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        }, { root: contenedorConScroll(el), rootMargin: '0px 0px 600px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total]);
    return [Math.min(cuantos, total), centinela];
}

// En el celular, tarjetas en vez de la tabla (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

// ─── Dropdown "Enviar a" ──────────────────────────────────────────────────────
const SendToDropdown = ({ currentCanasto, onSend, disabled }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef();

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const otros = CANASTOS_DEFINIDOS.filter(c => c.id !== currentCanasto);

    return (
        <div className="relative" ref={ref}>
            <button
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap border
                    ${disabled
                        ? 'bg-zinc-100 text-zinc-300 border-zinc-200 cursor-not-allowed'
                        : 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30 hover:bg-brand-cyan hover:text-white hover:border-brand-cyan'}`}
            >
                <Send size={12} />
                Enviar a
                {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {open && (
                <div className="absolute right-0 mt-1 z-50 bg-white border border-zinc-200 rounded-xl shadow-xl shadow-zinc-900/10 min-w-[200px] overflow-hidden animate-in zoom-in-95 duration-150">
                    <div className="px-3 py-2 border-b border-zinc-100 text-[10px] font-black text-zinc-400 uppercase tracking-wide">
                        Mover a canasto
                    </div>
                    {otros.map(c => {
                        return (
                            <button
                                key={c.id}
                                onClick={() => { setOpen(false); onSend(c.id); }}
                                className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-zinc-50 transition-colors text-sm font-medium text-zinc-700 border-b border-zinc-100 last:border-0"
                            >
                                <c.icon size={15} className="shrink-0 text-brand-cyan" />
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Órdenes de un canasto (abajo de las tarjetas) ───────────────────────────
// Sin overflow que recorte: el menú «Enviar a» de las últimas filas tiene que poder salir de la tarjeta.
const CanastoDetail = ({ canasto, areaFilter, onMoved, recarga }) => {
    const [orders, setOrders]     = useState([]);
    const [loading, setLoading]   = useState(true);
    const [selected, setSelected] = useState(new Set());
    const [sending, setSending]   = useState(false);
    const [search, setSearch]     = useState('');
    const conTabla = useConTabla();

    const c = CANASTOS_DEFINIDOS.find(x => x.id === canasto) || CANASTOS_DEFINIDOS[0];

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ canasto, area: areaFilter || 'TODOS' });
            const res = await api.get(`/canastos/ordenes?${params}`);
            setOrders(res.data?.ordenes || []);
        } catch (e) {
            toast.error('Error al cargar órdenes: ' + (e.response?.data?.error || e.message));
        } finally {
            setLoading(false);
        }
    }, [canasto, areaFilter]);

    // recarga: el «Actualizar» de arriba también trae de nuevo las órdenes (sin perder la búsqueda ni lo marcado)
    useEffect(() => { load(); }, [load, recarga]);

    const toggleSelect = (id) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === filtered.length) setSelected(new Set());
        else setSelected(new Set(filtered.map(o => o.OrdenID)));
    };

    const handleSend = async (destCanasto, orderIds) => {
        if (!orderIds?.length) return;
        setSending(true);
        try {
            await api.post('/canastos/mover', { ordenIds: orderIds, destinoCanasto: destCanasto });
            toast.success(`${orderIds.length} orden(es) enviada(s) a "${destCanasto}"`);
            setSelected(new Set());
            await load();
            onMoved?.();
        } catch (e) {
            toast.error('Error: ' + (e.response?.data?.error || e.message));
        } finally {
            setSending(false);
        }
    };

    const filtered = orders.filter(o =>
        !search ||
        (o.CodigoOrden || '').toLowerCase().includes(search.toLowerCase()) ||
        (o.Cliente     || '').toLowerCase().includes(search.toLowerCase())
    );
    // Se dibujan de a 50; marcar todas sigue tomando la lista filtrada entera
    const [cuantos, centinela] = useDeAPoco(filtered);
    const visibles = filtered.slice(0, cuantos);
    const todasMarcadas = selected.size === filtered.length && filtered.length > 0;

    const selArray = [...selected];

    return (
        <div className={`${CARD} flex flex-col`}>
            {/* Encabezado: el canasto elegido, la búsqueda y la acción masiva */}
            <div className="px-4 py-3 border-b border-zinc-200 flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-2.5 min-w-0 mr-auto">
                    <c.icon size={20} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h3 className="text-sm font-black text-zinc-800 leading-tight">{c.label}</h3>
                        <p className="text-xs text-zinc-400">{orders.length} orden(es) · Área: {areaFilter || 'TODOS'}</p>
                    </div>
                </div>

                {/* Acción masiva */}
                {selArray.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className={`${CHIP} border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan whitespace-nowrap`}>
                            {selArray.length} seleccionada(s)
                        </span>
                        <SendToDropdown
                            currentCanasto={canasto}
                            onSend={(dest) => handleSend(dest, selArray)}
                            disabled={sending}
                        />
                    </div>
                )}

                {/* Búsqueda */}
                <div className="relative w-full md:w-80">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                        className={CAMPO}
                        placeholder="Buscar por código o cliente..."
                        aria-label="Buscar por código o cliente"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Lista */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <span className="text-sm text-zinc-400">Cargando órdenes...</span>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 px-4 text-center">
                    <Inbox size={40} className="text-zinc-200" />
                    <span className="text-sm text-zinc-400">{search ? 'Sin resultados' : 'Este canasto está vacío'}</span>
                </div>
            ) : !conTabla ? (
                // Celular: una tarjeta por orden (marcar, código y estado arriba, cliente y área, y «Enviar a»)
                <div className="p-3 space-y-2">
                    <label className="flex items-center gap-2 px-1 pb-1 text-xs font-bold text-zinc-500">
                        <input type="checkbox" className="rounded accent-brand-cyan cursor-pointer" checked={todasMarcadas} onChange={toggleAll} />
                        Marcar todas ({filtered.length})
                    </label>
                    {visibles.map(o => {
                        const isSelected = selected.has(o.OrdenID);
                        return (
                            <div key={o.OrdenID} className={`rounded-xl border p-3 transition-colors ${isSelected ? 'border-brand-cyan/40 bg-brand-cyan/5' : 'border-zinc-200'}`}>
                                <div className="flex items-start gap-2.5">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 rounded accent-brand-cyan cursor-pointer"
                                        checked={isSelected}
                                        onChange={() => toggleSelect(o.OrdenID)}
                                        aria-label={`Marcar ${o.CodigoOrden}`}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="font-mono font-black text-sm text-zinc-800 truncate">{o.CodigoOrden}</span>
                                            <span className={`${CHIP} shrink-0 ${claseEstado(o)}`}>{o.Estado}</span>
                                        </div>
                                        <p className="text-sm text-zinc-600 truncate mt-0.5">{o.Cliente || '-'}</p>
                                    </div>
                                </div>
                                <div className="mt-2.5 flex items-center justify-between gap-2">
                                    <span className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200`}>{o.AreaID}</span>
                                    <SendToDropdown
                                        currentCanasto={canasto}
                                        onSend={(dest) => handleSend(dest, [o.OrdenID])}
                                        disabled={sending}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {cuantos < filtered.length && (
                        <div ref={centinela} className="py-3 text-center text-xs text-zinc-400">
                            Mostrando {cuantos} de {filtered.length}…
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <table className="w-full text-sm whitespace-nowrap">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                <th className="px-4 py-2.5 w-10">
                                    <input
                                        type="checkbox"
                                        className="rounded accent-brand-cyan cursor-pointer"
                                        checked={todasMarcadas}
                                        onChange={toggleAll}
                                    />
                                </th>
                                <th className="px-4 py-2.5 text-left">Código</th>
                                <th className="px-4 py-2.5 text-left">Cliente</th>
                                <th className="px-4 py-2.5 text-left">Área</th>
                                <th className="px-4 py-2.5 text-left">Estado</th>
                                <th className="px-4 py-2.5 w-28"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {visibles.map(o => {
                                const isSelected = selected.has(o.OrdenID);
                                return (
                                    <tr key={o.OrdenID} className={`transition-colors ${isSelected ? 'bg-brand-cyan/10' : 'hover:bg-zinc-50'}`}>
                                        <td className="px-4 py-3">
                                            <input
                                                type="checkbox"
                                                className="rounded accent-brand-cyan cursor-pointer"
                                                checked={isSelected}
                                                onChange={() => toggleSelect(o.OrdenID)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 font-mono font-black text-zinc-800 text-xs tracking-wide">{o.CodigoOrden}</td>
                                        <td className="px-4 py-3 font-medium text-zinc-600 truncate max-w-[320px]">{o.Cliente || '-'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200`}>{o.AreaID}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`${CHIP} ${claseEstado(o)}`}>{o.Estado}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end">
                                                <SendToDropdown
                                                    currentCanasto={canasto}
                                                    onSend={(dest) => handleSend(dest, [o.OrdenID])}
                                                    disabled={sending}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {cuantos < filtered.length && (
                        <div ref={centinela} className="py-3 text-center text-xs text-zinc-400 border-t border-zinc-100">
                            Mostrando {cuantos} de {filtered.length}…
                        </div>
                    )}
                </>
            )}

            {/* Pie */}
            {!loading && filtered.length > 0 && (
                <div className="px-4 py-2.5 border-t border-zinc-200 bg-zinc-50 rounded-b-2xl text-xs text-zinc-400">
                    {filtered.length} orden(es) mostrada(s)
                </div>
            )}
        </div>
    );
};

// ─── Vista principal Canastos ─────────────────────────────────────────────────
const CanastosView = ({ areaFilter }) => {
    const [counts, setCounts]           = useState({});
    const [loading, setLoading]         = useState(true);
    // Arranca mostrando el primero (antes no había nada elegido y abajo de las tarjetas no había nada)
    const [selectedCanasto, setSelected] = useState(CANASTOS_DEFINIDOS[0].id);
    // Para que «Actualizar» también recargue las órdenes del canasto elegido
    const [recarga, setRecarga]         = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ area: areaFilter || 'TODOS' });
            const res = await api.get(`/canastos/resumen?${params}`);
            const map = {};
            (res.data?.canastos || []).forEach(c => { map[c.canasto] = c.total; });
            setCounts(map);
        } catch (e) {
            toast.error('Error al cargar canastos: ' + (e.response?.data?.error || e.message));
        } finally {
            setLoading(false);
        }
    }, [areaFilter]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="absolute inset-0 overflow-y-auto bg-slate-50 p-3 md:p-6 text-zinc-800">

            {/* Título */}
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                    <ShoppingBasket size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-zinc-800">Gestión de Canastos</h2>
                        <p className="text-sm text-zinc-400">
                            Organizá manualmente el estado logístico de las órdenes · Área: <b className="font-bold text-zinc-600">{areaFilter || 'TODOS'}</b>
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => { load(); setRecarga(r => r + 1); }}
                    className={BTN_SECUNDARIO}
                >
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {/* Canastos: funcionan como pestañas */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-3 mb-4">
                {CANASTOS_DEFINIDOS.map(c => {
                    const clr     = COLOR_MAP[c.color];
                    const count   = counts[c.id] || 0;
                    const elegido = selectedCanasto === c.id;
                    return (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelected(c.id)}
                            aria-pressed={elegido}
                            className={`${CARD} relative overflow-hidden flex items-center gap-3 px-3.5 md:px-4 pt-4 pb-3.5 text-left transition-colors
                                ${elegido ? '!border-brand-cyan ring-2 ring-brand-cyan/15' : 'hover:border-zinc-300'}`}
                        >
                            {/* Franja de estado del canasto */}
                            <div className={`absolute inset-x-0 top-0 h-1 ${clr.barra}`} />
                            <c.icon size={22} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                            <div className="min-w-0">
                                <span className="block text-[11px] font-bold text-zinc-500 leading-tight truncate">{c.label}</span>
                                <span className="block text-xl font-black text-zinc-800 tabular-nums leading-tight mt-0.5">
                                    {loading ? <Loader2 size={16} className="animate-spin text-brand-cyan my-1" /> : count}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Órdenes del canasto elegido */}
            <CanastoDetail
                key={selectedCanasto}
                canasto={selectedCanasto}
                areaFilter={areaFilter}
                onMoved={load}
                recarga={recarga}
            />
        </div>
    );
};

export default CanastosView;
