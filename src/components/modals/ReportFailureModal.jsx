import React, { useState, useEffect, useRef } from 'react';
import { failuresService } from '../../services/api';
import styles from './Modals.module.css';

const ReportFailureModal = ({ isOpen, onClose, areaName, areaCode }) => {
  const [activeTab, setActiveTab] = useState('new');
  const [loading, setLoading] = useState(false);
  
  // Datos
  const [machines, setMachines] = useState([]);
  const [history, setHistory] = useState([]);
  
  // Autocompletado Falla (Combo Inteligente)
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  const [formData, setFormData] = useState({
    maquinaId: '',
    titulo: '',
    descripcion: '',
    prioridad: 'Media'
  });

  // 1. Carga Inicial
  useEffect(() => {
    if (isOpen && areaCode) {
        loadMachines();
        // Cargar sugerencias iniciales (las más frecuentes)
        loadSuggestions(''); 
        setActiveTab('new');
    }
  }, [isOpen, areaCode]);

  // 2. Cargar Historial al cambiar tab
  useEffect(() => {
    if (isOpen && activeTab === 'history') loadHistory();
  }, [activeTab, isOpen]);

  const loadMachines = async () => {
      try {
          const data = await failuresService.getMachines(areaCode);
          setMachines(data);
      } catch (e) { console.error(e); }
  };

  const loadHistory = async () => {
      setLoading(true);
      try {
          const data = await failuresService.getHistory(areaCode);
          setHistory(data);
      } catch (e) { console.error(e); } 
      finally { setLoading(false); }
  };

  const loadSuggestions = async (query) => {
      try {
          const results = await failuresService.searchTitles(query, areaCode);
          setSuggestions(results);
      } catch(e) {}
  };

  // --- LÓGICA COMBOBOX (Igual que Insumos) ---
  const handleTitleInput = (e) => {
      const val = e.target.value;
      setFormData({ ...formData, titulo: val });
      loadSuggestions(val);
      setShowDropdown(true);
  };

  const selectTitle = (title) => {
      setFormData({ ...formData, titulo: title });
      setShowDropdown(false);
  };

  const createNewFailureType = async () => {
      if (!formData.titulo) return;
      
      setLoading(true);
      try {
          await failuresService.createType({
              areaId: areaCode,
              titulo: formData.titulo
          });
          
          alert(`✅ "${formData.titulo}" agregado al catálogo.`);
          setShowDropdown(false);
          // Recargar sugerencias para que ya aparezca como existente
          loadSuggestions(formData.titulo); 
      } catch (error) {
          alert("Error al agregar al catálogo: " + error.message);
      } finally {
          setLoading(false);
      }
  };

  // Cerrar dropdown click fuera
  useEffect(() => {
    const handleClick = (e) => { if(dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);


  const handleSubmit = async () => {
      if (!formData.maquinaId || !formData.titulo) {
          alert("Seleccione máquina y tipo de falla.");
          return;
      }

      setLoading(true);
      try {
          await failuresService.create({
              ...formData,
              reportadoPor: 'Operario'
          });
          
          alert("✅ Ticket creado.");
          setFormData({ maquinaId: '', titulo: '', descripcion: '', prioridad: 'Media' });
          setActiveTab('history');
          loadHistory();
      } catch (error) {
          alert("Error creando ticket");
      } finally {
          setLoading(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalLarge}>
        
        {/* HEADER ROJO */}
        <div className={styles.modalHeaderWarning}>
            <div className={styles.headerTitle} style={{color: '#b91c1c'}}>
                <i className="fa-solid fa-triangle-exclamation"></i> Falla: {areaName}
            </div>
            <div className={styles.tabsContainer}>
                <button className={`${styles.tabBtn} ${activeTab==='new'?styles.tabActiveRed:''}`} onClick={()=>setActiveTab('new')}>Nuevo Reporte</button>
                <button className={`${styles.tabBtn} ${activeTab==='history'?styles.tabActiveRed:''}`} onClick={()=>setActiveTab('history')}>Historial</button>
            </div>
            <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
        </div>

        <div className={styles.modalContent}>
            
            {activeTab === 'new' && (
                <div className={styles.formContainer}>
                    
                    {/* 1. MÁQUINA (Select Fijo) */}
                    <div className={styles.formGroup}>
                        <label>Máquina Afectada</label>
                        <select 
                            className={styles.selectInput}
                            value={formData.maquinaId}
                            onChange={(e) => setFormData({...formData, maquinaId: e.target.value})}
                        >
                            <option value="">-- Seleccionar Equipo --</option>
                            {machines.map(m => (
                                <option key={m.MaquinaID} value={m.MaquinaID}>{m.Nombre}</option>
                            ))}
                        </select>
                    </div>

                    {/* 2. TÍTULO FALLA (Combo Inteligente - Estilo Insumos) */}
                    <div className={styles.formGroup} ref={dropdownRef} style={{position:'relative'}}>
                        <label>Tipo de Falla</label>
                        <div className={styles.comboWrapper}>
                            <input 
                                type="text" 
                                className={styles.textInput}
                                placeholder="Buscar o escribir nueva..."
                                value={formData.titulo}
                                onChange={handleTitleInput}
                                onFocus={() => { loadSuggestions(formData.titulo); setShowDropdown(true); }}
                                autoComplete="off"
                            />
                            <i className={`fa-solid fa-chevron-down ${styles.comboIcon}`}></i>
                        </div>

                        {showDropdown && (
                            <ul className={styles.comboDropdown}>
                                {suggestions.length > 0 ? (
                                    suggestions.map((s, i) => (
                                        <li key={i} onClick={() => selectTitle(s.Titulo)} className={styles.comboOption}>
                                            <span>{s.Titulo}</span>
                                            {/* Badge opcional para frecuentes */}
                                            {s.EsFrecuente && <span className={styles.comboUnit} style={{background:'#fee2e2', color:'#b91c1c'}}>Común</span>}
                                        </li>
                                    ))
                                ) : (
                                    <li className={styles.noResult} onClick={createNewFailureType}>
                                        <i className="fa-solid fa-plus-circle"></i>
                                        <div>
                                            Agregar <strong>"{formData.titulo}"</strong> al catálogo
                                            <div style={{fontSize:'0.7rem', fontWeight:'normal'}}>Se guardará para futuros reportes</div>
                                        </div>
                                    </li>
                                )}
                            </ul>
                        )}
                    </div>

                    {/* 3. PRIORIDAD (Stepper Visual) */}
                    <div className={styles.formGroup}>
                        <label>Prioridad</label>
                        <div className={styles.stepperContainer}>
                            {['Baja', 'Media', 'Alta', 'Crítica'].map((prio, idx) => (
                                <div 
                                    key={prio} 
                                    className={`${styles.stepItem} ${formData.prioridad === prio ? styles.stepActive + ' ' + styles[prio] : ''}`}
                                    onClick={() => setFormData({...formData, prioridad: prio})}
                                >
                                    <div className={styles.stepCircle} style={{fontSize:'0.6rem'}}>{idx + 1}</div>
                                    <span style={{fontSize:'0.8rem'}}>{prio}</span>
                                </div>
                            ))}
                            <div className={styles.stepLine}></div>
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label>Descripción Adicional</label>
                        <textarea className={styles.textArea} rows="2" value={formData.descripcion} onChange={(e) => setFormData({...formData, descripcion: e.target.value})}></textarea>
                    </div>

                    <div className={styles.actionsFooter}>
                        <button className={styles.reportButton} onClick={handleSubmit} disabled={loading}>
                            {loading ? 'Procesando...' : 'Crear Ticket'}
                        </button>
                    </div>
                </div>
            )}

            {/* VISTA HISTORIAL */}
            {activeTab === 'history' && (
                <div className={styles.historyContainer}>
                    <table className={styles.historyTable}>
                        <thead><tr><th>Fecha</th><th>Falla / Equipo</th><th>Estado</th></tr></thead>
                        <tbody>
                            {history.length === 0 ? (
                                <tr><td colSpan="3" className={styles.emptyRow}>Sin historial reciente.</td></tr>
                            ) : (
                                history.map(t => (
                                    <tr key={t.TicketID}>
                                        <td>{new Date(t.FechaReporte).toLocaleDateString()}</td>
                                        <td>
                                            <div style={{fontWeight:'bold', color:'#334155'}}>{t.Titulo}</div>
                                            <div style={{fontSize:'0.75rem', color:'#64748b'}}>Eq: {t.MaquinaNombre}</div>
                                        </td>
                                        <td>
                                            <span className={`${styles.statusTag} ${t.Estado === 'Abierto' ? styles.StateOpen : styles.StateClosed}`}>
                                                {t.Estado}
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
  );
};

export default ReportFailureModal;