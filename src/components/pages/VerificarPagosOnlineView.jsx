import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../services/apiClient';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import {
    CreditCard, Wifi, WifiOff, Search, Loader2, Wallet,
    ChevronDown, ChevronRight, Package, X, AlertTriangle,
    DollarSign, Filter, SearchX
} from 'lucide-react';

// Estética nueva (27/10/2026): encabezado, pestañas (Selector en el celular), filtros con Selector/SelectorFecha,
// tablas en tarjeta (en el celular, un pago por tarjeta) y montos/fechas en formato uruguayo. La lógica de cada
// pestaña no cambió.

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_SIN_ICONO = CAMPO.replace('pl-9', 'pl-3');
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400';
const TH_CHICO = 'px-4 py-2 text-[10px] font-black uppercase tracking-wide text-zinc-400';
const CHIP = 'inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap';
const CHIP_NEUTRO = `${CHIP} bg-zinc-50 text-zinc-600 border-zinc-200`;
const CHIP_OK = `${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200`;
const CHIP_FALLA = `${CHIP} bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`;

const fmtFecha = (f) => f
    ? new Date(f).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : '—';
const fmtMonto = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtOrdenes = (n) => `${n} ${n !== 1 ? 'órdenes' : 'orden'}`;

// Total de las órdenes de un pago, por moneda: [['$', 1234.5], ['US$', 20]]
const totalesPorMoneda = (ordenes) => Object.entries(ordenes.reduce((acc, o) => {
    const s = o.moneda || '$';
    acc[s] = (acc[s] || 0) + Number(o.monto || 0);
    return acc;
}, {}));

// En el celular, tarjetas en vez de tablas anchas (una vista sola: no se dibujan las dos ocultando una)
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

const Cargando = ({ texto = 'Cargando pagos...' }) => (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 size={18} className="animate-spin text-brand-cyan" /> {texto}
    </span>
);

const Vacio = ({ texto, detalle }) => (
    <div className="flex flex-col items-center justify-center text-center">
        <SearchX size={40} className="mb-3 text-brand-cyan" />
        <span className="text-sm font-bold text-zinc-700">{texto}</span>
        {detalle && <span className="text-xs text-zinc-400 mt-1">{detalle}</span>}
    </div>
);

// Pie del listado: cargando la página siguiente o fin de los resultados
const PieListado = ({ loading, hayFilas, hasMore }) => (
    <>
        {loading && hayFilas && <div className="flex justify-center py-3"><Cargando texto="Cargando más..." /></div>}
        {!hasMore && hayFilas && <div className="text-center text-xs text-zinc-400 py-2">Fin de los resultados</div>}
    </>
);

const Cliente = ({ nombre, codigo }) => (
    <>
        {nombre
            ? <div className="font-bold text-zinc-800 text-sm">{nombre}</div>
            : <div className="text-sm text-zinc-400">Sin cliente</div>}
        {codigo && <div className="text-[11px] text-zinc-400 font-mono break-all">Cód: {codigo}</div>}
    </>
);

// ─── SHARED: Filtros de fecha + cliente + orden ────────────────────────────

const FilterBar = ({ filters, onChange, onSearch, extra, loading }) => (
    <div className={`${CARD} p-4 grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end`}>
        <div className="min-w-0 md:w-40">
            <span className={ETIQUETA}>Desde</span>
            <SelectorFecha filtro vaciable className="w-full" placeholder="Desde" aria-label="Desde"
                value={filters.startDate} onChange={e => onChange('startDate', e.target.value)} />
        </div>
        <div className="min-w-0 md:w-40">
            <span className={ETIQUETA}>Hasta</span>
            <SelectorFecha filtro vaciable className="w-full" placeholder="Hasta" aria-label="Hasta"
                value={filters.endDate} onChange={e => onChange('endDate', e.target.value)} />
        </div>
        <div className="col-span-2 md:flex-1 min-w-0 md:min-w-[200px]">
            <span className={ETIQUETA}>Cliente</span>
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <input type="text" placeholder="Nombre o código..." className={CAMPO} aria-label="Cliente"
                    value={filters.clientFilter} onChange={e => onChange('clientFilter', e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} />
            </div>
        </div>
        {filters.hasOwnProperty('orderFilter') && (
            <div className="min-w-0 md:w-40">
                <span className={ETIQUETA}>Orden retiro</span>
                <input type="text" placeholder="R-1234..." className={CAMPO_SIN_ICONO} aria-label="Orden retiro"
                    value={filters.orderFilter} onChange={e => onChange('orderFilter', e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} />
            </div>
        )}
        {extra}
        <button onClick={onSearch} disabled={loading} className={`${BTN_PRINCIPAL} col-span-2 md:col-span-1 whitespace-nowrap`}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Filtrar
        </button>
    </div>
);

// ─── TAB 1: HISTORIAL DE TODOS LOS PAGOS ──────────────────────────────────

const PAGE_SIZE = 50;

const BotonOrdenes = ({ cantidad, abierto, onClick }) => (
    <button onClick={onClick}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${abierto ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'}`}>
        {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {fmtOrdenes(cantidad)}
    </button>
);

// Un pago en el celular: cliente y monto arriba, método/tipo/retiro, y al pie la fecha y las órdenes (desplegables)
const TarjetaPago = ({ pago, abierto, onToggle }) => {
    const hasOrd = pago.Ordenes?.length > 0;
    // Un pago puede cubrir varios retiros (una transferencia por 4 RT): el
    // backend los manda juntos, "RT-1, RT-2", en una sola fila del pago.
    const variosRetiros = Number(pago.CantRetiros || 0) > 1;
    return (
        <div className={`${CARD} p-3.5 flex flex-col gap-2.5`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><Cliente nombre={pago.NombreCliente} codigo={pago.CodigoCliente} /></div>
                <div className="font-black text-zinc-900 tabular-nums whitespace-nowrap">{pago.Moneda || '$'} {fmtMonto(pago.Monto)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span className={`${CHIP} bg-white text-zinc-700 border-zinc-200`}>
                    <CreditCard size={12} className="text-brand-cyan" /> {pago.MetodoPago || '—'}
                </span>
                {pago.TipoCliente && <span className={CHIP_NEUTRO}>{pago.TipoCliente}</span>}
                {pago.OrdenRetiro
                    ? <span className="ml-auto flex flex-col items-end gap-0.5">
                        {String(pago.OrdenRetiro).split(', ').map(rt => (
                            <span key={rt} className="font-mono font-bold text-brand-cyan text-sm">{rt}</span>
                        ))}
                    </span>
                    : <span className="text-zinc-400 text-xs ml-auto">Sin retiro</span>}
            </div>
            <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-zinc-100">
                <span className="text-xs text-zinc-500 tabular-nums">{fmtFecha(pago.Fecha)}</span>
                {hasOrd && <BotonOrdenes cantidad={pago.Ordenes.length} abierto={abierto} onClick={onToggle} />}
            </div>
            {abierto && hasOrd && (
                <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                    {pago.Ordenes.map((o, i) => (
                        <div key={i} className="px-3 py-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="font-mono font-bold text-brand-cyan text-sm">
                                    {o.codigo}
                                    {variosRetiros && <span className="ml-1.5 text-zinc-400">· {o.retiro || '—'}</span>}
                                </div>
                                <div className="text-xs text-zinc-600">{o.producto || '—'}</div>
                                {(o.modo || o.cantidad != null) && (
                                    <div className="text-[11px] text-zinc-400 tabular-nums">
                                        {[o.modo, o.cantidad != null ? Number(o.cantidad).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null].filter(Boolean).join(' · ')}
                                    </div>
                                )}
                            </div>
                            <div className="text-sm font-bold text-zinc-800 tabular-nums whitespace-nowrap">{o.moneda || '$'} {fmtMonto(o.monto)}</div>
                        </div>
                    ))}
                    {totalesPorMoneda(pago.Ordenes).map(([sym, tot], i) => (
                        <div key={sym} className="px-3 py-2 bg-zinc-50 flex justify-between gap-3 text-sm font-black">
                            <span className="text-zinc-700">{i === 0 ? `Total (${fmtOrdenes(pago.Ordenes.length)})` : ''}</span>
                            <span className="text-zinc-900 tabular-nums whitespace-nowrap">{sym} {fmtMonto(tot)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const HistorialPagos = () => {
    const [pagos, setPagos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [metodos, setMetodos] = useState([]);
    const [filters, setFilters] = useState({ startDate: '', endDate: '', clientFilter: '', orderFilter: '', metodoPago: '' });
    const [busqueda, setBusqueda] = useState('');
    const [hasMore, setHasMore] = useState(true);
    const conTabla = useConTabla();

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

    const sinFilas = loading && pagos.length === 0 ? <Cargando />
        : filtered.length === 0 ? <Vacio texto="No se encontraron pagos." detalle="Probá con otras fechas, otro cliente u otro método." />
        : null;

    return (
        <div className="flex flex-col gap-4">
            <FilterBar
                filters={filters}
                onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
                onSearch={handleSearch}
                loading={loading}
                extra={
                    <div className="min-w-0 md:w-52">
                        <span className={ETIQUETA}>Método</span>
                        <Selector filtro className="w-full" aria-label="Método de pago" anchoLista={260}
                            value={filters.metodoPago} onChange={e => setFilters(f => ({ ...f, metodoPago: e.target.value }))}>
                            <option value="">Todos</option>
                            {metodos.map(m => <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>)}
                        </Selector>
                    </div>
                }
            />

            {/* Rótulo + buscador local (filtra lo ya cargado) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                <div className="flex items-baseline gap-3">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Pagos</h3>
                    <span className="text-xs font-bold text-zinc-400 tabular-nums">
                        {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
                    </span>
                </div>
                <div className="relative sm:w-[26rem]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input type="text" placeholder="Buscar cliente, retiro u orden..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                        aria-label="Buscar en los pagos cargados" className={`${CAMPO} pr-9`} />
                    {busqueda && (
                        <button onClick={() => setBusqueda('')} aria-label="Borrar búsqueda" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {!conTabla ? (
                sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : (
                    <div className="flex flex-col gap-2.5">
                        {filtered.map(pago => (
                            <TarjetaPago key={pago.Id} pago={pago} abierto={expandedId === pago.Id}
                                onToggle={() => setExpandedId(expandedId === pago.Id ? null : pago.Id)} />
                        ))}
                    </div>
                )
            ) : (
            <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm text-left border-collapse">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th className={TH}>Fecha</th>
                                <th className={TH}>Cliente</th>
                                <th className={TH}>Tipo</th>
                                <th className={TH}>Método de pago</th>
                                <th className={TH}>Orden retiro</th>
                                <th className={`${TH} text-right`}>Monto</th>
                                <th className={`${TH} text-center`}>Órdenes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {sinFilas ? (
                                <tr><td colSpan={7} className="px-4 py-14 text-center">{sinFilas}</td></tr>
                            ) : filtered.map(pago => {
                                const isExp = expandedId === pago.Id;
                                const hasOrd = pago.Ordenes?.length > 0;
                                // Un pago puede cubrir varios retiros (una transferencia por 4 RT): el
                                // backend los manda juntos, "RT-1, RT-2", en una sola fila del pago.
                                const variosRetiros = Number(pago.CantRetiros || 0) > 1;
                                return (
                                    <React.Fragment key={pago.Id}>
                                        <tr className={`transition-colors ${isExp ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
                                            <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap tabular-nums">{fmtFecha(pago.Fecha)}</td>
                                            <td className="px-4 py-3"><Cliente nombre={pago.NombreCliente} codigo={pago.CodigoCliente} /></td>
                                            <td className="px-4 py-3">
                                                {pago.TipoCliente
                                                    ? <span className={CHIP_NEUTRO}>{pago.TipoCliente}</span>
                                                    : <span className="text-zinc-300">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`${CHIP} bg-white text-zinc-700 border-zinc-200`}>
                                                    <CreditCard size={12} className="text-brand-cyan" /> {pago.MetodoPago || '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {pago.OrdenRetiro ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        {String(pago.OrdenRetiro).split(', ').map(rt => (
                                                            <span key={rt} className="font-mono font-bold text-brand-cyan text-sm">{rt}</span>
                                                        ))}
                                                    </div>
                                                ) : <span className="text-zinc-400 text-xs">Sin retiro</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right font-black text-zinc-900 text-sm whitespace-nowrap tabular-nums">
                                                {pago.Moneda || '$'} {fmtMonto(pago.Monto)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {hasOrd
                                                    ? <BotonOrdenes cantidad={pago.Ordenes.length} abierto={isExp} onClick={() => setExpandedId(isExp ? null : pago.Id)} />
                                                    : <span className="text-xs text-zinc-300">—</span>}
                                            </td>
                                        </tr>
                                        {isExp && hasOrd && (
                                            <tr className="bg-zinc-50">
                                                <td colSpan={7} className="px-8 pb-4 pt-1">
                                                    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                                                        <div className="px-4 py-2.5 border-b border-zinc-100 text-xs font-bold text-zinc-700 flex items-center gap-2">
                                                            <Package size={14} className="text-brand-cyan" /> Órdenes del pago · <span className="font-mono">{pago.OrdenRetiro || `#${pago.Id}`}</span>
                                                        </div>
                                                        <table className="w-full text-sm">
                                                            <thead className="bg-zinc-50 border-b border-zinc-100">
                                                                <tr>
                                                                    {variosRetiros && <th className={`${TH_CHICO} text-left`}>Retiro</th>}
                                                                    <th className={`${TH_CHICO} text-left`}>Código</th>
                                                                    <th className={`${TH_CHICO} text-left`}>Material / Producto</th>
                                                                    <th className={`${TH_CHICO} text-left`}>Modo</th>
                                                                    <th className={`${TH_CHICO} text-center`}>Cantidad</th>
                                                                    <th className={`${TH_CHICO} text-right`}>Monto</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-zinc-100">
                                                                {pago.Ordenes.map((o, i) => (
                                                                    <tr key={i}>
                                                                        {variosRetiros && <td className="px-4 py-2 font-mono font-bold text-zinc-500 whitespace-nowrap">{o.retiro || '—'}</td>}
                                                                        <td className="px-4 py-2 font-mono font-bold text-brand-cyan whitespace-nowrap">{o.codigo}</td>
                                                                        <td className="px-4 py-2 text-zinc-700">{o.producto || '—'}</td>
                                                                        <td className="px-4 py-2">
                                                                            {o.modo ? <span className={CHIP_NEUTRO}>{o.modo}</span> : <span className="text-zinc-300">—</span>}
                                                                        </td>
                                                                        <td className="px-4 py-2 text-center font-bold text-zinc-600 tabular-nums">
                                                                            {o.cantidad != null ? Number(o.cantidad).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right font-bold text-zinc-800 whitespace-nowrap tabular-nums">
                                                                            {o.moneda || '$'} {fmtMonto(o.monto)}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                            <tfoot className="border-t border-zinc-200">
                                                                {totalesPorMoneda(pago.Ordenes).map(([sym, tot], i, arr) => (
                                                                    <tr key={sym} className="bg-zinc-50 font-black text-sm">
                                                                        {i === 0 && <td colSpan={variosRetiros ? 4 : 3} rowSpan={arr.length} className="px-4 py-2 text-zinc-700">Total ({fmtOrdenes(pago.Ordenes.length)})</td>}
                                                                        <td />
                                                                        <td className="px-4 py-2 text-right text-zinc-900 whitespace-nowrap tabular-nums">{sym} {fmtMonto(tot)}</td>
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
            </div>
            )}
            {/* Sentinel para infinite scroll */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            <PieListado loading={loading} hayFilas={pagos.length > 0} hasMore={hasMore} />
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
    // Fallidos: por defecto solo los intentos cuya orden SIGUE sin pagar. Casi todos los demás son
    // reintentos de clientes que después pagaron (otro intento, la otra pasarela o caja).
    const [soloSinPagar, setSoloSinPagar] = useState(true);
    const soloSinPagarRef = useRef(true);
    const conTabla = useConTabla();

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
            if (fallidos && soloSinPagarRef.current) params.append('soloSinResolver', '1');
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

    const cambiarSoloSinPagar = () => {
        soloSinPagarRef.current = !soloSinPagarRef.current;
        setSoloSinPagar(soloSinPagarRef.current);
        handleSearch();
    };

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
    // Link generado sin respuesta de la pasarela (Handy «Creado», MP «pending» sin aviso): el cliente
    // lo abrió y no terminó de pagar. No es un rechazo.
    const etiquetaEstado = (pago) => {
        const s = (pago.Status || '').toLowerCase();
        if (s === 'creado' || (s === 'pending' && !pago.WebhookReceivedAt)) return 'Sin completar';
        return normalizeStatus(pago.Status);
    };

    // El color sale de la etiqueta que se muestra: «Sin completar» va en ámbar (no es un rechazo), no en el
    // color de falla como antes; un estado desconocido va en gris.
    const statusColor = (pago) => {
        const e = etiquetaEstado(pago).toLowerCase();
        if (['pagado', 'paid', 'success'].includes(e)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        if (['pendiente', 'sin completar', 'created'].includes(e)) return 'bg-amber-50 text-amber-700 border-amber-200';
        if (['devuelto', 'sin estado'].includes(e)) return 'bg-zinc-50 text-zinc-600 border-zinc-200';
        return 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20';
    };

    const moneda = (p) => (p.Currency === 858 || p.Currency === 'UYU' ? '$' : 'US$');
    const columnas = fallidos ? 7 : 6;
    const resultado = (pago) => pago.OrdenPagada === 1 ? <span className={CHIP_OK}>Pagó después</span>
        : pago.OrdenPagada === 0 ? <span className={CHIP_FALLA}>Sin pagar</span>
        : null;
    const sinFilas = loading && pagos.length === 0 ? <Cargando />
        : pagos.length === 0 ? <Vacio texto={fallidos
            ? (soloSinPagar ? 'No hay intentos fallidos con la orden sin pagar.' : 'No hay pagos fallidos con esos filtros.')
            : 'No se encontraron pagos.'} />
        : null;

    return (
        <div className="flex flex-col gap-4">
            <FilterBar filters={filters} onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))} onSearch={handleSearch} loading={loading}
                extra={fallidos && (
                    <button onClick={cambiarSoloSinPagar} disabled={loading}
                        title="Oculta los intentos cuya orden ya se pagó por otro lado (otro intento, la otra pasarela o caja)"
                        className={`col-span-2 md:col-span-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-colors disabled:opacity-50 whitespace-nowrap
                            ${soloSinPagar ? 'bg-brand-magenta/10 border-brand-magenta/20 text-brand-magenta' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50'}`}>
                        <Filter size={15} /> {soloSinPagar ? 'Solo sin pagar' : 'Todos los intentos'}
                    </button>
                )} />

            <div className="flex items-baseline gap-3 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">{fallidos ? 'Intentos fallidos' : 'Pagos'}</h3>
                <span className="text-xs font-bold text-zinc-400 tabular-nums">{pagos.length} resultado{pagos.length !== 1 ? 's' : ''}</span>
            </div>

            {!conTabla ? (
                sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : (
                    <div className="flex flex-col gap-2.5">
                        {pagos.map(pago => (
                            <button key={pago.Id} type="button" onClick={() => setSelected(pago)}
                                className={`${CARD} p-3.5 w-full text-left flex flex-col gap-2.5 hover:bg-zinc-50 transition-colors`}>
                                <div className="w-full flex items-start justify-between gap-3">
                                    <div className="min-w-0"><Cliente nombre={pago.NombreCliente} codigo={pago.CodCliente} /></div>
                                    <div className="font-black text-zinc-900 tabular-nums whitespace-nowrap">{moneda(pago)} {fmtMonto(pago.TotalAmount)}</div>
                                </div>
                                <div className="w-full flex flex-wrap items-center gap-1.5">
                                    <span className={`${CHIP} ${statusColor(pago)}`}>{etiquetaEstado(pago)}</span>
                                    {fallidos && resultado(pago)}
                                    {pago.OrdenRetiroFormatted
                                        ? <span className="font-mono font-bold text-brand-cyan text-sm ml-auto">{pago.OrdenRetiroFormatted}</span>
                                        : <span className="text-zinc-400 text-xs ml-auto">Sin identificar</span>}
                                </div>
                                <div className="w-full flex items-center justify-between gap-3 pt-2.5 border-t border-zinc-100">
                                    <span className="text-xs text-zinc-500 tabular-nums whitespace-nowrap">{fmtFecha(pago.PaidAt || pago.CreatedAt)}</span>
                                    <span className="text-[11px] text-zinc-400 font-mono truncate min-w-0">{pago.TransactionId}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )
            ) : (
            <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm text-left border-collapse">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th className={TH}>Fecha</th>
                                <th className={TH}>{gatewayLabel}</th>
                                <th className={TH}>Cliente</th>
                                <th className={`${TH} text-right`}>Monto</th>
                                <th className={`${TH} text-center`}>Estado</th>
                                {fallidos && <th className={`${TH} text-center`}>Resultado</th>}
                                <th className={`${TH} text-center`}>Órdenes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {sinFilas ? (
                                <tr><td colSpan={columnas} className="px-4 py-14 text-center">{sinFilas}</td></tr>
                            ) : pagos.map(pago => {
                                // Usa el prefijo real de la BD devuelto por el backend
                                const orLabel = pago.OrdenRetiroFormatted || null;
                                const fecha = pago.PaidAt || pago.CreatedAt;
                                return (
                                    <tr key={pago.Id} onClick={() => setSelected(pago)}
                                        className="hover:bg-zinc-50 cursor-pointer transition-colors">
                                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap tabular-nums">{fmtFecha(fecha)}</td>
                                        <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{pago.TransactionId}</td>
                                        <td className="px-4 py-3"><Cliente nombre={pago.NombreCliente} codigo={pago.CodCliente} /></td>
                                        <td className="px-4 py-3 text-right font-black text-zinc-900 whitespace-nowrap tabular-nums">
                                            {moneda(pago)} {fmtMonto(pago.TotalAmount)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`${CHIP} ${statusColor(pago)}`}>{etiquetaEstado(pago)}</span>
                                        </td>
                                        {fallidos && (
                                            <td className="px-4 py-3 text-center">{resultado(pago) || <span className="text-zinc-300">—</span>}</td>
                                        )}
                                        <td className="px-4 py-3 text-center">
                                            {orLabel
                                                ? <span className="font-mono font-bold text-brand-cyan text-sm">{orLabel}</span>
                                                : <span className="text-zinc-400 text-xs">Sin identificar</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            )}
            <div ref={sentinelRef} style={{ height: 1 }} />
            <PieListado loading={loading} hayFilas={pagos.length > 0} hasMore={hasMore} />

            {/* Modal detalle */}
            {selected && (
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-zinc-100">
                            <div className="min-w-0">
                                <h3 className="text-lg font-black text-zinc-900">Detalle de transacción</h3>
                                <p className="text-xs text-zinc-400 font-mono mt-0.5 break-all">{selected.TransactionId}</p>
                            </div>
                            <button onClick={() => setSelected(null)} aria-label="Cerrar"
                                className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                                    <p className={ETIQUETA}>Cliente</p>
                                    <Cliente nombre={selected.NombreCliente} codigo={selected.CodCliente} />
                                </div>
                                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                                    <p className={ETIQUETA}>Monto / Estado</p>
                                    <p className="font-black text-zinc-900 text-lg tabular-nums">
                                        {moneda(selected)} {fmtMonto(selected.TotalAmount)}
                                    </p>
                                    <span className={`${CHIP} mt-1 ${statusColor(selected)}`}>
                                        {etiquetaEstado(selected)} {selected.IssuerName ? `· ${selected.IssuerName}` : ''}
                                    </span>
                                </div>
                            </div>
                            {(() => {
                                const parsed = parseOrders(selected.OrdersJson);
                                const subs = parsed.orders || (Array.isArray(parsed) ? parsed : []);
                                const retiro = parsed.ordenRetiro;
                                return (
                                    <div className="flex flex-col gap-3">
                                        {retiro && (
                                            <p>
                                                <span className={`${CHIP} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20 font-mono`}>
                                                    Retiro: {/^[A-Za-z]/.test(String(retiro)) ? String(retiro) : 'R-' + String(retiro)}
                                                </span>
                                            </p>
                                        )}
                                        {subs.length > 0 && (
                                            <div className="rounded-xl border border-zinc-200 overflow-hidden">
                                                <table className="w-full text-sm border-collapse">
                                                    <thead className="bg-zinc-50 border-b border-zinc-200"><tr>
                                                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400">ID</th>
                                                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400">Descripción</th>
                                                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wide text-zinc-400">Monto</th>
                                                    </tr></thead>
                                                    <tbody className="divide-y divide-zinc-100">
                                                        {subs.map((o, i) => (
                                                            <tr key={i} className="hover:bg-zinc-50">
                                                                <td className="px-3 py-2 font-mono font-bold text-zinc-800">{o.id || o.rawId || 'N/A'}</td>
                                                                <td className="px-3 py-2 text-zinc-600">{o.desc || 'Pedido estándar'}</td>
                                                                <td className="px-3 py-2 text-right font-bold text-zinc-900 tabular-nums">{fmtMonto(o.amount)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="px-6 py-3 border-t border-zinc-100 flex justify-end">
                            <button onClick={() => setSelected(null)} className={BTN_SECUNDARIO}>Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── VISTA PRINCIPAL CON TABS ─────────────────────────────────────────────

const TABS = [
    { id: 'historial',   label: 'Todos los pagos',        Icono: DollarSign },
    { id: 'online',      label: 'Handy',                  Icono: Wifi },
    { id: 'fallidos',    label: 'Handy fallidos',         Icono: WifiOff,       falla: true },
    { id: 'mp',          label: 'MercadoPago',            Icono: CreditCard },
    { id: 'mp-fallidos', label: 'MercadoPago fallidos',   Icono: AlertTriangle, falla: true },
];

const VerificarPagosOnlineView = () => {
    const [tab, setTab] = useState('historial');

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3">
                <Wallet size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Gestión de pagos</h1>
                    <p className="text-sm text-zinc-500 mt-1">Todos los cobros y los pagos online de Handy y Mercado Pago</p>
                </div>
            </div>

            {/* Pestañas: pastillas en escritorio, Selector en el celular */}
            <div className="hidden md:inline-flex self-start flex-wrap rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                {TABS.map(({ id, label, Icono, falla }) => (
                    <button key={id} onClick={() => setTab(id)}
                        className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${
                            tab === id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                        }`}>
                        <Icono size={15} className={tab === id ? 'text-white' : (falla ? 'text-brand-magenta' : 'text-brand-cyan')} /> {label}
                    </button>
                ))}
            </div>
            <div className="md:hidden">
                <Selector className="w-full" value={tab} onChange={e => setTab(e.target.value)} aria-label="Pestaña">
                    {TABS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Selector>
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
