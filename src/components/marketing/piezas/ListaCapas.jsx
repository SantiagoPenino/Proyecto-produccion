import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { Tarjeta } from './controles';
import { nombreCapa } from './capas';
import { ICONOS_CAPA } from './iconos';

// Lista de capas, la de adelante arriba (como en los programas de diseño). Se ordena arrastrando.
const ListaCapas = ({ capas, seleccion, onSeleccionar, onReordenar, onAlternar }) => {
    const filas = [...capas].reverse();

    const alSoltar = (r) => {
        if (!r.destination || r.destination.index === r.source.index) return;
        // La lista está dada vuelta: el índice visible i es la capa n - 1 - i.
        const n = capas.length;
        onReordenar(n - 1 - r.source.index, n - 1 - r.destination.index);
    };

    return (
        <Tarjeta titulo={`Capas · ${capas.length}`}>
            {!capas.length ? (
                <p className="text-sm text-slate-400">La pieza está vacía. Agregá un título, una foto o elegí una plantilla.</p>
            ) : (
                <DragDropContext onDragEnd={alSoltar}>
                    <Droppable droppableId="capas-pieza">
                        {(prov) => (
                            <div ref={prov.innerRef} {...prov.droppableProps} className="space-y-1">
                                {filas.map((c, i) => {
                                    const Icono = ICONOS_CAPA[c.tipo];
                                    const { tipo, detalle } = nombreCapa(c);
                                    const activa = c.id === seleccion;
                                    return (
                                        <Draggable key={c.id} draggableId={c.id} index={i}>
                                            {(p, snap) => (
                                                <div
                                                    ref={p.innerRef}
                                                    {...p.draggableProps}
                                                    onClick={() => onSeleccionar(c.id)}
                                                    className={`flex items-center gap-2 pl-1 pr-1.5 py-1.5 rounded-xl border cursor-pointer select-none ${activa ? 'border-brand-cyan bg-sky-50' : 'border-transparent hover:bg-slate-50'} ${snap.isDragging ? 'shadow-lg bg-white' : ''}`}
                                                >
                                                    <span {...p.dragHandleProps} className="text-slate-300 hover:text-slate-500 cursor-grab px-0.5" title="Arrastrá para cambiar el orden">
                                                        <GripVertical size={15} />
                                                    </span>
                                                    {Icono && <Icono size={15} className={c.oculta ? 'text-slate-300' : 'text-brand-cyan'} />}
                                                    <span className={`flex-1 min-w-0 truncate text-[13px] ${c.oculta ? 'text-slate-400' : 'text-slate-700'}`}>
                                                        <span className="font-bold">{tipo}</span>
                                                        {detalle && <span className="text-slate-400"> · {detalle}</span>}
                                                    </span>
                                                    <button type="button" title={c.oculta ? 'Mostrar' : 'Ocultar'}
                                                        onClick={(e) => { e.stopPropagation(); onAlternar(c.id, 'oculta'); }}
                                                        className={`w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white ${c.oculta ? 'text-slate-500' : 'text-slate-300 hover:text-slate-500'}`}>
                                                        {c.oculta ? <EyeOff size={14} /> : <Eye size={14} />}
                                                    </button>
                                                    <button type="button" title={c.bloqueada ? 'Desbloquear' : 'Bloquear'}
                                                        onClick={(e) => { e.stopPropagation(); onAlternar(c.id, 'bloqueada'); }}
                                                        className={`w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white ${c.bloqueada ? 'text-slate-500' : 'text-slate-300 hover:text-slate-500'}`}>
                                                        {c.bloqueada ? <Lock size={14} /> : <LockOpen size={14} />}
                                                    </button>
                                                </div>
                                            )}
                                        </Draggable>
                                    );
                                })}
                                {prov.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            )}
        </Tarjeta>
    );
};

export default ListaCapas;
