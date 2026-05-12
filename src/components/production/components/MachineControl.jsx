import React, { useState, useEffect } from 'react';
import RollCard from './RollCard';
import { Play, Pause, FlagTriangleRight, Info, Settings, Printer, PrinterX, ChevronDown, Unlink, Check } from 'lucide-react';
import { Listbox, Transition } from '@headlessui/react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';

const MachineControl = ({ machine, onAssign, onToggleStatus, onViewDetails, onUnassign, pendingRolls = [] }) => {
    // machine.rolls tiene los rollos asignados
    // machine.status es el estado de la maquina

    // Identificar rollo activo (En maquina)
    const activeRoll = machine.rolls.find(r => r.status && r.status.includes('En maquina'));

    // Estado local para la selección del combo
    // Si hay un rollo activo, el combo se forza a ese rollo
    // Si no, se puede seleccionar libremente de la cola
    const [selectedRollId, setSelectedRollId] = useState('');
    const [removingRollId, setRemovingRollId] = useState(null);

    useEffect(() => {
        if (activeRoll) {
            setSelectedRollId(activeRoll.id);
        } else {
            const isSelectedValid = machine.rolls.some(r => String(r.id) === String(selectedRollId));
            if (!isSelectedValid) {
                setSelectedRollId(machine.rolls.length > 0 ? machine.rolls[0].id : '');
            }
        }
    }, [activeRoll, machine.rolls, selectedRollId]);

    const isRunning = !!activeRoll;

    // State for Decision Modal
    const [showFinishModal, setShowFinishModal] = useState(false);

    // Handlers
    const handlePlay = () => {
        if (selectedRollId) onToggleStatus(selectedRollId, 'start');
    };

    const handlePause = () => {
        if (activeRoll) onToggleStatus(activeRoll.id, 'pause');
    };

    const handleStop = () => {
        if (!activeRoll) return;
        setShowFinishModal(true);
    };

    const confirmFinish = (destination) => {
        // destination: 'production' | 'quality'
        if (activeRoll) {
            // Pasamos el destino como tercer argumento (la funcion padre debe soportarlo)
            onToggleStatus(activeRoll.id, 'finish', destination);
        }
        setShowFinishModal(false);
    };

    const isFalla = (machine.status || '').toLowerCase().includes('falla');

    return (
        <div className={`min-w-0 bg-white rounded-2xl shadow-lg border-t-4 flex flex-col max-h-full transition-colors
            ${isFalla ? 'border-brand-magenta' : isRunning ? 'border-brand-cyan' : 'border-zinc-400'}`}>

            {/* ENCABEZADO DE CONTROL */}
            <div className="p-3 border-b border-zinc-100 bg-zinc-50 rounded-t-xl flex flex-col gap-2 relative z-10 shadow-sm">

                {/* 1. Nombre y Estado */}
                <div className="flex justify-between items-center">
                    <div className="font-black text-zinc-800 text-sm flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isFalla ? 'bg-brand-magenta/10 text-brand-magenta' : isRunning ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-zinc-100 text-zinc-400'}`}>
                            {isFalla ? <PrinterX size={16} /> : isRunning ? <Settings size={16} className="animate-spin" /> : <Printer size={16} />}
                        </div>
                        <span className="truncate max-w-[120px]" title={machine.name}>{machine.name}</span>
                    </div>
                    {(() => {
                        const isFalla = (machine.status || '').toLowerCase().includes('falla');
                        if (isFalla) return (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20">
                                FALLA
                            </span>
                        );
                        return (
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${isRunning ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' : 'bg-zinc-50 text-zinc-500 border-zinc-200'}`}>
                                {isRunning ? 'TRABAJANDO' : machine.status || 'PAUSADO'}
                            </span>
                        );
                    })()}
                </div>

                {/* 2. Controles (Play/Pause/Stop/Detail) */}
                <div className="flex items-center gap-1 justify-between bg-white p-1 rounded-lg border border-zinc-200 shadow-sm">
                    <div className="flex items-center gap-1">
                        <Tippy content="Iniciar">
                            <button onClick={handlePlay} disabled={isRunning || !selectedRollId}
                                className={`w-8 h-8 rounded flex items-center justify-center transition-all ${isRunning || !selectedRollId ? 'text-zinc-300 cursor-not-allowed' : 'text-brand-cyan hover:bg-brand-cyan/10 hover:scale-110 active:scale-95'}`}>
                                <Play size={14} />
                            </button>
                        </Tippy>
                        <Tippy content="Pausar">
                            <button onClick={handlePause} disabled={!isRunning}
                                className={`w-8 h-8 rounded flex items-center justify-center transition-all ${!isRunning ? 'text-zinc-300 cursor-not-allowed' : 'text-brand-gold hover:bg-brand-gold/10 hover:scale-110 active:scale-95'}`}>
                                <Pause size={14} />
                            </button>
                        </Tippy>
                        <Tippy content="Finalizar Lote">
                            <button onClick={handleStop} disabled={!isRunning}
                                className={`w-8 h-8 rounded flex items-center justify-center transition-all ${!isRunning ? 'text-zinc-300 cursor-not-allowed' : 'text-brand-magenta hover:bg-brand-magenta/10 hover:scale-110 active:scale-95'}`}>
                                <FlagTriangleRight size={14} />
                            </button>
                        </Tippy>
                    </div>
                    <div className="w-px h-4 bg-zinc-200"></div>
                    <Tippy content="Ver Detalles">
                        <button onClick={() => onViewDetails(machine)} className="w-8 h-8 rounded flex items-center justify-center text-brand-cyan hover:bg-brand-cyan/10 transition-all hover:scale-110">
                            <Info size={16} />
                        </button>
                    </Tippy>
                </div>

                {/* 3. Selector de Rollo */}
                <div className="relative flex items-center gap-1">
                    <div className="relative flex-1">
                        {(() => {
                            const currentSelectedRoll = machine.rolls.find(r => String(r.id) === String(selectedRollId)) || pendingRolls.find(r => String(r.id) === String(selectedRollId));
                            const selectedRollName = currentSelectedRoll ? (currentSelectedRoll.name || `Lote #${currentSelectedRoll.id}`) : "Seleccionar Lote...";

                            return (
                                <Listbox
                                    value={selectedRollId}
                                    onChange={(id) => {
                                        const isPending = pendingRolls.some(r => String(r.id) === String(id));
                                        if (isPending) {
                                            onAssign(id);
                                            setSelectedRollId(id);
                                        } else {
                                            setSelectedRollId(id);
                                        }
                                    }}
                                    disabled={isRunning || isFalla}
                                >
                                    <div className="relative z-[50]">
                                        <Listbox.Button className={`relative w-full text-[10px] font-bold py-1.5 pl-2 pr-6 rounded border text-left outline-none transition-all
                                            ${(isRunning || isFalla) ? 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed' : 'bg-white text-brand-cyan border-brand-cyan/30 hover:border-brand-cyan cursor-pointer shadow-sm'}`}>
                                            <span className="block truncate">{selectedRollName}</span>
                                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-zinc-400">
                                                <ChevronDown size={12} />
                                            </span>
                                        </Listbox.Button>
                                        <Transition
                                            as={React.Fragment}
                                            leave="transition ease-in duration-100"
                                            leaveFrom="opacity-100"
                                            leaveTo="opacity-0"
                                        >
                                            <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-xs shadow-xl border border-zinc-100 focus:outline-none z-[60] font-sans">
                                                {/* SECTION: EN MAQUINA */}
                                                {machine.rolls.length > 0 && (
                                                    <>
                                                        <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 bg-zinc-50 uppercase sticky top-0 z-[61]">En Máquina</div>
                                                        {machine.rolls.map((r) => (
                                                            <Listbox.Option
                                                                key={r.id}
                                                                className={({ active }) =>
                                                                    `relative cursor-pointer select-none py-1.5 pl-8 pr-4 ${
                                                                        active ? 'bg-brand-cyan/10 text-brand-cyan font-bold' : 'text-zinc-700 font-medium'
                                                                    }`
                                                                }
                                                                value={r.id}
                                                            >
                                                                {({ selected }) => (
                                                                    <>
                                                                        <span className={`block truncate ${selected ? 'font-bold' : 'font-medium'}`}>
                                                                            {r.name || `Lote #${r.id}`} {r.status.includes('En maquina') ? '(Actual)' : ''}
                                                                        </span>
                                                                        {selected ? (
                                                                            <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-brand-cyan">
                                                                                <Check size={12} strokeWidth={3} />
                                                                            </span>
                                                                        ) : null}
                                                                    </>
                                                                )}
                                                            </Listbox.Option>
                                                        ))}
                                                    </>
                                                )}

                                                {/* SECTION: MESA DE ARMADO */}
                                                {pendingRolls.length > 0 && (
                                                    <>
                                                        <div className={`px-3 py-1.5 text-[10px] font-bold text-zinc-400 bg-zinc-50 uppercase sticky top-0 z-[61] ${machine.rolls.length > 0 ? 'mt-1 border-t border-zinc-100' : ''}`}>Mesa de Armado</div>
                                                        {pendingRolls.map((r) => (
                                                            <Listbox.Option
                                                                key={r.id}
                                                                className={({ active }) =>
                                                                    `relative cursor-pointer select-none py-1.5 pl-8 pr-4 ${
                                                                        active ? 'bg-brand-cyan/10 text-brand-cyan font-bold' : 'text-zinc-700 font-medium'
                                                                    }`
                                                                }
                                                                value={r.id}
                                                            >
                                                                {({ selected }) => (
                                                                    <>
                                                                        <span className={`block truncate ${selected ? 'font-bold' : 'font-medium'}`}>
                                                                            {r.name || `Lote #${r.id}`}
                                                                        </span>
                                                                        {selected ? (
                                                                            <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-brand-cyan">
                                                                                <Check size={12} strokeWidth={3} />
                                                                            </span>
                                                                        ) : null}
                                                                    </>
                                                                )}
                                                            </Listbox.Option>
                                                        ))}
                                                    </>
                                                )}
                                                
                                                {machine.rolls.length === 0 && pendingRolls.length === 0 && (
                                                     <div className="px-4 py-3 text-xs text-zinc-400 italic text-center">No hay lotes disponibles</div>
                                                )}
                                            </Listbox.Options>
                                        </Transition>
                                    </div>
                                </Listbox>
                            );
                        })()}
                    </div>

                    {/* Botón EJECT / Desmontar */}
                    {selectedRollId && !isRunning && (
                        <Tippy content="Quitar Lote">
                            <button
                                onClick={() => {
                                    onUnassign(selectedRollId, () => {
                                        setRemovingRollId(String(selectedRollId));
                                    });
                                }}
                                className="w-8 h-[29px] rounded bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20 hover:bg-brand-magenta/20 flex items-center justify-center transition-all shadow-sm"
                            >
                                <Unlink size={13} />
                            </button>
                        </Tippy>
                    )}
                </div>

            </div>

            {/* TABLA / LISTA DE ROLLOS (VISIBLE) */}
            <Droppable droppableId={String(machine.id)} isDropDisabled={(machine.status || '').toLowerCase().includes('falla')}>
                {(provided, snapshot) => (
                    <div 
                        ref={provided.innerRef} 
                        {...provided.droppableProps}
                        className={`p-0 flex-1 flex flex-col -space-y-px overflow-y-auto custom-scrollbar transition-colors ${snapshot.isDraggingOver ? 'bg-brand-cyan/5 rounded-b-xl' : 'bg-zinc-50/50'}`}
                    >
                        {machine.rolls.map((roll, index) => (
                            <Draggable key={roll.id} draggableId={String(roll.id)} index={index}>
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={`w-full ${String(removingRollId) === String(roll.id) ? 'opacity-0 transition-opacity duration-300 ease-out' : ''}`}
                                        style={{
                                            ...provided.draggableProps.style,
                                            opacity: snapshot.isDragging ? 0.8 : 1
                                        }}
                                    >
                                        <RollCard
                                            roll={roll}
                                            index={index}
                                            isMachineView={true}
                                            machineName={machine.name}
                                            isSelected={String(roll.id) === String(selectedRollId)}
                                            onViewDetails={(r) => onViewDetails(r, machine)} // Pass machine context if needed
                                        />
                                    </div>
                                )}
                            </Draggable>
                        ))}
                        {machine.rolls.length === 0 && (() => {
                            const isFalla = (machine.status || '').toLowerCase().includes('falla');
                            return isFalla ? (
                                <div className="h-32 m-3 border-2 border-dashed border-brand-magenta/20 rounded-xl flex flex-col items-center justify-center gap-2 bg-brand-magenta/5">
                                    <PrinterX size={24} className="text-brand-magenta opacity-40" />
                                    <span className="text-xs font-black text-brand-magenta/60 uppercase tracking-wide">{machine.name}</span>
                                    <span className="text-[10px] font-bold text-brand-magenta">No Disponible</span>
                                </div>
                            ) : (
                                <div className={`h-32 m-3 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-colors ${snapshot.isDraggingOver ? 'border-brand-cyan/50 text-brand-cyan bg-brand-cyan/10' : 'border-zinc-200 text-zinc-300'}`}>
                                    <Printer size={28} className={snapshot.isDraggingOver ? 'opacity-50' : 'opacity-20'} />
                                    <span className="text-xs font-medium">{snapshot.isDraggingOver ? 'Soltar para Asignar' : 'Disponible para Asignar'}</span>
                                </div>
                            );
                        })()}
                        {provided.placeholder}
                    </div>
                )}
            </Droppable>

            {/* MODAL DECISION FINALIZAR */}
            {showFinishModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-900/60 px-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-zinc-200/50">
                        <div className="px-6 pt-8 pb-5 flex flex-col items-center gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-cyan/20 to-brand-cyan/5 flex items-center justify-center text-brand-cyan shadow-inner ring-1 ring-brand-cyan/20">
                                <FlagTriangleRight size={26} className="ml-1" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-xl font-black text-zinc-800 tracking-tight mb-1">Finalizar Producción</h3>
                                <p className="text-sm text-zinc-500 font-medium leading-tight">
                                    ¿El lote ha terminado completamente o debe continuar en otro equipo?
                                </p>
                            </div>
                        </div>
                        <div className="px-6 pb-6 bg-white">
                            <div className="flex flex-col gap-2.5">
                                {/* OPCIÓN: FINALIZAR Y ENVIAR A CALIDAD */}
                                <button
                                    onClick={() => confirmFinish('quality')}
                                    className="group relative w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-500/20 active:scale-[0.98] overflow-hidden"
                                >
                                    <i className="fa-solid fa-clipboard-check relative z-10"></i>
                                    <span className="relative z-10">Enviar a Calidad</span>
                                </button>

                                {/* OPCIÓN: SEGUIR EN PROD */}
                                <button
                                    onClick={() => confirmFinish('production')}
                                    className="w-full py-3 px-4 bg-white border-2 border-zinc-200 hover:border-brand-cyan/50 text-zinc-700 hover:text-brand-cyan hover:bg-brand-cyan/5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                                >
                                    <i className="fa-solid fa-arrow-rotate-right"></i>
                                    Mantener en Producción
                                </button>

                                <button
                                    onClick={() => setShowFinishModal(false)}
                                    className="w-full py-2.5 px-4 text-zinc-400 font-bold hover:text-zinc-700 hover:bg-zinc-100 rounded-xl transition-all mt-1"
                                >
                                    Cancelar
                                </button>
                            </div>

                            {/* ALERT DE INVENTARIO */}
                            {activeRoll?.BobinaID && (
                                <div className="mt-5 p-3 bg-brand-gold/10 border border-brand-gold/20 rounded-xl flex gap-3 items-start">
                                    <i className="fa-solid fa-triangle-exclamation text-brand-gold mt-0.5"></i>
                                    <p className="text-xs text-brand-gold font-medium leading-snug">
                                        Este lote usa la Bobina <span className="font-bold">#{activeRoll.BobinaID}</span>. Si se agotó, recuerde cerrarla en el inventario.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MachineControl;


