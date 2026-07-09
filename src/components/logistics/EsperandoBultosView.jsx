import React from 'react';
import Swal from 'sweetalert2';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logisticsService } from '../../services/modules/logisticsService';
import { useAuth } from '../../context/AuthContext';

// Punticos: un círculo por bulto. Relleno = recibido, vacío = falta.
const Punticos = ({ total, recibidos }) => (
    <div className="flex items-center gap-1.5">
        {Array.from({ length: Math.max(total || 1, 1) }).map((_, k) => (
            <span
                key={k}
                className={`w-3.5 h-3.5 rounded-full shrink-0 ${
                    k < recibidos ? 'bg-emerald-500' : 'border-2 border-slate-300 bg-transparent'
                }`}
            />
        ))}
    </div>
);

const EsperandoBultosView = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const { data: ordenes = [], isLoading } = useQuery({
        queryKey: ['logistica', 'esperando-bultos'],
        queryFn: logisticsService.getEsperandoBultos,
        refetchInterval: 15000,
    });

    const forzarMut = useMutation({
        mutationFn: (ordenId) => logisticsService.forzarIngreso(ordenId, user?.id || 1),
        onSuccess: () => {
            toast.success('Orden ingresada. Se avisará al cliente en la próxima corrida.');
            queryClient.invalidateQueries({ queryKey: ['logistica', 'esperando-bultos'] });
        },
        onError: (err) => toast.error('No se pudo forzar: ' + (err?.response?.data?.error || err.message)),
    });

    const handleForzar = async (o) => {
        if (!o.OrdenIdReal) {
            toast.error('No se pudo resolver la orden para forzar.');
            return;
        }
        const r = await Swal.fire({
            icon: 'warning',
            title: '¿Forzar ingreso?',
            html: `Vas a ingresar <strong>${o.OrdCodigoOrden}</strong> con <strong>${o.BultosRecibidos} de ${o.BultosEsperados}</strong> bultos.<br><br>Se va a contabilizar y avisar al cliente, aunque falte un bulto.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, forzar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#d97706',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        });
        if (!r.isConfirmed) return;
        forzarMut.mutate(o.OrdenIdReal);
    };

    return (
        <div className="p-6 max-w-4xl mx-auto w-full">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <i className="fa-solid fa-box-open text-amber-500"></i>
                    Esperando Bultos
                </h1>
                <span className="text-sm text-slate-500">
                    {ordenes.length} {ordenes.length === 1 ? 'orden' : 'órdenes'}
                </span>
            </div>

            {isLoading && (
                <div className="p-8 text-center text-slate-400">
                    <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Cargando...
                </div>
            )}

            {!isLoading && ordenes.length === 0 && (
                <div className="p-10 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
                    <i className="fa-solid fa-circle-check text-3xl mb-3 text-emerald-400"></i>
                    <p className="font-bold text-slate-600">No hay órdenes esperando bultos</p>
                    <p className="text-sm">Todo lo que llegó al depósito está completo.</p>
                </div>
            )}

            <div className="space-y-2">
                {ordenes.map((o) => {
                    const dias = o.DiasEsperando || 0;
                    const alerta = dias >= 3;
                    return (
                        <div
                            key={o.OrdIdOrden}
                            className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl px-4 py-3"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-slate-800 text-sm truncate">{o.OrdCodigoOrden}</div>
                                <div className="text-xs text-slate-500 truncate">{o.Cliente || 'Sin cliente'}</div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <Punticos total={o.BultosEsperados} recibidos={o.BultosRecibidos} />
                                <span className="text-xs text-slate-500 min-w-[54px]">
                                    {o.BultosRecibidos}/{o.BultosEsperados} bultos
                                </span>
                            </div>

                            <div
                                className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1 shrink-0 ${
                                    alerta ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                                }`}
                            >
                                <i className={`fa-solid ${alerta ? 'fa-triangle-exclamation' : 'fa-clock'}`}></i>
                                {dias === 0 ? 'hoy' : `hace ${dias} ${dias === 1 ? 'día' : 'días'}`}
                            </div>

                            <button
                                onClick={() => handleForzar(o)}
                                disabled={forzarMut.isPending}
                                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-white hover:bg-amber-50 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                                <i className="fa-solid fa-forward mr-1"></i>Forzar
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default EsperandoBultosView;
