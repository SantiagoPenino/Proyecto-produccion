import React, { useState, useEffect, useRef } from 'react';
import Swal from 'sweetalert2';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageOpen, Loader2, PackageCheck, CheckCircle2, AlertTriangle, Clock, LogIn, FastForward } from 'lucide-react';
import { logisticsService } from '../../services/modules/logisticsService';
import { useAuth } from '../../context/AuthContext';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, una tarjeta blanca con borde por orden
// (código y estado arriba, cliente, lo que falta en un recuadro gris y abajo los bultos y el botón), íconos de
// Lucide en brand-cyan sin fondo y el color solo para el estado (completo / días esperando). Se dibujan de a 50.
// Las confirmaciones siguen con Swal, con el botón en brand-cyan. Lógica sin cambios.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const BTN_CHICO_PRINCIPAL = 'ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';
const BTN_CHICO_SECUNDARIO = 'ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 whitespace-nowrap';

// Listas de a 50 (patrón useDeAPoco de Reportes): al acercarse al final se agregan 50 más; vuelve a 50 cuando
// cambia la lista. El margen de 600 px se mide contra el contenedor que scrollea de verdad.
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

// Punticos: un círculo por bulto. Relleno = recibido, vacío = falta.
const Punticos = ({ total, recibidos }) => (
    <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: Math.max(total || 1, 1) }).map((_, k) => (
            <span
                key={k}
                className={`w-3 h-3 rounded-full shrink-0 ${
                    k < recibidos ? 'bg-emerald-500' : 'border-2 border-zinc-300 bg-transparent'
                }`}
            />
        ))}
    </div>
);

// Dónde está un bulto que falta, en palabras: "en tránsito · REM-006301", "en ECOUV"...
const dondeEsta = (f) => {
    const lugar = f.Estado === 'EN_TRANSITO'
        ? 'en tránsito'
        : f.Estado === 'EN_STOCK' ? `en ${f.Ubicacion || 'su área'}` : String(f.Estado || '').toLowerCase();
    return f.Remito ? `${lugar} · ${f.Remito}` : lugar;
};

const EsperandoBultosView = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const { data: ordenes = [], isLoading } = useQuery({
        queryKey: ['logistica', 'esperando-bultos'],
        queryFn: logisticsService.getEsperandoBultos,
        refetchInterval: 15000,
    });
    const [cuantos, centinela] = useDeAPoco(ordenes);

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
        // Completo: ya no falta ningún bulto que pueda llegar (los perdidos o reemplazados por una
        // reposición no se esperan). Es el mismo ingreso, sin el aviso de "faltan bultos".
        const r = await Swal.fire(o.Completo ? {
            icon: 'question',
            title: '¿Ingresar la orden?',
            html: `Ya llegaron todos los bultos que se esperan de <strong>${o.OrdCodigoOrden}</strong>.<br><br>Se ingresa el <strong>pedido completo</strong> (todas sus órdenes), se contabiliza y se avisa al cliente.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, ingresar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#006E97',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        } : {
            icon: 'warning',
            title: '¿Forzar ingreso?',
            html: `Vas a forzar <strong>${o.OrdCodigoOrden}</strong> con <strong>${o.BultosRecibidos} de ${o.BultosEsperados}</strong> bultos del pedido.<br><br>Se ingresa el <strong>pedido completo</strong> (todas sus órdenes), se contabiliza y se avisa al cliente aunque falten bultos.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, forzar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#006E97',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        });
        if (!r.isConfirmed) return;
        forzarMut.mutate(o.OrdenIdReal);
    };

    return (
        <div className="min-h-full bg-slate-50 p-3 md:p-6 text-zinc-800">
            {/* Encabezado */}
            <div className="flex items-center gap-3 min-w-0 mb-4">
                <PackageOpen size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div className="min-w-0">
                    <h2 className="text-lg font-black text-zinc-800">Esperando Bultos</h2>
                    <p className="text-sm text-zinc-400">
                        {ordenes.length} {ordenes.length === 1 ? 'orden' : 'órdenes'}
                    </p>
                </div>
            </div>

            {isLoading && (
                <div className={`${CARD} py-16 flex flex-col items-center justify-center gap-3`}>
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <span className="text-sm text-zinc-400">Cargando...</span>
                </div>
            )}

            {!isLoading && ordenes.length === 0 && (
                <div className={`${CARD} py-16 px-4 flex flex-col items-center justify-center gap-2 text-center`}>
                    <PackageCheck size={40} className="text-zinc-200" />
                    <p className="font-bold text-zinc-500">No hay órdenes esperando bultos</p>
                    <p className="text-sm text-zinc-400">Todo lo que llegó al depósito está completo.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {ordenes.slice(0, cuantos).map((o) => {
                    const dias = o.DiasEsperando || 0;
                    const alerta = dias >= 3;
                    const faltantes = !o.Completo && (o.Faltantes || []).length > 0;
                    return (
                        <div
                            key={o.OrdIdOrden}
                            className={`${CARD} p-4 flex flex-col gap-3 hover:border-zinc-300 transition-colors`}
                        >
                            {/* Código y estado */}
                            <div className="flex items-start justify-between gap-2">
                                <span className="font-black text-zinc-800 tracking-tight font-mono truncate min-w-0">{o.OrdCodigoOrden}</span>
                                {o.Completo ? (
                                    <span className={`${CHIP} inline-flex items-center gap-1 whitespace-nowrap shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200`}>
                                        <CheckCircle2 size={12} className="shrink-0" />
                                        Completo
                                    </span>
                                ) : (
                                    <span
                                        className={`${CHIP} inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
                                            alerta ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                                        }`}
                                    >
                                        {alerta ? <AlertTriangle size={12} className="shrink-0" /> : <Clock size={12} className="shrink-0" />}
                                        {dias === 0 ? 'hoy' : `hace ${dias} ${dias === 1 ? 'día' : 'días'}`}
                                    </span>
                                )}
                            </div>

                            {/* Cliente */}
                            <p className="text-sm font-bold text-zinc-700 truncate -mt-1.5">{o.Cliente || 'Sin cliente'}</p>

                            {/* Completo: el recuadro dice que está lista (antes quedaba un hueco vacío en el medio) */}
                            {o.Completo && (
                                <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 px-3 py-2.5 text-xs text-emerald-700 flex items-start gap-2">
                                    <PackageCheck size={15} className="shrink-0 mt-px" />
                                    <span>Llegaron todos los bultos que se esperan. Lista para ingresar.</span>
                                </div>
                            )}

                            {/* Lo que falta y dónde está */}
                            {faltantes && (
                                <div
                                    className="rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5 text-xs"
                                    title={o.Faltantes.map(f => `${f.CodigoEtiqueta} (${f.CodigoOrden}): ${dondeEsta(f)}`).join('\n')}
                                >
                                    <p className="text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1">Falta</p>
                                    {o.Faltantes.slice(0, 2).map((f, i) => (
                                        <p key={i} className="truncate text-rose-700">
                                            <span className="font-bold">{f.CodigoEtiqueta}</span> · {dondeEsta(f)}
                                        </p>
                                    ))}
                                    {o.Faltantes.length > 2 && (
                                        <p className="text-zinc-400 mt-0.5">y {o.Faltantes.length - 2} más</p>
                                    )}
                                </div>
                            )}

                            {/* Pie: bultos recibidos y la acción */}
                            <div className="flex items-center justify-between gap-2 flex-wrap mt-auto">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Punticos total={o.BultosEsperados} recibidos={o.BultosRecibidos} />
                                    <span className="text-[11px] text-zinc-400 whitespace-nowrap tabular-nums">
                                        {o.BultosRecibidos}/{o.BultosEsperados} bultos
                                    </span>
                                </div>
                                {o.Completo ? (
                                    <button
                                        type="button"
                                        onClick={() => handleForzar(o)}
                                        disabled={forzarMut.isPending}
                                        className={BTN_CHICO_PRINCIPAL}
                                    >
                                        <LogIn size={13} />Ingresar
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleForzar(o)}
                                        disabled={forzarMut.isPending}
                                        className={BTN_CHICO_SECUNDARIO}
                                    >
                                        <FastForward size={13} />Forzar
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {cuantos < ordenes.length && (
                    <div ref={centinela} className="col-span-full py-3 text-center text-xs text-zinc-400">
                        Mostrando {cuantos} de {ordenes.length}…
                    </div>
                )}
            </div>
        </div>
    );
};

export default EsperandoBultosView;
