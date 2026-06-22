// src/components/utils/rendererMap.js
// 
// MAPEO CENTRALIZADO DE FUNCIONES DE RENDERIZADO PARA LA TABLA DE PRODUCCIÓN.

import React from 'react';

// -----------------------------------------------------
// 1. DEFINICIÓN DE COLUMNAS (defaultColDefs)
// -----------------------------------------------------

const universalColDefs = [
    // Columnas clave
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'code', headerName: 'CÓDIGO', width: 100, pinned: 'left' },
    { field: 'client', headerName: 'Cliente', width: 250 },
    
    // Columnas de detalle
    { field: 'desc', headerName: 'Descripción del Trabajo', flex: 1, minWidth: 300 },
    { field: 'magnitude', headerName: 'Magnitud', width: 100 },
    { field: 'material', headerName: 'Material', width: 180 },
    { field: 'variantCode', headerName: 'Cod. Stock', width: 120 },
    
    // Columnas de estado y tiempo
    { field: 'status', headerName: 'Estado General', width: 130 },
    { field: 'areaStatus', headerName: 'Estado en Área', width: 130 },
    { field: 'priority', headerName: 'Prioridad', width: 100 },
    { field: 'deliveryDate', headerName: 'Entrega Est.', width: 150 },
    
    // Columna de acciones (si la quieres visible por defecto)
    // Nota: Esta es solo la definición del encabezado, el contenido se define en renderRowCells
    { field: 'actions', headerName: 'Acciones', width: 140, suppressColumnsToolPanel: true }, 
];

// -----------------------------------------------------
// 2. RENDERIZADO DE FILAS (renderRowCells)
// -----------------------------------------------------

// Define los botones que aparecen en la última celda de cada fila.
// Esto es lo que define el "look and feel" de DTF/ECOUV que quieres.
const universalRowCells = (params, onAction) => (
    <div style={{ display: 'flex', gap: 8, height: '100%', alignItems: 'center' }}>
        
        {/* Botón de Inicio/Play */}
        <button 
            onClick={() => onAction('start', params.data)} 
            style={{ padding: '4px 8px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8em' }}
            title="Iniciar Proceso / Tomar Orden"
        >
            <i className="fa-solid fa-play"></i>
        </button>
        
        {/* Botón de Detalle/Ver */}
        <button 
            onClick={() => onAction('view', params.data)} 
            style={{ padding: '4px 8px', background: '#e5e7eb', color: '#1f2937', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8em' }}
            title="Ver Detalle"
        >
            <i className="fa-solid fa-eye"></i>
        </button>
        
    </div>
);


// -----------------------------------------------------
// MAPEO CENTRALIZADO
// -----------------------------------------------------
export const RendererMap = {
    
    // DEFINICIÓN DE LA TABLA ESTÁNDAR (La que quieres que usen DTF, ECOUV, etc.)
    'UNIVERSAL_TABLE': {
        renderRowCells: universalRowCells, 
        defaultColDefs: universalColDefs,
    },
    
    // Puedes dejar otras claves apuntando al UNIVERSAL si necesitas distinguirlas en la DB
    'DTF_TABLE': {
        renderRowCells: universalRowCells, 
        defaultColDefs: universalColDefs,
    },
    
    'BORDADO_TABLE': {
        renderRowCells: universalRowCells, 
        defaultColDefs: universalColDefs,
    }
};
