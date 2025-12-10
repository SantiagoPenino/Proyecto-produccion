import React, { useState, useEffect } from 'react';
import { stockService } from '../../services/api';
import styles from './Modals.module.css';

const CreateItemModal = ({ isOpen, onClose, initialName, onSuccess }) => {
    const [formData, setFormData] = useState({
        nombre: '',
        unidad: 'Unidades',
        categoria: 'General'
    });
    const [loading, setLoading] = useState(false);

    // Al abrir, precargamos lo que el usuario estaba escribiendo
    useEffect(() => {
        if (isOpen) {
            setFormData(prev => ({ ...prev, nombre: initialName || '' }));
        }
    }, [isOpen, initialName]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!formData.nombre) return alert("El nombre es obligatorio");
        
        try {
            setLoading(true);
            await stockService.createItem(formData); // Guarda en BD
            alert("✅ Insumo creado exitosamente");
            onSuccess(formData); // Pasamos el nuevo item al modal padre
            onClose();
        } catch (error) {
            alert("Error al crear: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1100}}> {/* Z-index mayor para estar encima */}
            <div className={styles.modal} style={{maxWidth: '400px'}}>
                <div className={styles.modalHeader}>
                    <h3>✨ Nuevo Insumo</h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>
                <div className={styles.modalContent}>
                    <p style={{fontSize:'0.9rem', color:'#64748b', marginBottom:'10px'}}>
                        Estás agregando un nuevo ítem al catálogo global.
                    </p>
                    
                    <div className={styles.formGroup}>
                        <label>Nombre del Insumo</label>
                        <input 
                            type="text" 
                            className={styles.textInput}
                            value={formData.nombre}
                            onChange={(e) => setFormData({...formData, nombre: e.target.value})}
                            autoFocus
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Unidad de Medida por Defecto</label>
                        <select 
                            className={styles.selectInput}
                            value={formData.unidad}
                            onChange={(e) => setFormData({...formData, unidad: e.target.value})}
                        >
                            <option>Unidades</option>
                            <option>Litros</option>
                            <option>Metros</option>
                            <option>Rollos</option>
                            <option>Cajas</option>
                            <option>Paquetes</option>
                            <option>Conos</option>
                        </select>
                    </div>
                </div>
                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.cancelButton}>Cancelar</button>
                    <button onClick={handleSubmit} className={styles.saveButton} disabled={loading}>
                        {loading ? 'Guardando...' : 'Guardar Insumo'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateItemModal;