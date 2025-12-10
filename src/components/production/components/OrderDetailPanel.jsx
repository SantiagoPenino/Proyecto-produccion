import React, { useState, useEffect } from 'react';
import { ordersService } from '../../../services/api';
import styles from './OrderDetailPanel.module.css';

const OrderDetailPanel = ({ order, onClose }) => {
    // Estado local para los datos de la orden (para permitir recargas tras editar)
    const [currentOrder, setCurrentOrder] = useState(null);
    const [files, setFiles] = useState([]);
    
    // Estado de Edición
    const [editingFileId, setEditingFileId] = useState(null);
    const [editValues, setEditValues] = useState({ copias: 1, metros: 0, link: '' });

    // Sincronizar el prop 'order' con el estado local 'currentOrder'
    useEffect(() => {
        // Siempre actualizamos el estado, sea una orden o null
        setCurrentOrder(order);

        if (order) {
            // Si hay orden, procesamos los archivos
            const parsedFiles = Array.isArray(order.filesData) 
                ? order.filesData 
                : (typeof order.filesData === 'string' ? JSON.parse(order.filesData) : []);
            setFiles(parsedFiles);
        } else {
            // Si no hay orden, limpiamos archivos
            setFiles([]);
        }
    }, [order]);

    // PROTECCIÓN CRÍTICA: Si no hay orden, no renderizamos nada.
    if (!currentOrder) return null;

    const reloadOrder = async () => {
        try {
            // Buscamos la orden actualizada
            // Nota: getByArea trae todas, buscamos la nuestra. 
            // Si tienes un endpoint getById específico es mejor, pero esto funciona.
            const freshData = await ordersService.getByArea(currentOrder.area, 'active'); 
            const freshOrder = freshData.find(o => o.id === currentOrder.id);
            
            // Si no la encuentra en activas, búscala en historial
            if (!freshOrder) {
                 const historyData = await ordersService.getByArea(currentOrder.area, 'history');
                 const historyOrder = historyData.find(o => o.id === currentOrder.id);
                 if(historyOrder) {
                     setCurrentOrder(historyOrder);
                     setFiles(historyOrder.filesData || []);
                 }
            } else {
                setCurrentOrder(freshOrder);
                setFiles(freshOrder.filesData || []);
            }
        } catch (e) { console.error("Error recargando orden", e); }
    };

    const startEditing = (file) => {
        const url = file.link || file.RutaAlmacenamiento || '';
        setEditingFileId(file.ArchivoID);
        setEditValues({ 
            copias: file.copias, 
            metros: file.metros,
            link: url 
        });
    };

    const saveEditing = async () => {
        try {
            await ordersService.updateFile({
                fileId: editingFileId,
                copias: editValues.copias,
                metros: editValues.metros,
                link: editValues.link
            });
            setEditingFileId(null);
            await reloadOrder(); 
        } catch (e) { alert("Error al actualizar archivo"); }
    };

    // Calcular total visualmente
    const totalMetrosVisual = files.reduce((acc, f) => acc + ((f.copias || 1) * (f.metros || 0)), 0);

    return (
        <>
            <div className={styles.overlay} onClick={onClose}></div>
            
            <div className={styles.panel}>
                
                {/* HEADER */}
                <div className={styles.header}>
                    <div className={styles.headerTop}>
                        <span className={styles.idBadge}>#{currentOrder.id}</span>
                        <button onClick={onClose} className={styles.closeBtn}><i className="fa-solid fa-xmark"></i></button>
                    </div>
                    <h2 className={styles.clientName}>{currentOrder.client}</h2>
                    <p className={styles.jobDesc}>{currentOrder.desc}</p>
                    
                    <div className={styles.statusRow}>
                        <span className={styles.statusTag}>{currentOrder.status}</span>
                        <span className={`${styles.tag} ${styles[currentOrder.priority]}`}>{currentOrder.priority}</span>
                    </div>
                </div>

                <div className={styles.scrollContent}>
                    
                    {/* INFO */}
                    <div className={styles.section}>
                        <h3>Especificaciones</h3>
                        <div className={styles.gridInfo}>
                            <div className={styles.infoItem}>
                                <label>Variante</label><span>{currentOrder.variant || '-'}</span>
                            </div>
                            <div className={styles.infoItem}>
                                <label>Total (BD)</label>
                                <span className={styles.highlightValue}>{currentOrder.magnitude || '0m'}</span>
                            </div>
                            <div className={styles.infoItem}>
                                <label>Rollo / Lote</label>
                                <span>{currentOrder.rollId || '-'}</span>
                            </div>
                            <div className={styles.infoItem}>
                                <label>Fecha Entrega</label>
                                <span>{currentOrder.deliveryDate ? new Date(currentOrder.deliveryDate).toLocaleDateString() : '-'}</span>
                            </div>
                        </div>
                        {currentOrder.note && (
                            <div className={styles.noteBox}>
                                <i className="fa-solid fa-note-sticky" style={{marginRight:5}}></i> 
                                {currentOrder.note}
                            </div>
                        )}
                    </div>

                    {/* ARCHIVOS */}
                    <div className={styles.section}>
                        <h3>Archivos y Medidas</h3>
                        
                        <div className={styles.filesTableContainer}>
                            <table className={styles.filesTable}>
                                <thead>
                                    <tr>
                                        <th>Archivo / Link</th>
                                        <th className="text-center" style={{width:'60px'}}>Cant.</th>
                                        <th className="text-center" style={{width:'70px'}}>Mts</th>
                                        <th className="text-right" style={{width:'70px'}}>Sub</th>
                                        <th style={{width:'40px'}}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {files.length === 0 ? (
                                        <tr><td colSpan="5" style={{padding:20, textAlign:'center', color:'#999'}}>Sin archivos.</td></tr>
                                    ) : (
                                        files.map((f, idx) => {
                                            const fileId = f.ArchivoID || idx; 
                                            const isEditing = editingFileId === fileId;
                                            const fileUrl = f.link || f.RutaAlmacenamiento || '#';

                                            return (
                                                <tr key={idx} className={isEditing ? styles.editingRow : ''}>
                                                    <td>
                                                        <div className={styles.fileName}>{f.nombre}</div>
                                                        <div className={styles.linkWrapper}>
                                                            {isEditing ? (
                                                                <input type="text" className={styles.linkInput} value={editValues.link} onChange={e=>setEditValues({...editValues, link: e.target.value})} placeholder="https://..." />
                                                            ) : (
                                                                fileUrl !== '#' && (
                                                                    <div className={styles.tooltipContainer}>
                                                                        <a href={fileUrl} target="_blank" rel="noreferrer" className={styles.realLink}>
                                                                            <i className="fa-solid fa-link"></i> Abrir
                                                                        </a>
                                                                        <div className={styles.tooltip}>
                                                                            <div className={styles.tooltipArrow}></div>
                                                                            <div className={styles.tooltipTitle}>Destino:</div>
                                                                            <div className={styles.tooltipUrl}>{fileUrl}</div>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            )}
                                                        </div>
                                                    </td>
                                                    
                                                    <td className="text-center">
                                                        {isEditing ? <input type="number" className={styles.miniInput} value={editValues.copias} onChange={e=>setEditValues({...editValues, copias: e.target.value})} /> : f.copias}
                                                    </td>
                                                    
                                                    <td className="text-center">
                                                        {isEditing ? <input type="number" step="0.1" className={styles.miniInput} value={editValues.metros} onChange={e=>setEditValues({...editValues, metros: e.target.value})} /> : `${f.metros}m`}
                                                    </td>
                                                    
                                                    <td className="text-right font-bold">
                                                        {isEditing ? (editValues.copias * editValues.metros).toFixed(2) : ((f.copias||1) * (f.metros||0)).toFixed(2)}m
                                                    </td>
                                                    
                                                    <td className="text-center">
                                                        {isEditing ? (
                                                            <div className="flex gap-1 justify-center">
                                                                <button onClick={saveEditing} className={styles.iconBtnGreen}><i className="fa-solid fa-check"></i></button>
                                                                <button onClick={()=>setEditingFileId(null)} className={styles.iconBtnRed}><i className="fa-solid fa-xmark"></i></button>
                                                            </div>
                                                        ) : (
                                                            <button onClick={()=>startEditing(f)} className={styles.iconBtnGray} title="Editar Medidas">
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colSpan="3" className="text-right font-bold text-gray-500">TOTAL:</td>
                                        <td className="text-right font-bold text-blue-600" style={{fontSize:'1rem'}}>
                                            {totalMetrosVisual.toFixed(2)}m
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default OrderDetailPanel;