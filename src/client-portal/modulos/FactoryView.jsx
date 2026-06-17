import React, { useEffect, useState } from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { apiClient } from '../api/apiClient';
import { Loader2, RefreshCw, Layers, Trash2, Check, Settings, Circle, Ban, AlertTriangle, Search, Factory, Truck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ConfirmationModal } from '../pautas/ConfirmationModal';
import { socket } from '../../services/socketService';

const STATUS_CONFIG = {
    zombie: {
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        glow: 'shadow-[0_0_12px_rgba(239,68,68,0.2)]',
        icon: <AlertTriangle size={15} />,
        label: 'ERROR',
        dot: 'bg-red-500',
    },
    pendiente: {
        color: 'text-zinc-400',
        bg: 'bg-zinc-500/10',
        border: 'border-zinc-600/30',
        glow: '',
        icon: <Circle size={15} />,
        label: 'PENDIENTE',
        dot: 'bg-zinc-500',
    },
    cancelado: {
        color: 'text-red-400/60',
        bg: 'bg-red-500/5',
        border: 'border-red-500/20',
        glow: '',
        icon: <Ban size={15} />,
        label: 'CANCELADO',
        dot: 'bg-red-500/50',
    },
    finalizado: {
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        glow: 'shadow-[0_0_12px_rgba(52,211,153,0.15)]',
        icon: <Check size={15} strokeWidth={3} />,
        label: 'PRONTO',
        dot: 'bg-emerald-400',
    },
    avisado: {
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        glow: 'shadow-[0_0_12px_rgba(52,211,153,0.15)]',
        icon: <Check size={15} strokeWidth={3} />,
        label: 'RETIRAR',
        dot: 'bg-emerald-400',
    },
    entregado: {
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        glow: 'shadow-[0_0_12px_rgba(52,211,153,0.15)]',
        icon: <Check size={15} strokeWidth={3} />,
        label: 'ENTREGADO',
        dot: 'bg-emerald-400',
    },
    activo: {
        color: 'text-brand-cyan',
        bg: 'bg-brand-cyan/10',
        border: 'border-brand-cyan/30',
        glow: 'shadow-[0_0_12px_rgba(0,174,239,0.15)]',
        icon: <Settings size={15} className="animate-[spin_3s_linear_infinite]" />,
        label: 'EN PROCESO',
        dot: 'bg-custom-cyan',
    },
};

const getStatusKey = (status) => {
    const s = (status || '').toUpperCase();
    if (s.includes('CARGANDO')) return 'zombie';
    if (s.includes('PENDIENTE')) return 'pendiente';
    if (s.includes('CANCELADO')) return 'cancelado';
    if (s.includes('ENTREGADO')) return 'entregado';
    if (s.includes('AVISADO') || s.includes('PARA AVISAR')) return 'avisado';
    if (s.includes('FINALIZADO') || s.includes('PRONTO') || s.includes('INGRESADO')) return 'finalizado';
    return 'activo';
};

const getProjectStatus = (subOrders) => {
    const statuses = subOrders.map(so => getStatusKey(so.Estado));
    if (statuses.every(s => s === 'cancelado')) return 'cancelado';
    if (statuses.every(s => s === 'entregado')) return 'entregado';
    if (statuses.every(s => s === 'avisado')) return 'avisado';
    if (statuses.every(s => ['finalizado', 'entregado', 'avisado'].includes(s))) return 'finalizado';
    if (statuses.every(s => s === 'pendiente' || s === 'zombie')) return 'pendiente';
    if (statuses.some(s => s === 'zombie')) return 'zombie';
    if (statuses.some(s => s === 'activo')) return 'activo';
    return 'pendiente';
};

const FILTER_TABS = [
    { key: 'ALL', label: 'Todos' },
    { key: 'ACTIVE', label: 'En Proceso' },
    { key: 'PENDING', label: 'Pendientes' },
    { key: 'DONE', label: 'Finalizados' },
    { key: 'CANCELLED', label: 'Cancelados' },
];

export const FactoryView = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [expandedProject, setExpandedProject] = useState(null);

    // Infinite scroll states
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [globalCounts, setGlobalCounts] = useState({ ALL: 0, ACTIVE: 0, PENDING: 0, DONE: 0, CANCELLED: 0 });
    const observer = React.useRef();

    const [modal, setModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning',
        onConfirm: () => { },
        confirmText: 'Confirmar'
    });

    const fetchOrders = async (pageNum = 1, shouldAppend = false) => {
        if (pageNum === 1) setLoading(true);
        else setLoadingMore(true);

        try {
            const res = await apiClient.get(`/web-orders/my-orders?page=${pageNum}&limit=20`);
            if (res.success) {
                if (shouldAppend) {
                    setOrders(prev => [...prev, ...res.data]);
                } else {
                    setOrders(res.data || []);
                }
                
                setHasMore((res.data || []).length === 20);

                if (res.counts) {
                    setGlobalCounts(res.counts);
                }
            }
        } catch (error) {
            console.error("Error fetching orders:", error);
        } finally {
            if (pageNum === 1) setLoading(false);
            setLoadingMore(false);
        }
    };

    const handleDeleteBundle = (docId, e) => {
        e?.stopPropagation();
        setModal({
            isOpen: true,
            title: "Eliminar Proyecto Incompleto",
            message: "Esta acción eliminará permanentemente todos los registros fallidos de este proyecto. \nEsta acción no se puede deshacer.",
            type: 'danger',
            confirmText: 'Eliminar Todo',
            onConfirm: async () => {
                setLoading(true);
                try {
                    await apiClient.delete(`/web-orders/bundle/${docId}`);
                    setPage(1);
                    if (page === 1) await fetchOrders(1, false);
                } catch (err) {
                    alert("Error: " + err.message);
                    setLoading(false);
                }
            }
        });
    };

    const handleCancelProject = (subOrders, e) => {
        e?.stopPropagation();
        setModal({
            isOpen: true,
            title: "Cancelar Pedido Completo",
            message: "Todas las órdenes pendientes de este proyecto pasarán a estado 'Cancelado'. \n¿Estás seguro de cancelar todo el pedido?",
            type: 'warning',
            confirmText: 'Sí, Cancelar Pedido',
            onConfirm: async () => {
                setLoading(true);
                try {
                    for (const so of subOrders) {
                        if (['Pendiente', 'Cargando...'].includes(so.Estado)) {
                            await apiClient.delete(`/web-orders/incomplete/${so.OrdenID}`);
                        }
                    }
                    setPage(1);
                    if (page === 1) await fetchOrders(1, false);
                } catch (err) {
                    alert("Error al cancelar proyecto: " + err.message);
                    setLoading(false);
                }
            }
        });
    };

    useEffect(() => {
        fetchOrders(page, page > 1);
    }, [page]);

    // ── Socket: actualización en tiempo real cuando cambia estado de una orden ──
    useEffect(() => {
        let debounceTimer = null;

        const handleOrderUpdate = () => {
            // Debounce: si llegan múltiples eventos seguidos, solo hacemos un fetch
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                setPage(1);
                if (page === 1) fetchOrders(1, false);
            }, 600);
        };

        socket.on('server:ordersUpdated', handleOrderUpdate);
        socket.on('server:order_updated', handleOrderUpdate);

        return () => {
            clearTimeout(debounceTimer);
            socket.off('server:ordersUpdated', handleOrderUpdate);
            socket.off('server:order_updated', handleOrderUpdate);
        };
    }, []);

    // Agrupación por Proyecto
    const projects = {};
    orders.forEach(order => {
        const docId = order.NoDocERP || order.CodigoOrden;
        if (!projects[docId]) {
            projects[docId] = {
                id: docId,
                title: order.DescripcionTrabajo,
                date: order.FechaIngreso,
                materials: new Set(),
                subOrders: []
            };
        }
        projects[docId].subOrders.push(order);
        if (order.Material) projects[docId].materials.add(order.Material);
    });

    // Filtrado
    const filteredProjects = Object.values(projects).filter(p => {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm ||
            p.id.toString().toLowerCase().includes(searchLower) ||
            (p.title || '').toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;

        const projectStatus = getProjectStatus(p.subOrders);
        if (statusFilter === 'ALL') return true;
        if (statusFilter === 'CANCELLED') return projectStatus === 'cancelado';
        if (statusFilter === 'DONE') return projectStatus === 'finalizado';
        if (statusFilter === 'PENDING') return projectStatus === 'pendiente' || projectStatus === 'zombie';
        if (statusFilter === 'ACTIVE') return projectStatus === 'activo';
        return true;
    });

    // Count badges replaced by globalCounts
    const statusCounts = globalCounts;

    // Observer ref
    const lastElementRef = React.useCallback(node => {
        if (loading || loadingMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                setPage(prevPage => prevPage + 1);
            }
        });
        if (node) observer.current.observe(node);
    }, [loading, loadingMore, hasMore]);

    if (loading && page === 1) return (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-zinc-700 border-t-custom-cyan animate-spin" />
                <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-transparent border-b-brand-magenta animate-[spin_1.5s_linear_infinite_reverse] opacity-50" />
            </div>
            <p className="text-zinc-500 text-xs font-bold tracking-widest uppercase">Cargando pedidos...</p>
        </div>
    );

    return (
        <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">

            {/* ── Header ── */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center shrink-0">
                        <Factory size={18} className="text-custom-cyan" />
                    </div>
                    <div>
                        <h2 className="text-xl sm:text-2xl font-black text-zinc-100 tracking-tight font-barlow leading-none">MIS PEDIDOS</h2>
                        <p className="text-zinc-500 text-[10px] font-bold tracking-[0.2em] uppercase mt-0.5">Estado de Producción</p>
                    </div>
                </div>
                <button
                    onClick={fetchOrders}
                    className="p-2.5 rounded-xl border border-zinc-700/50 bg-custom-dark hover:border-brand-cyan/30 hover:bg-brand-cyan/5 transition-all group shrink-0"
                    title="Refrescar"
                >
                    <RefreshCw size={16} className="text-zinc-400 group-hover:text-custom-cyan transition-colors" />
                </button>
            </div>

            {/* ── Search + Filters ── */}
            <div className="glass-panel rounded-xl p-4 space-y-4">
                <div className="relative">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Buscar por #ID, título del trabajo..."
                        className="w-full pl-11 pr-4 py-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-brand-cyan/40 focus:bg-zinc-800 transition-all font-medium"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                    {FILTER_TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={`
                                relative flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all flex-1 basis-[31%] sm:basis-0
                                ${statusFilter === tab.key
                                    ? 'bg-brand-cyan/15 text-custom-cyan border border-brand-cyan/30 shadow-[0_0_10px_rgba(0,174,239,0.1)]'
                                    : 'text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300'
                                }
                            `}
                        >
                            {tab.label}
                            {statusCounts[tab.key] > 0 && (
                                <span className={`
                                    min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-black px-1
                                    ${statusFilter === tab.key
                                        ? 'bg-custom-cyan/20 text-custom-cyan'
                                        : 'bg-zinc-800 text-zinc-500'
                                    }
                                `}>
                                    {statusCounts[tab.key]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Orders List ── */}
            {filteredProjects.length === 0 ? (
                <div className="glass-panel rounded-xl p-16 flex flex-col items-center justify-center gap-3">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 border border-zinc-700/30 flex items-center justify-center mb-2">
                        <Layers className="w-7 h-7 text-zinc-600" />
                    </div>
                    <p className="text-zinc-400 text-sm font-bold">Sin pedidos encontrados</p>
                    <p className="text-zinc-600 text-xs">Los pedidos que realices aparecerán aquí</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredProjects.map((project, pIdx) => {
                        const isLast = pIdx === filteredProjects.length - 1;
                        const projectStatus = getProjectStatus(project.subOrders);
                        const statusConf = STATUS_CONFIG[projectStatus];
                        const hasZombies = project.subOrders.some(so => so.Estado === 'Cargando...');
                        const allPending = project.subOrders.every(so => ['Pendiente', 'Cargando...'].includes(so.Estado));
                        const materialList = Array.from(project.materials);

                        return (
                            <motion.div
                                key={project.id}
                                ref={isLast ? lastElementRef : null}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: pIdx * 0.04, duration: 0.3 }}
                                className={`glass-panel rounded-xl overflow-hidden transition-all duration-300 hover:border-zinc-600/50 ${statusConf.glow}`}
                            >
                                <div className="px-4 py-4 sm:px-6 sm:py-5 space-y-2">
                                    {/* Fila 1: dot + ID | material | estado + acción */}
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${statusConf.dot} shrink-0 ${projectStatus === 'activo' ? 'animate-pulse' : ''}`} />
                                        <span className="text-lg font-black text-zinc-100 tracking-tight font-barlow shrink-0">
                                            {project.id}
                                        </span>

                                        {/* Material en el medio */}
                                        {materialList.length > 0 && (
                                            <div className="flex items-center gap-1 flex-1 min-w-0">
                                                <span className="text-[10px] text-zinc-400 bg-zinc-800/80 border border-zinc-700/50 px-2 py-0.5 rounded font-bold uppercase tracking-wide truncate">
                                                    {materialList[0]}
                                                </span>
                                                {materialList.length > 1 && (
                                                    <span className="text-[10px] text-zinc-500 font-bold shrink-0">+{materialList.length - 1}</span>
                                                )}
                                            </div>
                                        )}
                                        {materialList.length === 0 && <div className="flex-1" />}

                                        {/* Estado + acción a la derecha */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${statusConf.bg} ${statusConf.color} ${statusConf.border} border`}>
                                                {statusConf.icon}
                                                {statusConf.label}
                                            </span>
                                            {projectStatus === 'finalizado' && (
                                                <button onClick={(e) => { e.stopPropagation(); navigate('/portal/pickup'); }} className="p-1.5 rounded-lg text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all" title="Crear Retiro">
                                                    <Truck size={12} />
                                                </button>
                                            )}
                                            {(hasZombies || allPending) && (
                                                hasZombies ? (
                                                    <button onClick={(e) => handleDeleteBundle(project.id, e)} className="p-1.5 rounded-lg text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-all" title="Eliminar error">
                                                        <Trash2 size={12} />
                                                    </button>
                                                ) : (
                                                    <button onClick={(e) => handleCancelProject(project.subOrders, e)} className="p-1.5 rounded-lg text-zinc-400 border border-zinc-700/50 hover:text-red-400 hover:border-red-500/30 transition-all" title="Cancelar">
                                                        <Ban size={12} />
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>

                                    {/* Fila 2: descripción (izq) + fecha (der) */}
                                    <div className="flex items-baseline justify-between gap-3">
                                        <p className="text-sm text-zinc-300 font-semibold truncate">
                                            {project.title || 'Sin descripción'}
                                        </p>
                                        <span className="text-[11px] text-zinc-500 font-medium shrink-0">
                                            {new Date(project.date).toLocaleString('es-ES', {
                                                day: '2-digit', month: 'short', year: 'numeric'
                                            })}
                                        </span>
                                    </div>

                                    {/* Motivo de cancelación */}
                                    {projectStatus === 'cancelado' && (() => {
                                        const cancelledOrder = project.subOrders.find(so => so.MotivoCancelacion || so.DetallesCancelacion);
                                        const motivo = cancelledOrder?.MotivoCancelacion;
                                        const detalles = cancelledOrder?.DetallesCancelacion;
                                        if (!motivo && !detalles) return null;
                                        return (
                                            <div className="flex items-start gap-2 mt-1 px-2.5 py-2 rounded-lg bg-red-500/5 border border-red-500/15">
                                                <Ban size={13} className="text-red-400/60 shrink-0 mt-0.5" />
                                                <div className="min-w-0">
                                                    {motivo && <p className="text-[11px] font-bold text-red-400/80">{motivo}</p>}
                                                    {detalles && <p className="text-[11px] text-zinc-400 mt-0.5">{detalles}</p>}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Toggle pipeline */}
                                <button
                                    onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 border-t border-zinc-800/60 text-[10px] font-bold text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-all"
                                >
                                    {expandedProject === project.id
                                        ? <><span>OCULTAR ETAPAS</span><span className="text-[10px]">▲</span></>
                                        : <><span>VER ETAPAS</span><span className="text-[10px]">▼</span></>}
                                </button>

                                <AnimatePresence initial={false}>
                                    {expandedProject === project.id && (
                                        <motion.div
                                            key="pipeline"
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                                            className="overflow-hidden border-t border-zinc-800/60 bg-zinc-900/20"
                                        >
                                            <div className="px-4 py-4 overflow-x-auto scrollbar-hide">
                                                <div className="flex justify-center min-w-full">
                                                <div className="inline-flex items-center gap-0">
                                                    {(() => {
                                                        const originalOrders = project.subOrders
                                                            .filter(so => !(so.CodigoOrden || '').toUpperCase().includes('-F'))
                                                            .sort((a, b) => (a.CodigoOrden > b.CodigoOrden ? 1 : -1));

                                                        return originalOrders.map((so, idx, arr) => {
                                                            const sKey = getStatusKey(so.Estado);
                                                            const sConf = STATUS_CONFIG[sKey];
                                                            const isDone = sKey === 'finalizado';
                                                            const isZombie = so.Estado === 'Cargando...';

                                                            return (
                                                                <React.Fragment key={so.OrdenID}>
                                                                    <div className="flex flex-col items-center min-w-[90px]">
                                                                        <div className={`
                                                                            w-9 h-9 rounded-full flex items-center justify-center border-2
                                                                            ${sConf.border} ${sConf.bg} transition-all mb-1.5
                                                                            ${isZombie ? 'animate-pulse' : ''}
                                                                            ${isDone ? 'shadow-[0_0_12px_rgba(52,211,153,0.2)]' : ''}
                                                                            ${sKey === 'activo' ? 'shadow-[0_0_12px_rgba(0,174,239,0.15)]' : ''}
                                                                        `}>
                                                                            <span className={sConf.color}>{sConf.icon}</span>
                                                                        </div>
                                                                        <div className="text-center">
                                                                            <div className="text-[10px] font-black text-zinc-300 uppercase tracking-tight leading-tight">
                                                                                {so.AreaID || '—'}
                                                                            </div>
                                                                            <div className={`text-[9px] font-bold uppercase tracking-wider ${sConf.color}`}>
                                                                                {isZombie ? 'ERROR' : so.Estado}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    {idx < arr.length - 1 && (
                                                                        <div className="flex-1 self-start mt-[18px] -mx-2 min-w-[20px]">
                                                                            <div className={`h-[2px] w-full rounded-full ${isDone ? 'bg-emerald-500/40' : 'bg-zinc-700/50'}`} />
                                                                        </div>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    })}
                </div>
            )}
            
            {loadingMore && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-custom-cyan animate-spin" />
                    <span className="text-zinc-500 text-[10px] font-bold tracking-widest uppercase">Cargando más pedidos...</span>
                </div>
            )}

            {/* Modal de Confirmación */}
            <ConfirmationModal
                isOpen={modal.isOpen}
                title={modal.title}
                message={modal.message}
                type={modal.type}
                confirmText={modal.confirmText}
                onClose={() => setModal({ ...modal, isOpen: false })}
                onConfirm={modal.onConfirm}
            />
        </div>
    );
};
