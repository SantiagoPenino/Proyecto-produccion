import React, { useState, useEffect, useRef } from 'react';
import { stockService } from '../../services/api';
import CreateItemModal from './CreateItemModal.jsx';
import styles from './Modals.module.css';

const StockRequestModal = ({ isOpen, onClose, areaName, areaCode }) => {
  const [activeTab, setActiveTab] = useState('new');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [formData, setFormData] = useState({
    item: '',
    cantidad: '',
    unidad: 'Unidades',
    prioridad: 'Normal',
    observaciones: ''
  });

  // COMBOBOX LOGIC
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Cargar historial
  useEffect(() => {
    if (activeTab === 'history' && isOpen) loadHistory();
  }, [activeTab, isOpen]);

  const loadHistory = async () => {
      setLoading(true);
      try {
          const data = await stockService.getHistory(areaCode);
          setHistory(data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
  };

  // Cerrar dropdown click fuera
  useEffect(() => {
    const handleClick = (e) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
            setShowDropdown(false);
        }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleItemInput = async (e) => {
      const val = e.target.value;
      setFormData({ ...formData, item: val });
      if (val.length > 0) {
          try {
              const items = await stockService.searchItems(val);
              setSuggestions(items);
              setShowDropdown(true);
          } catch (err) { console.error(err); }
      } else { setShowDropdown(false); }
  };

  const selectItem = (item) => {
      setFormData({ ...formData, item: item.Nombre, unidad: item.UnidadDefault });
      setShowDropdown(false);
  };

  const openCreateModal = () => {
      setShowDropdown(false);
      setIsCreateOpen(true);
  };

  const handleItemCreated = (newItem) => {
      setFormData({ ...formData, item: newItem.nombre, unidad: newItem.unidad });
  };

  const handleSubmit = async () => {
    if (!formData.item || !formData.cantidad) return alert("Faltan datos");
    setLoading(true);
    try {
        await stockService.create({ areaId: areaCode, ...formData });
        alert("✅ Solicitud enviada!");
        setFormData({ item: '', cantidad: '', unidad: 'Unidades', prioridad: 'Normal', observaciones: '' });
        onClose();
    } catch (error) { alert("Error al enviar"); } 
    finally { setLoading(false); }
  };

  if (!isOpen) return null;

  return (
    <>
        <div className={styles.modalOverlay}>
            <div className={styles.modalLarge}>
                
                {/* HEADER */}
                <div className={styles.modalHeaderStock}>
                    <div className={styles.headerTitle}>
                        <i className="fa-solid fa-boxes-stacked" style={{marginRight:'8px'}}></i> 
                        Insumos: {areaName}
                    </div>
                    <div className={styles.tabsContainer}>
                        <button className={`${styles.tabBtn} ${activeTab==='new'?styles.tabActive:''}`} onClick={()=>setActiveTab('new')}>Nueva Solicitud</button>
                        <button className={`${styles.tabBtn} ${activeTab==='history'?styles.tabActive:''}`} onClick={()=>setActiveTab('history')}>Historial</button>
                    </div>
                    <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
                </div>

                <div className={styles.modalContent}>
                    
                    {activeTab === 'new' && (
                        <div className={styles.formContainer}>
                            
                            {/* INPUT COMBOBOX */}
                            <div className={styles.formGroup} ref={dropdownRef} style={{position:'relative'}}>
                                <label>Insumo / Material</label>
                                <div className={styles.comboWrapper}>
                                    <input 
                                        type="text" 
                                        className={styles.textInput} 
                                        placeholder="Escribe para buscar..."
                                        value={formData.item}
                                        onChange={handleItemInput}
                                        onFocus={() => formData.item && setShowDropdown(true)}
                                        autoComplete="off"
                                    />
                                    <i className={`fa-solid fa-chevron-down ${styles.comboIcon}`}></i>
                                </div>

                                {/* LISTA DESPLEGABLE */}
                                {showDropdown && (
                                    <ul className={styles.comboDropdown}>
                                        {suggestions.length > 0 ? (
                                            suggestions.map((s, i) => (
                                                <li key={i} onClick={() => selectItem(s)} className={styles.comboOption}>
                                                    <span>{s.Nombre}</span>
                                                    <span className={styles.comboUnit}>{s.UnidadDefault}</span>
                                                </li>
                                            ))
                                        ) : (
                                            <li className={styles.noResult} onClick={openCreateModal}>
                                                <i className="fa-solid fa-plus-circle" style={{marginRight:'5px'}}></i>
                                                Crear "{formData.item}"
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>

                            <div className={styles.rowGroup}>
                                <div className={styles.formGroup}>
                                    <label>Cantidad</label>
                                    <input type="number" className={styles.textInput} value={formData.cantidad} onChange={e=>setFormData({...formData, cantidad:e.target.value})} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label>Unidad</label>
                                    <select className={styles.selectInput} value={formData.unidad} onChange={e=>setFormData({...formData, unidad:e.target.value})}>
                                        <option>Unidades</option><option>Litros</option><option>Metros</option><option>Rollos</option><option>Cajas</option><option>Conos</option>
                                    </select>
                                </div>
                            </div>

                            {/* STEPPER PRIORIDAD */}
                            <div className={styles.formGroup}>
                                <label>Prioridad</label>
                                <div className={styles.stepperContainer}>
                                    {['Normal', 'Alta', 'Urgente'].map((level, idx) => (
                                        <div 
                                            key={level} 
                                            className={`${styles.stepItem} ${formData.prioridad === level ? styles.stepActive + ' ' + styles[level] : ''}`}
                                            onClick={() => setFormData({...formData, prioridad: level})}
                                        >
                                            <span>{level}</span>
                                        </div>
                                    ))}
                                    <div className={styles.stepLine} style={{display:'none'}}></div> {/* Oculto para limpieza visual */}
                                </div>
                            </div>

                            <div className={styles.formGroup}>
                                <label>Observaciones</label>
                                <textarea className={styles.textArea} rows="2" placeholder="Detalles..." value={formData.observaciones} onChange={e=>setFormData({...formData, observaciones:e.target.value})}></textarea>
                            </div>

                            <div className={styles.actionsFooter}>
                                <button className={styles.stockButton} onClick={handleSubmit} disabled={loading}>
                                    {loading ? 'Enviando...' : 'Confirmar Pedido'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TABLA HISTORIAL (Usando estilos unificados 'cleanTable') */}
                    {activeTab === 'history' && (
                        <div className={styles.tableContainer}> {/* Usamos el contenedor estándar */}
                            <table className={styles.cleanTable}>
                                <thead>
                                    <tr>
                                        <th>Fecha</th>
                                        <th>Detalle</th>
                                        <th style={{textAlign:'center'}}>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.length === 0 ? (
                                        <tr><td colSpan="3" style={{padding:20, textAlign:'center', color:'#94a3b8'}}>Sin historial reciente.</td></tr>
                                    ) : (
                                        history.map(h => (
                                            <tr key={h.SolicitudID} className={styles.tableRow}>
                                                <td>{new Date(h.FechaSolicitud).toLocaleDateString()}</td>
                                                <td>
                                                    <div style={{fontWeight:'bold', color:'#334155'}}>{h.Item}</div>
                                                    <div style={{fontSize:'0.75rem', color:'#64748b'}}>
                                                        {h.Cantidad} {h.Unidad} {h.Observaciones ? ` - ${h.Observaciones}` : ''}
                                                    </div>
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    <span style={{
                                                        padding:'2px 8px', borderRadius:'10px', fontSize:'0.7rem', fontWeight:'bold', textTransform:'uppercase',
                                                        background: h.Estado==='Pendiente'?'#fef9c3': (h.Estado==='Entregado'?'#dcfce7':'#f3f4f6'),
                                                        color: h.Estado==='Pendiente'?'#854d0e': (h.Estado==='Entregado'?'#166534':'#4b5563')
                                                    }}>
                                                        {h.Estado}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>

        <CreateItemModal 
            isOpen={isCreateOpen}
            onClose={() => setIsCreateOpen(false)}
            initialName={formData.item}
            onSuccess={handleItemCreated}
        />
    </>
  );
};

export default StockRequestModal;