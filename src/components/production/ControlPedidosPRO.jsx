import React, { useState } from 'react';
import Swal from 'sweetalert2';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logisticsService } from '../../services/modules/logisticsService';
import { useAuth } from '../../context/AuthContext';

// [PRENDAS] FASE 6: bandeja de pedidos con orden madre PRO ya reunidos físicamente en
// PRO (todos sus componentes llegaron — Bordado, Estampado, etc.) esperando control
// manual antes de generar la etiqueta final y salir hacia Depósito. Reemplaza el trigger
// automático que había en receiveDispatch (sacado por un bug: "En Tránsito" contaba como
// "pronto" y armaba remitos parciales de a un componente).
const AREA_LABELS = {
    'EMB': 'Bordado', 'DF': 'DTF', 'TPU': 'TPU', 'EST': 'Estampado',
    'TWC': 'Corte', 'TWT': 'Costura', 'SB': 'Sublimación', 'ECOUV': 'Eco UV',
};

const ControlPedidosPRO = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [expandido, setExpandido] = useState(null);

    const { data, isLoading } = useQuery({
        queryKey: ['logistica', 'pro', 'pedidos-completos'],
        queryFn: logisticsService.getPedidosCompletosPRO,
        refetchInterval: 15000,
    });
    const pedidos = data?.pedidos || [];

    const aprobarMut = useMutation({
        mutationFn: (noDocERP) => logisticsService.aprobarControlPRO(noDocERP),
        onSuccess: (res, noDocERP) => {
            if (res.remitoCreado) {
                toast.success(`Pedido ${noDocERP} controlado — etiqueta generada y remito ${res.dispatchCode} enviado a Depósito.`);
            } else {
                toast.warning(res.message || 'Etiqueta generada, pero el remito no se pudo armar solo.');
            }
            queryClient.invalidateQueries({ queryKey: ['logistica', 'pro', 'pedidos-completos'] });
        },
        onError: (err) => toast.error('No se pudo aprobar: ' + (err?.response?.data?.error || err.message)),
    });

    const handleAprobar = async (p) => {
        const r = await Swal.fire({
            icon: 'question',
            title: `¿Controlar pedido ${p.codigoOrden || p.noDocERP}?`,
            html: `Cliente: <strong>${p.cliente || 'Sin cliente'}</strong><br>
                   ${p.componentes.length} componente(s) reunido(s) en PRO.<br><br>
                   Al confirmar se genera la etiqueta final y sale un remito hacia Depósito.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, controlado — aprobar',
            cancelButtonText: 'Todavía no',
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        });
        if (!r.isConfirmed) return;
        aprobarMut.mutate(p.noDocERP);
    };

    return (
        <div className="p-6 max-w-4xl mx-auto w-full">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <i className="fa-solid fa-clipboard-check text-indigo-500"></i>
                    Control de Pedidos — PRO
                </h1>
                <span className="text-sm text-slate-500">
                    {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'} completo{pedidos.length === 1 ? '' : 's'}
                </span>
            </div>

            {isLoading && (
                <div className="p-8 text-center text-slate-400">
                    <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Cargando...
                </div>
            )}

            {!isLoading && pedidos.length === 0 && (
                <div className="p-10 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
                    <i className="fa-solid fa-circle-check text-3xl mb-3 text-emerald-400"></i>
                    <p className="font-bold text-slate-600">No hay pedidos esperando control</p>
                    <p className="text-sm">Los pedidos aparecen acá cuando TODOS sus componentes ya llegaron a PRO.</p>
                </div>
            )}

            <div className="space-y-2">
                {pedidos.map((p) => {
                    const isExpanded = expandido === p.noDocERP;
                    return (
                        <div key={p.noDocERP} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                            <div className="flex items-center gap-4 px-4 py-3">
                                <button
                                    onClick={() => setExpandido(isExpanded ? null : p.noDocERP)}
                                    className="flex-1 min-w-0 text-left flex items-center gap-3"
                                >
                                    <i className={`fa-solid fa-chevron-${isExpanded ? 'down' : 'right'} text-slate-400 text-xs shrink-0`}></i>
                                    <div className="min-w-0">
                                        <div className="font-bold text-slate-800 text-sm truncate">
                                            {p.codigoOrden || p.noDocERP} — {p.producto || p.trabajo || 'Producto'}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate">{p.cliente || 'Sin cliente'}</div>
                                    </div>
                                </button>

                                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 whitespace-nowrap shrink-0">
                                    <i className="fa-solid fa-check mr-1"></i>
                                    {p.componentes.length} de {p.componentes.length} en PRO
                                </span>

                                <button
                                    onClick={() => handleAprobar(p)}
                                    disabled={aprobarMut.isPending}
                                    className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                    <i className="fa-solid fa-clipboard-check mr-1"></i>Aprobar Control
                                </button>
                            </div>

                            {isExpanded && (
                                <div className="px-4 pb-3 pt-1 border-t border-slate-100 bg-slate-50/50">
                                    <div className="grid gap-1.5 mt-2">
                                        {p.componentes.map((c) => (
                                            <div key={c.ordenId} className="flex items-center gap-3 text-sm bg-white rounded-lg border border-slate-200 px-3 py-2">
                                                <span className="font-mono text-xs text-slate-400 shrink-0">{c.codigoOrden}</span>
                                                <span className="flex-1 min-w-0 truncate text-slate-700">{c.nombreArticulo || 'Componente'}</span>
                                                {c.magnitud != null && (
                                                    <span className="text-xs text-slate-500 shrink-0">x{c.magnitud}</span>
                                                )}
                                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 shrink-0">
                                                    {AREA_LABELS[c.areaId] || c.areaId}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ControlPedidosPRO;
