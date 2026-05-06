import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../services/apiClient';
import Lottie from 'lottie-react';
import loadingAnim from '../../assets/animations/Loading.json';
import {
    CreditCard, Wifi, WifiOff, Search, Calendar, RefreshCw,
    ChevronDown, ChevronRight, Package, X, AlertTriangle,
    CheckCircle, DollarSign, Filter
} from 'lucide-react';

const LottieSpinner = ({ size = 64 }) => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '24px 0' }}>
        <Lottie animationData={loadingAnim} loop style={{ width: size, height: size }} />
    </div>
);

// ─── SHARED: Filtros de fecha + cliente + orden ────────────────────────────

const FilterBar = ({ filters, onChange, onSearch, extra, loading }) => (
    <div className="bg-slate-50 rounded-xl p-3 mb-4 border border-slate-200 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Calendar size={11}/> Desde</label>
            <input type="date" className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                value={filters.startDate} onChange={e => onChange('startDate', e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Calendar size={11}/> Hasta</label>
            <input type="date" className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                value={filters.endDate} onChange={e => onChange('endDate', e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</label>
            <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Nombre o código..." className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 text-sm outline-none focus:border-blue-500"
                    value={filters.clientFilter} onChange={e => onChange('clientFilter', e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} />
            </div>
        </div>
        {filters.hasOwnProperty('orderFilter') && (
            <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Orden Retiro</label>
                <input type="text" placeholder="R-1234..." className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                    value={filters.orderFilter} onChange={e => onChange('orderFilter', e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} />
            </div>
        )}
        {extra}
        <button onClick={onSearch} disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded-lg text-sm transition-all disabled:opacity-50 whitespace-nowrap">
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />} Filtrar
        </button>
    </div>
);

// ─── TAB 1: HISTORIAL DE TODOS LOS PAGOS ──────────────────────────────────

const PAGE_SIZE = 50;

const HistorialPagos = () => {
    const [pagos, setPagos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [metodos, setMetodos] = useState([]);
    const [filters, setFilters] = useState({ startDate: '', endDate: '', clientFilter: '', orderFilter: '', metodoPago: '' });
    const [busqueda, setBusqueda] = useState('');
    const [hasMore, setHasMore] = useState(true);

    const offsetRef = useRef(0);
    const loadingRef = useRef(false);
    const sentinelRef = useRef(null);

    const fetchPagos = async (append = false) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });
            params.append('offset', offsetRef.current);
            const res = await api.get(`/web-retiros/historial-pagos?${params}`);
            const data = res.data;
            if (append) setPagos(prev => [...prev, ...data]);
            else setPagos(data);
            const more = data.length === PAGE_SIZE;
            setHasMore(more);
            offsetRef.current += data.length;
        } catch (e) { console.error(e); }
        finally { setLoading(false); loadingRef.current = false; }
    };

    const handleSearch = () => {
        offsetRef.current = 0;
        setHasMore(true);
        fetchPagos(false);
    };

    useEffect(() => {
        api.get('/apipagos/metodos').then(r => setMetodos(r.data || [])).catch(() => {});
        fetchPagos(false);
    }, []);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting && hasMore && !loadingRef.current) fetchPagos(true); },
            { threshold: 0.1 }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore]);

    const filtered = useMemo(() => {
        if (!busqueda.trim()) return pagos;
        const t = busqueda.toLowerCase();
        return pagos.filter(p => [
            p.NombreCliente,
            String(p.CodigoCliente || ''),
            p.OrdenRetiro,
            p.MetodoPago,
            p.TipoCliente,
            ...(p.Ordenes || []).map(o => o.codigo),
            ...(p.Ordenes || []).map(o => o.producto)
        ].some(v => String(v || '').toLowerCase().includes(t)));
    }, [pagos, busqueda]);

    return (
        <div className="flex flex-col gap-3">
            <FilterBar
                filters={filters}
                onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
                onSearch={handleSearch}
                loading={loading}
                extra={
                    <div className="flex flex-col gap-1 min-w-[150px]">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Filter size={11}/> Método</label>
                        <select className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                            value={filters.metodoPago} onChange={e => setFilters(f => ({ ...f, metodoPago: e.target.value }))}>
                            <option value="">Todos</option>
                            {metodos.map(m => <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>)}
                        </select>
                    </div>
                }
            />

            {/* Buscador local */}
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Buscar por cliente, cód. cliente, orden retiro, código de orden..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 bg-slate-50" />
                {busqueda && (
                    <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <X size={14} />
                    </button>
                )}
            </div>

            <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-wide z-10">
                        <tr>
                            <th className="px-4 py-3 text-left">Fecha</th>
                            <th className="px-4 py-3 text-left">Cliente</th>
                            <th className="px-4 py-3 text-left">Tipo</th>
                            <th className="px-4 py-3 text-left">Método de Pago</th>
                            <th className="px-4 py-3 text-left">Orden Retiro</th>
                            <th className="px-4 py-3 text-right">Monto</th>
                            <th className="px-4 py-3 text-center">Órdenes</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading && pagos.length === 0 ? (
                            <tr><td colSpan={7}><LottieSpinner size={72} /></td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-10 text-slate-400">No se encontraron pagos.</td></tr>
                        ) : filtered.map(pago => {
                            const isExp = expandedId === pago.Id;
                            const hasOrd = pago.Ordenes?.length > 0;
                            return (
                                <React.Fragment key={pago.Id}>
                                    <tr className={`hover:bg-slate-50 transition-colors ${isExp ? 'bg-emerald-50/30' : ''}`}>
                                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                                            {pago.Fecha ? new Date(pago.Fecha).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-slate-800 text-sm">{pago.NombreCliente || '—'}</div>
                                            <div className="text-xs text-slate-400">Cód: {pago.CodigoCliente || '—'}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {pago.TipoCliente ? (
                                                <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">{pago.TipoCliente}</span>
                                            ) : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                <CreditCard size={11} /> {pago.MetodoPago || '—'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {pago.OrdenRetiro ? (
                                                <span className="font-mono font-black text-blue-700 text-sm">{pago.OrdenRetiro}</span>
                                            ) : <span className="text-slate-300 text-xs">Sin retiro</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-black text-emerald-700 text-sm whitespace-nowrap">
                                            {pago.Moneda || '$'} {Number(pago.Monto || 0).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {hasOrd ? (
                                                <button onClick={() => setExpandedId(isExp ? null : pago.Id)}
                                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${isExp ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>
                                                    {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                    {pago.Ordenes.length} orden{pago.Ordenes.length !== 1 ? 'es' : ''}
                                                </button>
                                            ) : <span className="text-xs text-slate-300">—</span>}
                                        </td>
                                    </tr>
                                    {isExp && hasOrd && (
                                        <tr>
                                            <td colSpan={7} className="px-8 pb-4 pt-0 bg-emerald-50/50 border-b border-emerald-100">
                                                <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
                                                    <div className="px-4 py-2 bg-emerald-600 text-white text-xs font-black flex items-center gap-2">
                                                        <Package size={13} /> Órdenes del pago · {pago.OrdenRetiro || `#${pago.Id}`}
                                                    </div>
                                                    <table className="w-full text-sm">
                                                        <thead>
                                                            <tr className="bg-emerald-50 text-emerald-800 text-xs font-black uppercase">
                                                                <th className="px-4 py-2 text-left">Código</th>
                                                                <th className="px-4 py-2 text-left">Material / Producto</th>
                                                                <th className="px-4 py-2 text-left">Modo</th>
                                                                <th className="px-4 py-2 text-center">Cantidad</th>
                                                                <th className="px-4 py-2 text-right">Monto</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-emerald-50">
                                                            {pago.Ordenes.map((o, i) => (
                                                                <tr key={i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                                                                    <td className="px-4 py-2 font-mono font-black text-blue-700">{o.codigo}</td>
                                                                    <td className="px-4 py-2 text-slate-700">{o.producto || '—'}</td>
                                                                    <td className="px-4 py-2">
                                                                        {o.modo ? <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-xs font-bold">{o.modo}</span> : <span className="text-slate-300">—</span>}
                                                                    </td>
                                                                    <td className="px-4 py-2 text-center font-bold text-slate-600">
                                                                        {o.cantidad != null ? Number(o.cantidad).toFixed(2) : '—'}
                                                                    </td>
                                                                    <td className="px-4 py-2 text-right font-bold text-slate-800">
                                                                        {o.moneda || '$'} {Number(o.monto || 0).toLocaleString()}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot>
                                                            {Object.entries(
                                                                pago.Ordenes.reduce((acc, o) => {
                                                                    const s = o.moneda || '$';
                                                                    acc[s] = (acc[s] || 0) + Number(o.monto || 0);
                                                                    return acc;
                                                                }, {})
                                                            ).map(([sym, tot], i, arr) => (
                                                                <tr key={sym} className="bg-emerald-50 font-black text-sm">
                                                                    {i === 0 && <td colSpan={3} rowSpan={arr.length} className="px-4 py-2 text-emerald-800">Total ({pago.Ordenes.length} órdenes)</td>}
                                                                    <td />
                                                                    <td className="px-4 py-2 text-right text-emerald-900">{sym} {tot.toLocaleString()}</td>
                                                                </tr>
                                                            ))}
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="text-xs text-slate-400 text-right">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</div>
            {/* Sentinel para infinite scroll */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loading && pagos.length > 0 && <div style={{display:'flex',justifyContent:'center',padding:'8px'}}><LottieSpinner size={40}/></div>}
            {!hasMore && pagos.length > 0 && <div className="text-center text-xs text-slate-400 py-2">— Fin de los resultados —</div>}
        </div>
    );
};

// ─── TAB 2 & 3: TABLA PAGOS ONLINE (compartida) ───────────────────────────

const TablaPagosOnline = ({ endpoint, fallidos = false, gatewayLabel = 'Transacción' }) => {
    const [pagos, setPagos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);
    const [filters, setFilters] = useState({ startDate: '', endDate: '', clientFilter: '' });
    const [hasMore, setHasMore] = useState(true);

    const offsetRef = useRef(0);
    const loadingRef = useRef(false);
    const sentinelRef = useRef(null);

    const fetchOnline = async (append = false) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });
            params.append('offset', offsetRef.current);
            const res = await api.get(`${endpoint}?${params}`);
            const data = res.data;
            if (append) setPagos(prev => [...prev, ...data]);
            else setPagos(data);
            const more = data.length === PAGE_SIZE;
            setHasMore(more);
            offsetRef.current += data.length;
        } catch (e) { console.error(e); }
        finally { setLoading(false); loadingRef.current = false; }
    };

    const handleSearch = () => {
        offsetRef.current = 0;
        setHasMore(true);
        fetchOnline(false);
    };

    useEffect(() => { fetchOnline(false); }, []);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting && hasMore && !loadingRef.current) fetchOnline(true); },
            { threshold: 0.1 }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore]);

    const parseOrders = (jsonStr) => { try { return JSON.parse(jsonStr || '[]'); } catch { return []; } };

    const MP_STATUS_MAP = {
        'approved':   'Pagado',
        'pending':    'Pendiente',
        'in_process': 'Pendiente',
        'rejected':   'Fallido',
        'cancelled':  'Cancelado',
        'refunded':   'Devuelto',
        'charged_back': 'Contracargo',
    };
    const normalizeStatus = (st) => MP_STATUS_MAP[(st || '').toLowerCase()] || st || 'Sin estado';

    const statusColor = (st) => {
        const s = (st || '').toLowerCase();
        if (['paid', 'pagado', 'success', 'approved'].includes(s)) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (['pending', 'pendiente', 'created', 'in_process'].includes(s)) return 'bg-amber-100 text-amber-700 border-amber-200';
        return 'bg-rose-100 text-rose-700 border-rose-200';
    };

    return (
        <div className="flex flex-col gap-3">
            <FilterBar filters={filters} onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))} onSearch={handleSearch} loading={loading} />

            <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-wide z-10">
                        <tr>
                            <th className="px-4 py-3 text-left">Fecha</th>
                            <th className="px-4 py-3 text-left">{gatewayLabel}</th>
                            <th className="px-4 py-3 text-left">Cliente</th>
                            <th className="px-4 py-3 text-right">Monto</th>
                            <th className="px-4 py-3 text-center">Estado</th>
                            <th className="px-4 py-3 text-center">Órdenes</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading && pagos.length === 0 ? (
                            <tr><td colSpan={6}><LottieSpinner size={72} /></td></tr>
                        ) : pagos.length === 0 ? (
                            <tr><td colSpan={6} className="text-center py-10 text-slate-400">
                                {fallidos ? '¡No hay pagos fallidos con esos filtros!' : 'No se encontraron pagos.'}
                            </td></tr>
                        ) : pagos.map(pago => {
                            // Usa el prefijo real de la BD devuelto por el backend
                            const orLabel = pago.OrdenRetiroFormatted || null;
                            const fecha = pago.PaidAt || pago.CreatedAt;
                            return (
                                <tr key={pago.Id} onClick={() => setSelected(pago)}
                                    className="hover:bg-blue-50 cursor-pointer transition-colors">
                                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                                        {fecha ? new Date(fecha).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">{pago.TransactionId}</td>
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-blue-700">{pago.NombreCliente || 'N/A'}</div>
                                        <div className="text-xs text-slate-400">Cód: {pago.CodCliente}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-black text-slate-800 whitespace-nowrap">
                                        {pago.Currency === 858 || pago.Currency === 'UYU' ? 'UYU' : 'USD'} {Number(pago.TotalAmount || 0).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${statusColor(pago.Status)}`}>
                                            {normalizeStatus(pago.Status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {orLabel
                                            ? <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-xs font-bold">{orLabel}</span>
                                            : <span className="text-slate-300 text-xs">Sin identificar</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loading && pagos.length > 0 && <div style={{display:'flex',justifyContent:'center',padding:'8px'}}><LottieSpinner size={40}/></div>}
            {!hasMore && pagos.length > 0 && <div className="text-center text-xs text-slate-400 py-2">— Fin de los resultados —</div>}
            <div className="text-xs text-slate-400 text-right">{pagos.length} resultado{pagos.length !== 1 ? 's' : ''}</div>

            {/* Modal detalle */}
            {selected && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
                            <div>
                                <h3 className="text-lg font-black text-blue-700">Detalle de Transacción</h3>
                                <p className="text-xs text-slate-400 font-mono mt-0.5">{selected.TransactionId}</p>
                            </div>
                            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-rose-500 w-9 h-9 rounded-full hover:bg-rose-50 flex items-center justify-center transition-all">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Cliente</p>
                                    <p className="font-bold text-slate-800">{selected.NombreCliente || 'N/A'}</p>
                                    <p className="text-xs text-slate-400">Cód: {selected.CodCliente}</p>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Monto / Estado</p>
                                    <p className="font-black text-blue-700 text-lg">
                                        {selected.Currency === 858 || selected.Currency === 'UYU' ? 'UYU' : 'USD'} {Number(selected.TotalAmount || 0).toFixed(2)}
                                    </p>
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border mt-1 ${statusColor(selected.Status)}`}>
                                        {normalizeStatus(selected.Status)} {selected.IssuerName ? `· ${selected.IssuerName}` : ''}
                                    </span>
                                </div>
                            </div>
                            {(() => {
                                const parsed = parseOrders(selected.OrdersJson);
                                const subs = parsed.orders || (Array.isArray(parsed) ? parsed : []);
                                const retiro = parsed.ordenRetiro;
                                return (
                                    <div>
                                        {retiro && (
                                            <p className="mb-2">
                                                <span className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full text-sm font-bold">
                                                    Retiro: {/^[A-Za-z]/.test(String(retiro)) ? String(retiro) : 'R-' + String(retiro)}
                                                </span>
                                            </p>
                                        )}
                                        {subs.length > 0 && (
                                            <table className="w-full text-sm border-collapse">
                                                <thead><tr className="bg-slate-100 text-slate-600 text-xs font-black uppercase">
                                                    <th className="px-3 py-2 text-left">ID</th>
                                                    <th className="px-3 py-2 text-left">Descripción</th>
                                                    <th className="px-3 py-2 text-right">Monto</th>
                                                </tr></thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {subs.map((o, i) => (
                                                        <tr key={i} className="hover:bg-slate-50">
                                                            <td className="px-3 py-2 font-bold">{o.id || o.rawId || 'N/A'}</td>
                                                            <td className="px-3 py-2 text-slate-600">{o.desc || 'Pedido estándar'}</td>
                                                            <td className="px-3 py-2 text-right font-bold text-blue-700">{Number(o.amount || 0).toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
                            <button onClick={() => setSelected(null)} className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-sm">Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── VISTA PRINCIPAL CON TABS ─────────────────────────────────────────────

const TABS = [
    { id: 'historial',   label: 'Todos los Pagos',       icon: <DollarSign size={15} />,   color: 'emerald' },
    { id: 'online',      label: 'Handy',                  icon: <Wifi size={15} />,          color: 'blue' },
    { id: 'fallidos',    label: 'Handy Fallidos',         icon: <WifiOff size={15} />,       color: 'rose' },
    { id: 'mp',          label: 'MercadoPago',            icon: <CreditCard size={15} />,    color: 'violet' },
    { id: 'mp-fallidos', label: 'MercadoPago Fallidos',   icon: <AlertTriangle size={15} />, color: 'orange' },
];

const TAB_COLOR = {
    emerald: 'bg-emerald-600 text-white shadow',
    blue:    'bg-blue-600 text-white shadow',
    rose:    'bg-rose-600 text-white shadow',
    violet:  'bg-violet-600 text-white shadow',
    orange:  'bg-orange-500 text-white shadow',
};

const VerificarPagosOnlineView = () => {
    const [tab, setTab] = useState('historial');

    return (
        <div className="min-h-full flex flex-col p-4 lg:p-8 gap-4 font-sans bg-[#f6f8fb]">
            <div className="flex items-center gap-4 flex-wrap">
                <h2 className="text-2xl font-black text-slate-800">Gestión de Pagos</h2>
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm flex-wrap">
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                                tab === t.id ? TAB_COLOR[t.color] : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}>
                            {t.icon} {t.label}
                            {(t.id === 'fallidos' || t.id === 'mp-fallidos') && tab !== t.id && (
                                <span className="ml-1 bg-rose-100 text-rose-600 text-[10px] font-black px-1.5 py-0.5 rounded-full">!</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1">
                {tab === 'historial'   && <HistorialPagos />}
                {tab === 'online'      && <TablaPagosOnline endpoint="/web-retiros/pagos-online" gatewayLabel="Transacción Handy" />}
                {tab === 'fallidos'    && <TablaPagosOnline endpoint="/web-retiros/pagos-online-fallidos" fallidos gatewayLabel="Transacción Handy" />}
                {tab === 'mp'          && <TablaPagosOnline endpoint="/web-retiros/pagos-mp" gatewayLabel="Transacción MP" />}
                {tab === 'mp-fallidos' && <TablaPagosOnline endpoint="/web-retiros/pagos-mp-fallidos" fallidos gatewayLabel="Transacción MP" />}
            </div>
        </div>
    );
};

export default VerificarPagosOnlineView;
