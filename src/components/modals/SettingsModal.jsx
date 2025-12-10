import React, { useState } from 'react';
import { stockService } from '../../services/api'; // Importamos el servicio
import styles from './Modals.module.css';

// Recibimos 'areaCode' (ej: 'DTF') para saber a quién cargarle el costo
const StockModal = ({ isOpen, onClose, areaName, areaCode }) => {
  const [loading, setLoading] = useState(false);
  
  // Estado del formulario
  const [formData, setFormData] = useState({
    item: '',
    cantidad: '',
    unidad: 'Unidades',
    prioridad: 'Normal'
  });

  if (!isOpen) return null;

  // Manejar cambios en los inputs
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Enviar formulario
  // En src/components/modals/StockModal.jsx

  const handleSubmit = async () => {
    // LOG 1: Ver si el botón funciona
    console.log("👉 Botón presionado. Validando datos...");

    if (!formData.item || !formData.cantidad) {
        alert("Por favor complete el ítem y la cantidad.");
        return;
    }

    try {
        setLoading(true);
        
        // LOG 2: Ver qué datos estamos a punto de enviar
        const payload = {
            areaId: areaCode, // Importante: ¿Esto tiene valor?
            ...formData
        };
        console.log("📤 Enviando al Backend:", payload);

        // Llamamos al backend
        await stockService.create(payload);
        
        // LOG 3: Si llegamos aquí, fue éxito
        console.log("✅ Respuesta exitosa del Backend");
        
        alert("✅ Solicitud enviada a Logística correctamente.");
        setFormData({ item: '', cantidad: '', unidad: 'Unidades', prioridad: 'Normal' });
        onClose();
    } catch (error) {
        // LOG 4: Ver el error real
        console.error("❌ ERROR EN FRONTEND:", error);
        alert("❌ Error al enviar: " + (error.response?.data?.error || error.message));
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeaderStock}>
          <h3><i className="fa-solid fa-boxes-stacked"></i> Solicitud Insumos - {areaName}</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className={styles.modalContent}>
          
          <div className={styles.formGroup}>
            <label>Insumo / Material</label>
            <input 
                name="item"
                type="text" 
                placeholder="Ej: Tinta Magenta, Papel..." 
                className={styles.textInput}
                value={formData.item}
                onChange={handleChange}
                autoFocus
            />
          </div>

          <div className={styles.rowGroup}>
             <div className={styles.formGroup}>
                <label>Cantidad</label>
                <input 
                    name="cantidad"
                    type="number" 
                    placeholder="0" 
                    className={styles.textInput}
                    value={formData.cantidad}
                    onChange={handleChange}
                />
             </div>
             <div className={styles.formGroup}>
                <label>Unidad</label>
                <select name="unidad" className={styles.selectInput} value={formData.unidad} onChange={handleChange}>
                    <option>Unidades</option>
                    <option>Litros</option>
                    <option>Metros</option>
                    <option>Rollos</option>
                    <option>Cajas</option>
                </select>
             </div>
          </div>

          <div className={styles.formGroup}>
            <label>Prioridad</label>
            <select name="prioridad" className={styles.selectInput} value={formData.prioridad} onChange={handleChange}>
              <option value="Normal">Normal (Reposición)</option>
              <option value="Alta">Alta (Stock Crítico)</option>
              <option value="Urgente">Urgente (Parada de Máquina)</option>
            </select>
          </div>

        </div>
        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.cancelButton} disabled={loading}>Cancelar</button>
          <button onClick={handleSubmit} className={styles.stockButton} disabled={loading}>
            {loading ? 'Enviando...' : 'Enviar Solicitud'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockModal;