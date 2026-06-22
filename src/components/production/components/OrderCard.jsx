import React from 'react';
import { CircleCheck, CircleX, ScanSearch, Clock, AlertTriangle, Circle } from 'lucide-react';

const OrderCard = ({ order, onViewDetails, isSelected, onToggleSelect, minimal = false }) => {
    if (!order) return null;

    // Determinar colores según estado
    const getStatusColor = (status) => {
        const s = status?.toLowerCase() || '';
        if (s.includes('imprimiendo') || s.includes('proceso')) return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s.includes('detenido') || s.includes('falla')) return 'bg-red-100 text-red-700 border-red-200';
        if (s.includes('control') || s.includes('calidad')) return 'bg-purple-100 text-purple-700 border-purple-200';
        if (s.includes('finalizado') || s.includes('entregado') || s.includes('ok')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    };

    if (minimal) {
        // Determinar si la orden ya está en un estado final (no necesita más acciones aquí)
        const sUp = (order.status || '').toUpperCase().trim();
        const saUp = (order.statusArea || '').toUpperCase().trim();
        const isAlreadyDone =
            saUp === 'PRONTO' ||
            saUp === 'EN TRANSITO' ||
            sUp === 'FINALIZADO';

        // Status Icon Logic
        const getStatusIcon = () => {
            // Si ya está pronta/en transito/finalizada → mostrar badge de estado, NO checkmark
            if (isAlreadyDone) {
                const label = saUp === 'EN TRANSITO' ? 'EN TRÁNSITO' : saUp === 'PRONTO' ? 'PRONTO' : 'FINALIZADO';
                const colorClass = saUp === 'EN TRANSITO'
                    ? 'bg-blue-100 text-blue-600 border-blue-200'
                    : 'bg-emerald-100 text-emerald-600 border-emerald-200';
                return (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${colorClass} whitespace-nowrap`}>
                        {label}
                    </span>
                );
            }

            // Todos los archivos controlados → check (listo para finalizar)
            if (order.controlled) {
                if (order.failures > 0)
                    return <span className="inline-flex rounded-full bg-red-500 p-[3px]"><CircleX size={14} className="text-white" strokeWidth={2.5} /></span>;
                return <span className="inline-flex rounded-full bg-emerald-500 p-[3px]"><CircleCheck size={14} className="text-white" strokeWidth={2.5} /></span>;
            }
            if (sUp === 'FINALIZADO' || sUp === 'PRONTO SECTOR' || sUp === 'COMPLETO')
                return <CircleCheck size={18} className="text-brand-cyan" />;
            if (saUp.includes('CONTROL') || saUp.includes('CALIDAD') || sUp.includes('CONTROL') || sUp.includes('CALIDAD'))
                return <ScanSearch size={18} className="text-brand-cyan" />;
            if (sUp === 'EN PROCESO' || sUp.includes('IMPRIMIENDO') || sUp === 'PRODUCCION')
                return <Clock size={18} className="text-brand-cyan animate-pulse" />;
            if (sUp === 'FALLA')
                return <span className="inline-flex rounded-full bg-red-500 p-[3px]"><AlertTriangle size={14} className="text-white" strokeWidth={2.5} /></span>;

            return <Circle size={18} className="text-brand-cyan opacity-30" />;
        };

        return (
            <div
                className={`group bg-white border-b p-3 flex items-center gap-3 hover:bg-slate-50 transition-all cursor-pointer relative overflow-hidden ${isSelected ? 'border-brand-cyan bg-brand-cyan/10' : 'border-slate-200'}`}
                onClick={() => onToggleSelect && onToggleSelect(order.id, !isSelected)}
            >
                {/* ID & Selection */}
                <div onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-zinc-300 text-brand-cyan focus:ring-brand-cyan accent-brand-cyan cursor-pointer"
                        checked={isSelected || false}
                        onChange={(e) => onToggleSelect && onToggleSelect(order.id, e.target.checked)}
                    />
                </div>

                {/* Main Info */}
                <div className="flex flex-col overflow-hidden flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); onViewDetails && onViewDetails(order); }}>
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-black text-xs text-zinc-800">Orden No.: {order.code || order.id}</span>
                        {/* DEBUG DATA */}
                        <span className='text-[8px] text-red-500 hidden'>{JSON.stringify(Object.keys(order))}</span>

                        {/* Indicators Row */}
                        <div className="flex gap-1 items-center">
                            {/* Impresorita: siempre visible si tiene etiquetas, con contador de bultos */}
                            {order.hasLabels > 0 && (
                                <span className="inline-flex items-center gap-0.5">
                                    <i className="fa-solid fa-print text-[10px] text-brand-cyan" title={`${order.hasLabels} bulto(s) generado(s)`}></i>
                                    <span className="text-[9px] font-black text-brand-cyan leading-none">{order.hasLabels}</span>
                                </span>
                            )}
                            {order.failures > 0 && <i className="fa-solid fa-triangle-exclamation text-[10px] text-red-500" title="Reporte de Fallas"></i>}
                            {/* Urgent Priority */}
                            {order.priority === 'Urgente' && <i className="fa-solid fa-fire text-[10px] text-amber-500" title="Urgente"></i>}
                            {/* Next Service Indicator */}
                            {order.nextService && !isAlreadyDone && <i className="fa-solid fa-arrow-right-to-bracket text-[10px] text-brand-cyan" title={`Siguiente: ${order.nextService}`}></i>}
                        </div>

                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-zinc-700 uppercase leading-tight block break-words" title={order.client}>
                            {order.client || 'Sin Cliente'}
                        </span>
                        <span className="text-[9px] font-bold text-zinc-500 uppercase leading-tight mt-0.5 block break-words whitespace-normal" title={order.material}>
                            {order.material || 'Sin material'}
                        </span>
                    </div>
                    {/* TEMP DEBUG: Show raw keys if material is missing */}
                    {!order.material && <div className="text-[9px] text-red-500 leading-tight overflow-hidden break-all">{JSON.stringify(order._raw)}</div>}
                </div>

                {/* Status Icon (Right Side) */}
                <div className="shrink-0 pl-2">
                    {getStatusIcon()}
                </div>
            </div>
        );
    }

    return (
        <div
            className={`group bg-white border p-5 flex flex-col gap-4 hover:bg-slate-50 transition-all duration-300 relative overflow-hidden ${isSelected ? 'border-brand-cyan bg-brand-cyan/5 z-10' : 'border-zinc-200 hover:z-10'}`}
        >

            {/* Indicador lateral de prioridad */}
            {order.priority === 'Urgente' && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>
            )}

            {/* Checkbox de Selección */}
            <div className="absolute top-3 left-3 z-20">
                <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-zinc-300 text-brand-cyan focus:ring-brand-cyan accent-brand-cyan cursor-pointer"
                    checked={isSelected || false}
                    onChange={(e) => onToggleSelect && onToggleSelect(order.id, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                />
            </div>

            {/* Header: ID y Estado */}
            <div className="flex justify-between items-start pl-5" onClick={() => onViewDetails && onViewDetails(order)}>
                <div className="cursor-pointer">
                    <span className="font-mono text-xs font-bold text-zinc-400 mb-1 block">Orden No.: {order.code || order.id}</span>
                    <h3 className="font-bold text-lg text-zinc-800 leading-tight line-clamp-1" title={order.client}>
                        {order.client}
                    </h3>
                </div>
                <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold border ${getStatusColor(order.status)}`}>
                    {order.status || 'Pendiente'}
                </span>
            </div>

            {/* Body: Descripción y Detalles */}
            <div className="flex-1 pl-1 cursor-pointer" onClick={() => onViewDetails && onViewDetails(order)}>
                <p className="text-sm text-zinc-500 mb-3 line-clamp-2" title={order.desc}>
                    {order.desc || 'Sin descripción'}
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-zinc-50 rounded p-2 border border-zinc-100">
                        <span className="block text-zinc-400 text-[10px] uppercase font-bold">Material</span>
                        <span className="font-semibold text-zinc-700 truncate block" title={order.material}>{order.material || '-'}</span>
                    </div>
                    <div className="bg-zinc-50 rounded p-2 border border-zinc-100">
                        <span className="block text-zinc-400 text-[10px] uppercase font-bold">Cantidad</span>
                        <span className="font-semibold text-zinc-700">{order.magnitude || 0} <span className="text-[10px] text-zinc-400 font-normal ml-0.5">{order.um || ''}</span></span>
                    </div>
                </div>

                {order.nextService && (
                    <div className="mt-2 bg-indigo-50/50 rounded p-2 border border-indigo-100 flex items-center gap-2">
                        <i className="fa-solid fa-arrow-right-to-bracket text-indigo-400 text-lg"></i>
                        <div className="min-w-0">
                            <span className="block text-indigo-400 text-[9px] uppercase font-bold leading-none mb-0.5">Próximo Servicio</span>
                            <span className="font-bold text-indigo-700 text-xs block truncate" title={order.nextService}>
                                {order.nextService}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer: Acciones */}
            <div className="pt-3 border-t border-zinc-100 flex justify-between items-center mt-auto">
                <div className="flex items-center gap-2 text-xs text-brand-cyan">
                    <i className="fa-regular fa-clock"></i>
                    <span className="text-zinc-400">{order.entryDate ? new Date(order.entryDate).toLocaleDateString() : '-'}</span>
                </div>

                <button
                    onClick={(e) => { e.stopPropagation(); onViewDetails && onViewDetails(order); }}
                    className="w-8 h-8 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center hover:bg-brand-cyan hover:text-white transition-all shadow-sm hover:shadow-brand-cyan/20"
                    title="Ver Detalle Completo"
                >
                    <i className="fa-regular fa-eye"></i>
                </button>
            </div>
        </div>
    );
};

export default OrderCard;

