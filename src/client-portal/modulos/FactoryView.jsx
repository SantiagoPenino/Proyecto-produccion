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
        label: 'CARGANDO',
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
        label: 'FINALIZADO',
        dot: 'bg-emerald-400',
    },
    activo: {
        color: 'text-brand-cyan',
        bg: 'bg-brand-cyan/10',
        border: 'border-brand-cyan/30',
        glow: 'shadow-[0_0_12px_rgba(0,174,239,0.15)]',
        icon: <Settings size={15} className="animate-[spin_3s_linear_infinite]" />,
        label: 'PRODUCCION',
        dot: 'bg-custom-cyan',
    },
};

const getStatusKey = (status) => {
    const s = (status || '').toUpperCase();
    if (s.includes('CARGANDO')) return 'zombie';
    if (s.includes('CANCELADO')) return 'cancelado';
    if (s.includes('PENDIENTE')) return 'pendiente';
    if (s.includes('FINALIZADO') || s.includes('AVISADO') || s.includes('ENTREGADO') || s.includes('PRONTO')) return 'finalizado';
    if (s.includes('PRODUCCION') || s.includes('PRODUCCIÓN')) return 'activo';
    return 'activo';
};

const getProjectStatus = (subOrders) => {
    const statuses = subOrders.map(so => getStatusKey(so.Estado));
    if (statuses.every(s => s === 'cancelado')) return 'cancelado';
    if (statuses.every(s => s === 'finalizado')) return 'finalizado';
    if (statuses.every(s => s === 'pendiente' || s === 'zombie')) return 'pendiente';
    if (statuses.some(s => s === 'zombie')) return 'zombie';
    if (statuses.some(s => s === 'activo')) return 'activo';
    return 'pendiente';
};

const FILTER_TABS = [
    { key: 'ALL', label: 'Todos' },
    { key: 'ACTIVE', label: 'Produccion' },
    { key: 'PENDING', label: 'Pendiente' },
    { key: 'DONE', label: 'Finalizado' },
    { key: 'CANCELLED', label: 'Cancelado' },
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

    // Modal de cancelación con razón obligatoria
    const [cancelModal, setCancelModal] = useState({ isOpen: false, onConfirm: null, titulo: '', mensaje: '' });
    const [cancelRazon, setCancelRazon] = useState('');

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
        setCancelRazon('');
        setCancelModal({
            isOpen: true,
            titulo: 'Eliminar Proyecto Incompleto',
            mensaje: 'Esta acción eliminará permanentemente todos los registros fallidos de este proyecto.',
            onConfirm: async (razon) => {
                setLoading(true);
                try {
                    await apiClient.delete(`/web-orders/bundle/${docId}`, { razon });
                    setPage(1);
                    if (page === 1) await fetchOrders(1, false);
                } catch (err) {
                    alert('Error: ' + err.message);
                    setLoading(false);
                }
            }
        });
    };

    const handleCancelProject = (subOrders, e) => {
        e?.stopPropagation();
        setCancelRazon('');
        setCancelModal({
            isOpen: true,
            titulo: 'Cancelar Pedido Completo',
            mensaje: "Todas las órdenes pendientes pasarán a estado 'Cancelado'. Indicá el motivo de la cancelación.",
            onConfirm: async (razon) => {
                setLoading(true);
                try {
                    for (const so of subOrders) {
                        if (['Pendiente', 'Cargando...'].includes(so.Estado)) {
                            await apiClient.delete(`/web-orders/incomplete/${so.OrdenID}`, { razon });
                        }
                    }
                    setPage(1);
                    if (page === 1) await fetchOrders(1, false);
                } catch (err) {
                    alert('Error al cancelar proyecto: ' + err.message);
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
    // Normaliza el docId a su parte numérica para que "DTF-416" y "416" agrupen igual.
    const normalizeDocId = (raw) => {
        if (!raw) return null;
        const m = String(raw).match(/(\d+)$/);
        return m ? m[1] : String(raw);
    };

    // Extrae el File ID de una URL completa de Drive o lo devuelve tal cual si ya es solo un ID
    const extractDriveId = (raw) => {
        if (!raw) return null;
        // Formato: https://drive.google.com/file/d/FILE_ID/view...
        const m = String(raw).match(/\/file\/d\/([^/?&]+)/);
        return m ? m[1] : raw;
    };

    const projects = {};
    orders.filter(order => {
        const code = (order.CodigoOrden || '').toUpperCase();
        // Ocultar solo las FALLAS (-F, internas/efímeras). Las REPOSICIONES (-R) el cliente SÍ las ve.
        return !code.includes('-F');
    }).forEach(order => {
        // Agrupar por el número del CodigoOrden. Las reposiciones (DTF-571-R1) usan su código completo
        // como grupo propio: son una orden nueva, no se mezclan con la madre.
        const isRepoOrder = /-R\d+$/i.test(order.CodigoOrden || '');
        const groupKey = isRepoOrder
            ? order.CodigoOrden
            : (normalizeDocId(order.CodigoOrden) || order.CodigoOrden);
        if (!projects[groupKey]) {
            projects[groupKey] = {
                id: order.CodigoOrden,
                title: order.DescripcionTrabajo,
                date: order.FechaIngreso,
                materials: new Set(),
                subOrders: [],
                maquina: null,
                magnitud: null,
                um: null,
                driveFileId: null,
                primerArchivoId: null,
            };
        }
        // Preferir la info de la orden WEB (más completa: tiene área, descripción, etc.)
        if (order.Origen === 'WEB') {
            projects[groupKey].id = order.CodigoOrden;
            projects[groupKey].title = order.DescripcionTrabajo || projects[groupKey].title;
            projects[groupKey].date = order.FechaIngreso || projects[groupKey].date;
            // Tomar el primer valor disponible de máquina/metros/archivo
            if (!projects[groupKey].maquina && order.NombreMaquina) projects[groupKey].maquina = order.NombreMaquina;
            if (!projects[groupKey].magnitud && order.Magnitud) projects[groupKey].magnitud = order.Magnitud;
            if (!projects[groupKey].um && order.UM) projects[groupKey].um = order.UM;
            if (!projects[groupKey].driveFileId && order.DriveFileId) projects[groupKey].driveFileId = extractDriveId(order.DriveFileId);
            if (!projects[groupKey].primerArchivoId && order.PrimerArchivoID) projects[groupKey].primerArchivoId = order.PrimerArchivoID;
        }
        projects[groupKey].subOrders.push(order);
        if (order.Material) projects[groupKey].materials.add(order.Material);
    });

    // Deduplicar: si un proyecto tiene órdenes WEB y ERP con el mismo código numérico, quitar la ERP duplicada
    Object.values(projects).forEach(p => {
        const webCodes = new Set(p.subOrders.filter(o => o.Origen === 'WEB').map(o => normalizeDocId(o.CodigoOrden)));
        if (webCodes.size > 0) {
            // Las reposiciones (-R) nunca son duplicados: son órdenes nuevas legítimas, no quitarlas.
            p.subOrders = p.subOrders.filter(o =>
                o.Origen === 'WEB'
                || /-R\d+$/i.test(o.CodigoOrden || '')
                || !webCodes.has(normalizeDocId(o.CodigoOrden))
            );
        }
    });

    // Filtrado + orden por fecha desc (más nuevo primero)
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
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

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

                                    {/* Fila 3: máquina + metros + preview archivo */}
                                    {(project.maquina || project.magnitud || project.driveFileId) && (
                                        <div className="flex items-center gap-3 mt-0.5">
                                            {/* Preview miniatura Drive */}
                                            {project.driveFileId && (
                                                <a
                                                    href={`https://drive.google.com/file/d/${project.driveFileId}/view`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={e => e.stopPropagation()}
                                                    className="shrink-0 group relative"
                                                    title="Ver archivo"
                                                >
                                                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-zinc-700/60 bg-zinc-800 group-hover:border-brand-cyan/40 transition-colors">
                                                        <img
                                                            src={
                                                                project.primerArchivoId
                                                                    ? `/thumbnails/${project.id}/${project.primerArchivoId}.jpg`
                                                                    : `/api/web-orders/file-thumbnail/${project.driveFileId}`
                                                            }
                                                            alt="preview"
                                                            className="w-full h-full object-cover"
                                                            onError={e => {
                                                                // Fallback 1: proxy de Drive
                                                                if (e.target.dataset.fallback !== '1' && project.driveFileId) {
                                                                    e.target.dataset.fallback = '1';
                                                                    e.target.src = `/api/web-orders/file-thumbnail/${project.driveFileId}`;
                                                                    return;
                                                                }
                                                                // Fallback 2: ícono de documento
                                                                e.target.style.display = 'none';
                                                                e.target.parentNode.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" class="text-zinc-600"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg></div>';
                                                            }}
                                                        />
                                                    </div>
                                                </a>
                                            )}

                                            <div className="flex items-center gap-2 flex-wrap">
                                                {/* Metros */}
                                                {project.magnitud != null && (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-300 bg-zinc-800/80 border border-zinc-700/50 px-2 py-0.5 rounded">
                                                        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-zinc-500">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10M7 5v14M11 7v10M15 5v14M19 7v10" />
                                                        </svg>
                                                        {Number(project.magnitud).toLocaleString('es-UY', { maximumFractionDigits: 2 })} {project.um || 'm'}
                                                    </span>
                                                )}

                                                {/* Máquina */}
                                                {project.maquina && (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-400 bg-zinc-800/80 border border-zinc-700/50 px-2 py-0.5 rounded">
                                                        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-zinc-500">
                                                            <rect x="2" y="7" width="20" height="14" rx="2" />
                                                            <path strokeLinecap="round" d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
                                                        </svg>
                                                        {project.maquina}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}

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
                                                            const isRepo = (so.Prioridad === 'Reposición') || /-R\d+$/i.test(so.CodigoOrden || '');

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
                                                                            {isRepo && (
                                                                                <div className="text-[8px] font-black uppercase tracking-wider text-amber-400 bg-amber-400/10 rounded px-1 mt-0.5 inline-block">
                                                                                    Reposición
                                                                                </div>
                                                                            )}
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

            {/* Modal de Confirmación genérico */}
            <ConfirmationModal
                isOpen={modal.isOpen}
                title={modal.title}
                message={modal.message}
                type={modal.type}
                confirmText={modal.confirmText}
                onClose={() => setModal({ ...modal, isOpen: false })}
                onConfirm={modal.onConfirm}
            />

            {/* Modal de Cancelación con razón obligatoria */}
            {cancelModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-white font-semibold text-base">{cancelModal.titulo}</h3>
                                <p className="text-zinc-400 text-sm mt-1">{cancelModal.mensaje}</p>
                            </div>
                        </div>

                        <div className="mb-5">
                            <label className="block text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2">
                                Motivo de cancelación <span className="text-red-400">*</span>
                            </label>
                            <textarea
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-500 resize-none focus:outline-none focus:border-amber-500/60 transition-colors"
                                rows={3}
                                placeholder="Ej: Ya no necesito el producto, cambié de pedido..."
                                value={cancelRazon}
                                onChange={e => setCancelRazon(e.target.value)}
                                maxLength={500}
                                autoFocus
                            />
                            <div className="text-right text-zinc-600 text-[10px] mt-1">{cancelRazon.length}/500</div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setCancelModal({ ...cancelModal, isOpen: false })}
                                className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                disabled={!cancelRazon.trim()}
                                onClick={async () => {
                                    const razon = cancelRazon.trim();
                                    setCancelModal({ ...cancelModal, isOpen: false });
                                    await cancelModal.onConfirm(razon);
                                }}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Confirmar cancelación
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
