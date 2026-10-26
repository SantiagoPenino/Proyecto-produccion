import React, { useState, useEffect, useRef } from 'react';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Loader2, PackageCheck, Tag, Clock, ArchiveRestore } from 'lucide-react';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, una tarjeta blanca con borde por bulto
// (etiqueta y estado arriba, descripción, y abajo hace cuánto se perdió y el botón), íconos de Lucide en brand-cyan
// sin fondo y el color solo para el estado. Se dibujan de a 50. La confirmación de recuperar pasa de
// window.confirm a useConfirmar. Lógica sin cambios.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';

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

// Mock service call until implemented
const getLostItems = async () => {
    // LLAMADA REAL
    return logisticsService.getLostItems();
};

const LostView = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const queryClient = useQueryClient();
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const [cuantos, centinela] = useDeAPoco(items);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await getLostItems();
            setItems(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const recoverMutation = useMutation({
        mutationFn: logisticsService.recoverItem, // Needs implementation or reuse
        onSuccess: () => {
            toast.success("Item recuperado y puesto en stock");
            loadData();
        },
        onError: (err) => toast.error("Error: " + err.message)
    });

    const handleRecover = async (item) => {
        if (await confirmar({
            titulo: `¿Recuperar item ${item.CodigoEtiqueta}?`,
            texto: `Pasará a estado EN_STOCK en ${item.UbicacionActual || 'RECEPCION'}`,
            confirmar: 'Recuperar',
        })) {
            recoverMutation.mutate({
                bultoId: item.BultoID,
                location: 'RECEPCION' // Default location for recovery, or ask user?
            });
        }
    };

    return (
        <div className="p-3 md:p-6 h-full overflow-y-auto bg-slate-50 text-zinc-800">
            {/* Encabezado */}
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                    <AlertTriangle size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-zinc-800">Objetos Extraviados</h2>
                        <p className="text-sm text-zinc-400">Bultos marcados como perdidos durante el transporte o recepción.</p>
                    </div>
                </div>
                <button onClick={loadData} className={`${BTN_SECUNDARIO} shrink-0`} title="Actualizar" aria-label="Actualizar">
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {items.length === 0 && !loading ? (
                <div className={`${CARD} py-16 px-4 flex flex-col items-center justify-center gap-2 text-center`}>
                    <PackageCheck size={40} className="text-zinc-200" />
                    <p className="font-medium text-zinc-400">No hay bultos extraviados reportados.</p>
                </div>
            ) : items.length === 0 ? (
                <div className={`${CARD} py-16 flex flex-col items-center justify-center gap-3`}>
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <span className="text-sm text-zinc-400">Cargando...</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {items.slice(0, cuantos).map(item => (
                        <div key={item.BultoID} className={`${CARD} p-4 flex flex-col gap-3 hover:border-zinc-300 transition-colors`}>
                            {/* Etiqueta y estado */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Tag size={16} className="text-brand-cyan shrink-0" />
                                    <span className="font-black text-zinc-800 tracking-tight font-mono truncate">{item.CodigoEtiqueta}</span>
                                    <span className="text-[11px] text-zinc-400 font-mono whitespace-nowrap">ID: {item.BultoID}</span>
                                </div>
                                {item.Estado && (
                                    <span className={`${CHIP} uppercase shrink-0 bg-rose-50 text-rose-700 border-rose-200`}>
                                        {String(item.Estado).replace(/_/g, ' ')}
                                    </span>
                                )}
                            </div>

                            {/* Descripción */}
                            <p className="text-sm font-bold text-zinc-700 leading-snug line-clamp-2" title={item.Descripcion || ''}>{item.Descripcion}</p>

                            {/* Pie: hace cuánto se perdió y la acción */}
                            <div className="flex items-center justify-between gap-2 flex-wrap mt-auto pt-3 border-t border-zinc-100">
                                {/* /logistics/lost trae Logistica_Bultos tal cual: no hay FechaUpdated (decía siempre «Recientemente»),
                                    así que sin ella se muestra de cuándo es el bulto (FechaCreacion). */}
                                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 tabular-nums">
                                    <Clock size={11} className="shrink-0" />
                                    {item.FechaUpdated
                                        ? `Perdido hace ${Math.floor((new Date() - new Date(item.FechaUpdated)) / (1000 * 60 * 60 * 24))} días`
                                        : item.FechaCreacion
                                            ? `Bulto del ${new Date(item.FechaCreacion).toLocaleDateString('es-UY')}`
                                            : 'Sin fecha'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleRecover(item)}
                                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors whitespace-nowrap"
                                >
                                    <ArchiveRestore size={13} />
                                    Recuperar / Reingresar
                                </button>
                            </div>
                        </div>
                    ))}
                    {cuantos < items.length && (
                        <div ref={centinela} className="col-span-full py-3 text-center text-xs text-zinc-400">
                            Mostrando {cuantos} de {items.length}…
                        </div>
                    )}
                </div>
            )}
            {ventanaConfirmar}
        </div>
    );
};

export default LostView;
