import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Package, CheckCircle, ChevronDown, ChevronUp, RefreshCw, XCircle, Save, Edit2, PlayCircle, Clock, History, StickyNote, Send, Printer, Search, Truck, PackagePlus, Loader2, SearchX, ArrowRight, MapPin } from 'lucide-react';
import { wmsService } from '../../services/modules/wmsService';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, pestañas y buscador en una tarjeta, cada
// pedido en una tarjeta blanca con borde (código y chips arriba con el estado a la derecha, cliente y fecha, pie con
// el total y botones chicos), íconos Lucide en brand-cyan sin fondo y el color solo para el estado del pedido. La
// lista se dibuja de a 50. Los diálogos de Finalizar / Cancelar pasan a z-[6000] (tapan la navbar). Lógica sin cambios.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_DESTRUCTIVO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors whitespace-nowrap';
const BTN_ICONO = 'w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:text-brand-cyan hover:border-brand-cyan/40 hover:bg-brand-cyan/5 transition-colors';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_SIMPLE = 'px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const SEGMENTADO = 'inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white';
const segmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;
const ROTULO = 'text-[11px] font-black text-zinc-400 uppercase tracking-wide';
const BADGE = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const ICONO_CAMPO = 'absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none';

// Barra lateral de la tarjeta según el estado (solo presentación; antes ámbar / azul / índigo para el resto).
const BARRA_ESTADO = {
    'PENDIENTE': 'bg-amber-400',
    'EN_PREPARACION': 'bg-brand-cyan',
    'PREPARADO': 'bg-brand-cyan',
    'RECIBIDO_DEPOSITO': 'bg-emerald-500',
    'ENTREGADO': 'bg-zinc-300',
    'CANCELADO': 'bg-rose-400',
    'ENVIADO_PRODUCCION': 'bg-emerald-500',
};

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

    // Tarjetas de a 50 (solo presentación): al acercarse al final se agregan 50 más. Vuelve a 50 al cambiar de
    // pestaña, de filtro o con una búsqueda nueva del historial; el refresco automático de 30 s no la reinicia
    // (si no, cada medio minuto se cortaría la lista que uno está mirando).
    const [verPedidos, setVerPedidos] = useState(50);
    useEffect(() => { setVerPedidos(50); }, [vista, procesoSearch, historial]);
    const obsPedidos = useRef(null);
    const centinelaPedidos = useCallback((nodo) => {
        if (obsPedidos.current) obsPedidos.current.disconnect();
        if (!nodo) return;
        obsPedidos.current = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVerPedidos(v => v + 50); },
            { rootMargin: '0px 0px 600px 0px' });
        obsPedidos.current.observe(nodo);
    }, []);

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

                // [COMBOS] Si esto liberó la hermana real de un combo, la VEN- ya cumplió su
                // función (retiro confirmado + remito enviado) — el backend ya la movió a un
                // estado terminal propio (ENVIADO_PRODUCCION) porque nunca va a poder
                // completar "Depósito + Aviso" (el ProximoServicio de la ancla es fijo, no se
                // desbloquea solo). No seguir con receivePreparedOrder: siempre fallaría con
                // el guard y el mensaje sería confuso.
                // [REPOSICIÓN] VEN interna por falla: ya salió con remito al área que reportó.
                if (res1.reposicion) {
                    const r = res1.reposicion;
                    const destinoRep = r.areas?.[0];
                    const nombre = AREA_LABELS[destinoRep] || destinoRep || 'el área';
                    if (r.errores?.length) toast.warning(`Enviado a ${nombre}, pero el remito no se pudo armar solo. Armalo desde Despacho de PRO.`);
                    else toast.success(`Reposición enviada a ${nombre}${r.remitos?.length ? ` con el remito ${r.remitos.join(', ')}` : ''}. Falta recibirlo en ${nombre}.`);
                    loadOrders();
                    if (expandedOrder === order.id) loadEventos(order.id);
                    return;
                }
                if (res1.hermanasLiberadas > 0) {
                    const destinoCombo = destinoPendiente(order);
                    toast.success(destinoCombo
                        ? `Retiro confirmado — enviado a ${AREA_LABELS[destinoCombo] || destinoCombo}.`
                        : 'Retiro confirmado — enviado a producción.');
                    loadOrders();
                    if (expandedOrder === order.id) loadEventos(order.id);
                    return;
                }
            }

            const destino = destinoPendiente(order);
            const receiveToast = toast.loading(destino
                ? `Verificando si ya puede ingresar a Depósito (pasa primero por ${AREA_LABELS[destino] || destino})...`
                : 'Ingresando a Depósito y programando aviso...');
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
    // El retiro de un combo (ENVIADO_PRODUCCION) nunca pasa por "Depósito + Aviso" —
    // el 3er paso cambia de nombre para ese caso puntual, no queda mostrando algo que
    // en realidad no pasó.
    const stepLabelsFor = (estado, order) => estado === 'ENVIADO_PRODUCCION' || order?.esReposicion
        ? ['Preparación', 'Stock descontado', 'Enviado a Producción']
        : ['Preparación', 'Stock descontado', 'Depósito + Aviso'];
    // Paso "actual" según el estado del pedido (los anteriores se muestran hechos)
    const stepIndexOf = (estado) => {
        if (estado === 'PENDIENTE') return 0;
        if (estado === 'EN_PREPARACION') return 1;
        if (estado === 'RECIBIDO_DEPOSITO' || estado === 'ENTREGADO' || estado === 'ENVIADO_PRODUCCION') return 3; // todo hecho
        return 2; // PREPARADO: falta solo el ingreso a depósito + aviso
    };

    const Stepper = ({ estado, order }) => {
        const current = stepIndexOf(estado);
        const STEP_LABELS = stepLabelsFor(estado, order);
        return (
            <div className="flex items-center gap-0">
                {STEP_LABELS.map((label, i) => {
                    const done = i < current;
                    const active = i === current;
                    return (
                        <React.Fragment key={label}>
                            {i > 0 && (
                                <div className={`h-0.5 w-6 sm:w-10 rounded-full ${i <= current ? 'bg-brand-cyan' : 'bg-zinc-200'}`} />
                            )}
                            <div className="flex flex-col items-center gap-1">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-colors tabular-nums ${
                                    done ? 'bg-brand-cyan border-brand-cyan text-white'
                                    : active ? 'bg-white border-brand-cyan text-brand-cyan'
                                    : 'bg-white border-zinc-200 text-zinc-400'
                                }`}>
                                    {done ? <CheckCircle size={15} /> : i + 1}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-wide hidden sm:block whitespace-nowrap ${
                                    done || active ? 'text-brand-cyan' : 'text-zinc-400'
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
        'ENVIADO_PRODUCCION': 'Retiro de combo confirmado — enviado a producción',
    };

    // Nombres legibles de las áreas de producción (para el badge "→ Bordado" de los
    // pedidos comprar+personalizar, cuyas órdenes hermanas comparten el VEN)
    const AREA_LABELS = {
        'EMB': 'Bordado', 'DF': 'DTF', 'TPU': 'TPU', 'EST': 'Estampado',
        'TWC': 'Corte', 'TWT': 'Costura', 'SB': 'Sublimación',
        'ECOUV': 'Eco UV', 'DIRECTA': 'Directa', 'PRO': 'Producción',
    };

    // Área real que falta antes de Depósito (hermana de comprar+personalizar, o
    // ancla de combo con ProximoServicio propio) — null si el pedido va derecho a
    // Depósito. Se usa para que los botones/diálogo/toast digan el área real en vez
    // de prometer "Depósito y Aviso" cuando eso todavía no puede pasar.
    const destinoPendiente = (order) => {
        if ((order.areasDestino || []).length > 0) return order.areasDestino[0];
        if (order.proximoServicioAncla && order.proximoServicioAncla.toUpperCase() !== 'DEPOSITO') {
            return order.proximoServicioAncla;
        }
        return null;
    };

    const ESTADO_BADGE = {
        'PENDIENTE': { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock size={13} />, label: 'Pendiente' },
        'EN_PREPARACION': { cls: 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20', icon: <PlayCircle size={13} />, label: 'En Preparación' },
        'PREPARADO': { cls: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', icon: <CheckCircle size={13} />, label: 'Preparado WMS' },
        'RECIBIDO_DEPOSITO': { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Truck size={13} />, label: 'En Depósito' },
        'ENTREGADO': { cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', icon: <CheckCircle size={13} />, label: 'Entregado' },
        'CANCELADO': { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: <XCircle size={13} />, label: 'Cancelado' },
        'ENVIADO_PRODUCCION': { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Send size={13} />, label: 'Enviado a Producción' },
    };

    const activeCount = orders.length;

    // Lista visible según pestaña + filtro en vivo de En Proceso
    const filtroProceso = procesoSearch.trim().toLowerCase();
    const listaVisible = vista === 'proceso'
        ? orders.filter(o => !filtroProceso
            || (o.codigo || '').toLowerCase().includes(filtroProceso)
            || (o.cliente || '').toLowerCase().includes(filtroProceso))
        : historial;

    const destinoDialog = confirmDialog ? destinoPendiente(confirmDialog) : null;

    return (
        <div className="p-3 md:p-6 bg-slate-50 min-h-full relative font-sans text-zinc-800">

            {/* Confirmation Dialog (Finalizar) */}
            {confirmDialog && (
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl max-w-md w-full overflow-hidden">
                        <div className="p-5">
                            <div className="flex items-start gap-3 mb-4">
                                <CheckCircle size={22} className="shrink-0 mt-0.5 text-brand-cyan" aria-hidden="true" />
                                <h2 className="text-lg font-black text-zinc-800 leading-snug break-words min-w-0">¿Finalizar el pedido {confirmDialog.codigo}?</h2>
                            </div>
                            <div className="text-zinc-600 text-sm space-y-2">
                                <p className="font-bold text-zinc-700">Al confirmar, en un solo paso:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    {confirmDialog.estado !== 'PREPARADO' && (
                                        <li>Se descuenta el stock del WMS (rebaje de inventario) y se genera la etiqueta del bulto.</li>
                                    )}
                                    {destinoDialog ? (
                                        <li>El pedido se envía a <strong className="text-zinc-800">{AREA_LABELS[destinoDialog] || destinoDialog}</strong> — todavía NO ingresa a Depósito ni se avisa al cliente.</li>
                                    ) : (
                                        <>
                                            <li>El pedido ingresa a <strong className="text-zinc-800">Depósito</strong> (queda registrado y en cuenta del cliente).</li>
                                            <li>Se programa el <strong className="text-zinc-800">aviso automático (WhatsApp)</strong> al cliente de que su pedido está pronto.</li>
                                        </>
                                    )}
                                </ul>
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 px-5 py-3 bg-zinc-50 border-t border-zinc-100">
                            <button
                                type="button"
                                onClick={() => setConfirmDialog(null)}
                                className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => handleFinalize(confirmDialog)}
                                className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}
                            >
                                <CheckCircle size={15} />
                                Sí, Finalizar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Dialog */}
            {cancelDialog && (
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl max-w-md w-full overflow-hidden">
                        <div className="p-5">
                            <div className="flex items-start gap-3 mb-3">
                                <XCircle size={22} className="shrink-0 mt-0.5 text-rose-500" aria-hidden="true" />
                                <h2 className="text-lg font-black text-zinc-800 leading-snug">¿Cancelar Pedido?</h2>
                            </div>
                            <p className="text-sm text-zinc-600">
                                Estás a punto de CANCELAR el pedido <strong className="text-zinc-800">{cancelDialog.codigo}</strong>.
                                Esta acción no se puede deshacer y el pedido será removido.
                            </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 px-5 py-3 bg-zinc-50 border-t border-zinc-100">
                            <button
                                type="button"
                                onClick={() => setCancelDialog(null)}
                                className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}
                            >
                                Volver
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCancelOrder(cancelDialog.id)}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors flex-1 sm:flex-none"
                            >
                                <XCircle size={15} />
                                Sí, Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <Package size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                        <div className="min-w-0">
                            <h1 className="text-xl md:text-2xl font-black text-zinc-800 uppercase tracking-tight">Recibir Órdenes WMS</h1>
                            <p className="text-sm text-zinc-400">Preparación, rebaje de inventario, ingreso a depósito y aviso al cliente — todo en un lugar</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={loadOrders}
                        className={BTN_SECUNDARIO}
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                </div>

                {/* Pestañas (En Proceso / Historial) + buscador de la pestaña elegida */}
                <div className={`${CARD} p-3 flex flex-col sm:flex-row sm:items-center gap-3`}>
                    <div className={`${SEGMENTADO} self-start sm:self-auto shrink-0`}>
                        <button
                            type="button"
                            onClick={() => setVista('proceso')}
                            className={segmento(vista === 'proceso')}
                        >
                            <PlayCircle size={14} />
                            En Proceso
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums ${vista === 'proceso' ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{activeCount}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setVista('historial'); loadHistorial(); }}
                            className={segmento(vista === 'historial')}
                        >
                            <History size={14} />
                            Historial
                        </button>
                    </div>

                    {/* Buscador en vivo de la vista En Proceso (por orden o cliente) */}
                    {vista === 'proceso' && (
                        <div className="relative flex-1 min-w-0">
                            <Search size={15} className={ICONO_CAMPO} />
                            <input
                                type="text"
                                value={procesoSearch}
                                onChange={(e) => setProcesoSearch(e.target.value)}
                                placeholder="Filtrar por código (VEN-...) o cliente..."
                                aria-label="Filtrar pedidos en proceso"
                                className={CAMPO}
                            />
                        </div>
                    )}

                    {/* Buscador del historial */}
                    {vista === 'historial' && (
                        <div className="flex gap-2 flex-1 min-w-0">
                            <div className="relative flex-1 min-w-0">
                                <Search size={15} className={ICONO_CAMPO} />
                                <input
                                    type="text"
                                    value={historialSearch}
                                    onChange={(e) => setHistorialSearch(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') loadHistorial(historialSearch); }}
                                    placeholder="Buscar por código (VEN-...) o cliente..."
                                    aria-label="Buscar en el historial"
                                    className={CAMPO}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => loadHistorial(historialSearch)}
                                className={`${BTN_PRINCIPAL} shrink-0`}
                            >
                                <Search size={15} />
                                Buscar
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <h2 className="text-lg font-black text-zinc-800">{vista === 'proceso' ? 'Pedidos de Venta en Proceso' : 'Pedidos Terminados y Cancelados (últimos 50)'}</h2>
                    <span className={`${BADGE} bg-white text-zinc-600 border-zinc-200 tabular-nums`}>
                        {vista === 'proceso' ? `${activeCount} en cola` : `${historial.length} encontrados`}
                    </span>
                </div>

                {/* Orders List */}
                <div className="space-y-3">
                    {(vista === 'historial' && loadingHistorial) ? (
                        <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                            <Loader2 size={30} className="animate-spin text-brand-cyan" />
                            <p className="text-sm text-zinc-400">Buscando en el historial...</p>
                        </div>
                    ) : listaVisible.length === 0 ? (
                        <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-2 px-4 text-center`}>
                            {vista === 'proceso' && !(filtroProceso && orders.length > 0)
                                ? <CheckCircle size={40} className="text-zinc-200" />
                                : <SearchX size={40} className="text-zinc-200" />}
                            <p className="font-bold text-zinc-500">{vista === 'proceso' ? (filtroProceso && orders.length > 0 ? 'Sin coincidencias' : '¡Todo al día!') : 'Sin resultados'}</p>
                            <p className="text-sm text-zinc-400">{vista === 'proceso'
                                ? (filtroProceso && orders.length > 0 ? 'Ningún pedido en proceso coincide con esa búsqueda.' : 'No hay pedidos de venta en proceso.')
                                : 'No se encontraron pedidos terminados con esa búsqueda.'}</p>
                        </div>
                    ) : (
                        <>
                        {listaVisible.slice(0, verPedidos).map(order => {
                            const isExpanded = expandedOrder === order.id;
                            const isProcessing = processingId === order.id;
                            const readOnly = vista === 'historial';
                            const badge = ESTADO_BADGE[order.estado] || ESTADO_BADGE['PENDIENTE'];
                            const destinoOrder = destinoPendiente(order);

                            return (
                                <div key={order.id} className={`${CARD} overflow-hidden flex items-stretch hover:border-zinc-300 transition-colors`}>
                                    {/* Barra lateral de estado */}
                                    <div className={`w-1.5 shrink-0 ${BARRA_ESTADO[order.estado] || 'bg-zinc-300'}`} />

                                    <div className="flex-1 min-w-0">
                                    {/* Card Header (Always visible) */}
                                    <div
                                        className="p-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6 cursor-pointer"
                                        onClick={() => toggleExpand(order)}
                                    >
                                        <div className="flex-1 min-w-0">
                                            {/* Código + chips a la izquierda, estado a la derecha */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                                    <span className="font-mono text-base font-black text-zinc-800 break-all mr-0.5">{order.codigo}</span>
                                                    {order.notasCount > 0 && (
                                                        <span
                                                            className={`${BADGE} inline-flex items-center gap-1 bg-amber-50 text-amber-700 border-amber-200 tabular-nums`}
                                                            title={`Este pedido tiene ${order.notasCount} nota(s) — abrilo para leerlas`}
                                                        >
                                                            <StickyNote size={12} />
                                                            {order.notasCount}
                                                        </span>
                                                    )}
                                                    {order.bultosCount > 0 && (
                                                        <span
                                                            className={`${BADGE} inline-flex items-center gap-1 bg-zinc-50 text-zinc-600 border-zinc-200 tabular-nums`}
                                                            title={`El pedido tiene ${order.bultosCount} bulto(s) con etiqueta — se imprimen con el botón de imprimir`}
                                                        >
                                                            <Package size={12} />
                                                            {order.bultosCount} {order.bultosCount === 1 ? 'bulto' : 'bultos'}
                                                        </span>
                                                    )}
                                                    {/* Próxima área: siempre visible — Depósito discreto (venta pura),
                                                        área de producción RESALTADA (comprar y personalizar, o
                                                        combo cuyo componente todavía tiene que pasar por Bordado/Estampado) */}
                                                    {(order.areasDestino || []).length > 0 ? (
                                                        (order.areasDestino || []).map(a => (
                                                            <span
                                                                key={a}
                                                                className={`${BADGE} inline-flex items-center gap-1 font-black bg-brand-cyan text-white border-brand-cyan`}
                                                                title={`¡OJO! Este pedido también tiene trabajo en ${AREA_LABELS[a] || a} (órdenes del mismo documento ${order.codigo}) — no es venta directa a depósito`}
                                                            >
                                                                <ArrowRight size={12} />
                                                                {AREA_LABELS[a] || a}
                                                            </span>
                                                        ))
                                                    ) : order.proximoServicioAncla && order.proximoServicioAncla.toUpperCase() !== 'DEPOSITO' ? (
                                                        <span
                                                            className={`${BADGE} inline-flex items-center gap-1 font-black bg-brand-cyan text-white border-brand-cyan`}
                                                            title={`Este pedido todavía tiene que pasar por ${AREA_LABELS[order.proximoServicioAncla] || order.proximoServicioAncla} antes de Depósito — no ingresa directo`}
                                                        >
                                                            <ArrowRight size={12} />
                                                            {AREA_LABELS[order.proximoServicioAncla] || order.proximoServicioAncla}
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className={`${BADGE} inline-flex items-center gap-1 bg-white text-zinc-400 border-zinc-200`}
                                                            title="Venta directa: el pedido va solo a Depósito"
                                                        >
                                                            <ArrowRight size={12} />
                                                            Depósito
                                                        </span>
                                                    )}
                                                </div>
                                                <span className={`${BADGE} shrink-0 whitespace-nowrap inline-flex items-center gap-1 ${badge.cls}`}>
                                                    {badge.icon}
                                                    {badge.label}
                                                </span>
                                            </div>
                                            <p className="mt-2 font-bold text-zinc-800 truncate" title={order.cliente}>{order.cliente}</p>
                                            <p className="text-xs text-zinc-400 tabular-nums">
                                                {new Date(order.fecha).toLocaleDateString('es-UY', { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>

                                        {/* Stepper (los cancelados no lo muestran). La columna tiene ancho fijo
                                            para que el stepper y el estado queden alineados entre tarjetas. */}
                                        <div className="hidden lg:flex justify-center shrink-0 min-w-[23rem]">
                                            {order.estado !== 'CANCELADO' && (
                                                <Stepper estado={order.estado} order={order} />
                                            )}
                                        </div>

                                        {/* Pie: total a la izquierda, botones chicos a la derecha (en pantalla ancha, al costado) */}
                                        <div className="flex items-center justify-between lg:justify-end gap-3 lg:gap-4 shrink-0 pt-3 lg:pt-0 border-t border-zinc-100 lg:border-0">
                                            <div className="lg:text-right lg:min-w-[7.5rem]">
                                                <p className={ROTULO}>Total</p>
                                                <p className="font-black text-zinc-800 tabular-nums whitespace-nowrap">{order.moneda} ${order.total}</p>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                {!readOnly && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleAddBulto(order, e)}
                                                        className={BTN_ICONO}
                                                        title="Agregar un bulto más al pedido (va en más de un paquete) — las etiquetas quedan 1/2, 2/2... y se abren para imprimir"
                                                        aria-label="Agregar un bulto más al pedido"
                                                    >
                                                        <PackagePlus size={16} />
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(e) => handlePrintEtiquetas(order, e)}
                                                    className={BTN_ICONO}
                                                    title="Imprimir etiqueta del pedido (si todavía no existe, se genera en el momento)"
                                                    aria-label="Imprimir etiqueta del pedido"
                                                >
                                                    <Printer size={16} />
                                                </button>
                                                <div className="w-8 h-9 inline-flex items-center justify-center text-zinc-400" aria-hidden="true">
                                                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Detail View — abierta SIN tope de alto: con max-h-[2000px] un
                                        pedido de ~23+ líneas (VEN-2451) recortaba el pie y el botón
                                        "Iniciar Preparación" quedaba invisible. */}
                                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-none opacity-100 border-t border-zinc-100' : 'max-h-0 opacity-0'}`}>
                                        <div className="p-4 md:p-5 bg-zinc-50/60 space-y-4">

                                            {/* Stepper visible en mobile */}
                                            {order.estado !== 'CANCELADO' && (
                                                <div className="lg:hidden flex justify-center">
                                                    <Stepper estado={order.estado} order={order} />
                                                </div>
                                            )}

                                            <div>
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                    <h4 className={ROTULO}>Revisión de Artículos</h4>

                                                    {!readOnly && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCancelDialog(order)}
                                                            className={BTN_DESTRUCTIVO}
                                                        >
                                                            <XCircle size={15} />
                                                            Cancelar Pedido
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100">
                                                    {order.items.map((item, idx) => {
                                                        const isEditing = editingItem?.pedidoId === order.id && editingItem?.wms_variante_id === item.wms_variante_id;
                                                        return (
                                                            <div key={idx} className="px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                    {isEditing ? (
                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                value={editingItem.nuevaCantidad}
                                                                                onChange={(e) => setEditingItem({...editingItem, nuevaCantidad: Number(e.target.value)})}
                                                                                aria-label="Nueva cantidad"
                                                                                className={`${CAMPO_SIMPLE} w-20 font-bold tabular-nums`}
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={handleSaveQuantity}
                                                                                className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl bg-brand-cyan text-white hover:bg-brand-cyan/90 transition-colors"
                                                                                title="Guardar Cantidad"
                                                                                aria-label="Guardar Cantidad"
                                                                            >
                                                                                <Save size={15} />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setEditingItem(null)}
                                                                                className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
                                                                                title="Cancelar Edición"
                                                                                aria-label="Cancelar Edición"
                                                                            >
                                                                                <XCircle size={15} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                            <div className="min-w-[2.5rem] h-10 px-2 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-center font-black text-zinc-700 tabular-nums">
                                                                                x{item.cantidad}
                                                                            </div>
                                                                            {!readOnly && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setEditingItem({ pedidoId: order.id, wms_variante_id: item.wms_variante_id, nuevaCantidad: item.cantidad })}
                                                                                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/5 transition-colors"
                                                                                    title="Editar Cantidad"
                                                                                    aria-label="Editar Cantidad"
                                                                                >
                                                                                    <Edit2 size={15} />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <p className="font-bold text-zinc-800 break-words">{item.nombre_variante}</p>
                                                                        <p className="text-xs text-zinc-500 font-mono break-words">
                                                                            SKU: {item.sku || 'N/A'}
                                                                            {(item.ubicacion?.pasillo || item.ubicacion?.estante) && (
                                                                                <span className="ml-2 inline-flex items-center gap-1 text-brand-cyan font-bold">
                                                                                    <MapPin size={11} className="shrink-0" />
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
                                            </div>

                                            {/* Historial de estados (fechas) + Notas del pedido */}
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                {/* Timeline */}
                                                <div className="bg-white rounded-xl border border-zinc-200 p-4">
                                                    <h4 className={`${ROTULO} mb-3 flex items-center gap-1.5`}>
                                                        <History size={14} className="text-brand-cyan" /> Historial del Pedido
                                                    </h4>
                                                    {!(eventosMap[order.id]) ? (
                                                        <p className="text-sm text-zinc-400 flex items-center gap-2">
                                                            <Loader2 size={14} className="animate-spin text-brand-cyan" />
                                                            Cargando historial...
                                                        </p>
                                                    ) : (
                                                        <div className="space-y-0">
                                                            {eventosMap[order.id].filter(e => e.Tipo !== 'NOTA').map((ev, i, arr) => (
                                                                <div key={i} className="flex gap-3">
                                                                    <div className="flex flex-col items-center">
                                                                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === arr.length - 1 ? 'bg-brand-cyan' : 'bg-zinc-300'}`} />
                                                                        {i < arr.length - 1 && <div className="w-px flex-1 bg-zinc-200" />}
                                                                    </div>
                                                                    <div className="pb-4 min-w-0">
                                                                        <p className="text-sm font-bold text-zinc-700 leading-tight">
                                                                            {EVENTO_LABELS[(ev.Estado || '').trim()] || ev.Estado}
                                                                        </p>
                                                                        <p className="text-xs text-zinc-400 tabular-nums">
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
                                                <div className="bg-white rounded-xl border border-zinc-200 p-4 flex flex-col">
                                                    <h4 className={`${ROTULO} mb-3 flex items-center gap-1.5`}>
                                                        <StickyNote size={14} className="text-brand-cyan" /> Notas del Pedido
                                                    </h4>
                                                    <div className="flex-1 space-y-2 mb-3 max-h-48 overflow-y-auto">
                                                        {(eventosMap[order.id] || []).filter(e => e.Tipo === 'NOTA').length === 0 ? (
                                                            <p className="text-sm text-zinc-400">Sin notas todavía.</p>
                                                        ) : (
                                                            (eventosMap[order.id] || []).filter(e => e.Tipo === 'NOTA').map((n, i) => (
                                                                <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                                                                    <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">{n.Nota}</p>
                                                                    <p className="text-[11px] text-zinc-400 mt-1 tabular-nums">
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
                                                            aria-label="Nueva nota del pedido"
                                                            className={`${CAMPO_SIMPLE} flex-1 min-w-0`}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAddNota(order.id)}
                                                            disabled={savingNota || !(notaDrafts[order.id] || '').trim()}
                                                            className="w-10 shrink-0 inline-flex items-center justify-center rounded-xl bg-brand-cyan text-white hover:bg-brand-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                            title="Agregar nota"
                                                            aria-label="Agregar nota"
                                                        >
                                                            <Send size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Bar — el botón depende del paso del stepper (sin barra vacía
                                                en los estados que no tienen acción, ej. el historial) */}
                                            {(order.estado === 'PENDIENTE' || order.estado === 'EN_PREPARACION' || order.estado === 'PREPARADO') && (
                                            <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-zinc-200">
                                                {order.estado === 'PENDIENTE' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStartPreparation(order)}
                                                        disabled={isProcessing}
                                                        className={`${BTN_PRINCIPAL} w-full sm:w-auto text-center`}
                                                    >
                                                        <PlayCircle size={15} className="shrink-0" />
                                                        Iniciar Preparación
                                                    </button>
                                                )}
                                                {order.estado === 'EN_PREPARACION' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDialog(order)}
                                                        disabled={isProcessing}
                                                        className={`${BTN_PRINCIPAL} w-full sm:w-auto text-center`}
                                                        title={destinoOrder
                                                            ? `Descuenta el stock del WMS y envía el pedido a ${AREA_LABELS[destinoOrder] || destinoOrder} — todavía no ingresa a Depósito ni se avisa al cliente`
                                                            : "Descuenta el stock del WMS, ingresa el pedido a Depósito y programa el aviso al cliente"}
                                                    >
                                                        <CheckCircle size={15} className="shrink-0" />
                                                        {destinoOrder
                                                            ? `Finalizar: Rebajar Inventario y Enviar a ${AREA_LABELS[destinoOrder] || destinoOrder}`
                                                            : 'Finalizar: Rebajar Inventario, Ingresar a Depósito y Avisar'}
                                                    </button>
                                                )}
                                                {order.estado === 'PREPARADO' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDialog(order)}
                                                        disabled={isProcessing}
                                                        className={`${BTN_PRINCIPAL} w-full sm:w-auto text-center`}
                                                        title={destinoOrder
                                                            ? `Este pedido todavía tiene que pasar por ${AREA_LABELS[destinoOrder] || destinoOrder} — no ingresa a Depósito hasta que ese paso termine`
                                                            : "El stock ya fue descontado — solo ingresa a Depósito y programa el aviso"}
                                                    >
                                                        <CheckCircle size={15} className="shrink-0" />
                                                        {destinoOrder && order.esReposicion
                                                            ? `Enviar a ${AREA_LABELS[destinoOrder] || destinoOrder}`
                                                            : destinoOrder
                                                            ? `Pendiente: falta pasar por ${AREA_LABELS[destinoOrder] || destinoOrder}`
                                                            : 'Confirmar Ingreso a Depósito y Avisar'}
                                                    </button>
                                                )}
                                            </div>
                                            )}

                                        </div>
                                    </div>
                                    </div>
                                </div>
                            );
                        })}
                        {listaVisible.length > verPedidos && (
                            <div ref={centinelaPedidos} className="py-3 text-center text-xs text-zinc-400">
                                Mostrando {verPedidos} de {listaVisible.length}…
                            </div>
                        )}
                        </>
                    )}
                </div>

            </div>
        </div>
    );
};

export default WmsReceiveSalesView;
