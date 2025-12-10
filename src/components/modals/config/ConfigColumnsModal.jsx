import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';
import styles from '../Modals.module.css';

const ConfigColumnsModal = ({ isOpen, onClose, areaCode, initialColumns }) => {
    const [cols, setCols] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen, initialColumns]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Pedimos el Diccionario Maestro a la BD (Ya no está hardcodeado)
            const masterList = await areasService.getDictionary();
            
            // 2. Mapeamos la configuración actual del área (lo que ya estaba guardado)
            const savedMap = new Map(initialColumns?.map(c => [c.ClaveData, c]));

            // 3. Fusionamos: Maestro + Guardado
            const merged = masterList.map((field, index) => {
                const saved = savedMap.get(field.Clave);
                
                return {
                    ClaveData: field.Clave,
                    // Si el usuario ya le cambió el nombre, usamos ese. Si no, el default de BD.
                    Titulo: saved?.Titulo || field.EtiquetaDefault, 
                    Ancho: saved?.Ancho || field.AnchoDefault,
                    // Visibilidad persistente o defaults lógicos
                    EsVisible: saved ? saved.EsVisible : ['id', 'client', 'status', 'desc'].includes(field.Clave),
                    TieneFiltro: saved ? saved.TieneFiltro : false,
                    Orden: saved?.Orden || index + 1
                };
            });

            // 4. Ordenar: Visibles primero
            merged.sort((a, b) => {
                if (a.EsVisible && !b.EsVisible) return -1;
                if (!a.EsVisible && b.EsVisible) return 1;
                return a.Orden - b.Orden;
            });

            setCols(merged);

        } catch (error) {
            console.error("Error cargando diccionario:", error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const toggleVis = (idx) => {
        const newCols = [...cols];
        newCols[idx].EsVisible = !newCols[idx].EsVisible;
        setCols(newCols);
    };

    const handleChange = (index, field, value) => {
        const newCols = [...cols];
        newCols[index][field] = value;
        setCols(newCols);
    };

    const handleSave = async () => {
        try {
            // Guardamos solo lo visible y recalculamos el orden
            const payload = cols
                .filter(c => c.EsVisible) // Opcional: filtrar solo visibles
                .map((c, i) => ({ ...c, Orden: i + 1 }));
            
            await areasService.saveColumns({ areaId: areaCode, columnas: payload });
            alert("✅ Configuración guardada en SQL Server");
            onClose();
        } catch (e) { alert("Error guardando"); }
    };

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1100}}>
            <div className={styles.modalLarge}>
                <div className={styles.modalHeader}>
                    <h3>Configurar Tabla: {areaCode}</h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>
                
                <div className={styles.modalContent}>
                    {loading ? <p style={{textAlign:'center', padding:20}}>Cargando campos disponibles...</p> : (
                        <>
                            <div className={styles.alertInfo} style={{background:'#f0f9ff', padding:'10px', borderRadius:'6px', marginBottom:'10px', fontSize:'0.85rem', color:'#0369a1'}}>
                                <i className="fa-solid fa-database"></i> Los campos disponibles vienen directamente de la base de datos.
                            </div>

                            {/* Cabecera */}
                            <div style={{display:'grid', gridTemplateColumns:'40px 1fr 200px 80px 100px', padding:'10px', background:'#f8fafc', borderBottom:'2px solid #e2e8f0', fontWeight:'bold', fontSize:'0.75rem', color:'#64748b', textTransform:'uppercase'}}>
                                <div style={{textAlign:'center'}}>Ver</div>
                                <div>Campo BD</div>
                                <div>Título Tabla</div>
                                <div style={{textAlign:'center'}}>Filtro</div>
                                <div>Ancho</div>
                            </div>

                            {/* Lista */}
                            <div style={{maxHeight:'400px', overflowY:'auto'}}>
                                {cols.map((c, idx) => (
                                    <div key={c.ClaveData} style={{
                                        display:'grid', 
                                        gridTemplateColumns:'40px 1fr 200px 80px 100px', 
                                        alignItems:'center', 
                                        padding:'8px', 
                                        borderBottom:'1px solid #f1f5f9',
                                        background: c.EsVisible ? 'white' : '#f9fafb',
                                        opacity: c.EsVisible ? 1 : 0.6
                                    }}>
                                        <div style={{textAlign:'center'}}>
                                            <input type="checkbox" checked={!!c.EsVisible} onChange={()=>toggleVis(idx)} style={{cursor:'pointer'}} />
                                        </div>
                                        
                                        <div style={{fontSize:'0.85rem', fontWeight:'500', color:'#334155'}}>
                                            {c.ClaveData}
                                        </div>

                                        <div>
                                            <input type="text" className={styles.textInput} value={c.Titulo} onChange={(e)=>handleChange(idx, 'Titulo', e.target.value)} disabled={!c.EsVisible} style={{padding:'6px'}} />
                                        </div>

                                        <div style={{textAlign:'center'}}>
                                            <input type="checkbox" checked={!!c.TieneFiltro} onChange={(e)=>handleChange(idx, 'TieneFiltro', e.target.checked)} disabled={!c.EsVisible} />
                                        </div>

                                        <div>
                                            <input type="text" className={styles.textInput} value={c.Ancho} onChange={(e)=>handleChange(idx, 'Ancho', e.target.value)} disabled={!c.EsVisible} style={{padding:'6px', textAlign:'center'}} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.cancelButton}>Cancelar</button>
                    <button onClick={handleSave} className={styles.saveButton}>Guardar</button>
                </div>
            </div>
        </div>
    );
};

export default ConfigColumnsModal;