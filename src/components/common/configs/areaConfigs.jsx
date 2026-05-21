import React from 'react';

// 🎨 Estilos Base
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

// Formateo de fecha DD/MM/AA HH:mm
const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? '-' : date.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', ''); // Remove comma from "17/02/26, 10:30" => "17/02/26 10:30"
};

/* -------------------------------------------------------------------------- */
/* RENDERIZADO ESTÁNDAR PARA IMPRESIÓN (FLEXIBLE Y ALINEADO)                  */
/* -------------------------------------------------------------------------- */
const renderPrintRow = (o, i, styles, handlers) => {
  const { isSelected, onToggle } = handlers || { isSelected: false, onToggle: () => { } };

  // Estilo para celdas de texto que deben cortarse con "..." si son muy largas
  // Esto evita que la tabla se rompa visualmente.
  const textCellStyle = {
    whiteSpace: 'nowrap',       // No permite salto de línea (mantiene la fila ordenada)
    overflow: 'hidden',         // Oculta lo que sobra
    textOverflow: 'ellipsis',   // Pone "..." al final
    display: 'block',           // Necesario para que el ellipsis funcione
    lineHeight: '30px',         // Centrado vertical aproximado
    fontSize: '0.8rem',
    color: '#1e293b'
  };

  return [
    // 0. Checkbox
    <div key="chk" className={styles.gridCellCenter}>
      <input type="checkbox" checked={isSelected} onChange={() => onToggle(o.id)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
    </div>,

    // 1. Fecha
    <div key="date" className={styles.gridCellCenter}>
      <span className={styles.date} style={{ color: '#64748b', fontSize: '0.75rem' }}>{formatDate(o.entryDate)}</span>
    </div>,

    // 2. Prioridad
    <div key="prio" className={styles.gridCellCenter}>
      {o.priority === 'Urgente' ?
        <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', border: '1px solid #fecaca' }}>URG.</span> :
        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Normal</span>
      }
    </div>,

    // 3. Orden
    <div key="code" className={styles.gridCell}>
      <span className={styles.orderNumber} title={o.code} style={{ fontWeight: '700', color: '#334155', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
        {o.code || `Orden No.: ${o.id}`}
      </span>
    </div>,

    // 4. Cliente (Flexible 1fr)
    <div key="cli" className={styles.gridCell} title={o.client}>
      <span style={textCellStyle}>{o.client}</span>
    </div>,

    // 5. Trabajo (Flexible 1.2fr)
    <div key="job" className={styles.gridCell} title={o.desc}>
      <span style={textCellStyle}>{o.desc}</span>
    </div>,

    // 6. Material (Flexible 2fr - EL MÁS ANCHO)
    <div key="mat" className={styles.gridCell} title={o.material}>
      <span style={{ ...textCellStyle, fontWeight: '500' }}>{o.material || '-'}</span>
    </div>,

    // 7. Variante (CodStock)
    <div key="var" className={styles.gridCellCenter}>
      <span title={o.variantCode} style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace', background: '#f8fafc', padding: '2px 4px', borderRadius: '4px', border: '1px solid #e2e8f0', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {o.variantCode || '-'}
      </span>
    </div>,

    // 8. Archivos
    <div key="files" className={styles.gridCellCenter}>
      <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <i className="fa-regular fa-file-image"></i>
        <b>{o.filesCount || 0}</b>
      </span>
    </div>,

    // 9. Lote
    <div key="roll" className={styles.gridCellCenter}>
      {o.rollId ?
        <span style={{ background: '#eff6ff', color: '#2563eb', padding: '2px 6px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 'bold', border: '1px solid #bfdbfe', whiteSpace: 'nowrap' }}>{o.rollId}</span>
        : <span style={{ color: '#cbd5e1' }}>-</span>
      }
    </div>,

    // 10. Máquina
    <div key="maq" className={styles.gridCellCenter}>
      <span className={styles.machine} style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }} title={o.printer}>
        {o.printer || '-'}
      </span>
    </div>,

    // 11. Nota
    <div key="note" className={styles.gridCellCenter}>
      <i className="fa-regular fa-comment-dots" style={{ color: '#94a3b8', cursor: 'pointer' }}></i>
    </div>
  ];
};

/* -------------------------------------------------------------------------- */
/* RENDERIZADO LEGACY (Bordado, etc.)                                         */
/* -------------------------------------------------------------------------- */
const renderCommonCells = (order, index, styles, handlers, extraCells = []) => {
  const { isSelected, onToggle } = handlers || { isSelected: false, onToggle: () => { } };
  return [
    <div key="check" className={styles.gridCellCenter}><input type="checkbox" checked={isSelected} onChange={() => onToggle(order.id)} style={{ cursor: 'pointer' }} /></div>,
    <div key="pos" className={styles.gridCellCenter}><span className={styles.positionNumber}>{(index + 1).toString().padStart(2, '0')}</span></div>,
    <div key="id" className={styles.gridCell}><span className={styles.orderNumber}>Orden No.: {order.id}</span></div>,
    <div key="date" className={styles.gridCellCenter}><span className={styles.date}>{formatDate(order.entryDate)}</span></div>,
    <div key="cli" className={styles.gridCell}><span className={styles.clientName} title={order.client}>{order.client}</span></div>,
    <div key="desc" className={styles.gridCell}><span className={styles.jobDescription} title={order.desc}>{order.desc}</span></div>,
    ...extraCells,
    <div key="mac" className={styles.gridCellCenter}><span className={styles.machine}>{order.printer || '-'}</span></div>,
    <div key="status" className={styles.gridCellCenter}><span className={`${styles.statusBadge} ${styles[order.status?.replace(/\s/g, '')] || ''}`}>{order.status}</span></div>,
    <div key="chat" className={styles.gridCellCenter}><i className="fa-regular fa-comment-dots" style={{ color: '#94a3b8', cursor: 'pointer' }}></i></div>
  ];
};

/* -------------------------------------------------------------------------- */
/* CONFIGURACIÓN DE ÁREAS (GRID OPTIMIZADO PARA PANTALLA COMPLETA)            */
/* -------------------------------------------------------------------------- */

// DEFINICIÓN DE ANCHOS FLEXIBLES (TOTAL 12 COLUMNAS):
// 1.  Check: 30px (Fijo)
// 2.  Fecha: 95px (Fijo -- AUMENTADO DE 60px)
// 3.  Prio:  60px (Fijo)
// 4.  Orden: 110px (Fijo)
// 5.  Cliente: 1fr (Flexible)
// 6.  Trabajo: 1.2fr (Un poco más ancho)
// 7.  Material: 2fr (El DOBLE de ancho que Cliente, aquí va el texto largo)
// 8.  Var: 70px (Fijo)
// 9.  Arch: 50px (Fijo)
// 10. Lote: 70px (Fijo)
// 11. Maq: 90px (Fijo)
// 12. Nota: 40px (Fijo)

const FLEXIBLE_GRID = "30px 95px 60px 110px 1fr 1.2fr 2fr 70px 50px 70px 90px 40px";
const FLEXIBLE_HEADERS = ["", "Fecha", "Prio.", "Orden", "Cliente", "Trabajo", "Material", "Var.", "Arch.", "Lote", "Máq.", ""];

export const areaConfigs = {

  'DTF': {
    name: "Impresión DTF Textil",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'planilla-dtf': {
    name: "Impresión DTF Textil",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },

  // --- NUEVA ÁREA: IMD / XMD ---
  'IMD': {
    name: "Impresión Digital",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'XMD': {
    name: "Impresión Digital",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'planilla-imd': {
    name: "Impresión Digital",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },

  'ECOUV': {
    name: "Impresión EcoUV",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'planilla-ecouv': {
    name: "Impresión EcoUV",
    fileRequirements: [{ type: 'Impresión', label: 'Archivo de Impresión', required: true }],
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },

  'SUB': {
    name: "Sublimación",
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'planilla-sub': {
    name: "Sublimación",
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'planilla-sublimacion': {
    name: "Sublimación",
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },
  'planilla-directa': {
    name: "Gigantografía 3.20",
    gridTemplate: FLEXIBLE_GRID,
    headers: FLEXIBLE_HEADERS,
    renderRowCells: renderPrintRow
  },

  // --- ÁREAS LEGACY ---
  // Ajustado gridTemplate para columna Fecha (Index 3 - "Ingreso") de 80px a 95px
  'planilla-bord': {
    name: "Bordado Industrial",
    gridTemplate: "40px 40px 70px 95px 180px 180px 80px 60px 80px 90px 100px 100px 50px",
    fileRequirements: [{ type: 'Boceto', label: 'Boceto', required: true }],
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
      <div key="pts" className={styles.gridCellCenter}>{o.meta?.stitches ? (o.meta.stitches / 1000).toFixed(1) + 'k' : '-'}</div>,
      <div key="col" className={styles.gridCellCenter}>{o.meta?.colors || 1}</div>,
      <div key="cnt" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>,
      <div key="mat" className={styles.gridCellCenter}><span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>{o.meta?.matrix_status || 'N/A'}</span></div>
    ])
  },
  'planilla-bordado': {
    name: "Bordado Industrial",
    gridTemplate: "40px 40px 70px 95px 180px 180px 80px 60px 80px 90px 100px 100px 50px",
    fileRequirements: [{ type: 'Boceto', label: 'Boceto', required: true }],
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
      <div key="pts" className={styles.gridCellCenter}>{o.meta?.stitches ? (o.meta.stitches / 1000).toFixed(1) + 'k' : '-'}</div>,
      <div key="col" className={styles.gridCellCenter}>{o.meta?.colors || 1}</div>,
      <div key="cnt" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>,
      <div key="mat" className={styles.gridCellCenter}><span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>{o.meta?.matrix_status || 'N/A'}</span></div>
    ])
  },
  'planilla-laser': {
    name: "Corte Láser",
    gridTemplate: "40px 40px 70px 95px 180px 180px 120px 80px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Material", "Unid.", "Equipo", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
      <div key="mat" className={styles.gridCell}>{o.variant || 'MDF'}</div>,
      <div key="uni" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>
    ])
  },
  'planilla-costura': {
    name: "Taller de Costura",
    gridTemplate: "40px 40px 70px 95px 180px 180px 120px 80px 100px 100px 50px",
    headers: ["", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Prenda", "Cant.", "Taller", "Estado", ""],
    renderRowCells: (o, i, styles, h) => renderCommonCells(o, i, styles, h, [
      <div key="typ" className={styles.gridCell}>{o.variant || 'Prenda'}</div>,
      <div key="uni" className={styles.gridCellCenter}><strong>{o.magnitude || '0'}</strong></div>
    ])
  },
  'planilla-deposito': { name: "Depósito", gridTemplate: "1fr", headers: ["Vista Inventario"], renderRowCells: () => [] },
  'despacho': { name: "Despacho", gridTemplate: "1fr", headers: ["Lista Despachos"], renderRowCells: () => [] },
  'servicio': { name: "Servicio Técnico", gridTemplate: "1fr", headers: ["Tickets"], renderRowCells: () => [] },
  'infraestructura': { name: "Infraestructura", gridTemplate: "1fr", headers: ["Obras"], renderRowCells: () => [] },
  'planilla-coordinacion': { name: "Coordinación", gridTemplate: "1fr", headers: ["Kanban"], renderRowCells: () => [] }
};
