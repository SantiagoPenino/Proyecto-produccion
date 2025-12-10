import React from 'react';
import CellRenderer from './CellRenderer'; // Asegúrate de que este archivo exista en la misma carpeta
import styles from "./ProductionTable.module.css"; 

const ProductionTable = ({
  areaConfig,
  orders = [],
  selectedOrders = [],
  onToggleSelection = () => {} 
}) => {

  // Validación inicial de seguridad
  if (!areaConfig) {
      return <div className={styles.loading}>Cargando configuración...</div>;
  }

  // 1. DETERMINAR SI USAMOS CONFIGURACIÓN DINÁMICA (BD) O ESTÁTICA (Archivo JS)
  // Si 'dbConfig' existe y tiene columnas, tiene prioridad.
  const useDynamic = areaConfig.dbConfig && 
                     areaConfig.dbConfig.columns && 
                     areaConfig.dbConfig.columns.length > 0;
  
  // Extraemos las variables según el modo
  const columns = useDynamic ? areaConfig.dbConfig.columns : []; 
  const gridTemplate = useDynamic ? areaConfig.dbConfig.gridTemplate : areaConfig.gridTemplate;

  // Si no hay ninguna configuración válida, mostramos error visual
  if (!useDynamic && !areaConfig.headers) {
      return (
        <div className={styles.emptyState}>
            <i className="fa-solid fa-triangle-exclamation" style={{marginBottom: 10, fontSize: '1.5rem'}}></i>
            <br/>
            Error: No hay columnas configuradas para esta área.
        </div>
      );
  }

  return (
    <div className={styles.tableContainer}>
      
      {/* --- HEADER (Sticky) --- */}
      <div className={styles.headerRow} style={{ gridTemplateColumns: gridTemplate }}>
        {useDynamic ? (
            // A. Header Dinámico (Desde BD)
            columns.map((col) => (
                <div key={col.ClaveData} className={styles.headerCell}>
                    {col.Titulo}
                </div>
            ))
        ) : (
            // B. Header Estático (Fallback Archivo JS)
            areaConfig.headers.map((h, i) => (
                <div key={i} className={styles.headerCell}>{h}</div>
            ))
        )}
      </div>

      {/* --- BODY (Datos) --- */}
      <div className={styles.tableBody}>
        
        {orders.length === 0 ? (
             <div className={styles.emptyState}>
                <i className="fa-regular fa-folder-open" style={{marginBottom: 8}}></i>
                <br/>
                No hay órdenes en esta vista.
             </div>
        ) : (
            orders.map((order, index) => {
                const isSelected = selectedOrders.includes(order.id);
                
                return (
                    <div
                      key={order.id}
                      className={`${styles.tableRow} ${isSelected ? styles.selected : ''}`}
                      style={{ gridTemplateColumns: gridTemplate }}
                      // Opcional: Click en la fila para seleccionar
                      // onClick={() => onToggleSelection(order.id)} 
                    >
                      {useDynamic ? (
                          // A. RENDER DINÁMICO (Usando CellRenderer)
                          columns.map((col) => (
                              <div key={col.ClaveData} className={styles.gridCellCenter}>
                                  <CellRenderer 
                                      row={order} 
                                      columnKey={col.ClaveData} 
                                      handlers={{ isSelected, onToggle: onToggleSelection, index }}
                                  />
                              </div>
                          ))
                      ) : (
                          // B. RENDER ESTÁTICO (Función antigua)
                          // Verificamos que la función exista para no crashear
                          typeof areaConfig.renderRowCells === 'function' 
                            ? areaConfig.renderRowCells(order, index, styles, { isSelected, onToggle: onToggleSelection })
                            : <div className={styles.gridCell}>Error de Renderizado</div>
                      )}
                    </div>
                );
            })
        )}
      </div>
    </div>
  );
};

export default ProductionTable;