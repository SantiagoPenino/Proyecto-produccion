import React, { useState, useEffect, useCallback } from 'react';
import {
    ReceiptText, FileCheck2, LayoutGrid, List, RefreshCw, Search, Globe, Loader2, Pencil, Trash2, AlertTriangle, Clock,
} from 'lucide-react';
import api from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import QuotationEditModal from './QuotationEditModal';
import { toast } from 'sonner';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (22/10/2026, como Reportes y Servicio Técnico): fondo claro, tarjetas blancas con borde, íconos
// de Lucide en brand-cyan; el color queda para el estado (con costo / sin costo).
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const segmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;

const ESTADO_COLORS = {
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    zero: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};
const estadoDe = (monto) => (monto > 0 ? 'confirmed' : monto === 0 ? 'zero' : 'pending');
const fechaHora = (f) => (f ? new Date(f).toLocaleString('es-UY') : '—');

function Importe({ order, monto }) {
    return (
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap tabular-nums ${ESTADO_COLORS[estadoDe(monto)]}`}>
            {monto > 0 ? `${order.Moneda} ${monto.toFixed(2)}` : 'Sin costo'}
        </span>
    );
}

function QuotationCard({ order, onOpen, onDelete }) {
    const monto = Number(order.MontoTotal || 0);

    return (
        <div className={`${CARD} overflow-hidden flex items-stretch hover:border-zinc-300 transition-colors`}>
            {/* Barra lateral de estado */}
            <div className={`w-1.5 shrink-0 ${monto > 0 ? 'bg-emerald-500' : 'bg-amber-400'}`} />

            <div className="flex-1 min-w-0 p-4 flex flex-col gap-2.5">
                {/* Código e importe */}
                <div className="flex justify-between items-start gap-3">
                    <span className="font-black text-zinc-800 tracking-tight font-mono truncate">{order.NoDocERP}</span>
                    <Importe order={order} monto={monto} />
                </div>

                {/* El trabajo, como título */}
                <p className={`text-sm font-bold leading-snug line-clamp-2 ${order.QR_Trabajo ? 'text-zinc-800' : 'text-zinc-300 italic font-normal'}`} title={order.QR_Trabajo || ''}>
                    {order.QR_Trabajo || 'Sin trabajo'}
                </p>

                {/* Pie: cuándo se actualizó y las acciones */}
                <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 tabular-nums min-w-0 truncate" title="Última actualización">
                        <Clock size={11} className="shrink-0" /> {fechaHora(order.FechaGeneracion)}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => onOpen(order.NoDocERP)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors"
                        >
                            <Pencil size={13} /> Editar
                        </button>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDelete(order.NoDocERP); }}
                            className="w-[30px] h-[30px] inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                            title="Eliminar cotización completa"
                            aria-label="Eliminar cotización completa"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function QuotationView({ areaFilter }) {
    const { user } = useAuth();
    // Confirmación con el estilo del sistema (antes window.confirm, la ventana gris del navegador)
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [editingDoc, setEditingDoc] = useState(null);
    // true cuando editingDoc se abrió desde el buscador de "cualquier área": ese pedido
    // puede no tener ninguna línea de esta área, así que se edita completo (areaFilter
    // "TODOS"), no acotado al área actual.
    const [editingDocOtraArea, setEditingDocOtraArea] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [viewMode, setViewMode] = useState('card');

    // [PRO] Buscador de "cualquier área": la lista de arriba (esta área) solo trae
    // pedidos con línea facturable de esta área — en PRO eso excluye los que solo tienen
    // orden PRO como madre sin costo propio. Antes esto era un modal aparte
    // (BuscadorCotizacionOtraArea); el usuario pidió que viva en la misma página.
    const esPro = String(areaFilter || '').toUpperCase() === 'PRO';
    const [otraAreaTexto, setOtraAreaTexto] = useState('');
    const [otraAreaResultados, setOtraAreaResultados] = useState([]);
    const [otraAreaBuscando, setOtraAreaBuscando] = useState(false);
    const [otraAreaError, setOtraAreaError] = useState('');

    useEffect(() => {
        if (!esPro) return;
        const q = otraAreaTexto.trim();
        if (q.length < 2) { setOtraAreaResultados([]); setOtraAreaError(''); return; }
        let vigente = true;
        setOtraAreaBuscando(true);
        const t = setTimeout(() => {
            api.get('/quotation/list', { params: { q } })
                .then(res => {
                    if (!vigente) return;
                    setOtraAreaResultados(Array.isArray(res.data) ? res.data : []);
                    setOtraAreaError('');
                })
                .catch(err => { if (vigente) setOtraAreaError(err.response?.data?.error || err.message); })
                .finally(() => { if (vigente) setOtraAreaBuscando(false); });
        }, 500);
        return () => { vigente = false; clearTimeout(t); };
    }, [otraAreaTexto, esPro]);

    const abrirOtraArea = (noDocERP) => {
        setEditingDocOtraArea(true);
        setEditingDoc(String(noDocERP || '').trim());
        setOtraAreaTexto('');
        setOtraAreaResultados([]);
    };

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const query = new URLSearchParams();
            if (search) query.append('q', search);
            if (areaFilter) query.append('areaId', areaFilter);

            const res = await api.get(`/quotation/list?${query.toString()}`);
            setOrders(res.data || []);
        } catch (err) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
    }, [search, refreshKey, areaFilter]);

    const handleDeleteBundle = async (docId) => {
        if (!(await confirmar({
            titulo: `¿Eliminar todo el pedido ${docId}?`,
            texto: 'Se borran el pedido y sus cotizaciones para siempre. Esta acción es irreversible.',
            confirmar: 'Eliminar',
            peligro: true,
        }))) {
            return;
        }

        try {
            await api.delete(`/web-orders/bundle/${docId}`);
            setRefreshKey(k => k + 1);
        } catch (err) {
            toast.error('Error al intentar eliminar: ' + (err.response?.data?.error || err.message));
        }
    };


    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const handleSaved = () => {
        setRefreshKey(k => k + 1);  // Refrescar lista
    };

    const abrir = (id) => { setEditingDocOtraArea(false); setEditingDoc(id); };

    return (
        <div className="h-full flex flex-col bg-slate-50 font-sans text-zinc-800">
            {/* Encabezado de la vista */}
            <div className="px-3 md:px-6 pt-3 md:pt-6 pb-3 shrink-0 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <ReceiptText size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                        <div className="min-w-0">
                            <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Confirmación de cotización</h1>
                            <p className="text-sm text-zinc-400">Revisá y ajustá los costos antes de imprimir las etiquetas.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 hidden sm:inline">
                            {loading ? 'Cargando…' : orders.length > 0 ? `${orders.length.toLocaleString('es-UY')} ${orders.length === 1 ? 'cotización' : 'cotizaciones'}` : ''}
                        </span>
                        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white">
                            <button type="button" onClick={() => setViewMode('card')} className={segmento(viewMode === 'card')}><LayoutGrid size={14} /> Tarjetas</button>
                            <button type="button" onClick={() => setViewMode('list')} className={segmento(viewMode === 'list')}><List size={14} /> Lista</button>
                        </div>
                        <button type="button" onClick={() => setRefreshKey(k => k + 1)} disabled={loading} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar">
                            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Buscadores: el de esta área (lista de abajo) + el de cualquier área
                    (PRO), uno al lado del otro en la misma página — antes este segundo era
                    un modal aparte (BuscadorCotizacionOtraArea). */}
                <div className={`grid gap-2 ${esPro ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar en esta área por número de documento, trabajo o código…"
                            aria-label="Buscar en esta área"
                            className={CAMPO}
                        />
                    </div>

                    {esPro && (
                        <div className="relative">
                            {otraAreaBuscando
                                ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-brand-cyan" />
                                : <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />}
                            <input
                                value={otraAreaTexto}
                                onChange={e => setOtraAreaTexto(e.target.value)}
                                placeholder="Buscar en cualquier área (pedido, código, cliente o trabajo)…"
                                aria-label="Buscar en cualquier área"
                                className={CAMPO}
                            />
                            {otraAreaTexto.trim().length >= 2 && (
                                <div className="absolute z-30 mt-1.5 w-full bg-white border border-zinc-200 rounded-xl shadow-xl shadow-zinc-900/10 max-h-80 overflow-y-auto divide-y divide-zinc-100">
                                    {otraAreaError && <p className="text-xs text-rose-600 font-bold p-3">{otraAreaError}</p>}
                                    {!otraAreaBuscando && !otraAreaError && otraAreaResultados.length === 0 && (
                                        <p className="text-xs text-zinc-400 p-4 text-center">Ningún pedido coincide con "{otraAreaTexto.trim()}".</p>
                                    )}
                                    {otraAreaResultados.map(r => (
                                        <button
                                            key={r.ID}
                                            type="button"
                                            onClick={() => abrirOtraArea(r.NoDocERP)}
                                            className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 flex items-center gap-3"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-mono text-xs font-black text-zinc-700">{String(r.NoDocERP || '').trim()}</span>
                                                    {(r.Areas || []).map(a => (
                                                        <span key={a} className="text-[9px] font-black uppercase bg-zinc-100 text-zinc-600 border border-zinc-200 px-1.5 py-0.5 rounded">{a}</span>
                                                    ))}
                                                </div>
                                                <p className="text-sm font-bold text-zinc-800 truncate">{r.Cliente || 'Sin cliente'}</p>
                                                <p className="text-[11px] text-zinc-500 truncate">{r.QR_Trabajo || '—'}</p>
                                            </div>
                                            <div className="font-mono text-sm font-black text-zinc-700 shrink-0 tabular-nums">
                                                {r.Moneda === 'USD' ? 'USD' : '$'} {Number(r.MontoTotal || 0).toFixed(2)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto px-3 md:px-6 pb-3 md:pb-6">
                {loading && (
                    <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                        <Loader2 size={30} className="animate-spin text-brand-cyan" />
                        <p className="text-sm text-zinc-400">Cargando cotizaciones…</p>
                    </div>
                )}

                {!loading && error && (
                    <div className={`${CARD} flex items-center gap-2 px-4 py-3 text-sm font-bold text-rose-600`}>
                        <AlertTriangle size={16} className="shrink-0" /> {error}
                    </div>
                )}

                {!loading && !error && orders.length === 0 && (
                    <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-2 px-4 text-center`}>
                        <FileCheck2 size={40} className="text-zinc-200" />
                        <p className="font-bold text-zinc-500">No hay cotizaciones pendientes</p>
                        <p className="text-sm text-zinc-400">
                            {search ? `Ninguna coincide con "${search}".` : 'Cuando haya pedidos para revisar, aparecen acá.'}
                        </p>
                    </div>
                )}

                {!loading && orders.length > 0 && viewMode === 'card' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {orders.map(order => (
                            <QuotationCard key={order.ID} order={order} onOpen={abrir} onDelete={handleDeleteBundle} />
                        ))}
                    </div>
                )}

                {!loading && orders.length > 0 && viewMode === 'list' && (
                    <div className={`${CARD} overflow-hidden`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                        <th className="px-4 py-2.5">Orden</th>
                                        <th className="px-4 py-2.5">Trabajo</th>
                                        <th className="px-4 py-2.5">Actualizado</th>
                                        <th className="px-4 py-2.5 text-right">Importe</th>
                                        <th className="px-4 py-2.5 w-24" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {orders.map(order => {
                                        const monto = Number(order.MontoTotal || 0);
                                        return (
                                            <tr key={order.ID} className="hover:bg-zinc-50 transition-colors">
                                                <td className="px-4 py-2.5 font-black text-zinc-800 font-mono text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-1.5 h-6 rounded-full ${monto > 0 ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                                                        {order.NoDocERP}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-zinc-600 max-w-[400px] truncate" title={order.QR_Trabajo}>
                                                    {order.QR_Trabajo || '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-zinc-400 text-xs tabular-nums">{fechaHora(order.FechaGeneracion)}</td>
                                                <td className="px-4 py-2.5 text-right"><Importe order={order} monto={monto} /></td>
                                                <td className="px-4 py-2">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button type="button" onClick={() => abrir(order.NoDocERP)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors">
                                                            <Pencil size={13} /> Editar
                                                        </button>
                                                        <button type="button" onClick={() => handleDeleteBundle(order.NoDocERP)}
                                                            className="w-8 h-[30px] inline-flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                                                            title="Eliminar cotización completa" aria-label="Eliminar cotización completa">
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal editor. Si se abrió desde el buscador de "cualquier área", se edita el
                pedido COMPLETO (areaFilter "TODOS") — puede no tener ninguna línea de esta
                área. */}
            {editingDoc && (
                <QuotationEditModal
                    noDocERP={editingDoc}
                    currentUser={user}
                    areaFilter={editingDocOtraArea ? 'TODOS' : areaFilter}
                    /* "Reconstruir líneas" sólo en Logística (esta vista sin área) y en PRO.
                       Dentro de la bandeja de un área (AreaView → acá con areaFilter='DF',
                       'SUB'...) queda oculto. */
                    permitirReconstruir={editingDocOtraArea || !areaFilter || ['TODOS', 'PRO'].includes(String(areaFilter).toUpperCase())}
                    onClose={() => { setEditingDoc(null); setEditingDocOtraArea(false); }}
                    onSaved={handleSaved}
                />
            )}
            {ventanaConfirmar}
        </div>
    );
}
