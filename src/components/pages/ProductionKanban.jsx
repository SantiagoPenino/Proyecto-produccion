import React, { useState, useEffect } from 'react';
import { productionService, rollsService } from '../../services/api';
import ActiveRollModal from '../modals/ActiveRollModal';
import styles from './RollsKanban.module.css';

const ProductionKanban = ({ areaCode }) => {
    const [machines, setMachines] = useState([]);
    const [pendingRolls, setPendingRolls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoll, setSelectedRoll] = useState(null);

    // Recargar cada 60s para actualizar tiempos
    useEffect(() => {
        loadBoard();
        const interval = setInterval(loadBoard, 60000);
        return () => clearInterval(interval);
    }, [areaCode]);

    const loadBoard = async () => {
        try {
            // setLoading(true); // Opcional: Evitar parpadeo en refrescos automáticos
            const data = await productionService.getBoard(areaCode);
            setMachines(data.machines);
            setPendingRolls(data.pendingRolls);
        } catch (error) { console.error(error); } 
        finally { setLoading(false); }
    };

    const handleToggleStatus = async (rollId, currentStatus) => {
        const action = currentStatus === 'Producción' ? 'stop' : 'start';
        // Optimistic UI
        updateRollStatusVisual(rollId, action === 'start' ? 'Producción' : 'Pausado');
        try {
            await productionService.toggleStatus(rollId, action);
            loadBoard(); // Recargar para obtener la fecha de inicio exacta del server
        } catch (e) {
            alert("Error al cambiar estado");
            loadBoard();
        }
    };

    const handleCloseRoll = async (rollId) => {
        if (!confirm("¿Finalizar impresión y cerrar lote?")) return;
        try {
            await rollsService.closeRoll(rollId);
            setMachines(prev => prev.map(m => ({...m, rolls: m.rolls.filter(r => r.id !== rollId)})));
        } catch (e) { alert("Error al finalizar"); }
    };

    const updateRollStatusVisual = (rollId, newStatus) => {
        setMachines(prev => prev.map(m => ({
            ...m, rolls: m.rolls.map(r => r.id === rollId ? { ...r, status: newStatus } : r)
        })));
    };

    const handleManageRoll = (roll) => setSelectedRoll(roll);

    const handleDragStart = (e, rollId) => e.dataTransfer.setData("rollId", rollId);
    const handleDragOver = (e) => e.preventDefault();
    const handleDrop = async (e, targetMachineId) => {
        e.preventDefault();
        const rollId = e.dataTransfer.getData("rollId");
        if (!rollId) return;
        
        // Validación máquina ocupada
        if (targetMachineId) {
            const maq = machines.find(m => m.id === targetMachineId);
            if (maq && maq.rolls.length > 0) return alert("⛔ Máquina ocupada.");
        }

        try {
            await productionService.assignRoll(rollId, targetMachineId);
            loadBoard();
        } catch (e) { alert("Error al mover"); }
    };

    if (loading && machines.length === 0) return <div className={styles.loading}>Cargando Maquinaria...</div>;

    return (
        <div className={styles.boardContainer}>
            {/* IZQUIERDA: PENDIENTES */}
            <div className={`${styles.column} ${styles.columnPending}`} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, null)}>
                <div className={styles.colHeader}><h3>Lotes en Espera</h3><span className={styles.countBadge}>{pendingRolls.length}</span></div>
                <div className={styles.cardList}>
                    {pendingRolls.map(roll => (
                        <RollCard key={roll.id} roll={roll} onDragStart={handleDragStart} isPending={true} />
                    ))}
                    {pendingRolls.length === 0 && <div className={styles.emptyState}>No hay lotes esperando.</div>}
                </div>
            </div>

            {/* DERECHA: MÁQUINAS */}
            <div className={styles.rollsArea}>
                {machines.map(machine => {
                    const isBusy = machine.rolls.length > 0;
                    return (
                        <div key={machine.id} className={styles.rollColumn} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, machine.id)} 
                             style={{borderTop: machine.status==='OK'?'4px solid #10b981':'4px solid #ef4444', background: isBusy?'#f0fdf4':'white'}}>
                            <div className={styles.rollHeader} style={{border:'none', background:'transparent'}}>
                                <div className="flex justify-between items-center">
                                    <h3 style={{fontSize:'0.9rem', fontWeight:'bold', color: '#1e293b'}}>
                                        <i className={`fa-solid ${isBusy ? 'fa-gear fa-spin' : 'fa-print'}`} style={{marginRight:6, color: isBusy ? '#2563eb' : '#94a3b8'}}></i>
                                        {machine.name}
                                    </h3>
                                    <span style={{fontSize:'0.65rem', fontWeight:'bold', padding:'2px 6px', borderRadius:'4px', background: machine.status==='OK'?'#dcfce7':'#fee2e2', color: machine.status==='OK'?'#166534':'#991b1b'}}>{machine.status}</span>
                                </div>
                            </div>
                            <div className={styles.cardList} style={{background:'transparent'}}>
                                {machine.rolls.map(roll => (
                                    <RollCard 
                                        key={roll.id} 
                                        roll={roll} 
                                        onDragStart={handleDragStart}
                                        onToggleStatus={() => handleToggleStatus(roll.id, roll.status)}
                                        onFinish={() => handleCloseRoll(roll.id)}
                                        onManage={() => handleManageRoll(roll)}
                                        isMachineView={true}
                                    />
                                ))}
                                {machine.rolls.length === 0 && <div className={styles.emptyRollState}>Disponible</div>}
                            </div>
                        </div>
                    );
                })}
            </div>
            
            <ActiveRollModal isOpen={!!selectedRoll} onClose={() => setSelectedRoll(null)} roll={selectedRoll} onSuccess={() => { setSelectedRoll(null); loadBoard(); }} />
        </div>
    );
};

// --- TARJETA INTELIGENTE CON TIEMPO ---
const RollCard = ({ roll, onDragStart, isMachineView, onToggleStatus, onManage, onFinish }) => {
    const percent = Math.min((roll.usage / roll.capacity) * 100, 100);
    const isRunning = roll.status === 'Producción';
    const statusLabel = isRunning ? 'IMPRIMIENDO' : 'PARADA';

    // Cálculo de tiempo transcurrido si está corriendo
    let timeDisplay = null;
    if (roll.startTime && isMachineView) {
        const start = new Date(roll.startTime);
        timeDisplay = start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    return (
        <div draggable onDragStart={(e) => onDragStart(e, roll.id)} className={styles.card} style={{borderLeft: `4px solid ${roll.color}`, borderColor: isRunning ? '#fecaca' : '#e2e8f0', boxShadow: isRunning ? '0 0 0 2px rgba(239,68,68,0.1)' : 'none'}}>
            <div className={styles.cardHeader}>
                <span className={styles.orderId} style={{color: roll.color}}>{roll.id}</span>
                {isMachineView ? (
                    <button onClick={(e) => {e.stopPropagation(); onFinish()}} className={`${styles.iconBtn} ${styles.btnCheck}`} title="Finalizar Lote">
                        <i className="fa-solid fa-check"></i>
                    </button>
                ) : (
                    <span className={styles.magnitudeBadge} style={{fontSize:'0.65rem'}}>{roll.ordersCount} Ord.</span>
                )}
            </div>
            
            <div className={styles.clientName} style={{marginBottom:'8px'}}>{roll.name}</div>
            
            {isMachineView && (
                <div className={styles.controlBar}>
                    <div className={styles.statusIndicator}>
                        <div className={isRunning ? styles.dotRed : styles.dotGreen}></div>
                        <div style={{display:'flex', flexDirection:'column'}}>
                            <span className={styles.statusText} style={{color: isRunning ? '#dc2626' : '#166534'}}>{statusLabel}</span>
                            {/* Mostrar hora de inicio */}
                            {roll.startTime && (
                                <span style={{fontSize:'0.6rem', color:'#64748b'}}>
                                    Inicio: {timeDisplay}
                                </span>
                            )}
                        </div>
                    </div>
                    
                    <div className={styles.btnGroup}>
                        {/* PLAY / PAUSE - Ahora bonitos */}
                        <button onClick={(e) => {e.stopPropagation(); onToggleStatus()}} className={`${styles.iconBtn} ${isRunning ? styles.btnPause : styles.btnPlay}`} title={isRunning ? "Pausar" : "Iniciar"}>
                            <i className={`fa-solid ${isRunning ? 'fa-pause' : 'fa-play'}`}></i>
                        </button>
                        {/* GESTIÓN */}
                        <button onClick={(e) => {e.stopPropagation(); onManage()}} className={`${styles.iconBtn} ${styles.btnManage}`} title="Ver Detalle / PDF">
                            <i className="fa-solid fa-list-check"></i>
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.progressContainer} style={{height:'6px', marginBottom:'2px'}}>
                <div className={styles.progressBar} style={{width: `${percent}%`, background: roll.color}}></div>
            </div>
            <div style={{fontSize:'0.7rem', color:'#64748b', textAlign:'right'}}>{roll.usage.toFixed(1)} / {roll.capacity}m</div>
        </div>
    );
};

export default ProductionKanban;