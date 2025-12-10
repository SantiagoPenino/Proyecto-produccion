import React, { useState, useEffect } from 'react';
import { logisticsService, ordersService } from '../../services/api'; // <--- IMPORTAR ordersService
import styles from './Modals.module.css';

const LogisticsCartModal = ({ isOpen, onClose, areaName, areaCode, onSuccess }) => {
    const [orders, setOrders] = useState([]);
    const [selected, setSelected] = useState([]);
    const [loading, setLoading] = useState(false);
    const [cadete, setCadete] = useState('');

    // ... (useEffect y loadCandidates igual que antes) ...
    useEffect(() => {
        if (isOpen && areaCode) {
            loadCandidates();
            setSelected([]);
            setCadete('');
        }
    }, [isOpen, areaCode]);

    const loadCandidates = async () => {
        setLoading(true);
        try {
            const data = await logisticsService.getCandidates(areaCode);
            setOrders(data);
        } catch (e) { console.error(e); } 
        finally { setLoading(false); }
    };

    // ... (toggleSelect y toggleAll igual que antes) ...
    const toggleSelect = (id) => {
        if (selected.includes(id)) setSelected(selected.filter(s => s !== id));
        else setSelected([...selected, id]);
    };
    
    const toggleAll = () => {
        if (selected.length === orders.length) setSelected([]);
        else setSelected(orders.map(o => o.id));
    };

    // NUEVA FUNCIÓN: Sacar del carrito (Revertir estado)
    const removeFromCart = async (orderId) => {
        if (!confirm("¿Sacar esta orden del carrito? Volverá a estado 'Pendiente'.")) return;
        
        try {
            // Cambiamos estado a algo previo (ej: Pendiente o En Proceso)
            await ordersService.updateStatus(orderId, 'Pendiente'); 
            
            // La quitamos de la lista local visualmente
            setOrders(orders.filter(o => o.id !== orderId));
            setSelected(selected.filter(id => id !== orderId)); // Deseleccionar si estaba marcada
            
            // Notificar al padre para que actualice el contador del badge
            if (onSuccess) onSuccess(); 
        } catch (error) {
            alert("Error al devolver orden");
        }
    };

    // ... (handleDispatch igual que antes) ...
    const handleDispatch = async () => {
        if (selected.length === 0) return alert("Selecciona al menos una orden.");
        setLoading(true);
        try {
            const res = await logisticsService.createDispatch({
                areaId: areaCode,
                ordenesIds: selected,
                cadete: cadete
            });
            alert(`✅ COMPROBANTE GENERADO: ${res.codigo}`);
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) { alert("Error al generar despacho"); } 
        finally { setLoading(false); }
    };

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1200}}>
            <div className={styles.modalLarge}>
                
                {/* HEADER */}
                <div className={styles.modalHeader}>
                    <h3>
                        <i className="fa-solid fa-cart-shopping" style={{color:'#6366f1'}}></i>
                        Carrito de Entrega: {areaName}
                    </h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>

                <div className={styles.modalContent}>
                    {/* ... (Barra superior Cadete igual) ... */}
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:'20px'}}>
                         <div className={styles.formGroup} style={{flex:1, maxWidth:'350px', marginBottom:0}}>
                            <label>Responsable / Cadete</label>
                            <input type="text" className={styles.textInput} placeholder="Ej: Juan Pérez" value={cadete} onChange={e=>setCadete(e.target.value)} />
                        </div>
                        <div style={{textAlign:'right'}}>
                            <div style={{fontSize:'0.85rem', color:'#64748b', fontWeight:600}}>Total a Enviar</div>
                            <div style={{fontSize:'1.8rem', fontWeight:'800', color:'#0f172a', lineHeight:1}}>
                                {selected.length} <span style={{fontSize:'1.1rem', fontWeight:'600', color:'#94a3b8'}}>/ {orders.length}</span>
                            </div>
                        </div>
                    </div>

                    {/* TABLA */}
                    <div className={styles.tableContainer}>
                        <table className={styles.cleanTable}>
                            <thead>
                                <tr>
                                    <th style={{textAlign:'center', width:'40px'}}>
                                        <input type="checkbox" onChange={toggleAll} checked={orders.length > 0 && selected.length === orders.length} style={{cursor:'pointer'}} />
                                    </th>
                                    <th>Orden</th>
                                    <th>Cliente</th>
                                    <th>Trabajo</th>
                                    <th style={{textAlign:'center'}}>Acción</th> {/* Columna Nueva */}
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map(o => (
                                    <tr key={o.id} className={`${styles.tableRow} ${selected.includes(o.id) ? styles.tableRowSelected : ''}`}>
                                        <td className={styles.tableCell} style={{textAlign:'center'}}>
                                            <input type="checkbox" checked={selected.includes(o.id)} onChange={()=>toggleSelect(o.id)} style={{cursor:'pointer'}} />
                                        </td>
                                        <td className={styles.tableCell} style={{fontWeight:'700'}}>#{o.id}</td>
                                        <td className={styles.tableCell}>{o.client}</td>
                                        <td className={styles.tableCell} style={{color:'#64748b'}}>{o.description}</td>
                                        
                                        {/* BOTÓN DEVOLVER */}
                                        <td className={styles.tableCell} style={{textAlign:'center'}}>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); removeFromCart(o.id); }}
                                                title="Sacar del carrito (Devolver a producción)"
                                                style={{
                                                    background:'#fef2f2', border:'1px solid #fecaca', 
                                                    color:'#ef4444', borderRadius:'6px', padding:'4px 8px', 
                                                    cursor:'pointer'
                                                }}
                                            >
                                                <i className="fa-solid fa-rotate-left"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {orders.length === 0 && !loading && (
                                    <tr><td colSpan="5" style={{padding:40, textAlign:'center', color:'#94a3b8'}}>El carrito está vacío.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FOOTER */}
                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.cancelButton}>Cerrar</button>
                    <button 
                        onClick={handleDispatch} 
                        className={styles.saveButton} 
                        style={{background: '#4f46e5'}}
                        disabled={loading || selected.length === 0}
                    >
                        {loading ? 'Procesando...' : `Despachar Seleccionados`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LogisticsCartModal;