// src/utils/configs/areaConfigs.js
import React from 'react';

// 🎨 Estilos Base (Coinciden con tus módulos CSS)
const s = {
  gridCell: "gridCell",
  gridCellCenter: "gridCellCenter",
  orderNumber: "orderNumber",
  clientName: "clientName",
  jobDescription: "jobDescription",
  statusBadge: "statusBadge",
  machine: "machine",
  date: "date",
  positionNumber: "positionNumber"
};

/* -------------------------------------------------------------------------- */
/* HELPER: Renderizado de Celdas Comunes (Checkbox, ID, Cliente, Estado)      */
/* -------------------------------------------------------------------------- */
const renderCommonCells = (order, index, styles, handlers, extraCells = []) => {
  // Protección contra handlers undefined
  const { isSelected, onToggle } = handlers || { isSelected: false, onToggle: () => {} };
  
  // Formateo de fecha seguro
  const formatDate = (dateString) => {
      if (!dateString) return 'Hoy';
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? 'Hoy' : date.toLocaleDateString('es-ES', {day: '2-digit', month: '2-digit'});
  };

  return [
    // 1. Checkbox
    <div key="check" className={styles.gridCellCenter}>
      <input 
        type="checkbox" 
        checked={isSelected} 
        onChange={() => onToggle(order.id)}
        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
      />
    </div>,
    
    // 2. Posición
    <div key="pos" className={styles.gridCellCenter}>
      <span className={styles.positionNumber}>{(index + 1).toString().padStart(2, '0')}</span>
    </div>,
    
    // 3. ID Orden
    <div key="id" className={styles.gridCell}>
       <span className={styles.orderNumber}>#{order.id}</span>
    </div>,
    
    // 4. Ingreso
    <div key="date" className={styles.gridCellCenter}>
        <span className={styles.date}>{formatDate(order.entryDate)}</span>
    </div>,
    
    // 5. Cliente
    <div key="cli" className={styles.gridCell}>
       <span className={styles.clientName} title={order.client}>{order.client}</span>
    </div>,
    
    // 6. Trabajo
    <div key="desc" className={styles.gridCell}>
       <span className={styles.jobDescription} title={order.desc}>{order.desc}</span>
    </div>,
    
    // --- CELDAS ESPECÍFICAS (Insertadas aquí) ---
    ...extraCells,

    // X. Equipo / Máquina (Común a casi todos)
    <div key="mac" className={styles.gridCellCenter}>
        <span className={styles.machine}>{order.printer || '-'}</span>
    </div>,

    // Y. Estado
    <div key="status" className={styles.gridCellCenter}>
       <span className={`${styles.statusBadge} ${styles[order.status?.replace(/\s/g, '')] || ''}`}>
         {order.status}
       </span>
    </div>,
    
    // Z. Chat / Acciones
    <div key="chat" className={styles.gridCellCenter}>
        <i className="fa-regular fa-comment-dots" style={{color: '#94a3b8', cursor:'pointer'}}></i>
    </div>
  ];
};

/* -------------------------------------------------------------------------- */
/* CONFIGURACIÓN POR ÁREA                                                     */
/* Las claves deben ser 'planilla-' + codigo_bd.toLowerCase()                 */
/* -------------------------------------------------------------------------- */

export const areaConfigs = {
  
  // ==================== IMPRESIÓN ====================

  'planilla-dtf': { 
    name: "Impresión DTF Textil",
    // Grid: Check, Pos, ID, Date, Client, Job | Variante, Magnitud, Rollo | Equipo, Status, Chat
    fileRequirements: [ { type: 'Impresión', label: 'Archivo de Impresión (TIFF/PDF)', required: true } ],
    gridTemplate: "40px 40px 70px 80px 180px 180px 100px 80px 100px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Variante", "Magnitud", "Rollo", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        // Variante (ej: DTF UV)
        <div key="var" className={styles.gridCellCenter}>{o.variant || 'Estándar'}</div>,
        // Magnitud (ej: 15m)
        <div key="mag" className={styles.gridCellCenter}><strong>{o.magnitude || '-'}</strong></div>,
        // Rollo (Badge azul)
        <div key="roll" className={styles.gridCellCenter}>
            {o.rollId ? 
                <span style={{background:'#eff6ff', color:'#2563eb', padding:'2px 8px', borderRadius:'10px', fontSize:'0.75rem', fontWeight:'bold', border:'1px solid #bfdbfe'}}>
                    {o.rollId}
                </span> : 
                <span style={{color:'#cbd5e1'}}>-</span>
            }
        </div>
    ])
  },

  'planilla-sub': { // Si en DB el código es 'SUB'
    name: "Sublimación",
    gridTemplate: "40px 40px 70px 80px 180px 180px 100px 80px 90px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Tela", "Metros", "Papel", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="fab" className={styles.gridCell}>{o.meta?.fabric || '-'}</div>,
        <div key="met" className={styles.gridCellCenter}><strong>{o.magnitude || '0m'}</strong></div>,
        <div key="pap" className={styles.gridCellCenter}>{o.meta?.paper || 'Normal'}</div>
    ])
  },
  
  // Alias por si el sidebar usa nombre largo
  'planilla-sublimacion': { 
    name: "Sublimación",
    gridTemplate: "40px 40px 70px 80px 180px 180px 100px 80px 90px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Tela", "Metros", "Papel", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="fab" className={styles.gridCell}>{o.meta?.fabric || '-'}</div>,
        <div key="met" className={styles.gridCellCenter}><strong>{o.magnitude || '0m'}</strong></div>,
        <div key="pap" className={styles.gridCellCenter}>{o.meta?.paper || 'Normal'}</div>
    ])
  },

  'planilla-uv': {
    name: "Impresión ECO UV",
    gridTemplate: "40px 40px 70px 80px 180px 180px 120px 80px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Material", "Unid.", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="mat" className={styles.gridCell}>{o.variant || 'Rígido'}</div>,
        <div key="uni" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>
    ])
  },

  'planilla-directa': {
    name: "Gigantografía 3.20",
    gridTemplate: "40px 40px 70px 80px 180px 180px 120px 80px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Lona/Vinilo", "m²", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="mat" className={styles.gridCell}>{o.variant || 'Front'}</div>,
        <div key="sqm" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>
    ])
  },

  // ==================== PROCESOS ====================

  'planilla-bord': { // Si en DB es 'BORD'
    name: "Bordado Industrial",
    gridTemplate: "40px 40px 70px 80px 180px 180px 80px 60px 80px 90px 100px 100px 50px",
    fileRequirements: [
        { type: 'Boceto', label: 'Boceto / Arte', required: true },
        { type: 'Matriz', label: 'Archivo Matriz (.DST)', required: false }
    ],
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="pts" className={styles.gridCellCenter}>{o.meta?.stitches ? (o.meta.stitches/1000).toFixed(1)+'k' : '-'}</div>,
        <div key="col" className={styles.gridCellCenter}>{o.meta?.colors || 1}</div>,
        <div key="cnt" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>,
        <div key="mat" className={styles.gridCellCenter}>
             <span style={{fontSize:'0.65rem', fontWeight:'bold', color: o.meta?.matrix_status === 'Aprobado' ? 'green' : 'orange'}}>
                {o.meta?.matrix_status || 'N/A'}
             </span>
        </div>
    ])
  },
  
  // Alias para sidebar
  'planilla-bordado': {
    name: "Bordado Industrial",
    gridTemplate: "40px 40px 70px 80px 180px 180px 80px 60px 80px 90px 100px 100px 50px",
    fileRequirements: [
        { type: 'Boceto', label: 'Boceto / Arte', required: true },
        { type: 'Matriz', label: 'Archivo Matriz (.DST)', required: false }
    ],
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="pts" className={styles.gridCellCenter}>{o.meta?.stitches ? (o.meta.stitches/1000).toFixed(1)+'k' : '-'}</div>,
        <div key="col" className={styles.gridCellCenter}>{o.meta?.colors || 1}</div>,
        <div key="cnt" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>,
        <div key="mat" className={styles.gridCellCenter}>
             <span style={{fontSize:'0.65rem', fontWeight:'bold', color: o.meta?.matrix_status === 'Aprobado' ? 'green' : 'orange'}}>
                {o.meta?.matrix_status || 'N/A'}
             </span>
        </div>
    ])
  },

  'planilla-laser': {
    name: "Corte Láser",
    gridTemplate: "40px 40px 70px 80px 180px 180px 120px 80px 100px 100px 50px",
    fileRequirements: [
        { type: 'Boceto', label: 'Boceto / Arte', required: true },
        { type: 'Matriz', label: 'Archivo Matriz (.DST)', required: false }
    ],
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Material", "Unid.", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="mat" className={styles.gridCell}>{o.variant || 'MDF'}</div>,
        <div key="uni" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>
    ])
  },

  'planilla-costura': {
    name: "Taller de Costura",
    gridTemplate: "40px 40px 70px 80px 180px 180px 120px 80px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Prenda", "Cant.", "Taller", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
        <div key="typ" className={styles.gridCell}>{o.variant || 'Prenda'}</div>,
        <div key="uni" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>
    ])
  },

  // ==================== LOGÍSTICA & SOPORTE ====================
  // Configuraciones mínimas para evitar errores si se navega aquí
  
  'planilla-deposito': { name: "Depósito", gridTemplate: "1fr", headers: ["Vista Inventario"], renderRowCells: () => [] },
  'despacho': { name: "Despacho", gridTemplate: "1fr", headers: ["Lista Despachos"], renderRowCells: () => [] },
  'servicio': { name: "Servicio Técnico", gridTemplate: "1fr", headers: ["Tickets"], renderRowCells: () => [] },
  'infraestructura': { name: "Infraestructura", gridTemplate: "1fr", headers: ["Obras"], renderRowCells: () => [] },
  'planilla-coordinacion': { name: "Coordinación", gridTemplate: "1fr", headers: ["Kanban"], renderRowCells: () => [] }

};