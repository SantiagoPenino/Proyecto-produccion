import React, { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { productionService, rollsService } from '../../services/api'; // Usamos tus servicios originales
import ActiveRollModal from '../modals/ActiveRollModal';
import RollDetailModal from '../modals/RollDetailModal'; // Nuevo modal para ver órdenes
import styles from './ProductionKanban.module.css'; // Usaremos este nuevo archivo CSS

// Formato de duración (Necesario para mostrar el tiempo transcurrido)
const formatDuration = (seconds) => {
    if (!seconds || seconds < 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// --- COMPONENTE DE LA TARJETA DEL ROLLO ---
const RollCard = ({ roll, index, isMachineView, onToggleStatus, onFinish, onManage, onReassign, onOpenDetail }) => {
    // Nota: Asumo que los rollos tienen propiedades como .rollCode, .totalMeters, .usage, .capacity
    const percent = Math.min((roll.usage / roll.capacity) * 100, 100);
    const isRunning = roll.status === 'Producción';
    const isPaused = roll.status === 'Pausado';
    const isEnCola = roll.status === 'En cola' || !roll.machineId;
    const isLocked = roll.status === 'Producción'; // Restricción de movimiento
    
    // Calcula el tiempo de producción (usaremos currentDuration si viene del backend)
    const timeDisplay = formatDuration(roll.currentDuration); 
    
    // Botón principal
    let primaryButton;
    if (isRunning) {
        primaryButton = <button className={styles.btnPause} onClick={(e) => {e.stopPropagation(); onToggleStatus(roll.id, roll.status)}} title="Pausar Impresión"><i className="fa-solid fa-pause"></i> Pausar</button>;
    } else if (isPaused || isEnCola) {
        primaryButton = <button className={styles.btnStart} onClick={(e) => {e.stopPropagation(); onToggleStatus(roll.id, roll.status)}} title="Iniciar Impresión"><i className="fa-solid fa-play"></i> Iniciar</button>;
    }

    // El drag sólo está habilitado si NO está imprimiendo
    return (
        <Draggable draggableId={String(roll.id)} index={index} isDragDisabled={isLocked}>
            {(provided, snapshot) => (
                <div
                    className={`${styles.rollCard} ${styles[roll.status.replace(/\s+/g, '')]} ${isLocked ? styles.lockedCard : ''}`}
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={{
                        ...provided.draggableProps.style,
                        opacity: snapshot.isDragging || isLocked ? 0.7 : 1,
                        cursor: isLocked ? 'not-allowed' : 'grab'
                    }}
                >
                    {/* INFO PRINCIPAL DEL ROLLO */}
                    <div className={styles.rollInfo}>
                        <span className={styles.rollCode} style={{color: roll.color}}>{roll.rollCode || roll.id}</span>
                        <span className={styles.statusBadge}>{roll.status}</span>
                    </div>

                    <div className={styles.detailsRow}>
                        <p className={styles.detailItem}>Metros: <strong>{roll.usage?.toFixed(1)} / {roll.capacity}m</strong></p>
                        <p className={styles.detailItem}>Órdenes: <strong>{roll.ordersCount || roll.rolls?.length || 0}</strong></p>
                        <p className={styles.detailItem}>Tiempo: <strong className={isRunning ? styles.timerActive : styles.timerPaused}>{timeDisplay}</strong></p>
                    </div>

                    {/* BARRA DE PROGRESO */}
                    <div className={styles.progressBarContainer}>
                         <div className={styles.progressBar} style={{width: `${percent}%`, background: roll.color}}></div>
                    </div>
                    
                    {/* CONTROLES (SOLO SI ESTÁ ASIGNADO) */}
                    {isMachineView && (
                        <div className={styles.rollControls}>
                            {primaryButton}
                            
                            <button 
                                className={styles.btnView} 
                                onClick={(e) => {e.stopPropagation(); onOpenDetail(roll)}}
                                title="Ver detalle de órdenes y material"
                            >
                                <i className="fa-solid fa-list-ul"></i> Detalle
                            </button>

                            <button 
                                className={styles.btnFinish} 
                                onClick={(e) => {e.stopPropagation(); onFinish(roll.id)}}
                                title="Finalizar e imprimir reporte"
                            >
                                <i className="fa-solid fa-stop"></i> Finalizar
                            </button>
                        </div>
                    )}
                </div>
            )}
        </Draggable>
    );
};


const ProductionKanban = ({ areaCode }) => {
    // Usamos el estado del código anterior para la compatibilidad
    const [machines, setMachines] = useState([]);
    const [pendingRolls, setPendingRolls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoll, setSelectedRoll] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    // --- LÓGICA DE CARGA Y SERVICIOS ---

    const loadBoard = async () => {
        try {
            // Nota: Aquí se usa tu productionService.getBoard original.
            const data = await productionService.getBoard(areaCode); 
            setMachines(data.machines || []);
            setPendingRolls(data.pendingRolls || []);
        } catch (error) { console.error(error); } 
        finally { setLoading(false); }
    };

    useEffect(() => {
        loadBoard();
        const interval = setInterval(loadBoard, 60000);
        return () => clearInterval(interval);
    }, [areaCode]);

    // Registro de Tiempos (Iniciar/Pausar)
    const handleToggleStatus = async (rollId, currentStatus) => {
        const action = currentStatus === 'Producción' ? 'stop' : 'start';
        // Optimistic UI update (opcional)
        // updateRollStatusVisual(rollId, action === 'start' ? 'Producción' : 'Pausado');
        try {
            await productionService.toggleStatus(rollId, action);
            loadBoard(); 
        } catch (e) {
            alert("Error al cambiar estado");
            loadBoard();
        }
    };

    // Finalizar (Cerrar Rollo)
    const handleCloseRoll = async (rollId) => {
        if (!window.confirm("¿Confirmar: Finalizar impresión y cerrar este lote definitivamente?")) return;
        try {
            await rollsService.closeRoll(rollId);
            loadBoard(); // Recargar todo el tablero
        } catch (e) { alert("Error al finalizar el lote."); }
    };

    // Modal de Detalle de Órdenes
    const handleOpenRollDetail = (roll) => {
        setSelectedRoll(roll);
        setShowDetailModal(true);
    };

    // --- DRAG & DROP (Asignación y Reasignación) ---
    const onDragEnd = async (result) => {
        const { source, destination, draggableId } = result;

        if (!destination) return;
        if (source.droppableId === destination.droppableId) return;

        const rollId = draggableId;
        // targetMachineId puede ser null (vuelve a pendientes) o el ID de la máquina.
        const targetMachineId = destination.droppableId === 'pending' ? null : destination.droppableId; 
        
        // El bloqueo de movimiento está en RollCard, pero el backend debe re-validar.
        
        // Validación máquina ocupada (Tu lógica original)
        if (targetMachineId) {
            const maq = machines.find(m => String(m.id) === targetMachineId);
            if (maq && maq.rolls.length > 0 && maq.rolls[0].id !== rollId) { // Permitir drop si es el mismo rollo
                return alert("⛔ Máquina ocupada.");
            }
        }
        
        try {
            // Nota: productionService.assignRoll debe manejar la asignación a la máquina
            await productionService.assignRoll(rollId, targetMachineId);
            loadBoard();
        } catch (e) { alert("Error al mover. Recargando."); loadBoard(); }
    };

    if (loading && machines.length === 0) return <div className={styles.loadingContainer}>Cargando Maquinaria...</div>;

    // --- RENDERIZADO ---
    return (
        <div className={styles.kanbanContainer}>
            <DragDropContext onDragEnd={onDragEnd}>
                <div className={styles.board}>
                    
                    {/* COLUMNA 1: LOTES EN ESPERA (ORIGEN) */}
                    <div className={styles.column} style={{ borderTop: '4px solid #f59e0b', background: '#fff' }}>
                        <div className={styles.columnHeader}>
                            <div className={styles.columnTitle}><i className="fa-solid fa-layer-group" style={{color:'#f59e0b'}}></i> LOTES EN ESPERA</div>
                            <span className={styles.columnCount}>{pendingRolls.length}</span>
                        </div>
                        
                        <Droppable droppableId="pending">
                            {(provided) => (
                                <div className={styles.droppableArea} ref={provided.innerRef} {...provided.droppableProps}>
                                    {pendingRolls.map((roll, index) => (
                                        <RollCard 
                                            key={roll.id} 
                                            roll={roll} 
                                            index={index}
                                            isMachineView={false} 
                                            onOpenDetail={handleOpenRollDetail}
                                            // En pendientes, el arrastre siempre está habilitado (isLocked=false)
                                        />
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>

                    {/* COLUMNAS DE MÁQUINAS (DESTINO) */}
                    {machines.map(machine => {
                        const isBusy = machine.rolls.length > 0;
                        const statusColor = machine.status === 'OK' ? '#10b981' : '#ef4444';

                        return (
                            <div key={machine.id} className={styles.column} style={{ borderTop: `4px solid ${statusColor}`, background: isBusy ? '#f0fdf4' : '#fff' }}>
                                <div className={styles.columnHeader}>
                                    <div className={styles.columnTitle} style={{color: '#1e293b'}}>
                                        <i className={`fa-solid ${isBusy ? 'fa-gear fa-spin' : 'fa-print'}`} style={{color: isBusy ? '#2563eb' : '#94a3b8'}}></i>
                                        {machine.name}
                                    </div>
                                    <span style={{fontSize:'0.65rem', fontWeight:'bold', padding:'2px 6px', borderRadius:'4px', background: machine.status==='OK'?'#dcfce7':'#fee2e2', color: machine.status==='OK'?'#166534':'#991b1b'}}>
                                        {machine.status}
                                    </span>
                                </div>

                                <Droppable droppableId={String(machine.id)}>
                                    {(provided) => (
                                        <div className={styles.droppableArea} ref={provided.innerRef} {...provided.droppableProps}>
                                            {machine.rolls.map((roll, index) => (
                                                <RollCard 
                                                    key={roll.id} 
                                                    roll={roll} 
                                                    index={index}
                                                    isMachineView={true}
                                                    onToggleStatus={handleToggleStatus}
                                                    onFinish={handleCloseRoll}
                                                    onOpenDetail={handleOpenRollDetail}
                                                />
                                            ))}
                                            {provided.placeholder}
                                            {machine.rolls.length === 0 && <div style={{textAlign:'center', padding:20, color:'#cbd5e1', fontSize:'0.8rem'}}>Disponible</div>}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        );
                    })}

                </div>
            </DragDropContext>
            
            {/* Modales */}
            <ActiveRollModal isOpen={!!selectedRoll} onClose={() => setSelectedRoll(null)} roll={selectedRoll} onSuccess={loadBoard} />
            <RollDetailModal isOpen={showDetailModal} onClose={() => setShowDetailModal(false)} roll={selectedRoll} />
        </div>
    );
};

export default ProductionKanban;