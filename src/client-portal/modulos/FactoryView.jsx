import React, { useEffect, useState } from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { apiClient } from '../api/apiClient';
import { Loader2, RefreshCw, Layers, Trash2, Check, Settings, Circle, Ban, AlertTriangle } from 'lucide-react';

import { ConfirmationModal } from '../pautas/ConfirmationModal';

export const FactoryView = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [areaMap, setAreaMap] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');

    // Modal State
    const [modal, setModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning',
        onConfirm: () => { },
        confirmText: 'Confirmar'
    });

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/web-orders/my-orders');
            if (res.success) {
                setOrders(res.data || []);
            }
        } catch (error) {
            console.error("Error fetching orders:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = (id, isZombie, e) => {
        e?.stopPropagation();
        setModal({
            isOpen: true,
            title: isZombie ? "Eliminar Registro Incompleto" : "Cancelar Orden Pendiente",
            message: isZombie
                ? "Este registro tuvo un error de carga. Al eliminarlo, desaparecerá permanentemente. \n¿Deseas continuar?"
                : "La orden pasará a estado 'Cancelado' pero permanecerá en tu historial. \n¿Estás seguro?",
            type: isZombie ? 'danger' : 'warning',
            confirmText: isZombie ? 'Eliminar' : 'Cancelar Orden',
            onConfirm: async () => {
                setLoading(true);
                try {
                    await apiClient.delete(`/web-orders/incomplete/${id}`);
                    await fetchOrders();
                } catch (err) {
                    alert("Error: " + err.message);
                    setLoading(false);
                }
            }
        });
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
                    await fetchOrders();
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
                    await fetchOrders();
                } catch (err) {
                    alert("Error al cancelar proyecto: " + err.message);
                    setLoading(false);
                }
            }
        });
    };

    const fetchAreaMapping = async () => {
        try {
            const res = await apiClient.get('/web-orders/area-mapping');
            if (res.success) {
                // Nuevo formato: { names: {}, visibility: {} }
                setAreaMap(res.data?.names || res.data || {});
            }
        } catch (error) {
            console.error("Error fetching area mapping:", error);
        }
    };

    const getAreaName = (code) => {
        return areaMap[code] || code;
    };

    useEffect(() => {
        fetchOrders();
        fetchAreaMapping();
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

    const getStatusStyle = (status) => {
        const s = (status || '').toUpperCase();
        if (s.includes('CARGANDO')) return { color: 'text-rose-500', bg: 'bg-rose-50', icon: <AlertTriangle size={14} />, label: 'INCOMPLETO' };
        if (s.includes('PENDIENTE')) return { color: 'text-zinc-400', bg: 'bg-zinc-100', icon: <Circle size={14} />, label: 'PENDIENTE' };
        if (s.includes('CANCELADO')) return { color: 'text-rose-600 line-through', bg: 'bg-rose-50', icon: <Ban size={14} />, label: 'CANCELADO' };
        if (s.includes('FINALIZADO') || s.includes('PRONTO')) return { color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <Check size={14} />, label: 'PRONTO' };
        return { color: 'text-amber-500', bg: 'bg-amber-50', icon: <Settings size={14} className="animate-spin-slow" />, label: 'EN PROCESO' }; // Default Active
    };

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-zinc-300" /></div>;

    return (
        <div className="space-y-4 animate-fade-in p-2 md:p-6 pb-20 max-w-5xl mx-auto">
            <div className="flex flex-col gap-4 mb-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black text-zinc-800 tracking-tighter">MIS PEDIDOS</h2>
                        <p className="text-zinc-400 text-xs font-bold tracking-widest uppercase">Estado de Producción</p>
                    </div>
                    <button onClick={fetchOrders} className="p-2 bg-white border rounded-full hover:bg-zinc-50 shadow-sm transition-all"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row gap-4">
                    <input
                        type="text"
                        placeholder="Buscar por #ID, Título..."
                        className="flex-1 p-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-200"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="flex bg-zinc-100 p-1 rounded-lg overflow-x-auto">
                        {['ALL', 'ACTIVE', 'PENDING', 'DONE', 'CANCELLED'].map(filter => (
                            <button
                                key={filter}
                                onClick={() => setStatusFilter(filter)}
                                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap ${statusFilter === filter ? 'bg-white shadow text-zinc-800' : 'text-zinc-400 hover:text-zinc-600'}`}
                            >
                                {filter === 'ALL' ? 'TODOS' : filter === 'ACTIVE' ? 'EN PROCESO' : filter === 'PENDING' ? 'PENDIENTES' : filter === 'DONE' ? 'FINALIZADOS' : 'CANCELADOS'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {Object.keys(projects).length === 0 ? (
                <div className="p-10 text-center border-2 border-dashed border-zinc-200 rounded-2xl text-zinc-400">
                    <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">Sin pedidos activos</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {Object.values(projects)
                        .filter(p => {
                            // Search Filter
                            const searchLower = searchTerm.toLowerCase();
                            const matchesSearch = p.id.toString().includes(searchLower) || p.title.toLowerCase().includes(searchLower);
                            if (!matchesSearch) return false;

                            // Status Filter
                            const statusSet = new Set(p.subOrders.map(so => so.Estado));
                            const isCancelled = [...statusSet].every(s => s === 'Cancelado');
                            const isDone = [...statusSet].every(s => ['Finalizado', 'Pronto', 'Entregado'].some(done => s.includes(done)));
                            const isPending = [...statusSet].every(s => ['Pendiente', 'Cargando...'].includes(s));
                            const isActive = !isCancelled && !isDone && !isPending;

                            if (statusFilter === 'ALL') return true;
                            if (statusFilter === 'CANCELLED') return isCancelled;
                            if (statusFilter === 'DONE') return isDone;
                            if (statusFilter === 'PENDING') return isPending;
                            if (statusFilter === 'ACTIVE') return isActive;
                            return true;
                        })
                        .map((project) => {
                            const hasZombies = project.subOrders.some(so => so.Estado === 'Cargando...');
                            const allPending = project.subOrders.every(so => ['Pendiente', 'Cargando...'].includes(so.Estado));
                            const materialList = Array.from(project.materials).join(', ');

                            return (
                                <div key={project.id} className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col md:flex-row min-h-[140px]">

                                    {/* Left: Info Principal (White Background) - Fixed Width */}
                                    <div className="p-6 md:w-80 border-b md:border-b-0 md:border-r border-zinc-100 flex flex-col justify-center relative bg-white z-10 shrink-0">
                                        <div className="flex items-baseline gap-2 mb-2">
                                            <span className="text-2xl font-black text-zinc-800 tracking-tighter">ORD-{project.id}</span>
                                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                                                {new Date(project.date).toLocaleString('es-ES', {
                                                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                        <h3 className="text-sm font-bold text-zinc-700 leading-tight mb-3">{project.title}</h3>

                                        {/* Material List Vertical */}
                                        <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto scrollbar-hide">
                                            {Array.from(project.materials).map((mat, i) => (
                                                <div key={i} className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider truncate border-l-2 border-zinc-200 pl-2 py-0.5">
                                                    {mat}
                                                </div>
                                            ))}
                                            {project.materials.size === 0 && (
                                                <span className="text-[10px] text-zinc-300 font-bold uppercase italic">Sin material</span>
                                            )}
                                        </div>

                                        {hasZombies ? (
                                            <button onClick={(e) => handleDeleteBundle(project.id, e)} className="mt-4 w-fit text-[9px] font-black text-rose-600 hover:bg-rose-50 flex items-center gap-2 border border-rose-100 px-3 py-1.5 rounded-full transition-all">
                                                <Trash2 size={10} /> ELIMINAR ERROR
                                            </button>
                                        ) : allPending ? (
                                            <button onClick={(e) => handleCancelProject(project.subOrders, e)} className="mt-4 w-fit text-[9px] font-black text-zinc-400 hover:text-rose-600 hover:bg-rose-50 flex items-center gap-2 border border-zinc-100 hover:border-rose-100 px-3 py-1.5 rounded-full transition-all">
                                                <Ban size={10} /> CANCELAR PEDIDO
                                            </button>
                                        ) : null}
                                    </div>

                                    {/* Right: Stepper (Subtle Gray Background) */}
                                    <div className="flex-1 bg-zinc-50/50 p-6 flex items-center overflow-x-auto scrollbar-hide">
                                        <div className="flex items-start gap-0 min-w-max mx-auto md:mx-0">
                                            {project.subOrders.sort((a, b) => (a.CodigoOrden > b.CodigoOrden ? 1 : -1)).map((so, idx, arr) => {
                                                const style = getStatusStyle(so.Estado);
                                                const isZombie = so.Estado === 'Cargando...';
                                                const isPending = so.Estado === 'Pendiente';

                                                // Determine Connector Color
                                                const isDone = so.Estado.toLowerCase().includes('finalizado') || so.Estado.toLowerCase().includes('pronto') || so.Estado.toLowerCase().includes('entregado');
                                                const connectorColor = isDone ? 'bg-emerald-400' : 'bg-zinc-200';

                                                return (
                                                    <React.Fragment key={so.OrdenID}>
                                                        <div className="flex flex-col items-center relative min-w-[120px] group">

                                                            {/* Status Circle */}
                                                            <div
                                                                className={`w-10 h-10 rounded-full flex items-center justify-center border-[3px] transition-all z-10 mb-2 bg-white ${hasZombies && isZombie ? 'border-rose-200 animate-pulse' : 'border-zinc-200 shadow-sm'}`}
                                                            >
                                                                <div className={style.color}>{style.icon}</div>

                                                                {(isZombie || isPending) && (
                                                                    <button
                                                                        onClick={(e) => handleDelete(so.OrdenID, isZombie, e)}
                                                                        className="absolute -top-2 -right-2 bg-white shadow-sm border border-zinc-200 rounded-full p-1 text-zinc-400 hover:text-rose-500 hover:scale-110 transition-all z-20"
                                                                    >
                                                                        <Trash2 size={10} />
                                                                    </button>
                                                                )}
                                                            </div>

                                                            {/* Labels */}
                                                            <div className="text-center px-1">
                                                                <div className="text-[10px] font-black text-zinc-700 uppercase tracking-tight leading-tight mb-1">{getAreaName(so.AreaID)}</div>
                                                                <div className={`text-[9px] font-bold uppercase tracking-wider ${style.color.replace('line-through', '')}`}>
                                                                    {so.Estado === 'Cargando...' ? 'ERROR' : so.Estado}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Connector */}
                                                        {idx < arr.length - 1 && (
                                                            <div className="flex-1 self-start mt-5 -mx-6 z-0 min-w-[40px]">
                                                                <div className={`h-[3px] w-full rounded-full ${connectorColor}`}></div>
                                                            </div>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    </div>

                                </div>
                            );
                        })}
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
