import React, { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { rollsService } from '../../services/api';
import CreateRollModal from '../modals/CreateRollModal';
import styles from './RollsKanban.module.css';

// Helper Fecha seguro
const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
        return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    } catch (e) { return '-'; }
};

// Componente MultiSelect Materiales
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
        <div className={styles.multiSelectWrapper} ref={wrapperRef}>
            <button className={styles.multiSelectBtn} onClick={() => setIsOpen(!isOpen)}>
                <span>Materiales</span>
                {selected.length > 0 && <span className={styles.badgeCount} style={{marginLeft:5, background:'#2563eb', color:'white', fontSize:'0.6rem', padding:'1px 5px', borderRadius:10}}>{selected.length}</span>}
                <i className={`fa-solid fa-chevron-${isOpen ? 'up' : 'down'}`} style={{fontSize:'0.6rem', marginLeft:'8px'}}></i>
            </button>
            {isOpen && (
                <div className={styles.dropdownMenu}>
                    <label className={styles.dropdownItem} style={{fontWeight:'bold', color:'#2563eb'}}>
                        <input type="checkbox" checked={isAllSelected} onChange={handleSelectAll} />
                        <span>{isAllSelected ? 'Deseleccionar Todos' : 'Seleccionar Todos'}</span>
                    </label>
                    <div style={{height:1, background:'#e2e8f0', margin:'4px 0'}}></div>
                    {options.map(opt => (
                        <label key={opt} className={styles.dropdownItem}>
                            <input type="checkbox" checked={selected.includes(opt)} onChange={() => handleToggle(opt)} />
                            <span>{opt}</span>
                        </label>
                    ))}
                    {options.length === 0 && <div style={{padding:10, fontSize:'0.7rem'}}>Cargando materiales...</div>}
                </div>
            )}
        </div>
    );
};

const RollsKanban = ({ areaCode }) => {
    const [rolls, setRolls] = useState([]);     
    const [pending, setPending] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    // Filtros
    const [selectedIds, setSelectedIds] = useState([]);
    const [filterPrio, setFilterPrio] = useState('ALL');
    const [filterVar, setFilterVar] = useState('ALL');
    const [filterMat, setFilterMat] = useState([]);

    const loadBoard = async () => {
        try {
            setLoading(true);
            const data = await rollsService.getBoard(areaCode);
            setRolls(data.rolls || []);
            setPending(data.pendingOrders || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadBoard(); }, [areaCode]);

    // OBTENCIÓN SEGURA DE DATOS
    const getMaterial = (o) => o.material || o.Material || 'Sin Material';
    const getVariant = (o) => o.variantCode || o.Variante || '';
    const getPriority = (o) => o.priority || o.Prioridad || 'Normal';

    const uniquePriorities = [...new Set(pending.map(o => getPriority(o)))];
    const uniqueVariants = [...new Set(pending.map(o => getVariant(o)).filter(Boolean))];
    const uniqueMaterials = [...new Set(pending.map(o => getMaterial(o)))].sort();

    // FILTRADO
    const filteredPending = pending.filter(o => {
        if (filterPrio !== 'ALL' && getPriority(o) !== filterPrio) return false;
        if (filterVar !== 'ALL' && getVariant(o) !== filterVar) return false;
        if (filterMat.length > 0 && !filterMat.includes(getMaterial(o))) return false;
        return true;
    });

    // SELECCIÓN
    const toggleOrderSelection = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === filteredPending.length && filteredPending.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredPending.map(o => o.id));
        }
    };

    // DRAG AND DROP
    const onDragEnd = async (result) => {
        const { source, destination, draggableId } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId) return;

        const targetRollId = destination.droppableId === 'pending' ? null : destination.droppableId;
        const draggedIdInt = parseInt(draggableId);

        // Bloqueo
        if (targetRollId) {
            const targetRoll = rolls.find(r => r.id === targetRollId);
            if (targetRoll && (targetRoll.machineId || targetRoll.status === 'Producción' || targetRoll.status === 'Cerrado')) {
                return alert("⛔ Lote bloqueado.");
            }
        }

        // Selección múltiple
        let idsToMove = [];
        if (selectedIds.includes(draggedIdInt)) idsToMove = [...selectedIds];
        else idsToMove = [draggedIdInt];

        // Optimistic UI
        const ordersToMove = [];
        const newPending = pending.filter(o => {
            if (idsToMove.includes(o.id)) {
                ordersToMove.push(o);
                return false;
            }
            return true;
        });

        const newRolls = rolls.map(r => {
            const ordersInRoll = r.orders.filter(o => idsToMove.includes(o.id));
            if (ordersInRoll.length > 0) {
                ordersToMove.push(...ordersInRoll);
                const reduction = ordersInRoll.reduce((sum, o) => sum + (parseFloat(o.magnitude || o.Magnitud) || 0), 0);
                return { ...r, orders: r.orders.filter(o => !idsToMove.includes(o.id)), currentUsage: Math.max(0, r.currentUsage - reduction) };
            }
            return r;
        });

        if (targetRollId === null) {
            setPending([...ordersToMove, ...newPending]);
            setRolls(newRolls);
        } else {
            setPending(newPending);
            setRolls(newRolls.map(r => {
                if (r.id === targetRollId) {
                    const increase = ordersToMove.reduce((sum, o) => sum + (parseFloat(o.magnitude || o.Magnitud) || 0), 0);
                    return { ...r, orders: [...r.orders, ...ordersToMove], currentUsage: r.currentUsage + increase };
                }
                return r;
            }));
        }

        setSelectedIds([]);

        try {
            await rollsService.moveOrder(idsToMove, targetRollId); 
        } catch (error) {
            console.error(error);
            loadBoard();
        }
    };

    if (loading) return <div style={{padding:40, textAlign:'center'}}>Cargando...</div>;

    return (
        <div className={styles.kanbanContainer}>
            
            <div className={styles.toolbar}>
                <div className={styles.filterGroup}>
                    <span className={styles.filterLabel}>Prioridad:</span>
                    <div className={styles.buttonGroup}>
                        <button className={`${styles.filterBtn} ${filterPrio === 'ALL' ? styles.filterBtnActive : ''}`} onClick={() => setFilterPrio('ALL')}>Todas</button>
                        {uniquePriorities.map(p => (
                            <button key={p} className={`${styles.filterBtn} ${filterPrio === p ? styles.filterBtnActive : ''}`} onClick={() => setFilterPrio(p)}>{p}</button>
                        ))}
                    </div>
                </div>
                <div className={styles.divider}></div>
                <div className={styles.filterGroup}>
                    <span className={styles.filterLabel}>Variante:</span>
                    <div className={styles.buttonGroup}>
                        <button className={`${styles.filterBtn} ${filterVar === 'ALL' ? styles.filterBtnActive : ''}`} onClick={() => setFilterVar('ALL')}>Todas</button>
                        {uniqueVariants.slice(0, 6).map(v => (
                            <button key={v} className={`${styles.filterBtn} ${filterVar === v ? styles.filterBtnActive : ''}`} onClick={() => setFilterVar(v)}>{v}</button>
                        ))}
                    </div>
                </div>
                <div className={styles.divider}></div>
                <div className={styles.filterGroup}>
                    <span className={styles.filterLabel}>Material:</span>
                    <MaterialMultiSelect options={uniqueMaterials} selected={filterMat} onChange={setFilterMat} />
                </div>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className={styles.board}>
                    
                    {/* COLUMNA PENDIENTES */}
                    <div className={styles.column} style={{ borderTop: '4px solid #f59e0b', background: '#fff' }}>
                        <div className={styles.columnHeader}>
                            <div className={styles.headerCheckbox}>
                                <input 
                                    type="checkbox" 
                                    checked={filteredPending.length > 0 && selectedIds.length === filteredPending.length}
                                    onChange={toggleSelectAll}
                                />
                            </div>
                            <div className={styles.columnTitle}>
                                PENDIENTES
                                <span className={styles.columnCount}>{filteredPending.length}</span>
                            </div>
                        </div>
                        
                        <Droppable droppableId="pending">
                            {(provided) => (
                                <div className={styles.droppableArea} ref={provided.innerRef} {...provided.droppableProps}>
                                    {filteredPending.map((order, index) => (
                                        <KanbanCard 
                                            key={order.id} 
                                            order={order} 
                                            index={index} 
                                            isSelected={selectedIds.includes(order.id)}
                                            onToggle={() => toggleOrderSelection(order.id)}
                                        />
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>

                    {/* ROLLOS */}
                    {rolls.map(roll => {
                        const percent = roll.capacity > 0 ? Math.min((roll.currentUsage / roll.capacity) * 100, 100) : 0;
                        const isLocked = !!roll.machineId || roll.status === 'Producción' || roll.status === 'Cerrado';
                        return (
                            <div key={roll.id} className={styles.column} style={{ borderTop: `4px solid ${roll.color || '#6366f1'}` }}>
                                <div className={styles.columnHeader} style={{display:'block'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:5}}>
                                        <div className={styles.columnTitle} style={{color: roll.color}}>
                                            {isLocked && <i className="fa-solid fa-lock"></i>} {roll.name}
                                        </div>
                                        <span className={styles.columnCount}>{roll.orders.length}</span>
                                    </div>
                                    <div style={{width:'100%', height:'4px', background:'#e2e8f0', borderRadius:'2px', overflow:'hidden'}}>
                                        <div style={{width: `${percent}%`, background: roll.color || '#6366f1', height:'100%'}}></div>
                                    </div>
                                    <div style={{fontSize:'0.65rem', textAlign:'right', color:'#64748b', marginTop:2}}>{roll.currentUsage?.toFixed(1)} / {roll.capacity}m</div>
                                </div>
                                <Droppable droppableId={roll.id} isDropDisabled={isLocked}>
                                    {(provided) => (
                                        <div className={styles.droppableArea} ref={provided.innerRef} {...provided.droppableProps} style={{opacity: isLocked ? 0.7 : 1}}>
                                            {roll.orders.map((order, index) => (
                                                <KanbanCard key={order.id} order={order} index={index} isSelected={false} onToggle={() => {}} isReadOnly={true} />
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        );
                    })}

                    <button className={styles.addRollBtn} onClick={() => setIsCreateOpen(true)}>
                        <div className={styles.addIconCircle}><i className="fa-solid fa-plus"></i></div><span>Nuevo Lote</span>
                    </button>
                </div>
            </DragDropContext>

            <CreateRollModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} areaCode={areaCode} onSuccess={loadBoard} />
        </div>
    );
};

// --- TARJETA CORREGIDA: AHORA SÍ MUESTRA LA MEDIDA ---
const KanbanCard = ({ order, index, isSelected, onToggle, isReadOnly }) => {
    // 1. Extracción segura de datos (Soporta nombres de backend y frontend)
    const code = order.code || order.CodigoOrden || `#${order.id}`;
    const date = formatDate(order.entryDate || order.FechaIngreso);
    const client = order.client || order.Cliente;
    const desc = order.desc || order.DescripcionTrabajo;
    const material = order.material || order.Material;
    const variant = order.variantCode || order.Variante;
    
    // 2. CORRECCIÓN MEDIDA: Buscamos en todas las propiedades posibles
    const magnitude = order.magnitudeStr || order.Magnitud || order.magnitude;
    const priority = order.priority || order.Prioridad || 'Normal';

    return (
        <Draggable draggableId={String(order.id)} index={index}>
            {(provided, snapshot) => (
                <div
                    className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={{
                        ...provided.draggableProps.style,
                        opacity: snapshot.isDragging ? 0.9 : 1,
                        borderLeftColor: priority === 'Urgente' ? '#dc2626' : '#94a3b8'
                    }}
                    onClick={(e) => { if (!isReadOnly && !e.defaultPrevented) onToggle(); }}
                >
                    {!isReadOnly && (
                        <div className={styles.cardCheckbox} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={isSelected} onChange={onToggle} />
                        </div>
                    )}

                    {/* CABECERA: Código y Fecha */}
                    <div className={styles.cardTop}>
                        <span className={styles.cardCode}>{code}</span>
                        <span className={styles.cardDate}><i className="fa-regular fa-calendar"></i> {date}</span>
                    </div>

                    {/* CUERPO: Info Cliente vs Técnica */}
                    <div className={styles.cardBody}>
                        <div className={styles.cardMain}>
                            <div className={styles.cardClient} title={client}>{client}</div>
                            <div className={styles.cardJob} title={desc}>{desc}</div>
                        </div>
                        <div className={styles.cardMeta}>
                            <span className={`${styles.badgePrio} ${priority === 'Urgente' ? styles.prioUrgente : styles.prioNormal}`}>
                                {priority}
                            </span>
                            
                            {variant && (
                                <span className={styles.metaItem} title="Variante">
                                    {variant}
                                </span>
                            )}
                            
                            {/* AQUÍ MOSTRAMOS LA MEDIDA CON ICONO DE REGLA */}
                            {magnitude && (
                                <span className={styles.metaItem} title="Medida" style={{color:'#0f172a', fontWeight:'bold'}}>
                                    <i className="fa-solid fa-ruler-horizontal" style={{marginRight:4, fontSize:'0.6rem', color:'#94a3b8'}}></i>
                                    {magnitude}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* PIE: Material */}
                    <div className={styles.cardBottom}>
                        <span className={styles.materialText} title={material}>{material || 'Sin Material'}</span>
                    </div>
                </div>
            )}
        </Draggable>
    );
};

export default RollsKanban;