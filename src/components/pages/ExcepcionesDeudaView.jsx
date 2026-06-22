import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw, CheckCircle, Clock, XCircle, FileText, User, DollarSign, Search, Calendar, ChevronDown, ChevronRight, Package, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const ESTADOS = ['Pendiente', 'Cobrado', 'Condonado'];

const ESTADO_CONFIG = {
    Pendiente: { color: 'bg-rose-100 text-rose-700 border-rose-200', icon: <Clock size={14} />, label: 'Pendiente' },
    Cobrado:   { color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle size={14} />, label: 'Cobrado' },
    Condonado: { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: <XCircle size={14} />, label: 'Condonado' },
};

const EstadoBadge = ({ estado }) => {
    const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.Pendiente;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.color}`}>
            {cfg.icon} {cfg.label}
        </span>
    );
};

const getMonto = (item) => Number(item.MontoOrden || item.Monto || 0);

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
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 rounded-t-2xl flex justify-between items-center">
                    <div>
                        <div className="text-white font-black text-lg">Gestionar Deuda</div>
                        <div className="text-slate-300 text-sm">{item?.OrdenRetiro} · {item?.NombreCliente || item?.CodigoCliente}</div>
                    </div>
                    <button onClick={onClose} className="text-white hover:text-slate-300 text-2xl font-bold leading-none">&times;</button>
                </div>
                <div className="p-6 flex flex-col gap-4">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col gap-2 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                            <div><span className="font-bold text-slate-500">Orden:</span> <span className="font-black">{item?.OrdenRetiro}</span></div>
                            <div><span className="font-bold text-slate-500">Monto total:</span> <span className="font-black text-rose-600">$ {monto.toLocaleString()}</span></div>
                            {item?.TipoCliente && <div><span className="font-bold text-slate-500">Tipo:</span> <span className="font-semibold text-indigo-700">{item.TipoCliente}</span></div>}
                            <div><span className="font-bold text-slate-500">Motivo:</span> <span className="text-slate-700">{item?.Explicacion}</span></div>
                        </div>
                        {item?.Ordenes?.length > 0 && (
                            <div className="mt-1">
                                <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Package size={12}/> Órdenes del retiro</div>
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-200 text-slate-600 font-black">
                                            <th className="px-2 py-1 text-left rounded-l">Código</th>
                                            <th className="px-2 py-1 text-left">Material</th>
                                            <th className="px-2 py-1 text-left">Modo</th>
                                            <th className="px-2 py-1 text-center">Cant.</th>
                                            <th className="px-2 py-1 text-right rounded-r">Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {item.Ordenes.map((o, i) => (
                                            <tr key={i} className={i % 2 ? 'bg-white' : 'bg-slate-50'}>
                                                <td className="px-2 py-1 font-mono font-bold text-blue-700">{o.codigo}</td>
                                                <td className="px-2 py-1 text-slate-600 max-w-[160px] truncate" title={o.producto}>{o.producto || '—'}</td>
                                                <td className="px-2 py-1">
                                                    {o.modo ? <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[11px] font-bold">{o.modo}</span> : <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-2 py-1 text-center font-bold text-slate-700">{o.cantidad != null ? Number(o.cantidad).toFixed(2) : '—'}</td>
                                                <td className="px-2 py-1 text-right font-bold text-slate-700">{o.moneda || '$'} {Number(o.monto || 0).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Estado de Cobro</label>
                        <div className="flex gap-2">
                            {ESTADOS.map(e => {
                                const cfg = ESTADO_CONFIG[e];
                                return (
                                    <button key={e} onClick={() => setEstado(e)}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${
                                            estado === e
                                                ? `${cfg.color} border-current scale-105 shadow-sm`
                                                : 'border-slate-200 text-slate-400 hover:border-slate-300'
                                        }`}
                                    >
                                        {cfg.icon} {e}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Nota de gestión (opcional)</label>
                        <textarea value={nota} onChange={e => setNota(e.target.value)}
                            placeholder="Ej: Cobrado en efectivo el 10/03, transferencia #12345..."
                            rows={3}
                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                        />
                    </div>

                    <div className="flex gap-3 mt-1">
                        <button onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 font-bold py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                            Cancelar
                        </button>
                        <button onClick={handleGuardar} disabled={loading}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black py-2.5 rounded-xl transition-colors shadow-md"
                        >
                            {loading ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>
                </div>
            </div>
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

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* ENCABEZADO */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-rose-100 flex justify-center items-center rounded-xl">
                            <AlertCircle className="text-rose-600" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Pagos con Deuda</h1>
                            <p className="text-sm font-medium text-slate-500">Retiros entregados con deuda pendiente · control de cobro administrativo.</p>
                        </div>
                    </div>
                    <button onClick={fetchExcepciones}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 font-bold text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refrescar
                    </button>
                </div>

                {/* TARJETAS RESUMEN */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                        { label: 'Total registros',  value: resumen.total,          color: 'bg-slate-800',   icon: <FileText size={20} className="text-white" /> },
                        { label: 'Pendientes',        value: resumen.pendiente,      color: 'bg-rose-500',    icon: <Clock size={20} className="text-white" /> },
                        { label: 'Cobrados',          value: resumen.cobrado,        color: 'bg-emerald-500', icon: <CheckCircle size={20} className="text-white" /> },
                        { label: 'Monto pendiente',   value: `$ ${resumen.montoPendiente.toLocaleString('es-UY', { minimumFractionDigits: 2 })}`, color: 'bg-orange-500', icon: <DollarSign size={20} className="text-white" /> },
                        { label: 'Nuevas vía caja',   value: resumen.nuevasCaja,     color: 'bg-amber-500',   icon: <ShieldCheck size={20} className="text-white" /> },
                    ].map(c => (
                        <div key={c.label} className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-2 shadow-sm">
                            <div className={`w-10 h-10 ${c.color} rounded-xl flex items-center justify-center`}>{c.icon}</div>
                            <div className="text-2xl font-black text-slate-800">{c.value}</div>
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{c.label}</div>
                        </div>
                    ))}
                </div>

                {/* FILTROS + TABLA */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

                    {/* Barra de filtros */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <h2 className="text-lg font-bold text-slate-700">
                                Historial de Retiros con Deuda
                                {hayFiltros && (
                                    <span className="ml-2 text-sm font-semibold text-blue-600">
                                        · {filtered.length} de {allItems.length}
                                    </span>
                                )}
                            </h2>
                            <div className="flex flex-wrap gap-2">
                                {/* Filtro por estado */}
                                {['todos', ...ESTADOS].map(e => (
                                    <button key={e} onClick={() => setFiltroEstado(e)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                            filtroEstado === e
                                                ? 'bg-slate-800 text-white border-slate-800'
                                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                        }`}
                                    >
                                        {e === 'todos' ? '⭐ Todos' : e}
                                    </button>
                                ))}
                                {/* Filtro por origen */}
                                <div className="w-px bg-slate-200 mx-1" />
                                {[
                                    { key: 'todos',     label: 'Todas las fuentes' },
                                    { key: 'HISTORICO', label: '📋 Históricas' },
                                    { key: 'CAJA',      label: '🛡️ Vía Caja' },
                                ].map(o => (
                                    <button key={o.key} onClick={() => setFiltroOrigen(o.key)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                            filtroOrigen === o.key
                                                ? 'bg-amber-600 text-white border-amber-600'
                                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                        }`}
                                    >
                                        {o.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Buscador + fechas */}
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={busqueda}
                                    onChange={e => setBusqueda(e.target.value)}
                                    placeholder="Buscar por orden, cliente, tipo, órdenes, motivo..."
                                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Calendar size={16} className="text-slate-400 shrink-0" />
                                <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                    title="Fecha desde"
                                />
                                <span className="text-slate-400 text-sm">—</span>
                                <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                    title="Fecha hasta"
                                />
                                {hayFiltros && (
                                    <button onClick={() => { setBusqueda(''); setFechaDesde(''); setFechaHasta(''); setFiltroEstado('todos'); setFiltroOrigen('todos'); }}
                                        className="px-3 py-2 text-xs font-bold text-rose-600 border border-rose-200 rounded-xl hover:bg-rose-50 transition-colors whitespace-nowrap"
                                    >
                                        ✕ Limpiar
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-rose-50 text-rose-600 p-4 m-4 rounded-xl border border-rose-200 font-bold">{error}</div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 text-[11px] font-black uppercase tracking-wider border-b border-slate-200">
                                    <th className="p-4">Fecha</th>
                                    <th className="p-4">Orden / Cliente</th>
                                    <th className="p-4">Tipo / Origen</th>
                                    <th className="p-4">Monto</th>
                                    <th className="p-4">Órdenes</th>
                                    <th className="p-4">Motivo</th>
                                    <th className="p-4">Autorizó</th>
                                    <th className="p-4">Estado Cobro</th>
                                    <th className="p-4">Nota / Vencimiento</th>
                                    <th className="p-4 text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium">
                                {loading ? (
                                    <tr><td colSpan="10" className="text-center p-10 text-slate-400">Cargando datos...</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan="10" className="text-center p-10 text-slate-400 font-bold">No hay registros con ese filtro.</td></tr>
                                ) : (
                                    filtered.map((item, rowIdx) => {
                                        const monto      = getMonto(item);
                                        const isExpanded = expandedId === item.Id;
                                        const hasOrdenes = item.Ordenes?.length > 0;
                                        const esCaja     = item._origen === 'CAJA';
                                        const rowKey     = `${item._origen}-${item.Id}-${rowIdx}`;
                                        return (
                                            <React.Fragment key={rowKey}>
                                            <tr className={`hover:bg-slate-50 transition-colors cursor-default
                                                ${item.Estado !== 'Pendiente' ? 'opacity-70' : ''}
                                                ${isExpanded ? 'bg-blue-50/40' : ''}
                                                ${esCaja ? 'border-l-4 border-l-amber-400' : ''}
                                            `}>
                                                {/* Fecha */}
                                                <td className="p-4 text-slate-500 whitespace-nowrap text-xs">
                                                    {new Date(item.Fecha).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}
                                                </td>

                                                {/* Orden / Cliente */}
                                                <td className="p-4">
                                                    <div className="font-black text-slate-800">{item.OrdenRetiro}</div>
                                                    <div className="text-xs text-slate-500">{item.NombreCliente || item.CodigoCliente || '—'}</div>
                                                </td>

                                                {/* Tipo + Origen */}
                                                <td className="p-4">
                                                    <div className="flex flex-col gap-1">
                                                        {item.TipoCliente ? (
                                                            <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                                {item.TipoCliente}
                                                            </span>
                                                        ) : null}
                                                        {esCaja ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-black bg-amber-50 text-amber-700 border border-amber-200">
                                                                <ShieldCheck size={11} /> VÍA CAJA
                                                            </span>
                                                        ) : (
                                                            <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                                                Historial
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Monto */}
                                                <td className="p-4 whitespace-nowrap">
                                                    <span className={`font-black text-base ${monto > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                                                        $ {monto.toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                                                    </span>
                                                </td>

                                                {/* Órdenes — botón expandir */}
                                                <td className="p-4">
                                                    {hasOrdenes ? (
                                                        <button
                                                            onClick={() => setExpandedId(isExpanded ? null : item.Id)}
                                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                                                                isExpanded
                                                                    ? 'bg-blue-600 text-white border-blue-600'
                                                                    : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                                                            }`}
                                                        >
                                                            {isExpanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                                                            {item.Ordenes.length} orden{item.Ordenes.length !== 1 ? 'es' : ''}
                                                        </button>
                                                    ) : <span className="text-slate-300 text-xs">Sin órdenes</span>}
                                                </td>

                                                {/* Motivo */}
                                                <td className="p-4 max-w-[180px]">
                                                    <div className="text-slate-700 text-xs whitespace-pre-wrap line-clamp-2">{item.Explicacion || '—'}</div>
                                                </td>

                                                {/* Autorizó */}
                                                <td className="p-4 text-xs">
                                                    <span className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg font-bold">
                                                        <User size={12} /> {item.NombreAutorizador || `#${item.UsuarioAutorizador}`}
                                                    </span>
                                                </td>

                                                {/* Estado */}
                                                <td className="p-4">
                                                    <EstadoBadge estado={item.Estado || 'Pendiente'} />
                                                    {item.FechaGestion && (
                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                            {new Date(item.FechaGestion).toLocaleDateString('es-UY')}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* Nota / Vencimiento */}
                                                <td className="p-4 max-w-[160px]">
                                                    <div className="flex flex-col gap-1">
                                                        {esCaja && item.FechaVencimiento && (
                                                            <div>
                                                                <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Vence: </span>
                                                                <span className="text-xs font-bold text-slate-700">
                                                                    {new Date(item.FechaVencimiento).toLocaleDateString('es-UY')}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {item.NotaGestion
                                                            ? <div className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-3 italic">"{item.NotaGestion}"</div>
                                                            : (!esCaja || !item.FechaVencimiento) && <span className="text-slate-300">—</span>
                                                        }
                                                    </div>
                                                </td>

                                                {/* Acción */}
                                                <td className="p-4 text-center">
                                                    <button onClick={() => setItemGestion(item)}
                                                        className={`px-3 py-1.5 border rounded-xl text-xs font-bold transition-colors ${
                                                            esCaja
                                                                ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                                                                : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                                        }`}
                                                    >
                                                        Gestionar
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* FILA EXPANDIBLE — detalle de órdenes */}
                                            {isExpanded && hasOrdenes && (
                                                <tr>
                                                    <td colSpan={10} className="px-8 pb-4 pt-0 bg-blue-50/60 border-b border-blue-100">
                                                        <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
                                                            <div className="px-4 py-2 bg-blue-600 text-white text-xs font-black flex items-center gap-2">
                                                                <Package size={14}/> Detalle de órdenes · {item.OrdenRetiro}
                                                            </div>
                                                            <table className="w-full text-sm">
                                                                <thead>
                                                                    <tr className="bg-blue-50 text-blue-800 text-xs font-black uppercase tracking-wide">
                                                                        <th className="px-4 py-2 text-left">Código orden</th>
                                                                        <th className="px-4 py-2 text-left">Material / Producto</th>
                                                                        <th className="px-4 py-2 text-left">Modo</th>
                                                                        <th className="px-4 py-2 text-center">Cantidad</th>
                                                                        <th className="px-4 py-2 text-right">Monto</th>
                                                                        <th className="px-4 py-2 text-center">Estado</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-blue-50">
                                                                    {item.Ordenes.map((o, i) => (
                                                                        <tr key={i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                                                                            <td className="px-4 py-2.5 font-mono font-black text-blue-700">{o.codigo}</td>
                                                                            <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate" title={o.producto}>{o.producto || '—'}</td>
                                                                            <td className="px-4 py-2.5">
                                                                                {o.modo ? (
                                                                                    <span className="inline-block px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-bold">{o.modo}</span>
                                                                                ) : <span className="text-slate-300">—</span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-center font-bold text-slate-700">
                                                                                {o.cantidad != null ? (
                                                                                    <span className="inline-block px-2 py-0.5 bg-slate-100 rounded-lg text-xs font-black text-slate-600">{Number(o.cantidad).toFixed(2)}</span>
                                                                                ) : '—'}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-right font-bold text-slate-800">
                                                                                {o.moneda || '$'} {Number(o.monto || 0).toLocaleString()}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-center">
                                                                                {(() => {
                                                                                    const nombre = o.estadoNombre || `E${o.estado}`;
                                                                                    const lower  = nombre.toLowerCase();
                                                                                    const cls = lower.includes('entregad')
                                                                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                                                                        : lower.includes('cancel')
                                                                                        ? 'bg-rose-100 text-rose-700 border-rose-200'
                                                                                        : lower.includes('pronto') || lower.includes('listo')
                                                                                        ? 'bg-blue-100 text-blue-700 border-blue-200'
                                                                                        : 'bg-slate-100 text-slate-600 border-slate-200';
                                                                                    return (
                                                                                        <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${cls}`}>
                                                                                            {nombre}
                                                                                        </span>
                                                                                    );
                                                                                })()}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                                <tfoot>
                                                                    {Object.entries(
                                                                        item.Ordenes.reduce((acc, o) => {
                                                                            const sym = o.moneda || '$';
                                                                            acc[sym] = (acc[sym] || 0) + Number(o.monto || 0);
                                                                            return acc;
                                                                        }, {})
                                                                    ).map(([sym, total], i, arr) => (
                                                                        <tr key={sym} className="bg-blue-50 font-black text-sm">
                                                                            {i === 0 && (
                                                                                <td colSpan={2} rowSpan={arr.length} className="px-4 py-2 text-blue-800">
                                                                                    Total ({item.Ordenes.length} orden{item.Ordenes.length !== 1 ? 'es' : ''})
                                                                                </td>
                                                                            )}
                                                                            <td />
                                                                            <td className="px-4 py-2 text-right text-blue-900">
                                                                                {sym} {total.toLocaleString()}
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
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

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
