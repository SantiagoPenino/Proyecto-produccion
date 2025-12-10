import React, { useState, useEffect } from 'react';
import { ordersService, stockService, areasService } from '../../services/api'; 
import axios from 'axios';
import styles from './Modals.module.css';

// Componente botón Drive
const DriveButton = () => (
    <button type="button" className={styles.driveBtn} onClick={() => window.open('https://drive.google.com', '_blank')}>
        <i className="fa-brands fa-google-drive"></i> Abrir Drive
    </button>
);

const NewOrderModal = ({ isOpen, onClose, areaName, areaCode }) => {
  const [activeTab, setActiveTab] = useState('info'); 
  const [loading, setLoading] = useState(false);
  
  // Datos Maestros
  const [prioritiesConfig, setPrioritiesConfig] = useState([]);
  const [availableAreas, setAvailableAreas] = useState([]);
  
  // Estados del Formulario
  const [orderData, setOrderData] = useState({
    cliente: '',
    descripcion: '',
    prioridad: 'Normal',
    variante: '',
    magnitud: '0.00m', // Se calculará automático
    fechaEntrega: '',
    nota: ''
  });

  // Clientes Combo
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  // Materiales
  const [materials, setMaterials] = useState([]);
  const [matSearch, setMatSearch] = useState('');
  const [matQty, setMatQty] = useState(1);
  const [matSuggestions, setMatSuggestions] = useState([]);

  // Flujo
  const [workflow, setWorkflow] = useState([]);

  // Archivos
  const [files, setFiles] = useState([]);
  const [newFile, setNewFile] = useState({ 
      nombre: '', 
      link: '', 
      tipo: 'Impresión', // Tipo por defecto más común
      copias: 1, 
      metros: 0 
  });

  // Configuración de archivos requeridos según área
  const fileReqs = [
      { type: 'Impresión', label: 'Impresión', required: true },
      { type: 'Boceto', label: 'Boceto', required: false },
      { type: 'Guía', label: 'Guía', required: false }
  ];

  // 1. CARGA INICIAL
  useEffect(() => {
    if (isOpen && areaCode) {
        loadConfig();
        // Reset completo al abrir
        setOrderData({ cliente: '', descripcion: '', prioridad: 'Normal', variante: '', magnitud: '0.00m', fechaEntrega: '', nota: '' });
        setFiles([]);
        setMaterials([]);
        setWorkflow([]);
        setActiveTab('info');
    }
  }, [isOpen, areaCode]);

  // 2. CÁLCULO AUTOMÁTICO DE MAGNITUD
  // Cada vez que cambia la lista de archivos, recalculamos el total
  useEffect(() => {
      const totalMetros = files.reduce((acc, file) => {
          return acc + (parseFloat(file.metros || 0) * parseInt(file.copias || 1));
      }, 0);
      
      // Actualizamos el campo magnitud visualmente
      setOrderData(prev => ({
          ...prev,
          magnitud: totalMetros > 0 ? `${totalMetros.toFixed(2)}m` : ''
      }));
  }, [files]);

  const loadConfig = async () => {
      try {
          const responsePrio = await ordersService.getPriorities(areaCode);
          setPrioritiesConfig(responsePrio);
          const responseAreas = await areasService.getAll();
          setAvailableAreas(responseAreas.filter(a => a.code !== areaCode));
      } catch (e) { console.error(e); }
  };

  // --- CLIENTES ---
  const handleClientSearch = async (val) => {
      setOrderData({...orderData, cliente: val});
      if(val.length > 1) {
          try {
             // Asumiendo ruta directa o servicio
             // const res = await clientsService.search(val); 
             // setClientSuggestions(res);
             // setShowClientDropdown(true);
          } catch(e){}
      } else setShowClientDropdown(false);
  };

  // --- ARCHIVOS ---
  const addFileToList = () => {
      if (!newFile.nombre || !newFile.link) return alert("Nombre y Link son obligatorios");
      if (newFile.metros <= 0 && newFile.tipo === 'Impresión') return alert("Indica la medida del archivo");

      setFiles([...files, { ...newFile, id: Date.now() }]);
      // Resetear inputs, manteniendo el link por si sube varios del mismo folder
      setNewFile({ ...newFile, nombre: '', copias: 1, metros: 0 });
  };

  const removeFile = (id) => {
      setFiles(files.filter(f => f.id !== id));
  };

  // --- SUBMIT ---
  const handleSubmit = async () => {
      if(!orderData.cliente || !orderData.descripcion) return alert("Faltan datos básicos");
      
      // Validar si hay archivos de impresión
      if (files.length === 0) {
          const confirmNoFiles = confirm("⚠️ No has cargado archivos. ¿Crear orden sin archivos?");
          if(!confirmNoFiles) return setActiveTab('files');
      }

      setLoading(true);
      try {
          const payload = {
              areaId: areaCode,
              clienteNombre: orderData.cliente,
              ...orderData, // Incluye la magnitud calculada
              materiales: materials,
              flujo: workflow,
              archivos: files
          };

          await ordersService.create(payload);
          alert("✅ Orden creada con éxito");
          onClose();
      } catch (error) {
          alert("Error: " + error.message);
      } finally { setLoading(false); }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalLarge}>
        
        <div className={styles.modalHeaderTabs}>
            <div className={styles.headerTitle}>Nueva Orden: {areaName}</div>
            <div className={styles.tabsContainer}>
                <button className={`${styles.tabBtn} ${activeTab==='info'?styles.tabActive:''}`} onClick={()=>setActiveTab('info')}>Información</button>
                <button className={`${styles.tabBtn} ${activeTab==='files'?styles.tabActive:''}`} onClick={()=>setActiveTab('files')}>
                    Archivos ({files.length})
                </button>
                <button className={`${styles.tabBtn} ${activeTab==='mats'?styles.tabActive:''}`} onClick={()=>setActiveTab('mats')}>Materiales</button>
            </div>
            <button onClick={onClose} className={styles.closeButton}><i className="fa-solid fa-xmark"></i></button>
        </div>

        <div className={styles.modalContent}>
            
            {/* TAB 1: INFO */}
            {activeTab === 'info' && (
                <div className={styles.formContainer}>
                    <div className={styles.rowGroup}>
                        <div className={styles.formGroup} style={{flex:2}}>
                            <label>Cliente</label>
                            <input type="text" className={styles.textInput} placeholder="Buscar cliente..." 
                                value={orderData.cliente} onChange={(e) => handleClientSearch(e.target.value)} autoFocus />
                        </div>
                        <div className={styles.formGroup} style={{flex:1}}>
                             <label>Total Calculado</label>
                             <input type="text" className={styles.textInput} value={orderData.magnitud} readOnly 
                                style={{fontWeight:'bold', color:'#2563eb', background:'#f8fafc', textAlign:'center'}} 
                                placeholder="Suma archivos"
                             />
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label>Descripción del Trabajo</label>
                        <input type="text" className={styles.textInput} placeholder="Ej: 50 Remeras Logo Espalda" value={orderData.descripcion} onChange={e=>setOrderData({...orderData, descripcion:e.target.value})} />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Variante / Material</label>
                        <input type="text" className={styles.textInput} placeholder="Ej: DTF UV, DryFit..." value={orderData.variante} onChange={e=>setOrderData({...orderData, variante:e.target.value})} />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Prioridad</label>
                        <div className={styles.stepperContainer}>
                            {['Normal', 'Alta', 'Urgente'].map((prio, idx) => (
                                <div key={prio} 
                                     className={`${styles.stepItem} ${orderData.prioridad === prio ? styles.stepActive : ''}`}
                                     onClick={() => setOrderData({...orderData, prioridad: prio})}
                                >
                                    <span>{prio}</span>
                                </div>
                            ))}
                            <div className={styles.stepLine}></div>
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label>Notas Internas</label>
                        <textarea className={styles.textArea} rows="2" placeholder="Ojo con..." value={orderData.nota} onChange={e=>setOrderData({...orderData, nota:e.target.value})}></textarea>
                    </div>
                </div>
            )}

            {/* TAB 2: ARCHIVOS CON MEDIDAS */}
            {activeTab === 'files' && (
                <div className={styles.filesContainer}>
                    
                    <div className={styles.addFileBox}>
                        <h4 style={{margin:'0 0 10px 0', fontSize:'0.9rem', color:'#334155'}}>Agregar Archivo y Medidas</h4>
                        
                        <div className={styles.rowGroup}>
                            <div className={styles.formGroup} style={{flex:2}}>
                                <label style={{fontSize:'0.75rem'}}>Nombre Archivo</label>
                                <input type="text" className={styles.textInput} placeholder="Ej: logo_final.pdf" 
                                    value={newFile.nombre} onChange={e=>setNewFile({...newFile, nombre:e.target.value})}
                                />
                            </div>
                            <div className={styles.formGroup} style={{flex:1}}>
                                <label style={{fontSize:'0.75rem'}}>Tipo</label>
                                <select className={styles.selectInput} value={newFile.tipo} onChange={e=>setNewFile({...newFile, tipo:e.target.value})}>
                                    {fileReqs.map(req => <option key={req.type} value={req.type}>{req.type}</option>)}
                                    <option value="General">General</option>
                                </select>
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label style={{fontSize:'0.75rem'}}>Enlace (Drive/Nube)</label>
                            <div style={{display:'flex', gap:5}}>
                                <input type="text" className={styles.textInput} placeholder="https://..." 
                                    value={newFile.link} onChange={e=>setNewFile({...newFile, link:e.target.value})}
                                />
                                <DriveButton />
                            </div>
                        </div>

                        <div className={styles.rowGroup} style={{alignItems:'flex-end'}}>
                            <div className={styles.formGroup}>
                                <label style={{fontSize:'0.75rem'}}>Copias</label>
                                <input type="number" min="1" className={styles.textInput} value={newFile.copias} onChange={e=>setNewFile({...newFile, copias:e.target.value})} />
                            </div>
                            <div className={styles.formGroup}>
                                <label style={{fontSize:'0.75rem', color:'#2563eb', fontWeight:'bold'}}>Largo (Metros)</label>
                                <input type="number" step="0.1" className={styles.textInput} placeholder="0.00" 
                                    value={newFile.metros} onChange={e=>setNewFile({...newFile, metros:e.target.value})} 
                                    style={{borderColor:'#bfdbfe', background:'#eff6ff'}}
                                />
                            </div>
                            <div style={{paddingBottom:'10px', fontSize:'0.8rem', color:'#64748b', fontWeight:'600'}}>
                                Total: {(newFile.copias * newFile.metros).toFixed(2)}m
                            </div>
                            <button className={styles.saveButton} onClick={addFileToList} style={{marginBottom:'2px'}}>
                                <i className="fa-solid fa-plus"></i> Agregar
                            </button>
                        </div>
                    </div>

                    <div className={styles.tableContainer}>
                        <table className={styles.cleanTable}>
                            <thead>
                                <tr>
                                    <th>Archivo</th>
                                    <th>Tipo</th>
                                    <th className="text-center">Cant.</th>
                                    <th className="text-center">Medida</th>
                                    <th className="text-right">Subtotal</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {files.map(f => (
                                    <tr key={f.id} className={styles.tableRow}>
                                        <td className={styles.tableCell} style={{fontWeight:'600'}}>{f.nombre}</td>
                                        <td className={styles.tableCell}><span className={styles.fileTag}>{f.tipo}</span></td>
                                        <td className={styles.tableCell} style={{textAlign:'center'}}>{f.copias}</td>
                                        <td className={styles.tableCell} style={{textAlign:'center'}}>{f.metros}m</td>
                                        <td className={styles.tableCell} style={{textAlign:'right', fontWeight:'bold', color:'#2563eb'}}>
                                            {(f.copias * f.metros).toFixed(2)}m
                                        </td>
                                        <td className={styles.tableCell} style={{textAlign:'center'}}>
                                            <button onClick={() => removeFile(f.id)} className={styles.removeFileBtn}><i className="fa-solid fa-trash"></i></button>
                                        </td>
                                    </tr>
                                ))}
                                {files.length === 0 && <tr><td colSpan="6" style={{padding:20, textAlign:'center', color:'#999'}}>Agrega archivos para calcular el total.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 3: MATERIALES (Simplificado para este ejemplo) */}
            {activeTab === 'mats' && (
                <div className={styles.formContainer}>
                    <p style={{textAlign:'center', color:'#999'}}>Funcionalidad de materiales ya implementada anteriormente.</p>
                </div>
            )}

        </div>

        <div className={styles.modalFooter}>
            <div style={{marginRight:'auto', fontWeight:'bold', color:'#475569'}}>
                Total Orden: <span style={{fontSize:'1.1rem', color:'#2563eb'}}>{orderData.magnitud}</span>
            </div>
            <button className={styles.saveButton} onClick={handleSubmit} disabled={loading}>
                {loading ? 'Guardando...' : 'Crear Orden'}
            </button>
        </div>

      </div>
    </div>
  );
};

export default NewOrderModal;