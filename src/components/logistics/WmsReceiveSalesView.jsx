import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Package, CheckCircle, ChevronDown, ChevronUp, RefreshCw, XCircle, Save, Edit2, PlayCircle, Clock, History, StickyNote, Send, Printer, Search, Truck, PackagePlus } from 'lucide-react';
import { wmsService } from '../../services/modules/wmsService';

// [WMS] Vista unificada de la pestaña "Recibir órdenes de venta" (Inventario):
// todo el ciclo del pedido VEN en un solo lugar, con stepper por pedido.
//   1. PENDIENTE        → botón "Iniciar Preparación"
//   2. EN_PREPARACION   → botón "Finalizar" = descuenta stock WMS (rebaje de
//                         inventario) + genera etiqueta + ingresa a Depósito +
//                         aviso automático al cliente (encadena los endpoints
//                         confirm y receive existentes, sin lógica nueva).
//   3. PREPARADO (viejo)→ botón "Ingresar a Depósito y Avisar" (solo receive,
//                         para pedidos que ya venían preparados de Logística).
// La página de Logística WMS sigue funcionando igual — esto es aditivo.
const WmsReceiveSalesView = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [processingId, setProcessingId] = useState(null);
    const [expandedOrder, setExpandedOrder] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [cancelDialog, setCancelDialog] = useState(null);
    const [editingItem, setEditingItem] = useState(null); // { pedidoId, wms_variante_id, nuevaCantidad }
    const [eventosMap, setEventosMap] = useState({});     // pedidoId -> [eventos]
    const [notaDrafts, setNotaDrafts] = useState({});     // pedidoId -> texto de nota en edición
    const [savingNota, setSavingNota] = useState(false);
    // Pestañas: 'proceso' = pedidos activos (Pendiente/En Prep./Preparado);
    // 'historial' = terminados/cancelados, se consultan con búsqueda.
    const [vista, setVista] = useState('proceso');
    const [historial, setHistorial] = useState([]);
    const [historialSearch, setHistorialSearch] = useState('');
    const [loadingHistorial, setLoadingHistorial] = useState(false);
    const [procesoSearch, setProcesoSearch] = useState(''); // filtro en vivo por orden/cliente

    useEffect(() => {
        loadOrders();
        const interval = setInterval(loadOrders, 30000); // Auto-refresh every 30s
        return () => clearInterval(interval);
    }, []);

    const loadOrders = async () => {
        try {
            setLoading(true);
            // Pendientes + En Preparación (endpoint de Logística) y Preparados, unificados
            const [pendientes, preparados] = await Promise.all([
                wmsService.getPendingOrders().catch(() => []),
                wmsService.getPreparedOrders().catch(() => [])
            ]);
            // Normalizar el estado: en la base EstadoCobro puede venir con espacios al
            // final (SQL los ignora en el IN, JS no) — sin el trim el stepper y los
            // botones no matchean y la card queda sin acción.
            const all = [...(pendientes || []), ...(preparados || [])]
                .map(o => ({ ...o, estado: (o.estado || '').trim().toUpperCase() }))
                .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
            setOrders(all);
        } catch (error) {
            console.error('Error cargando pedidos:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadHistorial = async (search = historialSearch) => {
        try {
            setLoadingHistorial(true);
            const data = await wmsService.getHistorialPedidos(search);
            setHistorial((data || []).map(o => ({ ...o, estado: (o.estado || '').trim().toUpperCase() })));
        } catch (error) {
            toast.error('Error cargando el historial');
        } finally {
            setLoadingHistorial(false);
        }
    };

    // Abrir la impresión de etiquetas del pedido (resuelve el backend por VEN)
    const handlePrintEtiquetas = (order, e) => {
        if (e) e.stopPropagation();
        window.open(`/api/wms-logistica/etiquetas-print/${order.id}`, '_blank');
    };

    // Agregar un bulto más al pedido (va en más de un paquete). SOLO agrega y actualiza
    // el contador — la impresión es acción aparte (botón 🖨, saca todas las etiquetas
    // ya renumeradas 1/N ... N/N).
    const handleAddBulto = async (order, e) => {
        if (e) e.stopPropagation();
        try {
            const res = await wmsService.addBultoPedido(order.id);
            toast.success(res.message || 'Bulto agregado');
            if (vista === 'historial') loadHistorial(); else loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al agregar el bulto');
        }
    };

    // ── Historial y notas ────────────────────────────────────────────────────
    const loadEventos = async (pedidoId) => {
        try {
            const res = await wmsService.getEventos(pedidoId);
            setEventosMap(prev => ({ ...prev, [pedidoId]: res.eventos || [] }));
        } catch (e) { /* sin historial no se rompe la vista */ }
    };

    const toggleExpand = (order) => {
        const next = expandedOrder === order.id ? null : order.id;
        setExpandedOrder(next);
        if (next) loadEventos(order.id);
    };

    const handleAddNota = async (pedidoId) => {
        const nota = (notaDrafts[pedidoId] || '').trim();
        if (!nota) return;
        try {
            setSavingNota(true);
            await wmsService.addNota(pedidoId, nota);
            setNotaDrafts(prev => ({ ...prev, [pedidoId]: '' }));
            toast.success('Nota agregada al pedido');
            loadEventos(pedidoId);
            // refrescar el contador 📝 de la tarjeta
            if (vista === 'historial') loadHistorial(); else loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al agregar la nota');
        } finally {
            setSavingNota(false);
        }
    };

    const handleStartPreparation = async (order) => {
        try {
            setProcessingId(order.id);
            const loadingToast = toast.loading(`Iniciando preparación de ${order.codigo}...`);
            await wmsService.startPreparation(order.id);
            toast.success('Preparación iniciada', { id: loadingToast });
            loadOrders();
            if (expandedOrder === order.id) loadEventos(order.id);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al iniciar preparación');
        } finally {
            setProcessingId(null);
        }
    };

    // "Finalizar": descuenta stock WMS + etiqueta, y de corrido ingresa a Depósito y avisa.
    // Si el ingreso falla, el pedido queda PREPARADO y el botón pasa a "Ingresar a
    // Depósito y Avisar" para reintentar solo esa parte.
    const handleFinalize = async (order) => {
        try {
            setConfirmDialog(null);
            setProcessingId(order.id);

            if (order.estado !== 'PREPARADO') {
                const loadingToast = toast.loading(`Descontando stock WMS de ${order.codigo}...`);
                const res1 = await wmsService.confirmPreparation(order.id);
                if (!res1.success) {
                    toast.error(res1.message || 'No se pudo confirmar la preparación', { id: loadingToast });
                    loadOrders();
                    return;
                }
                if (res1.wmsErrors?.length > 0) {
                    toast.warning(`Stock descontado con advertencias: ${res1.wmsErrors.join('; ')}`, { id: loadingToast });
                } else {
                    toast.success('Stock descontado del WMS', { id: loadingToast });
                }
                // Etiqueta del bulto: se genera en el confirm — abrirla acá, igual que
                // hace la página de Logística WMS (única oportunidad automática).
                if (res1.bultoOrdenIds && res1.bultoOrdenIds.length === 1) {
                    window.open(`/api/production-file-control/orden/${res1.bultoOrdenIds[0]}/etiquetas/print`, '_blank');
                } else if (res1.bultoOrdenIds && res1.bultoOrdenIds.length > 1) {
                    window.open(`/api/production-file-control/orden/batch/etiquetas/print?ids=${res1.bultoOrdenIds.join(',')}`, '_blank');
                }
            }

            const receiveToast = toast.loading('Ingresando a Depósito y programando aviso...');
            const res2 = await wmsService.receivePreparedOrder(order.id);
            if (res2.success === false) {
                toast.error(res2.message || 'No se pudo ingresar el pedido a Depósito', { id: receiveToast });
            } else {
                toast.success(res2.message || 'Pedido ingresado a Depósito y aviso programado', { id: receiveToast });
            }
            loadOrders();
            if (expandedOrder === order.id) loadEventos(order.id);
        } catch (error) {
            toast.error(error.response?.data?.error || error.response?.data?.message || 'Error al finalizar el pedido');
            loadOrders();
        } finally {
            setProcessingId(null);
        }
    };

    const handleCancelOrder = async (pedidoId) => {
        try {
            setCancelDialog(null);
            const loadingToast = toast.loading('Cancelando pedido...');
            const res = await wmsService.cancelOrder(pedidoId);
            toast.success(res.message || 'Pedido cancelado', { id: loadingToast });
            loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al cancelar');
        }
    };

    const handleSaveQuantity = async () => {
        if (!editingItem) return;
        try {
            const loadingToast = toast.loading('Actualizando cantidad...');
            await wmsService.updateItemQuantity(editingItem.pedidoId, {
                wms_variante_id: editingItem.wms_variante_id,
                nuevaCantidad: editingItem.nuevaCantidad
            });
            toast.success('Cantidad actualizada', { id: loadingToast });
            setEditingItem(null);
            loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al actualizar cantidad');
        }
    };

    // ── Stepper ──────────────────────────────────────────────────────────────
    const STEP_LABELS = ['Preparación', 'Stock descontado', 'Depósito + Aviso'];
    // Paso "actual" según el estado del pedido (los anteriores se muestran hechos)
    const stepIndexOf = (estado) => {
        if (estado === 'PENDIENTE') return 0;
        if (estado === 'EN_PREPARACION') return 1;
        if (estado === 'RECIBIDO_DEPOSITO' || estado === 'ENTREGADO') return 3; // todo hecho
        return 2; // PREPARADO: falta solo el ingreso a depósito + aviso
    };

    const Stepper = ({ estado }) => {
        const current = stepIndexOf(estado);
        return (
            <div className="flex items-center gap-0">
                {STEP_LABELS.map((label, i) => {
                    const done = i < current;
                    const active = i === current;
                    return (
                        <React.Fragment key={label}>
                            {i > 0 && (
                                <div className={`h-0.5 w-6 sm:w-10 ${i <= current ? 'bg-indigo-400' : 'bg-slate-200'}`} />
                            )}
                            <div className="flex flex-col items-center gap-1">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                                    done ? 'bg-indigo-500 border-indigo-500 text-white'
                                    : active ? 'bg-white border-indigo-500 text-indigo-600'
                                    : 'bg-white border-slate-200 text-slate-400'
                                }`}>
                                    {done ? <CheckCircle size={15} /> : i + 1}
                                </div>
                                <span className={`text-[9px] font-bold uppercase tracking-wide hidden sm:block ${
                                    done || active ? 'text-indigo-600' : 'text-slate-400'
                                }`}>{label}</span>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>
        );
    };

    // Etiquetas legibles para el historial (Claridad: qué pasó exactamente en cada paso)
    const EVENTO_LABELS = {
        'CREADO': 'Pedido creado',
        'PENDIENTE': 'Pedido creado (Pendiente)',
        'EN_PREPARACION': 'Preparación iniciada',
        'PREPARADO': 'Stock descontado del WMS (Preparado)',
        'RECIBIDO_DEPOSITO': 'Ingresado a Depósito + aviso al cliente',
        'CANCELADO': 'Pedido cancelado',
        'ENTREGADO': 'Entregado al cliente',
    };

    // Nombres legibles de las áreas de producción (para el badge "→ Bordado" de los
    // pedidos comprar+personalizar, cuyas órdenes hermanas comparten el VEN)
    const AREA_LABELS = {
        'EMB': 'Bordado', 'DF': 'DTF', 'TPU': 'TPU', 'EST': 'Estampado',
        'TWC': 'Corte', 'TWT': 'Costura', 'SB': 'Sublimación',
        'ECOUV': 'Eco UV', 'DIRECTA': 'Directa', 'PRO': 'Producción',
    };

    const ESTADO_BADGE = {
        'PENDIENTE': { cls: 'bg-amber-50 text-amber-700', icon: <Clock size={14} />, label: 'Pendiente' },
        'EN_PREPARACION': { cls: 'bg-blue-50 text-blue-700', icon: <PlayCircle size={14} />, label: 'En Preparación' },
        'PREPARADO': { cls: 'bg-indigo-50 text-indigo-700', icon: <CheckCircle size={14} />, label: 'Preparado WMS' },
        'RECIBIDO_DEPOSITO': { cls: 'bg-emerald-50 text-emerald-700', icon: <Truck size={14} />, label: 'En Depósito' },
        'ENTREGADO': { cls: 'bg-slate-100 text-slate-600', icon: <CheckCircle size={14} />, label: 'Entregado' },
        'CANCELADO': { cls: 'bg-red-50 text-red-600', icon: <XCircle size={14} />, label: 'Cancelado' },
    };

    const activeCount = orders.length;

    // Lista visible según pestaña + filtro en vivo de En Proceso
    const filtroProceso = procesoSearch.trim().toLowerCase();
    const listaVisible = vista === 'proceso'
        ? orders.filter(o => !filtroProceso
            || (o.codigo || '').toLowerCase().includes(filtroProceso)
            || (o.cliente || '').toLowerCase().includes(filtroProceso))
        : historial;

    return (
        <div className="p-6 bg-slate-50 min-h-screen relative">

            {/* Confirmation Dialog (Finalizar) */}
            {confirmDialog && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-4 mb-4 text-emerald-600">
                            <div className="bg-emerald-100 p-3 rounded-full">
                                <CheckCircle size={24} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800">¿Finalizar el pedido {confirmDialog.codigo}?</h2>
                        </div>
                        <div className="text-slate-600 mb-6 text-sm space-y-2">
                            <p className="font-bold text-slate-700">Al confirmar, en un solo paso:</p>
                            <ul className="list-disc pl-5 space-y-1">
                                {confirmDialog.estado !== 'PREPARADO' && (
                                    <li>Se descuenta el stock del WMS (rebaje de inventario) y se genera la etiqueta del bulto.</li>
                                )}
                                <li>El pedido ingresa a <strong>Depósito</strong> (queda registrado y en cuenta del cliente).</li>
                                <li>Se programa el <strong>aviso automático (WhatsApp)</strong> al cliente de que su pedido está pronto.</li>
                            </ul>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setConfirmDialog(null)}
                                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleFinalize(confirmDialog)}
                                className="px-5 py-2.5 rounded-xl font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
                            >
                                <CheckCircle size={18} />
                                Sí, Finalizar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Dialog */}
            {cancelDialog && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-4 mb-4 text-red-600">
                            <div className="bg-red-100 p-3 rounded-full">
                                <XCircle size={24} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800">¿Cancelar Pedido?</h2>
                        </div>
                        <p className="text-slate-600 mb-6">
                            Estás a punto de CANCELAR el pedido <strong>{cancelDialog.codigo}</strong>.
                            Esta acción no se puede deshacer y el pedido será removido.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setCancelDialog(null)}
                                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                Volver
                            </button>
                            <button
                                onClick={() => handleCancelOrder(cancelDialog.id)}
                                className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all flex items-center gap-2"
                            >
                                <XCircle size={18} />
                                Sí, Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="bg-gradient-to-tr from-indigo-500 to-indigo-400 p-4 rounded-2xl text-white shadow-lg shadow-indigo-200">
                            <Package size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Recibir Órdenes WMS</h1>
                            <p className="text-slate-500 font-medium">Preparación, rebaje de inventario, ingreso a depósito y aviso al cliente — todo en un lugar</p>
                        </div>
                    </div>

                    <button
                        onClick={loadOrders}
                        className="self-start md:self-auto flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold shadow-sm transition-colors"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                </div>

                {/* Pestañas: En Proceso / Historial */}
                <div className="flex items-center gap-2 mb-5">
                    <button
                        onClick={() => setVista('proceso')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                            vista === 'proceso' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        <PlayCircle size={16} />
                        En Proceso
                        <span className={`px-2 py-0.5 rounded-full text-xs ${vista === 'proceso' ? 'bg-white/20' : 'bg-indigo-100 text-indigo-700'}`}>{activeCount}</span>
                    </button>
                    <button
                        onClick={() => { setVista('historial'); loadHistorial(); }}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                            vista === 'historial' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        <History size={16} />
                        Historial
                    </button>
                </div>

                {/* Buscador en vivo de la vista En Proceso (por orden o cliente) */}
                {vista === 'proceso' && (
                    <div className="relative mb-5">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            value={procesoSearch}
                            onChange={(e) => setProcesoSearch(e.target.value)}
                            placeholder="Filtrar por código (VEN-...) o cliente..."
                            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                    </div>
                )}

                {/* Buscador del historial */}
                {vista === 'historial' && (
                    <div className="flex gap-2 mb-5">
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                value={historialSearch}
                                onChange={(e) => setHistorialSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') loadHistorial(historialSearch); }}
                                placeholder="Buscar por código (VEN-...) o cliente..."
                                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={() => loadHistorial(historialSearch)}
                            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
                        >
                            <Search size={16} />
                            Buscar
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between mb-4 px-2">
                    <h2 className="text-lg font-bold text-slate-700">{vista === 'proceso' ? 'Pedidos de Venta en Proceso' : 'Pedidos Terminados y Cancelados (últimos 50)'}</h2>
                    <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-bold">
                        {vista === 'proceso' ? `${activeCount} en cola` : `${historial.length} encontrados`}
                    </span>
                </div>

                {/* Orders List */}
                <div className="space-y-4">
                    {(vista === 'historial' && loadingHistorial) ? (
                        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center">
                            <RefreshCw size={32} className="mx-auto text-indigo-400 animate-spin mb-3" />
                            <p className="text-slate-500 font-medium">Buscando en el historial...</p>
                        </div>
                    ) : listaVisible.length === 0 ? (
                        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center">
                            <CheckCircle size={48} className="mx-auto text-emerald-400 mb-4" />
                            <h3 className="text-xl font-bold text-slate-700 mb-2">{vista === 'proceso' ? (filtroProceso && orders.length > 0 ? 'Sin coincidencias' : '¡Todo al día!') : 'Sin resultados'}</h3>
                            <p className="text-slate-500">{vista === 'proceso'
                                ? (filtroProceso && orders.length > 0 ? 'Ningún pedido en proceso coincide con esa búsqueda.' : 'No hay pedidos de venta en proceso.')
                                : 'No se encontraron pedidos terminados con esa búsqueda.'}</p>
                        </div>
                    ) : (
                        listaVisible.map(order => {
                            const isExpanded = expandedOrder === order.id;
                            const isProcessing = processingId === order.id;
                            const readOnly = vista === 'historial';
                            const badge = ESTADO_BADGE[order.estado] || ESTADO_BADGE['PENDIENTE'];

                            return (
                                <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                                    {/* Card Header (Always visible) */}
                                    <div
                                        className="p-5 flex items-center justify-between cursor-pointer gap-4"
                                        onClick={() => toggleExpand(order)}
                                    >
                                        <div className="flex items-center gap-6 flex-1 min-w-0">
                                            {/* Accent Bar */}
                                            <div className={`w-1.5 h-12 rounded-full ${order.estado === 'PENDIENTE' ? 'bg-amber-400' : order.estado === 'EN_PREPARACION' ? 'bg-blue-500' : 'bg-indigo-500'}`}></div>

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-3 mb-1">
                                                    <span className="font-mono text-lg font-bold text-slate-800">{order.codigo}</span>
                                                    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${badge.cls}`}>
                                                        {badge.icon}
                                                        {badge.label}
                                                    </span>
                                                    {order.notasCount > 0 && (
                                                        <span
                                                            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700"
                                                            title={`Este pedido tiene ${order.notasCount} nota(s) — abrilo para leerlas`}
                                                        >
                                                            <StickyNote size={13} />
                                                            {order.notasCount}
                                                        </span>
                                                    )}
                                                    {order.bultosCount > 0 && (
                                                        <span
                                                            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600"
                                                            title={`El pedido tiene ${order.bultosCount} bulto(s) con etiqueta — se imprimen con el botón 🖨`}
                                                        >
                                                            <Package size={13} />
                                                            {order.bultosCount} {order.bultosCount === 1 ? 'bulto' : 'bultos'}
                                                        </span>
                                                    )}
                                                    {/* Próxima área: siempre visible — Depósito discreto (venta pura),
                                                        área de producción RESALTADA (comprar y personalizar) */}
                                                    {(order.areasDestino || []).length > 0 ? (
                                                        (order.areasDestino || []).map(a => (
                                                            <span
                                                                key={a}
                                                                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-violet-600 text-white shadow-sm shadow-violet-300"
                                                                title={`¡OJO! Este pedido también tiene trabajo en ${AREA_LABELS[a] || a} (órdenes del mismo documento ${order.codigo}) — no es venta directa a depósito`}
                                                            >
                                                                → {AREA_LABELS[a] || a}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span
                                                            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-slate-50 text-slate-400 border border-slate-200"
                                                            title="Venta directa: el pedido va solo a Depósito"
                                                        >
                                                            → Depósito
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-slate-500 font-medium truncate">
                                                    {order.cliente} • {new Date(order.fecha).toLocaleDateString('es-UY', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Stepper (los cancelados no lo muestran) */}
                                        {order.estado !== 'CANCELADO' && (
                                            <div className="hidden md:block shrink-0">
                                                <Stepper estado={order.estado} />
                                            </div>
                                        )}

                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="text-right hidden sm:block">
                                                <p className="text-xs text-slate-400 font-bold uppercase mb-0.5">Total</p>
                                                <p className="font-bold text-slate-800">{order.moneda} ${order.total}</p>
                                            </div>
                                            {!readOnly && (
                                                <button
                                                    onClick={(e) => handleAddBulto(order, e)}
                                                    className="bg-slate-50 hover:bg-amber-50 p-2.5 rounded-full text-slate-400 hover:text-amber-600 transition-colors"
                                                    title="Agregar un bulto más al pedido (va en más de un paquete) — las etiquetas quedan 1/2, 2/2... y se abren para imprimir"
                                                >
                                                    <PackagePlus size={18} />
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => handlePrintEtiquetas(order, e)}
                                                className="bg-slate-50 hover:bg-indigo-50 p-2.5 rounded-full text-slate-400 hover:text-indigo-600 transition-colors"
                                                title="Imprimir etiqueta del pedido (si todavía no existe, se genera en el momento)"
                                            >
                                                <Printer size={18} />
                                            </button>
                                            <div className="bg-slate-50 p-2 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Detail View */}
                                    <div className={`overflow-hidden transition-all duration-300 border-t border-slate-100 ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                        <div className="p-6 bg-slate-50/50">

                                            {/* Stepper visible en mobile */}
                                            {order.estado !== 'CANCELADO' && (
                                                <div className="md:hidden mb-4 flex justify-center">
                                                    <Stepper estado={order.estado} />
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Revisión de Artículos</h4>

                                                {!readOnly && (
                                                    <button
                                                        onClick={() => setCancelDialog(order)}
                                                        className="flex items-center gap-1.5 text-red-500 hover:text-red-700 text-sm font-bold transition-colors"
                                                    >
                                                        <XCircle size={16} />
                                                        Cancelar Pedido
                                                    </button>
                                                )}
                                            </div>

                                            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
                                                {order.items.map((item, idx) => {
                                                    const isEditing = editingItem?.pedidoId === order.id && editingItem?.wms_variante_id === item.wms_variante_id;
                                                    return (
                                                        <div key={idx} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                            <div className="flex items-center gap-4 flex-1">
                                                                {isEditing ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            value={editingItem.nuevaCantidad}
                                                                            onChange={(e) => setEditingItem({...editingItem, nuevaCantidad: Number(e.target.value)})}
                                                                            className="w-20 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                                        />
                                                                        <button
                                                                            onClick={handleSaveQuantity}
                                                                            className="p-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg transition-colors"
                                                                            title="Guardar Cantidad"
                                                                        >
                                                                            <Save size={18} />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setEditingItem(null)}
                                                                            className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                                                            title="Cancelar Edición"
                                                                        >
                                                                            <XCircle size={18} />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="bg-slate-100 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-slate-600">
                                                                            x{item.cantidad}
                                                                        </div>
                                                                        {!readOnly && (
                                                                            <button
                                                                                onClick={() => setEditingItem({ pedidoId: order.id, wms_variante_id: item.wms_variante_id, nuevaCantidad: item.cantidad })}
                                                                                className="text-slate-400 hover:text-indigo-500 transition-colors"
                                                                                title="Editar Cantidad"
                                                                            >
                                                                                <Edit2 size={16} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                <div>
                                                                    <p className="font-bold text-slate-800">{item.nombre_variante}</p>
                                                                    <p className="text-xs text-slate-500 font-mono">
                                                                        SKU: {item.sku || 'N/A'}
                                                                        {(item.ubicacion?.pasillo || item.ubicacion?.estante) && (
                                                                            <span className="ml-2 text-indigo-500 font-bold">
                                                                                UBICACIÓN: {[item.ubicacion?.pasillo, item.ubicacion?.estante].filter(Boolean).join(' / ')}
                                                                            </span>
                                                                        )}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Historial de estados (fechas) + Notas del pedido */}
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                                                {/* Timeline */}
                                                <div className="bg-white rounded-xl border border-slate-200 p-4">
                                                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                        <History size={15} /> Historial del Pedido
                                                    </h4>
                                                    {!(eventosMap[order.id]) ? (
                                                        <p className="text-sm text-slate-400">Cargando historial...</p>
                                                    ) : (
                                                        <div className="space-y-0">
                                                            {eventosMap[order.id].filter(e => e.Tipo !== 'NOTA').map((ev, i, arr) => (
                                                                <div key={i} className="flex gap-3">
                                                                    <div className="flex flex-col items-center">
                                                                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === arr.length - 1 ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                                                                        {i < arr.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
                                                                    </div>
                                                                    <div className="pb-4">
                                                                        <p className="text-sm font-bold text-slate-700 leading-tight">
                                                                            {EVENTO_LABELS[(ev.Estado || '').trim()] || ev.Estado}
                                                                        </p>
                                                                        <p className="text-xs text-slate-400 font-medium">
                                                                            {new Date(ev.Fecha).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                                            {ev.Usuario ? ` • ${ev.Usuario}` : ''}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Notas */}
                                                <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col">
                                                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                        <StickyNote size={15} /> Notas del Pedido
                                                    </h4>
                                                    <div className="flex-1 space-y-2 mb-3 max-h-48 overflow-y-auto">
                                                        {(eventosMap[order.id] || []).filter(e => e.Tipo === 'NOTA').length === 0 ? (
                                                            <p className="text-sm text-slate-400">Sin notas todavía.</p>
                                                        ) : (
                                                            (eventosMap[order.id] || []).filter(e => e.Tipo === 'NOTA').map((n, i) => (
                                                                <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                                                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{n.Nota}</p>
                                                                    <p className="text-[11px] text-slate-400 font-medium mt-1">
                                                                        {new Date(n.Fecha).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                                        {n.Usuario ? ` • ${n.Usuario}` : ''}
                                                                    </p>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={notaDrafts[order.id] || ''}
                                                            onChange={(e) => setNotaDrafts(prev => ({ ...prev, [order.id]: e.target.value }))}
                                                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddNota(order.id); }}
                                                            placeholder="Escribir una nota (ej: faltó un talle, cliente pasa mañana)..."
                                                            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                        />
                                                        <button
                                                            onClick={() => handleAddNota(order.id)}
                                                            disabled={savingNota || !(notaDrafts[order.id] || '').trim()}
                                                            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors"
                                                            title="Agregar nota"
                                                        >
                                                            <Send size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Bar — el botón depende del paso del stepper */}
                                            <div className="flex justify-end gap-3 pt-2 border-t border-slate-200">
                                                {order.estado === 'PENDIENTE' && (
                                                    <button
                                                        onClick={() => handleStartPreparation(order)}
                                                        disabled={isProcessing}
                                                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2"
                                                    >
                                                        <PlayCircle size={20} />
                                                        Iniciar Preparación
                                                    </button>
                                                )}
                                                {order.estado === 'EN_PREPARACION' && (
                                                    <button
                                                        onClick={() => setConfirmDialog(order)}
                                                        disabled={isProcessing}
                                                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2"
                                                        title="Descuenta el stock del WMS, ingresa el pedido a Depósito y programa el aviso al cliente"
                                                    >
                                                        <CheckCircle size={20} />
                                                        Finalizar: Rebajar Inventario, Ingresar a Depósito y Avisar
                                                    </button>
                                                )}
                                                {order.estado === 'PREPARADO' && (
                                                    <button
                                                        onClick={() => setConfirmDialog(order)}
                                                        disabled={isProcessing}
                                                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
                                                        title="El stock ya fue descontado — solo ingresa a Depósito y programa el aviso"
                                                    >
                                                        <CheckCircle size={20} />
                                                        Confirmar Ingreso a Depósito y Avisar
                                                    </button>
                                                )}
                                            </div>

                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

            </div>
        </div>
    );
};

export default WmsReceiveSalesView;
