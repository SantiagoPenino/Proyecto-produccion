import React, { useState, useEffect } from 'react';
import { areasService, workflowsService } from '../../../services/api';
import styles from '../Modals.module.css';

const ConfigFlowsModal = ({ isOpen, onClose }) => {
    const [step, setStep] = useState('list'); // 'list' | 'create'
    const [workflows, setWorkflows] = useState([]);
    const [areas, setAreas] = useState([]);
    
    // Formulario Nuevo Flujo
    const [newFlowName, setNewFlowName] = useState('');
    const [selectedSteps, setSelectedSteps] = useState([]); // Array de AreaIDs

    useEffect(() => {
        if (isOpen) {
            loadData();
            setStep('list');
        }
    }, [isOpen]);

    const loadData = async () => {
        try {
            const [wData, aData] = await Promise.all([
                workflowsService.getAll(),
                areasService.getAll()
            ]);
            setWorkflows(wData);
            setAreas(aData);
        } catch (e) { console.error(e); }
    };

    const handleAddStep = (areaId) => {
        if (!selectedSteps.includes(areaId)) {
            setSelectedSteps([...selectedSteps, areaId]);
        }
    };

    const handleSave = async () => {
        if (!newFlowName || selectedSteps.length === 0) return alert("Nombre y al menos 1 paso requeridos");
        try {
            await workflowsService.create({
                nombre: newFlowName,
                descripcion: 'Creado manualmente',
                pasos: selectedSteps
            });
            alert("Ruta creada!");
            setNewFlowName('');
            setSelectedSteps([]);
            setStep('list');
            loadData();
        } catch (e) { alert("Error al crear"); }
    };

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1100}}>
            <div className={styles.modalLarge}>
                <div className={styles.modalHeader}>
                    <h3><i className="fa-solid fa-diagram-project"></i> Gestión de Rutas</h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>

                <div className={styles.modalContent}>
                    {step === 'list' ? (
                        <div style={{minHeight:'300px'}}>
                            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>
                                <h4>Rutas Existentes</h4>
                                <button className={styles.addBtn} style={{width:'auto'}} onClick={()=>setStep('create')}>+ Nueva Ruta</button>
                            </div>
                            <div className={styles.fileList}>
                                {workflows.map(w => (
                                    <div key={w.id} className={styles.fileItem} style={{flexDirection:'column', alignItems:'flex-start'}}>
                                        <div style={{fontWeight:'bold'}}>{w.nombre}</div>
                                        <div style={{display:'flex', gap:'5px', flexWrap:'wrap', marginTop:'5px'}}>
                                            {w.pasos.map((p, i) => (
                                                <span key={i} className={styles.fileTag} style={{fontSize:'0.75rem'}}>
                                                    {i+1}. {p.nombre}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className={styles.formContainer}>
                            <h4>Diseñar Nueva Ruta</h4>
                            <div className={styles.formGroup}>
                                <label>Nombre de la Ruta</label>
                                <input className={styles.textInput} placeholder="Ej: Full Sublimación" value={newFlowName} onChange={e=>setNewFlowName(e.target.value)} />
                            </div>
                            
                            <div style={{display:'flex', gap:'20px', marginTop:'15px'}}>
                                {/* Lista de Áreas Disponibles */}
                                <div style={{flex:1, border:'1px solid #eee', padding:'10px', borderRadius:'8px', maxHeight:'300px', overflowY:'auto'}}>
                                    <small style={{color:'#999'}}>Click para agregar paso:</small>
                                    {areas.map(a => (
                                        <div key={a.code} onClick={()=>handleAddStep(a.code)} 
                                             style={{padding:'8px', cursor:'pointer', borderBottom:'1px solid #f9f9f9', fontWeight:'500'}}>
                                            + {a.name}
                                        </div>
                                    ))}
                                </div>

                                {/* Pasos Seleccionados */}
                                <div style={{flex:1, background:'#f0f9ff', padding:'10px', borderRadius:'8px'}}>
                                    <small style={{color:'#0284c7'}}>Secuencia:</small>
                                    {selectedSteps.map((s, i) => (
                                        <div key={i} style={{padding:'8px', background:'white', margin:'5px 0', borderRadius:'4px', boxShadow:'0 1px 2px rgba(0,0,0,0.05)'}}>
                                            <strong>{i+1}.</strong> {areas.find(a=>a.code===s)?.name || s}
                                        </div>
                                    ))}
                                    {selectedSteps.length > 0 && 
                                        <button onClick={()=>setSelectedSteps([])} style={{fontSize:'0.7rem', color:'red', marginTop:'10px', background:'none', border:'none', cursor:'pointer'}}>Limpiar</button>
                                    }
                                </div>
                            </div>

                            <div className={styles.actionsFooter} style={{marginTop:'20px'}}>
                                <button className={styles.cancelButton} onClick={()=>setStep('list')}>Volver</button>
                                <button className={styles.saveButton} onClick={handleSave}>Guardar Ruta</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfigFlowsModal;