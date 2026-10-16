import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { productionService, machineControlService } from '../../services/api';
import SlotActionModal from '../modals/SlotActionModal';
import { toast } from 'sonner';
import { ArrowLeft, Printer, RefreshCw, Maximize, Power, Pause, CheckCircle2, Play, Loader2, ServerOff, PlusCircle, Droplets, Package } from 'lucide-react';

const MachineDetailView = () => {
    const { machineId, area } = useParams();
    const navigate = useNavigate();
    const targetId = machineId;

    const [selectedSlot, setSelectedSlot] = useState(null);

    // --- PRODUCTION BOARD DATA ---
    const { data: prodData, isLoading, refetch } = useQuery({
        queryKey: ['productionBoard', area],
        queryFn: () => productionService.getBoard(area),
        enabled: !!area,
        // 30s: esta vista queda abierta 24/7 en TVs de planta — a 10s era una fuente
        // constante de carga; los cambios importantes igual llegan por socket/acciones.
        refetchInterval: 30000
    });

    // --- MACHINE SLOTS DATA ---
    const { data: slots, refetch: refetchSlots } = useQuery({
        queryKey: ['machineSlots', targetId],
        queryFn: () => machineControlService.getSlots(targetId),
        enabled: !!targetId,
        // 30s: los slots (bobina montada) cambian poco; a 5s multiplicaba requests sin valor.
        refetchInterval: 30000
    });

    const machine = prodData?.machines?.find(m => String(m.id) === String(targetId));

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    if (isLoading) return (
        <div className="flex items-center justify-center h-full bg-zinc-50 text-zinc-400 gap-3">
            <Loader2 size={32} className="animate-spin text-brand-cyan" />
            <span className="text-xl font-bold">Cargando Panel...</span>
        </div>
    );

    if (!machine) return (
        <div className="flex flex-col items-center justify-center h-full bg-zinc-50 text-zinc-400">
            <ServerOff size={64} className="mb-4 opacity-30" />
            <h2 className="text-2xl font-bold text-zinc-600">Máquina No Encontrada</h2>
            <button onClick={() => navigate(-1)} className="mt-4 px-6 py-2 bg-brand-cyan text-white rounded-lg font-bold hover:bg-brand-cyan/90 transition-colors">
                Regresar
            </button>
        </div>
    );

    const activeRoll = machine.rolls.find(r => r.status && r.status.includes('En maquina'));

    const handleToggleStatus = async (rollId, action, destination) => {
        try {
            await productionService.toggleStatus(rollId, action, destination);
            refetch();
            toast.success("Estado actualizado");
        } catch (error) {
            const msg = error.response?.data?.error || error.message || "Error desconocido";
            if (error.response?.status === 400) {
                console.warn("Accion bloqueada por validación de stock (Ignorada por usuario):", msg);
            }
            toast.error(msg);
        }
    };

    const handleUnassign = async (rollId) => {
        if (!window.confirm("¿Desmontar rollo y devolver a mesa de armado?")) return;
        try {
            await productionService.unassignRoll(rollId);
            refetch();
            toast.success("Rollo desmontado");
        } catch (error) {
            toast.error("Error al desmontar");
        }
    };

    return (
        <div className="h-full bg-zinc-50 p-4 flex flex-col gap-3 overflow-hidden">
            {/* HEADER */}
            <div className="flex items-center justify-between bg-white px-5 py-2.5 rounded-xl shadow-sm border border-zinc-200/80 shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-all">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="w-px h-5 bg-zinc-200"></div>
                    <h1 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <Printer size={20} className="text-brand-cyan" />
                        {machine.name}
                    </h1>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border ${
                        (machine.status || '').toLowerCase().includes('falla') ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/30' :
                        activeRoll ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30' :
                        'bg-zinc-100 text-zinc-500 border-zinc-200'
                    }`}>
                        {activeRoll ? 'PRODUCIENDO' : machine.status || 'DETENIDO'}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => { refetch(); refetchSlots(); }} className="w-8 h-8 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/10 flex items-center justify-center transition-all" title="Recargar">
                        <RefreshCw size={16} />
                    </button>
                    <button onClick={toggleFullScreen} className="w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 flex items-center justify-center transition-all" title="Pantalla Completa">
                        <Maximize size={16} />
                    </button>
                </div>
            </div>

            {/* MAIN GRID */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 overflow-hidden min-h-0">

                {/* LEFT: ACTIVE JOB DASHBOARD */}
                <div className="lg:col-span-2 flex flex-col overflow-hidden">
                    <div className="flex-1 bg-white rounded-2xl shadow-sm border border-zinc-200/80 p-8 flex flex-col justify-center relative overflow-hidden group">

                        {activeRoll ? (
                            <div className="z-10 w-full max-w-3xl mx-auto">
                                <div className="flex items-start justify-between mb-3">
                                    <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest bg-brand-cyan/10 px-3 py-1.5 rounded-lg border border-brand-cyan/20">Lote Activo</span>
                                    <span className="text-4xl font-black text-zinc-200">#{activeRoll.id}</span>
                                </div>
                                <h2 className="text-4xl md:text-5xl font-black text-zinc-800 leading-tight mb-1 truncate">
                                    {activeRoll.name}
                                </h2>
                                <p className="text-xl text-zinc-400 font-medium mb-8 truncate">
                                    {activeRoll.orders?.[0]?.client || 'Sin Cliente Asignado'}
                                </p>

                                {/* Progress Metrics */}
                                <div className="grid grid-cols-3 gap-4 mb-8">
                                    <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                                        <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1 tracking-wider">Ordenes</div>
                                        <div className="text-3xl font-black text-zinc-700">{activeRoll.orders?.length || 0}</div>
                                    </div>
                                    <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                                        <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1 tracking-wider">Metros Totales</div>
                                        <div className="text-3xl font-black text-zinc-700">{(activeRoll.totalMeters || 0).toFixed(1)}m</div>
                                    </div>
                                    <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                                        <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1 tracking-wider">Material</div>
                                        <div className="text-base font-bold text-zinc-700 truncate">{activeRoll.material}</div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => handleToggleStatus(activeRoll.id, 'pause')}
                                        className="h-16 bg-amber-50 text-amber-600 border border-amber-200 rounded-xl font-black text-lg hover:bg-amber-100 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-3"
                                    >
                                        <Pause size={22} /> PAUSAR
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (window.confirm("¿Confirmar FINALIZACIÓN del lote?")) handleToggleStatus(activeRoll.id, 'finish', 'quality');
                                        }}
                                        className="h-16 bg-emerald-500 text-white rounded-xl font-black text-lg hover:bg-emerald-600 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20"
                                    >
                                        <CheckCircle2 size={22} /> FINALIZAR
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center text-center z-10 w-full">
                                <div className="w-28 h-28 rounded-2xl bg-zinc-100 flex items-center justify-center mb-6">
                                    <Power size={48} className="text-zinc-300" />
                                </div>
                                <h2 className="text-2xl font-bold text-zinc-400 mb-2">Máquina en Espera</h2>
                                <p className="text-zinc-400 max-w-md text-sm">Seleccione un lote de la cola de producción para iniciar el trabajo.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: QUEUE */}
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-zinc-200/80 flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-100 flex justify-between items-center shrink-0">
                        <h3 className="font-bold text-zinc-700 text-xs uppercase tracking-wider flex items-center gap-2">
                            Cola Próxima
                            <span className="bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full text-[10px] font-black">{machine.rolls.filter(r => r.id !== activeRoll?.id).length}</span>
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                        {machine.rolls.filter(r => r.id !== activeRoll?.id).map((roll) => (
                            <div key={roll.id} className="p-3 rounded-xl border border-zinc-100 bg-zinc-50/50 hover:bg-brand-cyan/5 hover:border-brand-cyan/30 group transition-all relative">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-zinc-700 text-sm truncate w-2/3">{roll.name}</span>
                                    <span className="text-[10px] font-bold bg-zinc-100 text-zinc-400 px-1.5 py-0.5 rounded">#{roll.id}</span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="text-xs text-zinc-400 flex flex-col">
                                        <span>{(roll.totalMeters || 0).toFixed(1)}m · {roll.orders?.length} ord.</span>
                                        <span className="text-[10px] truncate max-w-[150px]">{roll.material}</span>
                                    </div>
                                    <button
                                        onClick={() => handleToggleStatus(roll.id, 'start')}
                                        className="text-white bg-brand-cyan w-7 h-7 rounded-lg flex items-center justify-center shadow-md hover:bg-brand-cyan/90 hover:scale-110 active:scale-90 transition-all opacity-0 group-hover:opacity-100"
                                        title="Subir a Producción"
                                    >
                                        <Play size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {machine.rolls.filter(r => r.id !== activeRoll?.id).length === 0 && (
                            <div className="text-center py-10 text-zinc-300 text-sm italic">Cola vacía</div>
                        )}
                    </div>
                </div>
            </div>

            {/* BOTTOM: INSUMOS / SLOTS */}
            <div className="shrink-0 bg-zinc-800 rounded-2xl p-4 shadow-xl border border-zinc-700/50 flex flex-col">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-white font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                        <Package size={14} className="text-brand-cyan" /> Slots & Insumos
                    </h3>
                    <div className="flex gap-3 text-[10px] text-zinc-400">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#22c55e]"></span> Activo</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-600"></span> Vacío</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                    {slots?.map(slot => (
                        <div
                            key={slot.SlotID}
                            onClick={() => setSelectedSlot(slot)}
                            className={`
                                p-3 rounded-xl cursor-pointer transition-all relative group hover:-translate-y-0.5 hover:shadow-lg
                                ${slot.BobinaMontadaID || slot.Tipo === 'CONSUMIBLE' ? 'bg-zinc-700/80 ring-1 ring-zinc-600' : 'bg-zinc-700/40 ring-1 ring-zinc-700 opacity-60 hover:opacity-100'}
                            `}
                        >
                            <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1 truncate">{slot.Nombre}</div>

                            {slot.Tipo === 'BOBINA' ? (
                                slot.BobinaMontadaID ? (
                                    <>
                                        <div className="text-white font-bold text-sm leading-tight truncate mb-0.5">
                                            {slot.CodigoEtiqueta || slot.BobinaMontadaID}
                                        </div>
                                        <div className="text-xs text-brand-cyan font-medium">
                                            {(slot.MetrosRestantes || 0).toFixed(1)} m disp.
                                        </div>
                                        <div className="text-[10px] text-zinc-500 mt-1 truncate">
                                            {slot.NombreInsumoMontado}
                                        </div>
                                        <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#22c55e]"></div>
                                    </>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-2">
                                        <PlusCircle size={20} className="mb-1 group-hover:text-white transition-colors" />
                                        <span className="text-[10px] font-bold uppercase">Montar</span>
                                    </div>
                                )
                            ) : (
                                <>
                                    <div className="flex items-center gap-2 mt-1">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${slot.Nombre.toLowerCase().includes('cyan') ? 'bg-cyan-500/20 text-cyan-400' :
                                                slot.Nombre.toLowerCase().includes('magenta') ? 'bg-pink-500/20 text-pink-400' :
                                                    slot.Nombre.toLowerCase().includes('yellow') ? 'bg-yellow-500/20 text-yellow-400' :
                                                        slot.Nombre.toLowerCase().includes('black') ? 'bg-zinc-600 text-zinc-300' :
                                                            slot.Nombre.toLowerCase().includes('white') ? 'bg-white/20 text-white' :
                                                                'bg-zinc-600 text-zinc-300'
                                            }`}>
                                            <Droplets size={14} />
                                        </div>
                                        <div className="text-right flex-1">
                                            <div className="text-[9px] text-zinc-400 uppercase font-bold">Acción</div>
                                            <div className="text-white font-bold text-[10px]">RECARGAR</div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                    {!slots?.length && (
                        <div className="col-span-full text-zinc-500 italic text-sm py-4 text-center">No hay slots configurados para esta máquina.</div>
                    )}
                </div>
            </div>

            {/* Modals */}
            <SlotActionModal
                isOpen={!!selectedSlot}
                onClose={() => setSelectedSlot(null)}
                slot={selectedSlot}
                machineId={targetId}
                onSuccess={() => {
                    refetchSlots();
                    toast.success("Operación Exitosa");
                }}
            />
        </div>
    );
};

export default MachineDetailView;
