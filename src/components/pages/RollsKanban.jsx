import React, { useState, useEffect, useRef } from 'react';
import Swal from 'sweetalert2';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { rollsService } from '../../services/api';
import { socket as socketService } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import CreateRollModal from '../modals/CreateRollModal';
import KanbanCard from '../production/components/KanbanCard';
import RollDetailsModal from '../modals/RollDetailsModal';

// Helper Fecha seguro
const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
        const d = new Date(dateString);
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    } catch (e) { return '-'; }
};



// --- MULTISELECT MATERIALES (TAILWIND) ---
const MaterialMultiSelect = ({ options, selected, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const handleToggle = (value) => {
        if (selected.includes(value)) onChange(selected.filter(item => item !== value));
        else onChange([...selected, value]);
    };

    const handleSelectAll = () => {
        if (selected.length === options.length) onChange([]);
        else onChange(options);
    };

    const isAllSelected = options.length > 0 && selected.length === options.length;

    return (
        <div className="relative" ref={wrapperRef}>
            <button
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all shadow-sm
                    ${selected.length > 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span>MATERIALES</span>
                {selected.length > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] px-1.5 rounded-full">{selected.length}</span>
                )}
                <i className={`fa-solid fa-chevron-${isOpen ? 'up' : 'down'} text-[10px] ml-1 opacity-50`}></i>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 max-h-80 bg-white border border-slate-200 rounded-lg shadow-xl overflow-y-auto z-50 p-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <label className="flex items-center gap-2 px-2 py-2 text-xs font-bold text-blue-600 cursor-pointer hover:bg-blue-50 rounded mb-1">
                        <input type="checkbox" checked={isAllSelected} onChange={handleSelectAll} className="rounded text-blue-600 focus:ring-blue-500 border-slate-300" />
                        <span>{isAllSelected ? 'Deseleccionar Todos' : 'Seleccionar Todos'}</span>
                    </label>
                    <div className="h-px bg-slate-100 my-1"></div>
                    {options.map(opt => (
                        <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 rounded">
                            <input type="checkbox" checked={selected.includes(opt)} onChange={() => handleToggle(opt)} className="rounded text-blue-600 focus:ring-blue-500 border-slate-300" />
                            <span className="truncate" title={opt}>{opt}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- COMPONENTE PRINCIPAL ---
const RollsKanban = ({ areaCode }) => {
    const [rolls, setRolls] = useState([]);
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    // ESTADOS NUEVOS PARA EDICIÓN Y DETALLE
    const [editingRollId, setEditingRollId] = useState(null);
    const [tempName, setTempName] = useState("");
    const [detailsRoll, setDetailsRoll] = useState(null);

    // Filtros
    const [selectedIds, setSelectedIds] = useState([]);
    const [filterPrio, setFilterPrio] = useState('ALL');
    const [filterVar, setFilterVar] = useState('ALL');
    const [filterMat, setFilterMat] = useState([]);
    const [filterType, setFilterType] = useState('ALL');

    const loadBoard = async () => {
        try {
            // setLoading(true); // Don't block UI on background refresh if desired, or keep it.
            // Keeping loading usually good for feedback, but for socket update maybe silent?
            // Let's keep it simple and reuse existing logic
            // Check if we are already loading to avoid loops? No, loadBoard sets it.
            setLoading(true);
            const data = await rollsService.getBoard(areaCode);

            const sortedRolls = (data.rolls || []).map(r => ({
                ...r,
                orders: r.orders.sort((a, b) => {
                    const seqA = a.sequence === null ? 999999 : a.sequence;
                    const seqB = b.sequence === null ? 999999 : b.sequence;
                    return seqA - seqB;
                })
            }));

            setRolls(sortedRolls);
            setPending(data.pendingOrders || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadBoard(); }, [areaCode]);

    // SOCKET SYNC LISTENER — recargaba el kanban entero con CADA server:ordersUpdated. Freno de 8 s y
    // pausa con la pestaña oculta, ver hooks/useRecargaConFreno (24/09).
    const avisarRecarga = useRecargaConFreno(loadBoard);
    useEffect(() => {
        socketService.on('server:ordersUpdated', avisarRecarga);
        return () => socketService.off('server:ordersUpdated', avisarRecarga);
    }, [avisarRecarga]);


    // LÓGICA DE EDICIÓN DE NOMBRE
    const startEditing = (roll) => {
        setEditingRollId(roll.id);
        setTempName(roll.name);
    };

    const saveRollName = async (rollId) => {
        if (!tempName.trim()) {
            setEditingRollId(null);
            return;
        }

        // Actualización Optimista
        const updatedRolls = rolls.map(r => r.id === rollId ? { ...r, name: tempName } : r);
        setRolls(updatedRolls);
        setEditingRollId(null);

        try {
            await rollsService.updateName(rollId, tempName);
        } catch (error) {
            console.error("Error actualizando nombre:", error);
            loadBoard(); // Revertir si falla
            if (error.response?.status === 409) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Nombre en uso',
                    text: error.response.data?.error || 'Ya existe un lote abierto con ese nombre en esta área.',
                    confirmButtonColor: '#006E97'
                });
            }
        }
    };

    const handleKeyDown = (e, rollId) => {
        if (e.key === 'Enter') saveRollName(rollId);
        if (e.key === 'Escape') setEditingRollId(null);
    };

    // ACCIÓN: DESARMAR ROLLO
    const handleDismantle = async (roll) => {
        if (!window.confirm(`¿Estás seguro de devolver TODO el lote "${roll.name}" a Pendientes?\n\nEl lote se eliminará y las órdenes volverán a la columna de pendientes. Si alguna estaba marcada como impresa, se le borra la marca.`)) return;

        try {
            setLoading(true);
            await rollsService.dismantle(roll.id);
            await loadBoard();
        } catch (error) {
            console.error("Error desarmando lote:", error);
            alert("No se pudo desarmar el lote.");
            setLoading(false);
        }
    };

    // Helpers de Datos
    const getMaterial = (o) => o.material || o.Material || 'Sin Material';
    const getVariant = (o) => o.variantCode || o.Variante || '';
    const getPriority = (o) => o.priority || o.Prioridad || 'Normal';
    const getType = (o) => o.tipoOrden || o.TipoOrden || 'Ordinaria';

    const uniquePriorities = [...new Set(pending.map(o => getPriority(o)))];
    const uniqueVariants = [...new Set(pending.map(o => getVariant(o)).filter(Boolean))];
    const uniqueMaterials = [...new Set(pending.map(o => getMaterial(o)))].sort();

    // FILTRADO
    const filteredPending = pending.filter(o => {
        if (filterPrio !== 'ALL' && getPriority(o) !== filterPrio) return false;
        if (filterVar !== 'ALL' && getVariant(o) !== filterVar) return false;
        if (filterType !== 'ALL' && getType(o) !== filterType) return false;
        if (filterMat.length > 0 && !filterMat.includes(getMaterial(o))) return false;
        return true;
    });

    const toggleOrderSelection = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === filteredPending.length && filteredPending.length > 0) setSelectedIds([]);
        else setSelectedIds(filteredPending.map(o => o.id));
    };

    // --- LÓGICA DRAG AND DROP ---
    const onDragEnd = async (result) => {
        const { source, destination, draggableId } = result;

        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        const newRolls = rolls.map(r => ({ ...r, orders: [...r.orders] }));
        const newPending = [...pending];

        // CASO 1: VIENE DE PENDIENTES
        if (source.droppableId === 'pending') {
            const destRollIndex = newRolls.findIndex(r => String(r.id) === String(destination.droppableId));
            if (destRollIndex === -1) return;

            const movedOrderIndex = newPending.findIndex(o => String(o.id) === String(draggableId));
            if (movedOrderIndex === -1) return;

            const [movedOrder] = newPending.splice(movedOrderIndex, 1);
            const destRoll = newRolls[destRollIndex];
            movedOrder.rollId = destRoll.id;

            destRoll.orders.splice(destination.index, 0, movedOrder);
            destRoll.currentUsage += (movedOrder.magnitude || 0);

            setPending(newPending);
            setRolls(newRolls);

            try {
                await rollsService.moveOrder({
                    orderId: movedOrder.id,
                    targetRollId: destRoll.id
                });
                const destIds = destRoll.orders.map(o => o.id);
                await rollsService.reorderOrders(destRoll.id, destIds);
            } catch (error) { console.error(error); }
            return;
        }

        // CASO 2: ENTRE ROLLOS
        const sourceRollIndex = newRolls.findIndex(r => String(r.id) === String(source.droppableId));
        const destRollIndex = newRolls.findIndex(r => String(r.id) === String(destination.droppableId));

        if (sourceRollIndex === -1) return;

        const sourceRoll = newRolls[sourceRollIndex];
        const [movedOrder] = sourceRoll.orders.splice(source.index, 1);

        if (sourceRollIndex === destRollIndex) {
            sourceRoll.orders.splice(destination.index, 0, movedOrder);
            setRolls(newRolls);
            try {
                const orderIds = sourceRoll.orders.map(o => o.id);
                await rollsService.reorderOrders(sourceRoll.id, orderIds);
            } catch (e) { console.error(e); }
        } else {
            if (destRollIndex === -1) return;
            const destRoll = newRolls[destRollIndex];
            movedOrder.rollId = destRoll.id;
            destRoll.orders.splice(destination.index, 0, movedOrder);

            sourceRoll.currentUsage -= (movedOrder.magnitude || 0);
            destRoll.currentUsage += (movedOrder.magnitude || 0);

            setRolls(newRolls);
            try {
                await rollsService.moveOrder({
                    orderId: movedOrder.id,
                    targetRollId: destRoll.id
                });
                const destIds = destRoll.orders.map(o => o.id);
                await rollsService.reorderOrders(destRoll.id, destIds);
            } catch (e) { console.error(e); }
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-full bg-slate-50">
            <div className="flex flex-col items-center gap-3">
                <i className="fa-solid fa-circle-notch fa-spin text-4xl text-blue-500"></i>
                <p className="font-bold text-slate-400">Cargando Planeamiento...</p>
            </div>
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* TOOLBAR */}
            <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap gap-4 items-center shrink-0 shadow-sm z-20">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase text-slate-400">Prioridad:</span>
                    <div className="flex gap-1">
                        <button className={`px-2 py-1 rounded text-[10px] font-bold border ${filterPrio === 'ALL' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`} onClick={() => setFilterPrio('ALL')}>TODAS</button>
                        {uniquePriorities.map(p => (
                            <button key={p} className={`px-2 py-1 rounded text-[10px] font-bold border ${filterPrio === p ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`} onClick={() => setFilterPrio(p)}>{p.toUpperCase()}</button>
                        ))}
                    </div>
                </div>

                <div className="w-px h-6 bg-slate-200"></div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase text-slate-400">Tipo:</span>
                    <div className="flex gap-1">
                        <button className={`px-2 py-1 rounded text-[10px] font-bold border ${filterType === 'ALL' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`} onClick={() => setFilterType('ALL')}>TODAS</button>
                        <button className={`px-2 py-1 rounded text-[10px] font-bold border ${filterType === 'Falla' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-red-500 border-slate-200'}`} onClick={() => setFilterType('Falla')}>FALLAS</button>
                    </div>
                </div>

                <div className="w-px h-6 bg-slate-200"></div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase text-slate-400">Variante:</span>
                    <div className="flex gap-1">
                        <button className={`px-2 py-1 rounded text-[10px] font-bold border ${filterVar === 'ALL' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`} onClick={() => setFilterVar('ALL')}>TODAS</button>
                        {uniqueVariants.slice(0, 4).map(v => (
                            <button key={v} className={`px-2 py-1 rounded text-[10px] font-bold border ${filterVar === v ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`} onClick={() => setFilterVar(v)}>{v}</button>
                        ))}
                    </div>
                </div>

                <div className="w-px h-6 bg-slate-200"></div>

                <MaterialMultiSelect options={uniqueMaterials} selected={filterMat} onChange={setFilterMat} />
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className="flex gap-4 overflow-x-auto p-6 h-full items-start bg-slate-50/50">

                    {/* COLUMNA PENDIENTES */}
                    <div className="w-80 min-w-[320px] flex flex-col max-h-full bg-white rounded-xl shadow-sm border border-amber-200 border-t-4 border-t-amber-400">
                        <div className="p-3 border-b border-amber-50 bg-amber-50/30 rounded-t-xl shrink-0 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    checked={filteredPending.length > 0 && selectedIds.length === filteredPending.length}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 border-slate-300 cursor-pointer"
                                />
                                <div className="font-black text-slate-700 text-sm flex items-center gap-2">
                                    PENDIENTES <span className="text-[10px] bg-amber-100 text-amber-700 px-2 rounded-full">{filteredPending.length}</span>
                                </div>
                            </div>
                        </div>
                        <Droppable droppableId="pending">
                            {(provided) => (
                                <div
                                    className="p-3 flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30"
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                >
                                    {filteredPending.map((order, index) => (
                                        <KanbanCard key={order.id} order={order} index={index} isSelected={selectedIds.includes(order.id)} onToggle={() => toggleOrderSelection(order.id)} />
                                    ))}
                                    {provided.placeholder}
                                    {filteredPending.length === 0 && (
                                        <div className="py-10 text-center text-slate-300 italic text-xs">Sin órdenes pendientes</div>
                                    )}
                                </div>
                            )}
                        </Droppable>
                    </div>

                    {/* COLUMNAS DE ROLLOS */}
                    {rolls.map(roll => {
                        const percent = roll.capacity > 0 ? Math.min((roll.currentUsage / roll.capacity) * 100, 100) : 0;
                        const isLocked = !!roll.machineId || roll.status === 'Producción' || roll.status === 'Cerrado';
                        const isEditing = editingRollId === roll.id;

                        // Color handling
                        const rollColor = roll.color || '#6366f1';

                        return (
                            <div key={roll.id} className="w-80 min-w-[320px] flex flex-col max-h-full bg-slate-100 rounded-xl shadow-sm border border-slate-200 border-t-4" style={{ borderTopColor: rollColor }}>
                                <div className="p-3 bg-white border-b border-slate-200 rounded-t-xl shrink-0">
                                    <div className="flex justify-between items-start mb-2">

                                        {/* EDICIÓN DE NOMBRE */}
                                        <div className="flex-1 font-bold text-sm text-slate-800 flex items-center gap-2 mr-2">
                                            {isLocked && <i className="fa-solid fa-lock text-slate-300 text-xs"></i>}

                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    value={tempName}
                                                    onChange={(e) => setTempName(e.target.value)}
                                                    onBlur={() => saveRollName(roll.id)}
                                                    onKeyDown={(e) => handleKeyDown(e, roll.id)}
                                                    className="w-full px-2 py-1 text-sm border-2 border-blue-500 rounded focus:outline-none"
                                                />
                                            ) : (
                                                <span
                                                    // PERMITIMOS EDITAR SIEMPRE (incluso si está bloqueado/isLocked)
                                                    // Se retira la restricción !isLocked
                                                    onClick={() => startEditing(roll)}
                                                    title="Clic para editar nombre"
                                                    className="truncate cursor-pointer hover:text-blue-600 transition-colors"
                                                    style={{ color: rollColor }}
                                                >
                                                    {roll.name}
                                                    <i className="fa-solid fa-pencil text-[10px] ml-1 opacity-20 hover:opacity-100"></i>
                                                </span>
                                            )}
                                        </div>

                                        {/* BOTONES DE ACCIÓN */}
                                        <div className="flex items-center gap-1">

                                            {/* BOTÓN DESARMAR (Solo si no está bloqueado) */}
                                            {!isLocked && (
                                                <button
                                                    className="w-6 h-6 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                    title="Devolver todo a Pendientes"
                                                    onClick={() => handleDismantle(roll)}
                                                >
                                                    <i className="fa-solid fa-trash-arrow-up text-xs"></i>
                                                </button>
                                            )}

                                            <button
                                                className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-blue-500 hover:bg-slate-50 transition-colors"
                                                title="Ver detalle"
                                                onClick={() => setDetailsRoll(roll)}
                                            >
                                                <i className="fa-regular fa-eye"></i>
                                            </button>
                                            <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200">{roll.orders.length}</span>
                                        </div>

                                    </div>

                                    {/* Progress Bar */}
                                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${percent}%`, background: rollColor }}
                                        ></div>
                                    </div>
                                    <div className="text-[10px] text-right text-slate-400 font-mono">
                                        <span className="font-bold text-slate-600">{roll.currentUsage?.toFixed(1)}</span> / {roll.capacity}m
                                    </div>
                                </div>

                                <Droppable droppableId={String(roll.id)} isDropDisabled={isLocked}>
                                    {(provided) => (
                                        <div
                                            className={`p-2 flex-1 overflow-y-auto custom-scrollbar transition-opacity ${isLocked ? 'opacity-60 grayscale' : ''}`}
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                        >
                                            {roll.orders.map((order, index) => (
                                                <KanbanCard key={order.id} order={order} index={index} isSelected={false} onToggle={() => { }} isReadOnly={isLocked} showSequence={true} />
                                            ))}
                                            {provided.placeholder}
                                            {roll.orders.length === 0 && (
                                                <div className="h-full flex flex-col items-center justify-center text-slate-300 py-10 gap-2 border-2 border-dashed border-slate-200 rounded-lg m-1">
                                                    <i className="fa-solid fa-box-open text-2xl opacity-50"></i>
                                                    <span className="text-xs">Lote vacío</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        );
                    })}

                    {/* BOTÓN NUEVO LOTE */}
                    <button
                        className="w-20 min-w-[80px] h-full rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all flex flex-col items-center justify-start py-10 gap-2 group shrink-0"
                        onClick={() => setIsCreateOpen(true)}
                    >
                        <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
                            <i className="fa-solid fa-plus text-lg"></i>
                        </div>
                        <span className="text-xs font-bold writing-vertical-lr rotate-180 uppercase tracking-widest">Nuevo Lote</span>
                    </button>
                </div>
            </DragDropContext>

            {/* MODALES */}
            <CreateRollModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} areaCode={areaCode} onSuccess={loadBoard} />

            {detailsRoll && (
                <RollDetailsModal roll={detailsRoll} onClose={() => setDetailsRoll(null)} />
            )}
        </div>
    );
};

export default RollsKanban;
