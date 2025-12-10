import React, { useState } from 'react';
import { ordersService } from '../../services/api';
import styles from './Modals.module.css'; // Usamos tus estilos estándar

const RollAssignmentModal = ({ isOpen, onClose, selectedIds = [], onSuccess }) => {
    const [rollId, setRollId] = useState('');
    const [loading, setLoading] = useState(false);

    // Generar nombre automático al abrir (Opcional)
    React.useEffect(() => {
        if (isOpen) {
            // Sugerencia: R-Fecha-Hora
            const autoId = `R-${new Date().getDate()}${new Date().getHours()}${new Date().getMinutes()}`;
            setRollId(autoId);
        }
    }, [isOpen]);

    const handleAssign = async () => {
        if (!rollId) return alert("Ingresa un nombre para el rollo");
        
        setLoading(true);
        try {
            await ordersService.assignRoll(selectedIds, rollId);
            alert(`✅ Rollo ${rollId} creado con ${selectedIds.length} órdenes.`);
            if(onSuccess) onSuccess(); // Recargar tabla
            onClose();
        } catch (error) {
            alert("Error al crear rollo");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1300}}>
            <div className={styles.modal}>
                <div className={styles.modalHeader}>
                    <h3><i className="fa-solid fa-scroll"></i> Crear Lote / Rollo</h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>
                
                <div className={styles.modalContent}>
                    <div className={styles.alertInfo} style={{marginBottom: 20}}>
                        Se agruparán <strong>{selectedIds.length} órdenes</strong> seleccionadas.
                        <br/>
                        Pasarán a estado: <strong>Imprimiendo</strong>.
                    </div>

                    <div className={styles.formGroup}>
                        <label>Identificador del Rollo</label>
                        <input 
                            type="text" 
                            className={styles.textInput}
                            value={rollId}
                            onChange={(e) => setRollId(e.target.value)}
                            autoFocus
                            placeholder="Ej: R-105"
                        />
                    </div>
                </div>

                <div className={styles.modalFooter}>
                    <button onClick={onClose} className={styles.cancelButton}>Cancelar</button>
                    <button onClick={handleAssign} className={styles.saveButton} disabled={loading}>
                        {loading ? 'Procesando...' : 'Confirmar y Agrupar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RollAssignmentModal;