import React, { useState, useEffect } from 'react';
import { rollsService } from '../../services/api';
import CreateRollModal from '../modals/CreateRollModal';
import styles from './RollsKanban.module.css';

const RollsKanban = ({ areaCode }) => {
    const [rolls, setRolls] = useState([]);
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    useEffect(() => { loadBoard(); }, [areaCode]);

    const loadBoard = async () => {
        try {
            setLoading(true);
            const data = await rollsService.getBoard(areaCode);
            setRolls(data.rolls);
            setPending(data.pendingOrders);
        } catch (error) { console.error(error); } 
        finally { setLoading(false); }
    };

    const handleDragStart = (e, orderId) => e.dataTransfer.setData("orderId", orderId);
    const handleDragOver = (e) => e.preventDefault();

    const handleDrop = async (e, targetRollId) => {
        e.preventDefault();
        const orderId = e.dataTransfer.getData("orderId");
        if (!orderId) return;

        // Validar bloqueo en destino
        if (targetRollId) {
            const targetRoll = rolls.find(r => r.id === targetRollId);
            if (targetRoll && (targetRoll.machineId || targetRoll.status === 'Producción' || targetRoll.status === 'Cerrado')) {
                return alert("⛔ Este lote está bloqueado (En máquina o cerrado).");
            }
        }

        moveOrderVisual(orderId, targetRollId);
        try { await rollsService.moveOrder(orderId, targetRollId); } 
        catch (e) { loadBoard(); }
    };

    const moveOrderVisual = (orderId, targetRollId) => {
        let order = pending.find(o => o.id == orderId);
        let sourceList = 'pending';

        if (!order) {
            rolls.forEach(r => {
                const found = r.orders.find(o => o.id == orderId);
                if (found) { order = found; sourceList = r.id; }
            });
        }
        if (!order) return;

        if (sourceList === 'pending') setPending(prev => prev.filter(o => o.id != orderId));
        else setRolls(prev => prev.map(r => r.id === sourceList ? { ...r, orders: r.orders.filter(o => o.id != orderId), currentUsage: r.currentUsage - (order.magnitude || 0) } : r));

        if (targetRollId === null) setPending(prev => [order, ...prev]);
        else setRolls(prev => prev.map(r => r.id === targetRollId ? { ...r, orders: [...r.orders, order], currentUsage: r.currentUsage + (order.magnitude || 0) } : r));
    };

    if (loading) return <div className={styles.loading}>Cargando...</div>;

    return (
        <div className={styles.boardContainer}>
            
            {/* PENDIENTES */}
            <div className={`${styles.column} ${styles.columnPending}`} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, null)}>
                <div className={styles.colHeader}><h3>Pendientes</h3><span className={styles.countBadge}>{pending.length}</span></div>
                <div className={styles.cardList}>
                    {pending.map(order => (
                        <div key={order.id} draggable onDragStart={(e) => handleDragStart(e, order.id)} className={styles.card}>
                            <div className={styles.cardHeader}>
                                <span className={styles.orderId}>#{order.id}</span>
                                {order.priority === 'Urgente' && <i className="fa-solid fa-fire text-red-500"></i>}
                            </div>
                            <div className={styles.clientName}>{order.client}</div>
                            <div className={styles.jobDesc}>{order.desc}</div>
                            <div className={styles.cardFooter}><span className={styles.magnitudeBadge}>{order.magnitudeStr || order.magnitude}</span></div>
                        </div>
                    ))}
                    {pending.length === 0 && <div className={styles.emptyState}>No hay pendientes.</div>}
                </div>
            </div>

            {/* ROLLOS */}
            <div className={styles.rollsArea}>
                {rolls.map(roll => {
                    const percent = Math.min((roll.currentUsage / roll.capacity) * 100, 100);
                    
                    // Bloqueo visual si está en máquina
                    const isLocked = !!roll.machineId || roll.status === 'Producción' || roll.status === 'Cerrado';

                    return (
                        <div key={roll.id} className={styles.rollColumn} onDragOver={handleDragOver} onDrop={(e) => !isLocked && handleDrop(e, roll.id)} style={{borderColor: roll.color, opacity: isLocked ? 0.8 : 1}}>
                            <div className={styles.rollHeader} style={{borderTopColor: roll.color}}>
                                <div className={styles.rollTitleRow}>
                                    <h3 style={{color: roll.color}}>
                                        {isLocked && <i className="fa-solid fa-lock mr-1" style={{fontSize:'0.7rem'}}></i>}
                                        {roll.name}
                                    </h3>
                                    <span className={styles.rollId}>{roll.id}</span>
                                </div>
                                <div className={styles.progressContainer}><div className={styles.progressBar} style={{width: `${percent}%`, background: roll.color}}></div></div>
                                <div className={styles.capacityText}>{roll.currentUsage.toFixed(1)} / {roll.capacity}</div>
                            </div>
                            
                            <div className={styles.cardList}>
                                {roll.orders.map(order => (
                                    <div 
                                        key={order.id} 
                                        draggable={!isLocked} 
                                        onDragStart={(e) => !isLocked && handleDragStart(e, order.id)} 
                                        className={`${styles.card} ${isLocked ? styles.cardLocked : ''}`}
                                    >
                                        <div className={styles.cardHeader}>
                                            <span className={styles.orderId}>#{order.id}</span>
                                            {isLocked && <i className="fa-solid fa-lock" style={{color:'#94a3b8', fontSize:'0.7rem'}}></i>}
                                        </div>
                                        <div className={styles.clientName}>{order.client}</div>
                                        <div className={styles.cardFooter}><span className={styles.magnitudeBadge}>{order.magnitudeStr || order.magnitude}</span></div>
                                    </div>
                                ))}
                                {roll.orders.length === 0 && <div className={styles.emptyRollState}>Arrastra aquí</div>}
                            </div>
                        </div>
                    );
                })}
                <button className={styles.addRollBtn} onClick={() => setIsCreateOpen(true)}><div className={styles.addIconCircle}><i className="fa-solid fa-plus"></i></div><span>Nuevo Lote</span></button>
            </div>
            
            <CreateRollModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} areaCode={areaCode} onSuccess={loadBoard} />
        </div>
    );
};

export default RollsKanban;