import React, { useMemo } from 'react';
import CellRenderer from './CellRenderer';
import styles from "./ProductionTable.module.css"; 

const ProductionTable = ({
  areaConfig,
  orders = [],
  selectedOrders = [],
  onToggleSelection = () => {},
  onRowClick = () => {} // Prop vital para abrir detalle
}) => {

  if (!areaConfig) return <div className={styles.loading}>Cargando configuración...</div>;

  // 1. Configuración de Columnas
  const useDynamic = areaConfig.dbConfig && 
                     areaConfig.dbConfig.columns && 
                     areaConfig.dbConfig.columns.length > 0;
  
  const columns = useDynamic ? areaConfig.dbConfig.columns : []; 
  const gridTemplate = useDynamic ? areaConfig.dbConfig.gridTemplate : areaConfig.gridTemplate;

  // Validación de seguridad
  if (!useDynamic && !areaConfig.headers) {
      return (
        <div className={styles.emptyState}>
            <i className="fa-solid fa-triangle-exclamation" style={{marginBottom: 10, fontSize:'1.5rem'}}></i>
            <br/>Error: No hay columnas configuradas.
        </div>
      );
  }

  // 2. AGRUPAMIENTO POR ESTADO
  const groupedOrders = useMemo(() => {
      const groups = {};
      orders.forEach(order => {
          const status = order.status || 'Sin Estado';
          if (!groups[status]) groups[status] = [];
          groups[status].push(order);
      });
      return groups;
  }, [orders]);

  // Orden lógico
  const statusOrder = ['Pendiente', 'Diseño', 'Cola de Impresión', 'Imprimiendo', 'Horneado', 'Terminación', 'Finalizado', 'Entregado'];
  
  const sortedKeys = Object.keys(groupedOrders).sort((a, b) => {
      const idxA = statusOrder.indexOf(a);
      const idxB = statusOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
  });

  return (
    <div className={styles.tableContainer}>
      
      {/* HEADER (Sticky gracias al CSS) */}
      <div className={styles.headerRow} style={{ gridTemplateColumns: gridTemplate }}>
        {useDynamic ? (
            columns.map((col) => (
                <div key={col.ClaveData} className={styles.headerCell}>{col.Titulo}</div>
            ))
        ) : (
            areaConfig.headers.map((h, i) => (
                <div key={i} className={styles.headerCell}>{h}</div>
            ))
        )}
      </div>

      {/* BODY */}
      <div className={styles.tableBody}>
        
        {orders.length === 0 ? (
             <div className={styles.emptyState}>
                <i className="fa-regular fa-folder-open" style={{fontSize:'2rem', marginBottom:'10px', color:'#cbd5e1'}}></i>
                <p>No hay órdenes en esta vista.</p>
             </div>
        ) : (
            sortedKeys.map(status => (
                <React.Fragment key={status}>
                    
                    {/* CABECERA DE GRUPO (Estado) */}
                    <div className={styles.groupHeader}>
                        <div className={styles.groupTitle}>
                            <span className={`${styles.statusDot} ${styles[status.replace(/\s/g, '')] || styles.defaultDot}`}></span>
                            {status} 
                            <span className={styles.countBadge}>{groupedOrders[status].length}</span>
                        </div>
                    </div>

                    {/* FILAS */}
                    {groupedOrders[status].map((order, index) => {
                        const isSelected = selectedOrders.includes(order.id);
                        return (
                            <div
                              key={order.id}
                              className={`${styles.tableRow} ${isSelected ? styles.selected : ''}`}
                              style={{ gridTemplateColumns: gridTemplate }}
                              onClick={() => onRowClick(order)} // <--- AQUÍ ESTÁ EL CLICK
                            >
                              {useDynamic ? (
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
                                  typeof areaConfig.renderRowCells === 'function' 
                                    ? areaConfig.renderRowCells(order, index, styles, { isSelected, onToggle: onToggleSelection })
                                    : <div className={styles.gridCell}>Error Render</div>
                              )}
                            </div>
                        );
                    })}
                </React.Fragment>
            ))
        )}
      </div>
    </div>
  );
};

export default ProductionTable;