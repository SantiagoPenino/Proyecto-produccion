import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';
import styles from '../Modals.module.css';

const ConfigInsumosModal = ({ isOpen, onClose, areaCode, insumos }) => {
    // Lista local para manejo optimista de checkboxes
    const [list, setList] = useState([]);

    useEffect(() => {
        if(insumos) setList(insumos);
    }, [insumos]);

    if (!isOpen) return null;

    const toggleInsumo = async (insumo) => {
        // 1. Calculamos nuevo estado
        const newState = !insumo.Asignado;
        
        // 2. Actualizamos UI inmediatamente (Optimista)
        const newList = list.map(i => 
            i.InsumoID === insumo.InsumoID ? { ...i, Asignado: newState } : i
        );
        setList(newList);

        try {
            // 3. Enviamos al backend
            await areasService.toggleInsumo({
                areaId: areaCode,
                insumoId: insumo.InsumoID,
                asignar: newState
            });
        } catch (error) {
            console.error(error);
            // Si falla, revertimos
            setList(insumos);
            alert("Error al guardar cambio");
        }
    };

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1100}}>
            <div className={styles.modal}>
                <div className={styles.modalHeader}>
                    <h3>Insumos Habilitados: {areaCode}</h3>
                    <button onClick={onClose} className={styles.closeButton}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                
                <div className={styles.modalContent}>
                    <p style={{fontSize:'0.85rem', color:'#64748b', marginBottom:'15px'}}>
                        Marca los materiales que se pueden solicitar en esta área.
                    </p>

                    <div style={{
                        maxHeight:'400px', 
                        overflowY:'auto', 
                        border:'1px solid #e2e8f0', 
                        borderRadius:'8px'
                    }}>
                        {list.length === 0 ? (
                            <div style={{padding:'20px', textAlign:'center'}}>No hay insumos registrados.</div>
                        ) : list.map(item => (
                            <label 
                                key={item.InsumoID} 
                                style={{
                                    display:'flex', 
                                    alignItems:'center', 
                                    padding:'12px 15px', 
                                    borderBottom:'1px solid #f1f5f9',
                                    cursor:'pointer',
                                    background: item.Asignado ? '#f0f9ff' : 'white',
                                    transition: 'background 0.2s'
                                }}
                            >
                                <input 
                                    type="checkbox" 
                                    checked={!!item.Asignado} 
                                    onChange={() => toggleInsumo(item)}
                                    style={{
                                        width:'18px', 
                                        height:'18px', 
                                        marginRight:'12px',
                                        accentColor: '#2563eb',
                                        cursor:'pointer'
                                    }}
                                />
                                <div>
                                    <div style={{fontWeight:'600', color:'#334155'}}>{item.Nombre}</div>
                                    <div style={{fontSize:'0.75rem', color:'#94a3b8'}}>{item.UnidadDefault}</div>
                                </div>
                                {item.Asignado && (
                                    <span style={{marginLeft:'auto', fontSize:'0.7rem', color:'#2563eb', fontWeight:'bold'}}>
                                        ACTIVO
                                    </span>
                                )}
                            </label>
                        ))}
                    </div>
                </div>

                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.saveButton}>Listo</button>
                </div>
            </div>
        </div>
    );
};

export default ConfigInsumosModal;