import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RefreshCw, CheckCircle, Clock, XCircle, FileText, User, Search, ChevronDown, ChevronRight, Package, ShieldCheck, HandCoins, CircleDollarSign, Loader2, SearchX, X, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

// Estética nueva (27/10/2026): encabezado, tarjetas de resumen, filtros en pastillas (Selector en el celular),
// fechas con SelectorFecha, tabla clara (en el celular, una tarjeta por retiro) de a 50 y ventana de gestión clara.
// La lógica (fuentes, filtros, gestión) no cambió.

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400';
const TH_CHICO = 'px-4 py-2 text-[10px] font-black uppercase tracking-wide text-zinc-400';
const CHIP = 'inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap';
const CHIP_NEUTRO = `${CHIP} bg-zinc-50 text-zinc-600 border-zinc-200`;
const SEGMENTO = 'inline-flex flex-wrap rounded-xl border border-zinc-200 bg-white p-1 gap-1';
const segmentoBoton = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`;

const ESTADOS = ['Pendiente', 'Cobrado', 'Condonado'];

const ESTADO_CONFIG = {
    Pendiente: { color: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock size={13} />, label: 'Pendiente' },
    Cobrado:   { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle size={13} />, label: 'Cobrado' },
    Condonado: { color: 'bg-zinc-50 text-zinc-500 border-zinc-200', icon: <XCircle size={13} />, label: 'Condonado' },
};

const ORIGENES = [
    { key: 'todos',     label: 'Todas las fuentes' },
    { key: 'HISTORICO', label: 'Históricas' },
    { key: 'CAJA',      label: 'Vía caja' },
];

const EstadoBadge = ({ estado }) => {
    const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.Pendiente;
    return (
        <span className={`${CHIP} ${cfg.color}`}>
            {cfg.icon} {cfg.label}
        </span>
    );
};

const OrigenBadge = ({ esCaja }) => esCaja
    ? <span className={`${CHIP} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20`}><ShieldCheck size={12} /> Vía caja</span>
    : <span className={CHIP_NEUTRO}>Historial</span>;

const getMonto = (item) => Number(item.MontoOrden || item.Monto || 0);
const fmtMonto = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (f) => f
    ? new Date(f).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : '—';
const fmtOrdenes = (n) => `${n} orden${n !== 1 ? 'es' : ''}`;
const fmtCantidad = (c) => Number(c).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Total de las órdenes de un retiro, por moneda: [['$', 1234.5], ['US$', 20]]
const totalesPorMoneda = (ordenes) => Object.entries(ordenes.reduce((acc, o) => {
    const sym = o.moneda || '$';
    acc[sym] = (acc[sym] || 0) + Number(o.monto || 0);
    return acc;
}, {}));

// Estado de una orden del retiro: entregada (verde), cancelada (falla), pronta (en curso), el resto neutro
const claseEstadoOrden = (nombre) => {
    const lower = nombre.toLowerCase();
    return lower.includes('entregad') ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : lower.includes('cancel') ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20'
        : lower.includes('pronto') || lower.includes('listo') ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20'
        : 'bg-zinc-50 text-zinc-600 border-zinc-200';
};

// En el celular, tarjetas en vez de la tabla de 10 columnas (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 1024px)';
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

// Listas de a 50 (patrón useDeAPoco de Reportes): con más de 1.800 registros se dibujaban todos de una. Al acercarse
// al final se agregan 50 más; vuelve a 50 cuando cambia la lista. El margen se mide contra el contenedor que scrollea.
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

const normalizeAutorizacion = (a) => ({
    Id: `AUZ-${a.AuzIdAutorizacion}`,
    OrdenRetiro: a.OrdenCodigo,
    NombreCliente: a.NombreCliente,
    CodigoCliente: a.CodigoCliente,
    Monto: parseFloat(a.AuzMontoDeuda || 0),
    MontoOrden: parseFloat(a.AuzMontoDeuda || 0),
    Explicacion: a.AuzMotivo,
    NombreAutorizador: a.NombreAutorizador,
    Estado: a.AuzEstado === 'ACTIVA' ? 'Pendiente' : a.AuzEstado === 'CONDONADA' ? 'Condonado' : 'Cobrado',
    Fecha: a.AuzFecha,
    FechaVencimiento: a.AuzFechaVencimiento || null,
    NotaGestion: a.AuzNotaGestion || null,
    TipoCliente: null,
    Ordenes: a.Ordenes || [],
    CantOrdenes: a.CantOrdenes || 0,
    _origen: 'CAJA',
});

const GestionModal = ({ item, onClose, onSaved }) => {
    const [estado, setEstado] = useState(item?.Estado || 'Pendiente');
    const [nota, setNota]     = useState(item?.NotaGestion || '');
    const [loading, setLoading] = useState(false);

    const handleGuardar = async () => {
        setLoading(true);
        try {
            if (item._origen === 'CAJA') {
                const numId = String(item.Id).replace('AUZ-', '');
                await api.put(`/contabilidad/caja/autorizaciones-sin-pago/${numId}`, { estado, nota });
            } else {
                await api.put(`/web-retiros/excepciones/${item.Id}/gestionar`, { estado, nota });
            }
            toast.success('Estado actualizado correctamente.');
            onSaved();
            onClose();
        } catch (err) {
            toast.error('Error al actualizar: ' + (err.response?.data?.error || err.message));
        } finally {
            setLoading(false);
        }
    };

    const monto = getMonto(item);

    return (
        <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-start gap-3">
                    <div className="min-w-0">
                        <div className="text-lg font-black text-zinc-900">Gestionar deuda</div>
                        <div className="text-sm text-zinc-500 truncate"><span className="font-mono font-bold text-zinc-700">{item?.OrdenRetiro}</span> · {item?.NombreCliente || item?.CodigoCliente}</div>
                    </div>
                    <button onClick={onClose} aria-label="Cerrar"
                        className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-6 flex flex-col gap-5 overflow-y-auto">
                    <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100 flex flex-col gap-3 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-0.5">Orden</div>
                                <div className="font-mono font-black text-zinc-800">{item?.OrdenRetiro}</div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-0.5">Monto total</div>
                                <div className="font-black text-zinc-900 tabular-nums">$ {fmtMonto(monto)}</div>
                            </div>
                            {item?.TipoCliente && (
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-0.5">Tipo</div>
                                    <div className="font-semibold text-zinc-700">{item.TipoCliente}</div>
                                </div>
                            )}
                            <div className="col-span-2">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-0.5">Motivo</div>
                                <div className="text-zinc-700 whitespace-pre-wrap">{item?.Explicacion || '—'}</div>
                            </div>
                        </div>
                        {item?.Ordenes?.length > 0 && (
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5 flex items-center gap-1.5"><Package size={12} className="text-brand-cyan" /> Órdenes del retiro</div>
                                <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
                                    <table className="w-full text-xs border-collapse">
                                        <thead className="bg-zinc-50 border-b border-zinc-200">
                                            <tr>
                                                <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase text-zinc-400">Código</th>
                                                <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase text-zinc-400">Material</th>
                                                <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase text-zinc-400">Modo</th>
                                                <th className="px-2 py-1.5 text-center text-[10px] font-black uppercase text-zinc-400">Cant.</th>
                                                <th className="px-2 py-1.5 text-right text-[10px] font-black uppercase text-zinc-400">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100">
                                            {item.Ordenes.map((o, i) => (
                                                <tr key={i}>
                                                    <td className="px-2 py-1.5 font-mono font-bold text-brand-cyan whitespace-nowrap">{o.codigo}</td>
                                                    <td className="px-2 py-1.5 text-zinc-600 max-w-[140px] truncate" title={o.producto}>{o.producto || '—'}</td>
                                                    <td className="px-2 py-1.5 text-zinc-600">{o.modo || <span className="text-zinc-300">—</span>}</td>
                                                    <td className="px-2 py-1.5 text-center font-bold text-zinc-700 tabular-nums">{o.cantidad != null ? fmtCantidad(o.cantidad) : '—'}</td>
                                                    <td className="px-2 py-1.5 text-right font-bold text-zinc-800 whitespace-nowrap tabular-nums">{o.moneda || '$'} {fmtMonto(o.monto)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Estado de cobro</label>
                        <div className="grid grid-cols-3 gap-2">
                            {ESTADOS.map(e => {
                                const cfg = ESTADO_CONFIG[e];
                                return (
                                    <button key={e} onClick={() => setEstado(e)}
                                        className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm border transition-colors ${
                                            estado === e
                                                ? `${cfg.color} ring-1 ring-current`
                                                : 'bg-white border-zinc-200 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50'
                                        }`}
                                    >
                                        {cfg.icon} {e}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="nota-gestion" className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Nota de gestión (opcional)</label>
                        <textarea id="nota-gestion" value={nota} onChange={e => setNota(e.target.value)}
                            placeholder="Ej: Cobrado en efectivo el 10/03, transferencia #12345..."
                            rows={3}
                            className="w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 resize-none"
                        />
                    </div>
                </div>
                <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
                    <button onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
                    <button onClick={handleGuardar} disabled={loading} className={BTN_PRINCIPAL}>
                        {loading ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Guardar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Un retiro con deuda en el celular: orden, cliente y monto arriba; origen, estado y motivo; al pie quién autorizó,
// la fecha y las acciones. Las órdenes se despliegan abajo.
const TarjetaDeuda = ({ item, abierto, onToggle, onGestionar }) => {
    const monto = getMonto(item);
    const hasOrdenes = item.Ordenes?.length > 0;
    const esCaja = item._origen === 'CAJA';
    return (
        <div className={`${CARD} p-3.5 flex flex-col gap-2.5 ${item.Estado !== 'Pendiente' ? 'opacity-70' : ''}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-mono font-black text-zinc-900">{item.OrdenRetiro}</div>
                    <div className="text-xs text-zinc-500">{item.NombreCliente || item.CodigoCliente || '—'}</div>
                </div>
                <div className={`font-black tabular-nums whitespace-nowrap ${monto > 0 ? 'text-zinc-900' : 'text-zinc-400'}`}>$ {fmtMonto(monto)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <EstadoBadge estado={item.Estado || 'Pendiente'} />
                <OrigenBadge esCaja={esCaja} />
                {item.TipoCliente && <span className={CHIP_NEUTRO}>{item.TipoCliente}</span>}
            </div>
            {item.Explicacion && <div className="text-xs text-zinc-700 whitespace-pre-wrap line-clamp-3">{item.Explicacion}</div>}
            {(item.NotaGestion || (esCaja && item.FechaVencimiento)) && (
                <div className="bg-zinc-50 rounded-xl px-3 py-2 text-xs flex flex-col gap-0.5">
                    {esCaja && item.FechaVencimiento && (
                        <div><span className="text-[10px] font-black uppercase tracking-widest text-amber-600">Vence </span>
                            <span className="font-bold text-zinc-700">{new Date(item.FechaVencimiento).toLocaleDateString('es-UY')}</span></div>
                    )}
                    {item.NotaGestion && <div className="text-zinc-600 italic whitespace-pre-wrap line-clamp-3">«{item.NotaGestion}»</div>}
                </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100">
                <div className="min-w-0 text-[11px] text-zinc-500 flex items-center gap-1.5 flex-wrap">
                    <span className="tabular-nums">{fmtFecha(item.Fecha)}</span>
                    <span className="inline-flex items-center gap-1"><User size={11} className="text-brand-cyan" /> {item.NombreAutorizador || `#${item.UsuarioAutorizador}`}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {hasOrdenes && (
                        <button onClick={onToggle}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${abierto ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'}`}>
                            {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {item.Ordenes.length}
                        </button>
                    )}
                    <button onClick={onGestionar} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-cyan text-white hover:bg-brand-cyan/90 transition-colors">Gestionar</button>
                </div>
            </div>
            {abierto && hasOrdenes && (
                <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                    {item.Ordenes.map((o, i) => (
                        <div key={i} className="px-3 py-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="font-mono font-bold text-brand-cyan text-sm">{o.codigo}</div>
                                {o.producto && <div className="text-xs text-zinc-600">{o.producto}</div>}
                                <div className="text-[11px] text-zinc-400 tabular-nums">
                                    {[o.modo, o.cantidad != null ? fmtCantidad(o.cantidad) : null].filter(Boolean).join(' · ')}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className="text-sm font-bold text-zinc-800 tabular-nums whitespace-nowrap">{o.moneda || '$'} {fmtMonto(o.monto)}</span>
                                {(() => { const nombre = o.estadoNombre || `E${o.estado}`; return <span className={`${CHIP} ${claseEstadoOrden(nombre)}`}>{nombre}</span>; })()}
                            </div>
                        </div>
                    ))}
                    {totalesPorMoneda(item.Ordenes).map(([sym, total], i) => (
                        <div key={sym} className="px-3 py-2 bg-zinc-50 flex justify-between gap-3 text-sm font-black">
                            <span className="text-zinc-700">{i === 0 ? `Total (${fmtOrdenes(item.Ordenes.length)})` : ''}</span>
                            <span className="text-zinc-900 tabular-nums whitespace-nowrap">{sym} {fmtMonto(total)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const ExcepcionesDeudaView = () => {
    const [excepciones, setExcepciones]       = useState([]);
    const [autorizaciones, setAutorizaciones] = useState([]);
    const [loading, setLoading]               = useState(true);
    const [error, setError]                   = useState(null);
    const [filtroEstado, setFiltroEstado]     = useState('todos');
    const [filtroOrigen, setFiltroOrigen]     = useState('todos'); // 'todos' | 'HISTORICO' | 'CAJA'
    const [itemGestion, setItemGestion]       = useState(null);
    const [expandedId, setExpandedId]         = useState(null);

    const [busqueda, setBusqueda]     = useState('');
    const [fechaDesde, setFechaDesde] = useState('');
    const [fechaHasta, setFechaHasta] = useState('');
    const conTabla = useConTabla();

    const fetchExcepciones = async () => {
        setLoading(true);
        setError(null);
        try {
            const [resExc, resAut] = await Promise.all([
                api.get('/web-retiros/excepciones'),
                api.get('/contabilidad/caja/autorizaciones-sin-pago').catch(() => ({ data: { data: [] } })),
            ]);
            setExcepciones(resExc.data || []);
            setAutorizaciones((resAut.data?.data || []).map(normalizeAutorizacion));
        } catch (err) {
            console.error(err);
            setError('Error al cargar la tabla de retiros con deuda.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchExcepciones(); }, []);

    // Unión de ambas fuentes
    const allItems = useMemo(() => {
        const excWithOrigen = excepciones.map(e => ({ ...e, _origen: 'HISTORICO' }));
        return [...excWithOrigen, ...autorizaciones];
    }, [excepciones, autorizaciones]);

    const filtered = useMemo(() => {
        let arr = allItems;

        if (filtroOrigen !== 'todos') arr = arr.filter(e => e._origen === filtroOrigen);
        if (filtroEstado !== 'todos') arr = arr.filter(e => e.Estado === filtroEstado);

        if (busqueda.trim()) {
            const t = busqueda.toLowerCase();
            arr = arr.filter(e => [
                e.OrdenRetiro, e.NombreCliente, e.CodigoCliente,
                e.TipoCliente, e.Explicacion, e.NombreAutorizador,
                ...(e.Ordenes || []).map(o => o.codigo)
            ].some(v => String(v || '').toLowerCase().includes(t)));
        }

        if (fechaDesde) {
            const desde = new Date(fechaDesde);
            arr = arr.filter(e => new Date(e.Fecha) >= desde);
        }
        if (fechaHasta) {
            const hasta = new Date(fechaHasta);
            hasta.setHours(23, 59, 59);
            arr = arr.filter(e => new Date(e.Fecha) <= hasta);
        }

        return arr;
    }, [allItems, filtroEstado, filtroOrigen, busqueda, fechaDesde, fechaHasta]);

    const resumen = useMemo(() => ({
        total:         allItems.length,
        pendiente:     allItems.filter(e => e.Estado === 'Pendiente').length,
        cobrado:       allItems.filter(e => e.Estado === 'Cobrado').length,
        montoPendiente: allItems.filter(e => e.Estado === 'Pendiente').reduce((a, e) => a + getMonto(e), 0),
        nuevasCaja:    autorizaciones.length,
    }), [allItems, autorizaciones]);

    const hayFiltros = busqueda || fechaDesde || fechaHasta || filtroEstado !== 'todos' || filtroOrigen !== 'todos';
    const limpiarFiltros = () => { setBusqueda(''); setFechaDesde(''); setFechaHasta(''); setFiltroEstado('todos'); setFiltroOrigen('todos'); };

    const [cuantos, centinela] = useDeAPoco(filtered);
    const visibles = filtered.slice(0, cuantos);
    const faltan = filtered.length - cuantos;

    const sinFilas = loading ? (
        <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando datos...
        </span>
    ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center">
            <SearchX size={40} className="mb-3 text-brand-cyan" />
            <span className="text-sm font-bold text-zinc-700">No hay registros con ese filtro.</span>
            {hayFiltros && <span className="text-xs text-zinc-400 mt-1">Probá con otra búsqueda, otro estado u otras fechas.</span>}
        </div>
    ) : null;

    const tarjetasResumen = [
        { label: 'Total registros', value: resumen.total.toLocaleString('es-UY'),     icon: FileText },
        { label: 'Pendientes',      value: resumen.pendiente.toLocaleString('es-UY'), icon: Clock },
        { label: 'Cobrados',        value: resumen.cobrado.toLocaleString('es-UY'),   icon: CheckCircle },
        { label: 'Monto pendiente', value: `$ ${fmtMonto(resumen.montoPendiente)}`,   icon: CircleDollarSign },
        { label: 'Nuevas vía caja', value: resumen.nuevasCaja.toLocaleString('es-UY'), icon: ShieldCheck },
    ];

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">

            {/* ENCABEZADO */}
            <div className="flex flex-wrap items-center gap-3">
                <HandCoins size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Pagos con deuda</h1>
                    <p className="text-sm text-zinc-500 mt-1">Retiros entregados con deuda pendiente · control de cobro administrativo</p>
                </div>
                <button onClick={fetchExcepciones} disabled={loading} className={BTN_SECUNDARIO} aria-label="Refrescar">
                    <RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Refrescar</span>
                </button>
            </div>

            {/* TARJETAS RESUMEN */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {tarjetasResumen.map(({ label, value, icon: Icono }, i) => (
                    <div key={label} className={`${CARD} p-4 flex flex-col gap-1.5 min-w-0 ${i === 3 ? 'col-span-2 order-last lg:col-span-1 lg:order-none' : ''}`}>
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            <Icono size={15} className="text-brand-cyan shrink-0" /> {label}
                        </div>
                        <div className="text-xl xl:text-2xl font-black text-zinc-900 tabular-nums truncate">{value}</div>
                    </div>
                ))}
            </div>

            {/* FILTROS */}
            <div className={`${CARD} p-4 flex flex-col gap-3`}>
                <div className="hidden md:flex flex-wrap items-center gap-2">
                    <div className={SEGMENTO}>
                        {['todos', ...ESTADOS].map(e => (
                            <button key={e} onClick={() => setFiltroEstado(e)} className={segmentoBoton(filtroEstado === e)}>
                                {e === 'todos' ? 'Todos' : e}
                            </button>
                        ))}
                    </div>
                    <div className={SEGMENTO}>
                        {ORIGENES.map(o => (
                            <button key={o.key} onClick={() => setFiltroOrigen(o.key)} className={segmentoBoton(filtroOrigen === o.key)}>
                                {o.key === 'CAJA' && <ShieldCheck size={13} className={filtroOrigen === o.key ? 'text-white' : 'text-brand-cyan'} />} {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:hidden">
                    <Selector filtro className="w-full" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} aria-label="Estado de cobro">
                        <option value="todos">Estado: todos</option>
                        {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                    </Selector>
                    <Selector filtro className="w-full" value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)} aria-label="Fuente">
                        {ORIGENES.map(o => <option key={o.key} value={o.key}>{o.key === 'todos' ? 'Fuente: todas' : o.label}</option>)}
                    </Selector>
                </div>

                <div className="grid grid-cols-2 gap-3 md:flex md:items-center">
                    <div className="relative col-span-2 md:flex-1 min-w-0">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            type="text"
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            placeholder="Buscar por orden, cliente, tipo, órdenes, motivo..."
                            aria-label="Buscar"
                            className={CAMPO}
                        />
                    </div>
                    <div className="min-w-0 md:w-40">
                        <SelectorFecha filtro vaciable className="w-full" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} placeholder="Desde" aria-label="Fecha desde" />
                    </div>
                    <div className="min-w-0 md:w-40">
                        <SelectorFecha filtro vaciable className="w-full" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} placeholder="Hasta" aria-label="Fecha hasta" />
                    </div>
                    {hayFiltros && (
                        <button onClick={limpiarFiltros}
                            className={`${BTN_SECUNDARIO} col-span-2 md:col-span-1 whitespace-nowrap text-zinc-500 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}>
                            <X size={14} /> Limpiar
                        </button>
                    )}
                </div>
            </div>

            <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Historial de retiros con deuda</h3>
                {!loading && (
                    <span className="text-xs font-bold text-zinc-400 tabular-nums">
                        {hayFiltros ? `${filtered.length.toLocaleString('es-UY')} de ${allItems.length.toLocaleString('es-UY')}` : `${allItems.length.toLocaleString('es-UY')} registros`}
                    </span>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 bg-brand-magenta/10 text-brand-magenta p-4 rounded-xl border border-brand-magenta/20 text-sm font-bold">
                    <AlertCircle size={16} className="shrink-0" /> {error}
                </div>
            )}

            {!conTabla ? (
                sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : (
                    <div className="flex flex-col gap-2.5">
                        {visibles.map((item, rowIdx) => (
                            <TarjetaDeuda key={`${item._origen}-${item.Id}-${rowIdx}`} item={item}
                                abierto={expandedId === item.Id}
                                onToggle={() => setExpandedId(expandedId === item.Id ? null : item.Id)}
                                onGestionar={() => setItemGestion(item)} />
                        ))}
                        {faltan > 0 && (
                            <div ref={centinela} className="py-3 text-center text-xs text-zinc-400">
                                Mostrando {cuantos.toLocaleString('es-UY')} de {filtered.length.toLocaleString('es-UY')}…
                            </div>
                        )}
                    </div>
                )
            ) : (
            <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th className={TH}>Fecha</th>
                                <th className={TH}>Orden / Cliente</th>
                                <th className={TH}>Tipo / Origen</th>
                                <th className={`${TH} text-right`}>Monto</th>
                                <th className={TH}>Órdenes</th>
                                <th className={TH}>Motivo</th>
                                <th className={TH}>Autorizó</th>
                                <th className={TH}>Estado cobro</th>
                                <th className={TH}>Nota / Vencimiento</th>
                                <th className={`${TH} text-center`}>Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {sinFilas ? (
                                <tr><td colSpan="10" className="px-4 py-14 text-center">{sinFilas}</td></tr>
                            ) : (
                                visibles.map((item, rowIdx) => {
                                    const monto      = getMonto(item);
                                    const isExpanded = expandedId === item.Id;
                                    const hasOrdenes = item.Ordenes?.length > 0;
                                    const esCaja     = item._origen === 'CAJA';
                                    const rowKey     = `${item._origen}-${item.Id}-${rowIdx}`;
                                    return (
                                        <React.Fragment key={rowKey}>
                                        <tr className={`transition-colors
                                            ${item.Estado !== 'Pendiente' ? 'opacity-70' : ''}
                                            ${isExpanded ? 'bg-zinc-50' : 'hover:bg-zinc-50'}
                                        `}>
                                            {/* Fecha */}
                                            <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap tabular-nums">{fmtFecha(item.Fecha)}</td>

                                            {/* Orden / Cliente */}
                                            <td className="px-4 py-3">
                                                <div className="font-mono font-black text-zinc-900">{item.OrdenRetiro}</div>
                                                <div className="text-xs text-zinc-500">{item.NombreCliente || item.CodigoCliente || '—'}</div>
                                            </td>

                                            {/* Tipo + Origen */}
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col items-start gap-1">
                                                    {item.TipoCliente ? <span className={CHIP_NEUTRO}>{item.TipoCliente}</span> : null}
                                                    <OrigenBadge esCaja={esCaja} />
                                                </div>
                                            </td>

                                            {/* Monto */}
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <span className={`font-black tabular-nums ${monto > 0 ? 'text-zinc-900' : 'text-zinc-400'}`}>
                                                    $ {fmtMonto(monto)}
                                                </span>
                                            </td>

                                            {/* Órdenes — botón expandir */}
                                            <td className="px-4 py-3">
                                                {hasOrdenes ? (
                                                    <button
                                                        onClick={() => setExpandedId(isExpanded ? null : item.Id)}
                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
                                                            isExpanded
                                                                ? 'bg-zinc-900 text-white border-zinc-900'
                                                                : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                                                        }`}
                                                    >
                                                        {isExpanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                                                        {fmtOrdenes(item.Ordenes.length)}
                                                    </button>
                                                ) : <span className="text-zinc-300 text-xs whitespace-nowrap">Sin órdenes</span>}
                                            </td>

                                            {/* Motivo */}
                                            <td className="px-4 py-3 max-w-[200px]">
                                                <div className="text-zinc-700 text-xs whitespace-pre-wrap line-clamp-2">{item.Explicacion || '—'}</div>
                                            </td>

                                            {/* Autorizó */}
                                            <td className="px-4 py-3 text-xs">
                                                <span className="inline-flex items-center gap-1.5 font-bold text-zinc-600 whitespace-nowrap">
                                                    <User size={12} className="text-brand-cyan" /> {item.NombreAutorizador || `#${item.UsuarioAutorizador}`}
                                                </span>
                                            </td>

                                            {/* Estado */}
                                            <td className="px-4 py-3">
                                                <EstadoBadge estado={item.Estado || 'Pendiente'} />
                                                {item.FechaGestion && (
                                                    <div className="text-[10px] text-zinc-400 mt-1 tabular-nums">
                                                        {new Date(item.FechaGestion).toLocaleDateString('es-UY')}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Nota / Vencimiento */}
                                            <td className="px-4 py-3 max-w-[180px]">
                                                <div className="flex flex-col gap-1">
                                                    {esCaja && item.FechaVencimiento && (
                                                        <div className="whitespace-nowrap">
                                                            <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Vence </span>
                                                            <span className="text-xs font-bold text-zinc-700 tabular-nums">
                                                                {new Date(item.FechaVencimiento).toLocaleDateString('es-UY')}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {item.NotaGestion
                                                        ? <div className="text-xs text-zinc-600 whitespace-pre-wrap line-clamp-3 italic">«{item.NotaGestion}»</div>
                                                        : (!esCaja || !item.FechaVencimiento) && <span className="text-zinc-300">—</span>
                                                    }
                                                </div>
                                            </td>

                                            {/* Acción */}
                                            <td className="px-4 py-3 text-center">
                                                <button onClick={() => setItemGestion(item)}
                                                    className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5 transition-colors"
                                                >
                                                    Gestionar
                                                </button>
                                            </td>
                                        </tr>

                                        {/* FILA EXPANDIBLE — detalle de órdenes */}
                                        {isExpanded && hasOrdenes && (
                                            <tr className="bg-zinc-50">
                                                <td colSpan={10} className="px-8 pb-4 pt-1">
                                                    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                                                        <div className="px-4 py-2.5 border-b border-zinc-100 text-xs font-bold text-zinc-700 flex items-center gap-2">
                                                            <Package size={14} className="text-brand-cyan" /> Detalle de órdenes · <span className="font-mono">{item.OrdenRetiro}</span>
                                                        </div>
                                                        <table className="w-full text-sm">
                                                            <thead className="bg-zinc-50 border-b border-zinc-100">
                                                                <tr>
                                                                    <th className={`${TH_CHICO} text-left`}>Código orden</th>
                                                                    <th className={`${TH_CHICO} text-left`}>Material / Producto</th>
                                                                    <th className={`${TH_CHICO} text-left`}>Modo</th>
                                                                    <th className={`${TH_CHICO} text-center`}>Cantidad</th>
                                                                    <th className={`${TH_CHICO} text-right`}>Monto</th>
                                                                    <th className={`${TH_CHICO} text-center`}>Estado</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-zinc-100">
                                                                {item.Ordenes.map((o, i) => (
                                                                    <tr key={i}>
                                                                        <td className="px-4 py-2.5 font-mono font-bold text-brand-cyan whitespace-nowrap">{o.codigo}</td>
                                                                        <td className="px-4 py-2.5 text-zinc-700 max-w-xs truncate" title={o.producto}>{o.producto || '—'}</td>
                                                                        <td className="px-4 py-2.5">
                                                                            {o.modo ? <span className={CHIP_NEUTRO}>{o.modo}</span> : <span className="text-zinc-300">—</span>}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-center font-bold text-zinc-600 tabular-nums">
                                                                            {o.cantidad != null ? fmtCantidad(o.cantidad) : '—'}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-right font-bold text-zinc-800 whitespace-nowrap tabular-nums">
                                                                            {o.moneda || '$'} {fmtMonto(o.monto)}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-center">
                                                                            {(() => {
                                                                                const nombre = o.estadoNombre || `E${o.estado}`;
                                                                                return <span className={`${CHIP} ${claseEstadoOrden(nombre)}`}>{nombre}</span>;
                                                                            })()}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                            <tfoot className="border-t border-zinc-200">
                                                                {totalesPorMoneda(item.Ordenes).map(([sym, total], i, arr) => (
                                                                    <tr key={sym} className="bg-zinc-50 font-black text-sm">
                                                                        {i === 0 && (
                                                                            <td colSpan={3} rowSpan={arr.length} className="px-4 py-2 text-zinc-700">
                                                                                Total ({fmtOrdenes(item.Ordenes.length)})
                                                                            </td>
                                                                        )}
                                                                        <td />
                                                                        <td className="px-4 py-2 text-right text-zinc-900 whitespace-nowrap tabular-nums">
                                                                            {sym} {fmtMonto(total)}
                                                                        </td>
                                                                        <td />
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
                                })
                            )}
                            {!sinFilas && faltan > 0 && (
                                <tr ref={centinela}>
                                    <td colSpan={10} className="px-4 py-3 text-center text-xs text-zinc-400">
                                        Mostrando {cuantos.toLocaleString('es-UY')} de {filtered.length.toLocaleString('es-UY')}…
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {itemGestion && (
                <GestionModal
                    item={itemGestion}
                    onClose={() => setItemGestion(null)}
                    onSaved={fetchExcepciones}
                />
            )}
        </div>
    );
};

export default ExcepcionesDeudaView;
