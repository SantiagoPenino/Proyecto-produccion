import React from 'react';

// Estilos inline para badges (puedes moverlos a CSS modules)
const styles = {
    badge: { padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase' },
    blue: { background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' },
    green: { background: '#f0fdf4', color: '#166534' },
    yellow: { background: '#fefce8', color: '#854d0e' },
    red: { background: '#fef2f2', color: '#b91c1c' },
    gray: { background: '#f3f4f6', color: '#4b5563' },
    bold: { fontWeight: '700', color: '#334155' },
    date: { fontSize: '0.75rem', fontWeight: '600', color: '#334155' },
    subDate: { fontSize: '0.65rem', color: '#94a3b8' }
};

const getStatusStyle = (status) => {
    const s = status?.toLowerCase() || '';
    if (s.includes('pendiente')) return styles.gray;
    if (s.includes('imprim') || s.includes('proceso')) return styles.blue;
    if (s.includes('final') || s.includes('listo')) return styles.green;
    if (s.includes('pausa') || s.includes('falla')) return styles.red;
    return styles.gray;
};

// Este componente recibe la orden y la clave de la columna (ej: 'client') y decide qué pintar
const CellRenderer = ({ row, columnKey, handlers }) => {
    
    switch (columnKey) {
        case 'check':
            return (
                <input 
                    type="checkbox" 
                    checked={handlers.isSelected} 
                    onChange={() => handlers.onToggle(row.id)} 
                    style={{ cursor: 'pointer', width:'16px', height:'16px' }} 
                />
            );

        case 'pos':
            return <span style={{color:'#cbd5e1', fontFamily:'monospace'}}>{handlers.index + 1}</span>;

        case 'id':
            return <span style={styles.bold}>#{row.id}</span>;

        case 'client':
            return <div style={{fontWeight:'600', overflow:'hidden', textOverflow:'ellipsis'}}>{row.client}</div>;
        
        case 'desc':
             return <div style={{color:'#64748b', fontSize:'0.8rem'}} title={row.desc}>{row.desc}</div>;

        case 'entryDate':
            return (
                <div style={{display:'flex', flexDirection:'column', lineHeight:'1.2'}}>
                    <span style={styles.date}>{row.entryDate ? new Date(row.entryDate).toLocaleDateString() : '-'}</span>
                    <span style={styles.subDate}>{row.entryDate ? new Date(row.entryDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                </div>
            );
        
        case 'deliveryDate':
             return <span style={{fontSize:'0.75rem', color:'#d97706'}}>{row.deliveryDate ? new Date(row.deliveryDate).toLocaleDateString() : '-'}</span>;

        case 'status':
            return <span style={{...styles.badge, ...getStatusStyle(row.status)}}>{row.status}</span>;

        case 'priority':
            return <span style={{
                ...styles.badge, 
                ...(row.priority === 'Urgente' ? styles.red : row.priority === 'Alta' ? styles.yellow : styles.gray)
            }}>{row.priority}</span>;

        case 'printer':
            return <span style={{background:'#f8fafc', padding:'2px 6px', borderRadius:'4px', fontSize:'0.75rem', color:'#475569'}}>{row.printer || '-'}</span>;

        case 'roll':
             return row.rollId ? <span style={{...styles.badge, ...styles.blue}}>{row.rollId}</span> : <span style={{color:'#e2e8f0'}}>-</span>;

        case 'magnitude':
             return <strong style={{color:'#0f172a'}}>{row.magnitude}</strong>;

        case 'variant':
             return <span>{row.variant}</span>;

        case 'filesCount':
             return row.filesCount > 0 ? <i className="fa-solid fa-paperclip" style={{color:'#3b82f6'}}> {row.filesCount}</i> : null;

        case 'chat':
             return <button style={{border:'none', background:'none', cursor:'pointer', color:'#94a3b8'}}><i className="fa-regular fa-comment-dots"></i></button>;

        default:
            // Fallback: Intenta buscar en el objeto plano o en meta_data
            return <span>{row[columnKey] || row.meta?.[columnKey] || '-'}</span>;
    }
};

export default CellRenderer;