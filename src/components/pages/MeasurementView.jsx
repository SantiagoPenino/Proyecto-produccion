import React, { useState, useEffect } from 'react';
import styles from './MeasurementView.module.css';

const MeasurementView = ({ areaCode }) => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false); // Mantengo para el botón Auto, aunque desactivado.
    
    // Solo necesitamos el estado para el archivo de referencia visual (para el mensaje de bloqueo)
    const [previewFile, setPreviewFile] = useState(null);       

    const fetchData = async () => {
        try {
            setLoading(true);
            const res = await fetch(`http://localhost:5000/api/measurements?area=${areaCode}`);
            if (!res.ok) throw new Error('Error del servidor');
            const data = await res.json();

            // 👇 FILTRO CLAVE: Solo mostramos archivos cuya medida confirmada sea 0 o nula.
            const filteredData = data.map(order => ({
                ...order,
                // `f.confirmed` viene del campo METROS que estamos actualizando.
                files: order.files.filter(f => f.confirmed <= 0) 
            })).filter(order => order.files.length > 0); // Ocultar órdenes sin archivos pendientes.

            setOrders(Array.isArray(filteredData) ? filteredData : []);

        } catch (e) {
            console.error("Error en fetchData:", e);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [areaCode]);

    const handlePreview = (file) => setPreviewFile(file); 

    // Botón Medición Automática (Manteniendo la funcionalidad por si se necesita)
    const handleMeasure = async () => {
        alert("La función de Medida Automática está actualmente desactivada para centrarse en la entrada manual.");
        return; 
    };

    const handleSave = async () => {
        const changes = [];
        orders.forEach(o => o.files.forEach(f => {
            // Guardamos solo si el valor confirmado es > 0
            if (f.confirmed > 0) {
                changes.push({
                    id: f.id,
                    confirmed: f.confirmed, 
                    // Enviamos 0 si no hay auto-medida para no romper el backend
                    width: f.autoWidth || 0,
                    height: f.autoHeight || 0
                });
            }
        }));
        
        if (changes.length === 0) return alert("No hay nuevas medidas para guardar (valor debe ser mayor a cero).");

        try {
            await fetch('http://localhost:5000/api/measurements/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ measurements: changes })
            });
            alert("Medidas guardadas y archivos quitados de la cola.");
            fetchData(); // Recarga para que los archivos guardados desaparezcan
        } catch (e) { alert("Error al guardar"); }
    };

    const handleInputChange = (orderId, fileId, value) => {
        const numericValue = value === '' ? 0 : parseFloat(value); 

        setOrders(prev => prev.map(o => {
            if (o.id !== orderId) return o;
            return { 
                ...o, 
                files: o.files.map(f => 
                    f.id === fileId ? 
                    { ...f, confirmed: numericValue } : 
                    f
                ) 
            };
        }));
    };

    if (loading) return <div className={styles.loadingContainer}>Cargando...</div>;

    return (
        <div className={styles.container} style={{ gridTemplateColumns: '1fr' }}> 
            <div className={styles.leftPanel} style={{ maxWidth: '100%', borderRight: 'none' }}>
                <div className={styles.header}>
                    <div className={styles.title}>
                        <h2>Ingreso de Medidas (Cola de Trabajo)</h2>
                        <span className={styles.subtitle}>Archivos pendientes de medición (Medida = 0)</span>
                    </div>
                    <div className={styles.actions}>
                        {/* Mantengo el botón de auto-medida por si lo reactivamos, pero desactivado su funcionalidad */}
                        <button className={styles.btnMeasure} onClick={handleMeasure}><i className="fa-solid fa-ruler-combined"></i> Medir Auto</button>
                        <button className={styles.btnSave} onClick={handleSave}><i className="fa-solid fa-floppy-disk"></i> Guardar Medidas</button>
                    </div>
                </div>

                <div className={styles.listContainer}>
                    {orders.map(order => (
                        <div key={order.id} className={styles.orderGroup}>
                            <div className={styles.orderHeader}>
                                <div><span className={styles.orderTitle}>{order.code}</span><span className={styles.clientName}>{order.client}</span></div>
                            </div>
                            <table className={styles.fileTable}>
                                <thead>
                                    <tr>
                                        <th>Ruta del Archivo</th>
                                        <th style={{ width: 60, textAlign: 'center' }}>Copias</th>
                                        <th style={{ width: 100, textAlign: 'right' }}>Auto (M)</th>
                                        <th style={{ width: 120, textAlign: 'right' }}>Medida (M)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {order.files.map(file => (
                                        <tr key={file.id} className={styles.fileRow} onClick={() => handlePreview(file)}>
                                            <td className={styles.fileCell}>
                                                <div className={styles.fileName}>
                                                    <i className={`fa-solid ${file.type === 'pdf' || file.name.endsWith('.pdf') ? 'fa-file-pdf ' + styles.iconPdf : 'fa-file-image ' + styles.iconImg}`}></i>
                                                    <a href={file.url} target="_blank" rel="noopener noreferrer" className={styles.fileLink} onClick={(e) => e.stopPropagation()} title={file.url}>
                                                        {file.url || file.name}
                                                    </a>
                                                </div>
                                            </td>
                                            <td className={styles.fileCell} style={{ textAlign: 'center' }}><span className={styles.badgeCopies}>{file.copies}</span></td>
                                            <td className={styles.fileCell} style={{ textAlign: 'right' }}>
                                                {(file.autoWidth > 0 && file.autoHeight > 0) ? (
                                                    <span className={styles.autoBadge}>{file.autoWidth}x{file.autoHeight}M</span>
                                                ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                                            </td>
                                            <td className={styles.fileCell} style={{ textAlign: 'right' }}>
                                                <input
                                                    type="number" 
                                                    className={styles.measureInput} 
                                                    value={file.confirmed > 0 ? file.confirmed : ''} 
                                                    placeholder="0.00" 
                                                    step="0.01"
                                                    onChange={(e) => handleInputChange(order.id, file.id, e.target.value)} 
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                    {orders.length === 0 && <div className={styles.emptyList}>🎉 ¡Cola de medición vacía!</div>}
                </div>
            </div>

            {/* PANEL DERECHO: VISOR (Con mensaje de bloqueo) */}
            <div className={styles.rightPanel}>
                {previewFile ? (
                    <div className={styles.previewContainer}>
                        <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '6px' }}>
                            <i className="fa-solid fa-lock" style={{ fontSize: '1.5rem', color: '#dc2626' }}></i>
                            <p style={{ marginTop: '10px', fontSize: '0.9rem', color: '#dc2626', fontWeight: 'bold' }}>
                                Bloqueo de Seguridad (Drive/Local)<br />
                                <span>Haz **CLIC** en la ruta del archivo para abrirlo en una pestaña nueva y validar la medida.</span>
                            </p>
                            <a href={previewFile.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: '#2563eb' }}>
                                Abrir Enlace: {previewFile.name}
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className={styles.emptyPreview}><i className="fa-regular fa-eye" style={{fontSize:'3rem', marginBottom:10}}></i><p>Selecciona una fila para ver el archivo de referencia.</p></div>
                )}
            </div>
        </div>
    );
};

export default MeasurementView;