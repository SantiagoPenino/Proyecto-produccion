import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

// ─── Canastos disponibles (orden fijo de visualización) ──────────────────────
const CANASTOS_DEFINIDOS = [
    { id: 'Canasto Produccion',    label: 'Canasto Producción',    icon: 'fa-box-open',          color: 'emerald' },
    { id: 'Canasto Falla',         label: 'Canasto Falla',         icon: 'fa-triangle-exclamation', color: 'orange' },
    { id: 'Canasto Reposiciones',  label: 'Canasto Reposiciones',  icon: 'fa-rotate',            color: 'blue'   },
    { id: 'Canasto Incompletos',   label: 'Canasto Incompletos',   icon: 'fa-hourglass-half',    color: 'amber'  },
    { id: 'Esperando Reposición',  label: 'Esperando Reposición',  icon: 'fa-clock',             color: 'purple' },
    { id: 'Cancelado',             label: 'Cancelados',            icon: 'fa-ban',               color: 'red'    },
];

const COLOR_MAP = {
    emerald: { card: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', icon: 'text-emerald-500', btn: 'bg-emerald-500 hover:bg-emerald-600' },
    orange:  { card: 'border-orange-200 bg-orange-50',   badge: 'bg-orange-100 text-orange-700',   icon: 'text-orange-500',  btn: 'bg-orange-500 hover:bg-orange-600'   },
    blue:    { card: 'border-blue-200 bg-blue-50',        badge: 'bg-blue-100 text-blue-700',        icon: 'text-blue-500',    btn: 'bg-blue-500 hover:bg-blue-600'        },
    amber:   { card: 'border-amber-200 bg-amber-50',      badge: 'bg-amber-100 text-amber-700',      icon: 'text-amber-500',   btn: 'bg-amber-500 hover:bg-amber-600'      },
    purple:  { card: 'border-purple-200 bg-purple-50',    badge: 'bg-purple-100 text-purple-700',    icon: 'text-purple-500',  btn: 'bg-purple-500 hover:bg-purple-600'    },
    red:     { card: 'border-red-200 bg-red-50',          badge: 'bg-red-100 text-red-700',          icon: 'text-red-500',     btn: 'bg-red-500 hover:bg-red-600'          },
};

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
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all whitespace-nowrap
                    ${disabled
                        ? 'bg-zinc-100 text-zinc-300 cursor-not-allowed'
                        : 'bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan hover:text-white border border-brand-cyan/30 hover:border-brand-cyan'}`}
            >
                <i className="fa-solid fa-paper-plane text-[10px]" />
                Enviar a
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-[9px]`} />
            </button>
            {open && (
                <div className="absolute right-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[200px] overflow-hidden animate-in zoom-in-95 duration-150">
                    <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Mover a canasto
                    </div>
                    {otros.map(c => {
                        const clr = COLOR_MAP[c.color];
                        return (
                            <button
                                key={c.id}
                                onClick={() => { setOpen(false); onSend(c.id); }}
                                className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 border-b border-gray-50 last:border-0"
                            >
                                <i className={`fa-solid ${c.icon} ${clr.icon} text-xs w-4`} />
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Panel de detalle de un canasto ──────────────────────────────────────────
const CanastoDetail = ({ canasto, areaFilter, onClose, onMoved }) => {
    const [orders, setOrders]     = useState([]);
    const [loading, setLoading]   = useState(true);
    const [selected, setSelected] = useState(new Set());
    const [sending, setSending]   = useState(false);
    const [search, setSearch]     = useState('');

    const c = CANASTOS_DEFINIDOS.find(x => x.id === canasto) || CANASTOS_DEFINIDOS[0];
    const clr = COLOR_MAP[c.color];

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

    useEffect(() => { load(); }, [load]);

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

    const selArray = [...selected];

    return (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-zinc-900/60" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col border border-gray-200 overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className={`px-6 py-4 flex items-center justify-between border-b border-gray-200 ${clr.card}`}>
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-white shadow-sm border border-gray-200`}>
                            <i className={`fa-solid ${c.icon} ${clr.icon} text-lg`} />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-800 text-lg leading-tight">{c.label}</h2>
                            <p className="text-xs text-gray-500">{orders.length} orden(es) · Área: {areaFilter || 'TODOS'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-red-500 flex items-center justify-center shadow-sm transition">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
                    {/* Búsqueda */}
                    <div className="flex-1 relative">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
                        <input
                            className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                            placeholder="Buscar por código o cliente..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    {/* Acción masiva */}
                    {selArray.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${clr.badge}`}>
                                {selArray.length} seleccionada(s)
                            </span>
                            <SendToDropdown
                                currentCanasto={canasto}
                                onSend={(dest) => handleSend(dest, selArray)}
                                disabled={sending}
                            />
                        </div>
                    )}
                </div>

                {/* Lista */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-indigo-400" />
                            <span className="text-sm font-medium">Cargando órdenes...</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                            <i className="fa-solid fa-inbox text-4xl mb-3 opacity-30" />
                            <span className="text-sm font-medium">{search ? 'Sin resultados' : 'Este canasto está vacío'}</span>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2.5 w-10">
                                        <input
                                            type="checkbox"
                                            className="rounded accent-brand-cyan cursor-pointer"
                                            checked={selected.size === filtered.length && filtered.length > 0}
                                            onChange={toggleAll}
                                        />
                                    </th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Código</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cliente</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Área</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Estado</th>
                                    <th className="px-4 py-2.5 w-28"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filtered.map(o => {
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
                                            <td className="px-4 py-3 font-mono font-bold text-zinc-800 text-xs tracking-wide">{o.CodigoOrden}</td>
                                            <td className="px-4 py-3 font-medium text-zinc-600 truncate max-w-[200px]">{o.Cliente || '-'}</td>
                                            <td className="px-4 py-3">
                                                <span className="text-[10px] font-bold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full border border-zinc-200">{o.AreaID}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                    o.Estado === 'Produccion' ? 'bg-blue-100 text-blue-700' :
                                                    o.Estado === 'Pendiente'  ? 'bg-zinc-100 text-zinc-600' :
                                                    (o.Estado === 'Pronto' || o.EstadoenArea === 'Pronto')     ? 'bg-emerald-100 text-emerald-700' :
                                                    'bg-zinc-100 text-zinc-500'
                                                }`}>{o.Estado}</span>
                                            </td>
                                            <td className="px-4 py-3 flex justify-end">
                                                <SendToDropdown
                                                    currentCanasto={canasto}
                                                    onSend={(dest) => handleSend(dest, [o.OrdenID])}
                                                    disabled={sending}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
                    <span className="text-xs text-gray-400">{filtered.length} orden(es) mostrada(s)</span>
                    <button onClick={onClose} className="px-5 py-2 bg-zinc-800 text-white text-xs font-bold rounded-lg hover:bg-zinc-700 transition shadow-sm">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Vista principal Canastos ─────────────────────────────────────────────────
const CanastosView = ({ areaFilter }) => {
    const [counts, setCounts]           = useState({});
    const [loading, setLoading]         = useState(true);
    const [selectedCanasto, setSelected] = useState(null);

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
        <div className="absolute inset-0 overflow-y-auto bg-gray-50 p-6">

            {/* Título */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <i className="fa-solid fa-basket-shopping text-indigo-500" />
                        Gestión de Canastos
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Organizá manualmente el estado logístico de las órdenes · Área: <b>{areaFilter || 'TODOS'}</b>
                    </p>
                </div>
                <button
                    onClick={load}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50 shadow-sm transition"
                >
                    <i className={`fa-solid fa-arrows-rotate ${loading ? 'fa-spin' : ''}`} />
                    Actualizar
                </button>
            </div>

            {/* Grid de canastos */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                    <i className="fa-solid fa-circle-notch fa-spin text-4xl mb-4 text-indigo-400" />
                    <span className="text-sm font-medium animate-pulse">Cargando canastos...</span>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    {CANASTOS_DEFINIDOS.map(c => {
                        const clr   = COLOR_MAP[c.color];
                        const count = counts[c.id] || 0;
                        return (
                            <button
                                key={c.id}
                                onClick={() => setSelected(c.id)}
                                className={`group relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 text-center
                                    ${clr.card} hover:border-opacity-80`}
                            >
                                {/* Ícono */}
                                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 bg-white shadow-sm border border-gray-100 transition-transform group-hover:scale-110`}>
                                    <i className={`fa-solid ${c.icon} ${clr.icon} text-2xl`} />
                                </div>

                                {/* Nombre */}
                                <span className="text-xs font-bold text-gray-700 leading-tight mb-2">{c.label}</span>

                                {/* Badge de cantidad */}
                                <span className={`text-2xl font-black ${clr.icon}`}>{count}</span>
                                <span className="text-[10px] text-gray-400 font-medium mt-0.5">
                                    {count === 1 ? 'orden' : 'órdenes'}
                                </span>

                                {/* Flecha */}
                                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <i className={`fa-solid fa-arrow-right ${clr.icon} text-xs`} />
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Panel de detalle */}
            {selectedCanasto && (
                <CanastoDetail
                    canasto={selectedCanasto}
                    areaFilter={areaFilter}
                    onClose={() => setSelected(null)}
                    onMoved={load}
                />
            )}
        </div>
    );
};

export default CanastosView;
