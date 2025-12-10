import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';
import styles from '../Modals.module.css'; // Usamos tus estilos limpios

const ConfigPrintersModal = ({ isOpen, onClose, areaCode, equipos }) => {
    // Estado para nuevo equipo
    const [newPrinter, setNewPrinter] = useState({ nombre: '', cap: 100, vel: 10 });
    const [loading, setLoading] = useState(false);
    
    // Lista local
    const [localList, setLocalList] = useState([]);

    // Estado de Edición
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ nombre: '', cap: 0, vel: 0 });

    useEffect(() => {
        if (equipos) setLocalList(equipos);
    }, [equipos]);

    if (!isOpen) return null;

    // --- AGREGAR NUEVO ---
    const handleAdd = async () => {
        if (!newPrinter.nombre.trim()) return;
        setLoading(true);
        try {
            // Nota: El endpoint addPrinter debe soportar los campos extra o los actualizamos después
            // Para simplificar, asumimos que addPrinter solo pide nombre y areaId por ahora, 
            // pero idealmente deberías actualizarlo en el backend para recibir todo junto.
            // Aquí enviamos lo básico y el usuario edita después si quiere detallar.
            await areasService.addPrinter({ 
                areaId: areaCode, 
                nombre: newPrinter.nombre 
            });
            
            alert('Equipo agregado. Puedes editar sus detalles en la lista.');
            // Recargar lista simulada o real
            onClose(); // Cerramos para forzar recarga desde ConfigPage
        } catch (error) {
            alert('Error al agregar equipo');
        } finally {
            setLoading(false);
        }
    };

    // --- EDITAR ---
    const startEdit = (eq) => {
        setEditingId(eq.EquipoID);
        setEditForm({ 
            nombre: eq.Nombre, 
            cap: eq.Capacidad || 100, 
            vel: eq.Velocidad || 10 
        });
    };

    const saveEdit = async (id) => {
        try {
            await areasService.updatePrinter(id, {
                nombre: editForm.nombre,
                capacidad: editForm.cap,
                velocidad: editForm.vel
            });
            
            // Actualizar lista local visualmente
            setLocalList(prev => prev.map(eq => 
                eq.EquipoID === id 
                ? { ...eq, Nombre: editForm.nombre, Capacidad: editForm.cap, Velocidad: editForm.vel } 
                : eq
            ));
            
            setEditingId(null);
        } catch (e) {
            alert("Error al guardar cambios");
        }
    };

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1100}}>
            <div className={styles.modalLarge}> {/* Usamos modal ancho para que quepa todo */}
                <div className={styles.modalHeader}>
                    <h3>
                        <i className="fa-solid fa-print" style={{color:'#64748b', marginRight:8}}></i>
                        Gestión de Equipos: {areaCode}
                    </h3>
                    <button onClick={onClose} className={styles.closeButton}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                
                <div className={styles.modalContent}>
                    
                    {/* BARRA DE AGREGAR */}
                    <div className={styles.addFileBox} style={{marginBottom: 20}}>
                        <h4 style={{fontSize:'0.85rem', fontWeight:'bold', marginBottom:10, color:'#334155'}}>Nuevo Equipo</h4>
                        <div style={{display:'flex', gap:'10px', alignItems:'flex-end'}}>
                            <div style={{flex:2}}>
                                <label style={{fontSize:'0.75rem', color:'#64748b'}}>Nombre Identificador</label>
                                <input 
                                    type="text" className={styles.textInput} placeholder="Ej: DTF-03"
                                    value={newPrinter.nombre} 
                                    onChange={(e) => setNewPrinter({...newPrinter, nombre: e.target.value})}
                                />
                            </div>
                            <button className={styles.saveButton} onClick={handleAdd} disabled={loading}>
                                {loading ? '...' : '+ Agregar'}
                            </button>
                        </div>
                    </div>

                    {/* TABLA DE EQUIPOS */}
                    <div className={styles.tableContainer}>
                        <table className={styles.cleanTable}>
                            <thead>
                                <tr>
                                    <th>Nombre Equipo</th>
                                    <th style={{textAlign:'center', width:'100px'}}>Velocidad <span style={{fontSize:'0.65rem', fontWeight:'normal'}}>(u/h)</span></th>
                                    <th style={{textAlign:'center', width:'100px'}}>Capacidad <span style={{fontSize:'0.65rem', fontWeight:'normal'}}>(u/día)</span></th>
                                    <th style={{textAlign:'center', width:'80px'}}>Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {localList.length === 0 ? (
                                    <tr><td colSpan="4" style={{textAlign:'center', padding:20, color:'#94a3b8'}}>No hay equipos configurados.</td></tr>
                                ) : (
                                    localList.map((eq) => {
                                        const isEditing = editingId === eq.EquipoID;
                                        
                                        return (
                                            <tr key={eq.EquipoID} className={isEditing ? styles.editingRow : ''}>
                                                {/* NOMBRE */}
                                                <td>
                                                    {isEditing ? (
                                                        <input type="text" className={styles.textInput} value={editForm.nombre} onChange={e=>setEditForm({...editForm, nombre:e.target.value})} />
                                                    ) : (
                                                        <span style={{fontWeight:'600', color:'#334155'}}>{eq.Nombre}</span>
                                                    )}
                                                </td>

                                                {/* VELOCIDAD */}
                                                <td style={{textAlign:'center'}}>
                                                    {isEditing ? (
                                                        <input type="number" className={styles.miniInput} value={editForm.vel} onChange={e=>setEditForm({...editForm, vel:e.target.value})} />
                                                    ) : (
                                                        <span>{eq.Velocidad || 0}</span>
                                                    )}
                                                </td>

                                                {/* CAPACIDAD */}
                                                <td style={{textAlign:'center'}}>
                                                    {isEditing ? (
                                                        <input type="number" className={styles.miniInput} value={editForm.cap} onChange={e=>setEditForm({...editForm, cap:e.target.value})} />
                                                    ) : (
                                                        <span>{eq.Capacidad || 0}</span>
                                                    )}
                                                </td>

                                                {/* ACCIONES */}
                                                <td style={{textAlign:'center'}}>
                                                    {isEditing ? (
                                                        <div style={{display:'flex', gap:5, justifyContent:'center'}}>
                                                            <button onClick={() => saveEdit(eq.EquipoID)} className={styles.iconBtnGreen}><i className="fa-solid fa-check"></i></button>
                                                            <button onClick={() => setEditingId(null)} className={styles.iconBtnRed}><i className="fa-solid fa-xmark"></i></button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => startEdit(eq)} className={styles.iconBtnGray} title="Editar">
                                                            <i className="fa-solid fa-pen-to-square"></i>
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.cancelButton}>Cerrar</button>
                </div>
            </div>
        </div>
    );
};

export default ConfigPrintersModal;