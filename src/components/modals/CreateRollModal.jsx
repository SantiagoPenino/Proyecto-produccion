import React, { useState } from 'react';
import { rollsService } from '../../services/api';
import styles from './Modals.module.css'; // Usamos tus estilos limpios

const CreateRollModal = ({ isOpen, onClose, areaCode, onSuccess }) => {
    const [formData, setFormData] = useState({
        name: '',
        capacity: 100,
        color: '#3b82f6' // Azul default
    });
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    // Colores predefinidos para elegir rápido
    const colors = [
        { hex: '#3b82f6', name: 'Azul' },
        { hex: '#10b981', name: 'Verde' },
        { hex: '#ef4444', name: 'Rojo' },
        { hex: '#f59e0b', name: 'Amarillo' },
        { hex: '#8b5cf6', name: 'Morado' },
        { hex: '#ec4899', name: 'Rosa' }
    ];

    const handleSubmit = async () => {
        if (!formData.name) return alert("El nombre es obligatorio");
        
        setLoading(true);
        try {
            await rollsService.create({
                areaId: areaCode,
                ...formData
            });
            alert("✅ Lote creado exitosamente");
            if (onSuccess) onSuccess();
            onClose();
            setFormData({ name: '', capacity: 100, color: '#3b82f6' }); // Reset
        } catch (error) {
            alert("Error al crear el lote");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1300}}>
            <div className={styles.modal}>
                <div className={styles.modalHeader}>
                    <h3><i className="fa-solid fa-scroll" style={{color: formData.color, marginRight:'10px'}}></i> Nuevo Lote de Producción</h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>
                
                <div className={styles.modalContent}>
                    <div className={styles.formGroup}>
                        <label>Nombre del Lote</label>
                        <input 
                            type="text" 
                            className={styles.textInput} 
                            placeholder="Ej: Urgentes Mañana, Pedido Nike..." 
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            autoFocus
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Capacidad Máxima (Metros/Unidades)</label>
                        <input 
                            type="number" 
                            className={styles.textInput} 
                            value={formData.capacity}
                            onChange={e => setFormData({...formData, capacity: e.target.value})}
                        />
                        <small style={{color:'#94a3b8', fontSize:'0.75rem'}}>Esto define el 100% de la barra de progreso.</small>
                    </div>

                    <div className={styles.formGroup}>
                        <label>Etiqueta de Color</label>
                        <div style={{display:'flex', gap:'10px', marginTop:'5px'}}>
                            {colors.map(c => (
                                <div 
                                    key={c.hex}
                                    onClick={() => setFormData({...formData, color: c.hex})}
                                    style={{
                                        width: '30px', height: '30px', borderRadius: '50%', 
                                        background: c.hex, cursor: 'pointer',
                                        border: formData.color === c.hex ? '3px solid #cbd5e1' : '1px solid transparent',
                                        transform: formData.color === c.hex ? 'scale(1.1)' : 'scale(1)',
                                        transition: 'all 0.2s'
                                    }}
                                    title={c.name}
                                ></div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.cancelButton}>Cancelar</button>
                    <button 
                        onClick={handleSubmit} 
                        className={styles.saveButton} 
                        style={{background: formData.color, border: 'none'}}
                        disabled={loading}
                    >
                        {loading ? 'Creando...' : 'Crear Lote'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateRollModal;