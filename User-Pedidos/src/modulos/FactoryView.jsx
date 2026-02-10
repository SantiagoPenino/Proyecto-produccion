import React, { useEffect, useState } from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { apiClient } from '../api/apiClient';
import { Loader2, RefreshCw, Layers } from 'lucide-react';

export const FactoryView = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

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

    useEffect(() => {
        fetchOrders();
    }, []);

    // Mapeo simple de progreso basado en estado
    const getProgress = (estado) => {
        const e = (estado || '').toLowerCase();
        if (e.includes('finalizado') || e.includes('pronto') || e.includes('entregado')) return 100;
        if (e.includes('impresion') || e.includes('produccion') || e.includes('en proceso')) return 70;
        if (e.includes('ripeando')) return 40;
        if (e.includes('pendiente')) return 15;
        return 5;
    };

    // Agrupación por Proyecto (NoDocERP)
    const projects = {};
    orders.forEach(order => {
        const docId = order.NoDocERP || order.CodigoOrden;
        if (!projects[docId]) {
            projects[docId] = {
                id: docId,
                title: order.DescripcionTrabajo,
                date: order.FechaIngreso,
                material: order.Material,
                subOrders: []
            };
        }
        projects[docId].subOrders.push(order);
    });

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
                <Loader2 className="w-12 h-12 animate-spin mb-4" />
                <p className="font-medium tracking-tight">Cargando estado de fábrica...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in p-2 md:p-6 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
                <div>
                    <h2 className="text-4xl font-black text-neutral-800 tracking-tighter">Estado en Fábrica</h2>
                    <p className="text-zinc-500 font-medium tracking-tight">Seguimiento consolidado por proyecto.</p>
                </div>
                <button
                    onClick={fetchOrders}
                    className="flex items-center gap-2 bg-white border border-zinc-200 shadow-sm hover:shadow-md hover:bg-zinc-50 text-zinc-800 px-6 py-3 rounded-2xl transition-all font-bold text-xs tracking-widest"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    ACTUALIZAR
                </button>
            </div>

            {Object.keys(projects).length === 0 ? (
                <GlassCard className="p-20 text-center border-dashed border-2">
                    <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Layers className="w-10 h-10 text-zinc-300" />
                    </div>
                    <h3 className="text-xl font-bold text-zinc-400">Sin pedidos activos</h3>
                    <p className="text-zinc-400 max-w-xs mx-auto mt-2 font-medium">Tus pedidos aparecerán aquí una vez que los envíes.</p>
                </GlassCard>
            ) : (
                <div className="grid grid-cols-1 gap-8">
                    {Object.values(projects).map((project) => (
                        <GlassCard key={project.id} className="overflow-hidden border-zinc-100 shadow-2xl shadow-zinc-200/40 lg:flex">
                            {/* Lateral Info */}
                            <div className="bg-zinc-900 p-8 lg:w-96 flex flex-col justify-between text-white">
                                <div>
                                    <div className="flex items-center gap-2 mb-4">
                                        <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 text-nowrap">ORDEN ACTIVA</span>
                                    </div>
                                    <h3 className="text-5xl font-black tracking-tighter mb-4">#{project.id}</h3>
                                    <p className="text-lg font-bold text-zinc-300 leading-tight mb-2">{project.title}</p>
                                    <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{project.material}</p>
                                </div>

                                <div className="mt-10 pt-10 border-t border-zinc-800">
                                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">FECHA DE INGRESO</p>
                                    <p className="text-sm font-bold">
                                        {new Date(project.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                                    </p>
                                </div>
                            </div>

                            {/* Details List */}
                            <div className="flex-1 p-8 bg-white">
                                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-6">FLUJO DE TRABAJO Y ESTADOS</p>
                                <div className="space-y-6">
                                    {project.subOrders.sort((a, b) => (a.CodigoOrden > b.CodigoOrden ? 1 : -1)).map((so) => {
                                        const progress = getProgress(so.EstadoenArea || so.Estado);
                                        const isDone = progress === 100;

                                        return (
                                            <div key={so.OrdenID} className="group relative">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm border-2 ${isDone ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-zinc-50 border-zinc-100 text-zinc-400'
                                                            }`}>
                                                            {so.AreaID}
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-tighter">{so.CodigoOrden}</p>
                                                            <p className="text-sm font-black text-zinc-900 uppercase">{so.EstadoenArea || so.Estado}</p>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-col items-end md:min-w-[120px]">
                                                        <span className={`text-[10px] font-black px-2 py-1 rounded-md mb-1 ${isDone ? 'text-emerald-500 bg-emerald-50' : 'text-zinc-400 bg-zinc-50'
                                                            }`}>
                                                            {progress}%
                                                        </span>
                                                        <div className="w-full md:w-32 bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full transition-all duration-700 ${isDone ? 'bg-emerald-500' : 'bg-zinc-900'}`}
                                                                style={{ width: `${progress}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {so.ProximoServicio && !isDone && (
                                                    <div className="ml-16">
                                                        <p className="text-[9px] font-bold text-zinc-400 uppercase italic">
                                                            SIGUIENTE: <span className="text-zinc-600 ml-1">{so.ProximoServicio}</span>
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </div>
            )}
        </div>
    );
};
