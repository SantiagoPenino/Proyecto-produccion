import React from 'react';
import { Layers, Eye } from 'lucide-react';

const RollCard = ({ roll, index, onViewDetails, isSelected, onToggleSelect, isMachineView, machineName }) => {
    if (!roll) return null;

    return (
        <div className={`bg-white border rounded-2xl p-3 transition-all relative group hover:bg-slate-50 hover:shadow-md ${isSelected ? 'border-brand-cyan bg-brand-cyan/10 z-10' : 'border-zinc-200 hover:z-10'}`}>
            {/* Cabecera Lote */}
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 w-full overflow-hidden pr-2">
                    <div className="w-8 h-8 rounded-lg bg-brand-cyan/10 flex items-center justify-center text-brand-cyan shrink-0">
                        <Layers size={16} />
                    </div>
                    <div>
                        <span className="text-[10px] uppercase font-bold text-zinc-400 block leading-none mb-0.5">Lote</span>
                        <span className="font-bold text-zinc-700 text-sm break-all">{roll.name || roll.rollCode || roll.id}</span>
                    </div>
                </div>
            </div>

            {/* Detalles Reestructurados */}
            <div className="mb-1 ml-1">
                {/* Material Completo y Estado */}
                <div className="flex justify-between items-start gap-2 mb-3">
                    <div className="text-xs font-bold text-zinc-600 leading-tight break-words" title={roll.material}>
                        {roll.material || 'Varios'}
                    </div>
                    {roll.status && (
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase border shrink-0 ${roll.status.includes('En maquina') || roll.status === 'Asignado' || (isMachineView && isSelected && roll.status.toLowerCase() === 'en cola') ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' :
                                'bg-zinc-50 text-zinc-500 border-zinc-200'
                            }`}>
                            {isMachineView && isSelected && roll.status.toLowerCase() === 'en cola' ? 'Actual' : roll.status}
                        </span>
                    )}
                </div>

                {/* Métricas: Órdenes y Metros */}
                <div className="flex items-center justify-between border-t border-zinc-100 pt-2.5">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-zinc-400 uppercase font-bold mb-0.5">Órdenes</span>
                            <span className="font-black text-zinc-700 text-sm leading-none">{roll.ordersCount || roll.orders?.length || 0}</span>
                        </div>
                        <div className="w-px h-6 bg-zinc-200"></div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-zinc-400 uppercase font-bold mb-0.5">Metros</span>
                            <span className="font-black text-brand-cyan text-sm leading-none">{parseFloat(roll.totalMeters || roll.usage || 0).toFixed(2)}m</span>
                        </div>
                    </div>
                    
                    {/* Botón Ojo */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onViewDetails) onViewDetails(roll);
                        }}
                        className="w-7 h-7 rounded-full bg-white border border-zinc-200 text-zinc-400 hover:bg-brand-cyan hover:text-white hover:border-brand-cyan flex items-center justify-center transition-all cursor-pointer shadow-sm"
                        title="Ver Detalle del Lote"
                    >
                        <Eye size={13} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RollCard;

