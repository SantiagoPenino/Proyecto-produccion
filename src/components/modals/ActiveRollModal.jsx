import React, { useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';
import { ordersService, rollsService } from '../../services/api';
import styles from './Modals.module.css'; // Reusamos estilos base

const ActiveRollModal = ({ isOpen, onClose, roll, onSuccess }) => {
    const [loading, setLoading] = useState(false);

    if (!isOpen || !roll) return null;

    // 1. GENERAR PDF CON QR
    const generateManifest = async () => {
        const doc = new jsPDF();
        
        // Generar QR
        const qrData = JSON.stringify({ id: roll.id, name: roll.name, orders: roll.orders.length });
        const qrUrl = await QRCode.toDataURL(qrData);

        // Encabezado
        doc.setFontSize(18);
        doc.text(`Manifiesto de Producción: ${roll.name}`, 14, 20);
        
        doc.setFontSize(10);
        doc.text(`ID Lote: ${roll.id}`, 14, 28);
        doc.text(`Fecha Impresión: ${new Date().toLocaleString()}`, 14, 33);
        
        // Pegar QR
        doc.addImage(qrUrl, 'PNG', 150, 10, 40, 40);

        // Tabla de Órdenes
        const tableColumn = ["ID", "Cliente", "Trabajo", "Variante", "Metros"];
        const tableRows = roll.orders.map(o => [
            o.id,
            o.client,
            o.desc,
            o.variant || '-',
            o.magnitude || '-'
        ]);

        doc.autoTable({
            startY: 50,
            head: [tableColumn],
            body: tableRows,
            theme: 'grid',
            headStyles: { fillColor: [59, 130, 246] }
        });

        doc.save(`Manifiesto_${roll.id}.pdf`);
    };

    // 2. MOVER ORDEN INDIVIDUAL (A Calidad/Terminación)
    const handleMoveOrder = async (orderId) => {
        if(!confirm("¿Marcar esta orden como impresa y pasar a Terminación?")) return;
        
        setLoading(true);
        try {
            // Cambiamos estado a 'Terminación' (o Calidad)
            // Esto la saca del rollo visualmente en el siguiente refresh
            await ordersService.updateStatus(orderId, 'Terminación');
            alert("✅ Orden enviada a Terminación/Calidad");
            if (onSuccess) onSuccess(); // Recargar datos del tablero
            onClose();
        } catch (e) {
            alert("Error al mover orden");
        } finally {
            setLoading(false);
        }
    };

    // 3. FINALIZAR ROLLO COMPLETO
    const handleFinishRoll = async () => {
        if(!confirm("¿Cerrar Lote completo? Todas las órdenes restantes pasarán a Finalizado.")) return;
        try {
            await rollsService.closeRoll(roll.id);
            if (onSuccess) onSuccess();
            onClose();
        } catch(e) { alert("Error al cerrar"); }
    };

    return (
        <div className={styles.modalOverlay} style={{zIndex: 1400}}>
            <div className={styles.modalLarge}>
                <div className={styles.modalHeader}>
                    <h3>
                        <i className="fa-solid fa-print" style={{color: roll.color}}></i>
                        Gestión de Producción: {roll.name}
                    </h3>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>

                <div className={styles.modalContent}>
                    
                    {/* ACCIONES DEL ROLLO */}
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'20px', background:'#f8fafc', padding:'15px', borderRadius:'8px', border:'1px solid #e2e8f0'}}>
                        <div>
                            <p style={{fontSize:'0.8rem', color:'#64748b'}}>Progreso del Lote</p>
                            <h2 style={{margin:0, color: roll.color}}>{roll.usage} / {roll.capacity}m</h2>
                        </div>
                        <div style={{display:'flex', gap:'10px'}}>
                            <button onClick={generateManifest} className={styles.stockButton} style={{background:'#334155'}}>
                                <i className="fa-solid fa-qrcode"></i> Imprimir QR / PDF
                            </button>
                            <button onClick={handleFinishRoll} className={styles.saveButton} style={{background:'#16a34a'}}>
                                <i className="fa-solid fa-check-double"></i> Finalizar Todo
                            </button>
                        </div>
                    </div>

                    {/* LISTA DE ÓRDENES EN EL ROLLO */}
                    <h4 style={{fontSize:'0.9rem', color:'#475569', marginBottom:'10px'}}>Órdenes en Cola de Impresión:</h4>
                    
                    <div className={styles.tableContainer}>
                        <table className={styles.cleanTable}>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Cliente</th>
                                    <th>Detalle</th>
                                    <th>Metros</th>
                                    <th style={{textAlign:'center'}}>Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roll.orders.map(order => (
                                    <tr key={order.id} className={styles.tableRow}>
                                        <td style={{fontWeight:'bold'}}>#{order.id}</td>
                                        <td>{order.client}</td>
                                        <td style={{color:'#64748b'}}>{order.desc}</td>
                                        <td><strong>{order.magnitude}</strong></td>
                                        <td style={{textAlign:'center'}}>
                                            <button 
                                                onClick={() => handleMoveOrder(order.id)}
                                                title="Marcar como Impreso -> Enviar a Calidad"
                                                className={styles.iconBtnGreen}
                                                style={{width:'auto', padding:'4px 10px', fontSize:'0.75rem', gap:'5px'}}
                                            >
                                                <i className="fa-solid fa-share"></i> A Calidad
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {roll.orders.length === 0 && <tr><td colSpan="5" style={{padding:20, textAlign:'center'}}>Lote vacío.</td></tr>}
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ActiveRollModal;