import React from 'react';
import { Layers, Eye } from 'lucide-react';

const RollCard = ({ roll, onViewDetails, isSelected, onToggleSelect, isMachineView, machineName }) => {
    if (!roll) return null;

    return (
        <div className={`bg-white border p-3 transition-all relative group hover:bg-slate-50 ${isSelected ? 'border-brand-cyan bg-brand-cyan/10 z-10' : 'border-zinc-200 hover:z-10'}`}>
            {/* Cabecera Lote */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
                        <Layers size={16} />
                    </div>
                    <div>
                        <span className="text-[10px] uppercase font-bold text-zinc-400 block leading-none">Lote</span>
                        <span className="font-bold text-zinc-700 text-sm">{roll.name || roll.rollCode || roll.id}</span>
                    </div>
                </div>
                {roll.status && (
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase border ${roll.status.includes('En maquina') || roll.status === 'Asignado' ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' :
                            'bg-zinc-50 text-zinc-500 border-zinc-100'
                        }`}>
                        {roll.status}
                    </span>
                )}
            </div>

            {/* Detalles Reestructurados */}
            <div className="mb-2 ml-1">
                {/* Material Completo */}
                <div className="text-xs font-bold text-zinc-600 mb-3 leading-tight break-words" title={roll.material}>
                    {roll.material || 'Varios'}
                </div>

                {/* Métricas: Órdenes y Metros */}
                <div className="flex items-center gap-4 border-t border-zinc-50 pt-2">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-400 uppercase font-bold">Órdenes</span>
                        <span className="font-black text-zinc-700 text-sm">{roll.ordersCount || roll.orders?.length || 0}</span>
                    </div>
                    <div className="w-px h-6 bg-zinc-100"></div>
                    <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-400 uppercase font-bold">Metros</span>
                        <span className="font-black text-brand-cyan text-sm">{roll.totalMeters || roll.usage || 0}m</span>
                    </div>
                </div>
            </div>

            {/* Footer Acciones */}
            <div className="pt-2 border-t border-zinc-50 flex justify-between items-center">
                <span className="text-[10px] text-zinc-400 italic">
                    {roll.printer || machineName ? `Asignado: ${roll.printer || machineName}` : (!isMachineView ? 'Mesa de Armado' : 'Sin Asignar')}
                </span>

                {/* Botón Ojo */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onViewDetails) onViewDetails(roll);
                    }}
                    className="w-7 h-7 rounded-full bg-zinc-50 text-zinc-400 hover:bg-brand-cyan/10 hover:text-brand-cyan flex items-center justify-center transition-colors cursor-pointer z-10"
                    title="Ver Detalle del Lote"
                >
                    <Eye size={13} />
                </button>
            </div>
        </div>
    );
};

export default RollCard;

