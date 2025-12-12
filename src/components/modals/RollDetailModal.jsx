import React from 'react';
// Asegúrate de que la ruta a tu archivo base de estilos de modal sea correcta.
// Si no tienes uno, crea un archivo Modal.module.css básico.
import styles from '../../components/modals/Modals.module.css'; 

const RollDetailModal = ({ isOpen, onClose, roll }) => {
    if (!isOpen || !roll) return null;

    // --- DATOS DE EJEMPLO DEL CONTENIDO DEL ROLLO ---
    // NOTA: En un entorno real, tendrías que hacer una llamada a la API
    // para obtener los detalles completos de las órdenes (cliente, descripción, etc.)
    // usando los IDs de orden que vienen en roll.orders.
    
    // Suponemos que roll.orders es un array de objetos de órdenes para la UI
    const orderDetails = roll.orders || [
        { id: 'O-EJEMPLO-001', client: "Cliente Prueba Alpha", items: 3, totalMeters: 30.5 },
        { id: 'O-EJEMPLO-002', client: "Cliente Beta Corp", items: 1, totalMeters: 20.0 }
    ];

    return (
        // Asegúrate de que la clase modalOverlay esté definida en tu CSS
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
                
                <div className={styles.modalHeader}>
                    <h2>Detalle de Órdenes: {roll.rollCode || roll.id}</h2>
                    <button className={styles.btnClose} onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
                </div>
                
                <div className={styles.modalBody}>
                    <p style={{marginBottom: '15px'}}>
                        <strong>Máquina Asignada:</strong> {roll.printerName || 'N/A'} | 
                        <strong> Estado:</strong> <span style={{fontWeight: 'bold', color: roll.status === 'Imprimiendo' ? '#10b981' : '#f97316'}}>{roll.status}</span>
                    </p>

                    <h4 style={{marginTop: '10px', borderBottom: '1px solid #e2e8f0', paddingBottom: '5px', fontSize: '0.9rem'}}>
                        Órdenes Incluidas ({orderDetails.length})
                    </h4>
                    
                    <div style={{maxHeight: '300px', overflowY: 'auto'}}>
                        {orderDetails.map((order, index) => (
                            <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dotted #f1f5f9', alignItems: 'center' }}>
                                <div>
                                    <strong style={{color: '#1e293b'}}>{order.id}</strong> - {order.client}
                                </div>
                                <div style={{fontSize: '0.85rem'}}>
                                    {order.items} items / <span style={{fontWeight: 'bold', color: '#0f766e'}}>{order.totalMeters} M</span>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
                
                <div className={styles.modalFooter}>
                    <button className={styles.btnSecondary} onClick={onClose}>Cerrar</button>
                </div>
            </div>
        </div>
    );
};

export default RollDetailModal;