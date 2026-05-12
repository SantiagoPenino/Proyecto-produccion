import React, { memo } from 'react';
import { Draggable } from '@hello-pangea/dnd';

// Helper de fecha simple para la tarjeta
const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
        const d = new Date(dateString);
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    } catch (e) { return '-'; }
};

/**
 * KanbanCard: Tarjeta optimizada para listas largas en pizarrones Kanban.
 * Utiliza React.memo para evitar re-renders innecesarios durante el Drag & Drop.
 */
const KanbanCard = memo(({ order, index, isSelected, onToggle, isReadOnly, showSequence }) => {
    // Extracción de props segura
    const code = order.code || order.CodigoOrden || `#${order.id}`;
    const date = formatDate(order.entryDate || order.FechaIngreso);
    const client = order.client || order.Cliente || 'Sin Cliente';
    const desc = order.desc || order.DescripcionTrabajo || 'Sin Descripción';
    const material = order.material || order.Material;
    const variant = order.variantCode || order.Variante;
    const magnitude = order.magnitudeStr || order.Magnitud || order.magnitude;
    const priority = order.priority || order.Prioridad || 'Normal';
    const type = order.tipoOrden || order.TipoOrden || 'Ordinaria';
    const fileCount = order.fileCount || 0;

    const isUrgent = priority === 'Urgente';
    const isFault = type === 'Falla';
    const isRepo = type === 'Reposicion' || (typeof code === 'string' && code.includes('-F'));

    return (
        <Draggable draggableId={String(order.id)} index={index} isDragDisabled={isReadOnly}>
            {(provided, snapshot) => (
                <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={`
                        group relative bg-white border mb-2 rounded-lg p-3 shadow-sm transition-all will-change-transform
                        ${isSelected
                            ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-400 z-10'
                            : (isRepo ? 'bg-red-50 border-red-300 hover:border-red-400' : 'border-zinc-200 hover:border-blue-300')
                        }
                        ${isRepo ? 'border-l-[4px] border-l-red-600 shadow-sm' : (isUrgent ? 'border-l-[4px] border-l-red-500' : 'border-l-[4px] border-l-zinc-300')}
                        ${snapshot.isDragging ? 'shadow-2xl rotate-2 scale-105 z-50 ring-2 ring-blue-500/20' : ''}
                        ${isReadOnly ? 'opacity-90' : 'cursor-grab active:cursor-grabbing'}
                    `}
                    onClick={(e) => {
                        if (!isReadOnly && !e.defaultPrevented && onToggle) {
                            // Evitar conflicto con drag
                            if (!snapshot.isDragging) onToggle();
                        }
                    }}
                >
                    {/* Checkbox Overlay (Solo visible si es seleccionable) */}
                    {!isReadOnly && !showSequence && (
                        <div
                            className="absolute top-3 right-3 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={onToggle}
                                className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500 cursor-pointer shadow-sm"
                            />
                        </div>
                    )}

                    {/* Checkbox Permanent Visible si está seleccionado */}
                    {isSelected && !isReadOnly && !showSequence && (
                        <div className="absolute top-3 right-3 z-20">
                            <i className="fa-solid fa-circle-check text-blue-600 text-lg bg-white rounded-full"></i>
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">

                        {/* Top Row: ID y Fecha */}
                        <div className="flex justify-between items-start border-b border-zinc-100 pb-1.5 border-dashed">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                                {showSequence && (
                                    <span className="text-[10px] font-black bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded shadow-sm">
                                        #{index + 1}
                                    </span>
                                )}
                                {isRepo && <i className="fa-solid fa-triangle-exclamation text-red-600 text-xs animate-pulse" title="Reposición por Falla"></i>}
                                <span className="text-sm font-black text-zinc-800 tracking-tight truncate" title={code}>
                                    {code}
                                </span>
                            </div>
                            <span className="text-[9px] font-bold text-zinc-400 flex items-center gap-1 shrink-0 bg-zinc-50 px-1.5 py-0.5 rounded">
                                <i className="fa-regular fa-calendar"></i> {date}
                            </span>
                        </div>

                        {/* Special Type Badges */}
                        {(isFault || isRepo) && (
                            <div className={`self-start text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wide
                                ${isFault ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                                <i className={`fa-solid ${isFault ? 'fa-triangle-exclamation' : 'fa-rotate-right'}`}></i>
                                {type}
                            </div>
                        )}

                        {/* Middle: Client & Desc */}
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-zinc-700 truncate" title={client}>
                                {client}
                            </span>
                            <span className="text-[10px] text-zinc-500 truncate italic font-medium" title={desc}>
                                {desc}
                            </span>
                        </div>

                        {/* Bottom: Metrics & Tags */}
                        <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase border
                                    ${isUrgent
                                        ? 'bg-red-50 text-red-600 border-red-100 animate-pulse'
                                        : 'bg-zinc-50 text-zinc-500 border-zinc-100'}`}>
                                    {priority}
                                </span>
                                {variant && (
                                    <span className="text-[9px] font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                        {variant}
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5">
                                {fileCount > 0 && (
                                    <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 flex items-center gap-1" title={`${fileCount} archivos`}>
                                        {fileCount} <i className="fa-solid fa-paperclip text-[8px]"></i>
                                    </span>
                                )}
                                {magnitude && (
                                    <span className="text-[9px] font-black text-zinc-700 bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200 flex items-center gap-1" title="Magnitud / Metros">
                                        <i className="fa-solid fa-ruler-horizontal text-zinc-400 text-[8px]"></i> {magnitude}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Footer: Material */}
                        {material && (
                            <div className="border-t border-zinc-100 pt-1.5 mt-0.5 flex items-center gap-1">
                                <i className="fa-solid fa-layer-group text-[9px] text-zinc-300"></i>
                                <span className="text-[10px] font-bold text-zinc-600 truncate uppercase" title={material}>
                                    {material}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </Draggable>
    );
}, (prev, next) => {
    // Comparación personalizada para React.memo: Solo re-renderizar si cambian cosas visualmente importantes
    return (
        prev.order.id === next.order.id &&
        prev.index === next.index &&
        prev.isSelected === next.isSelected &&
        prev.isReadOnly === next.isReadOnly &&
        prev.showSequence === next.showSequence &&
        prev.order.status === next.order.status && // Por si cambia el estado interno
        prev.order.priority === next.order.priority
    );
});

export default KanbanCard;

