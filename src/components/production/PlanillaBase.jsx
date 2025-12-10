import React from 'react';
import styles from './PlanillaBase.module.css';

const PlanillaBase = ({ 
  areaConfig,
  orders = [],
  selectedOrders = [],
  onToggleSelection,
  onCreateRoll,
  onSwitchTab
}) => {
  const [currentRollFilter, setCurrentRollFilter] = React.useState('ALL');

  const filteredOrders = orders.filter(order => {
    if (currentRollFilter !== 'ALL' && order.rollId !== currentRollFilter) return false;
    return true;
  });

  const renderTableRow = (order, index) => {
    const isSelected = selectedOrders.includes(order.id);
    
    return (
      <div 
        key={order.id}
        className={`${styles.tableRow} ${isSelected ? styles.selectedRow : ''}`}
        style={{ gridTemplateColumns: areaConfig.gridTemplate }}
      >
        {/* Checkbox */}
        <div className={`${styles.gridCell} ${styles.gridCellCenter}`}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={isSelected}
            onChange={() => onToggleSelection(order.id)}
          />
        </div>

        {/* Contenido específico del área */}
        {areaConfig.renderRowCells(order, index, styles)}
      </div>
    );
  };

  const handleCreateRoll = () => {
    if (selectedOrders.length === 0) {
      alert("Seleccione al menos una orden.");
      return;
    }
    onCreateRoll(selectedOrders);
  };

  const handleDeselectAll = () => {
    selectedOrders.forEach(orderId => onToggleSelection(orderId));
  };

  return (
    <div className={styles.app}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            onClick={() => onSwitchTab('dashboard')}
            className={styles.backButton}
            title="Volver"
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div>
            <h2 className={styles.areaTitle}>{areaConfig.name}</h2>
            <p className={styles.areaSubtitle}>Producción</p>
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className={styles.content}>
        <div className={styles.mainContent}>
          <div className={styles.tableContainer}>
            {/* Header de la tabla */}
            <div 
              className={styles.tableHeader}
              style={{ gridTemplateColumns: areaConfig.gridTemplate }}
            >
              {areaConfig.headers.map((header, index) => (
                <div key={index} className={styles.headerCell}>
                  {header}
                </div>
              ))}
            </div>
            
            {/* Filas de la tabla */}
            <div className={styles.tableBody}>
              {filteredOrders.length > 0 ? 
                filteredOrders.map((order, index) => renderTableRow(order, index)) :
                <div className={styles.emptyState}>
                  No hay órdenes para mostrar
                </div>
              }
            </div>
          </div>
          
          {/* Barra de acciones por lote */}
          {selectedOrders.length > 0 && (
            <div className={styles.batchBar}>
              <span className={styles.selectedCount}>
                {selectedOrders.length} seleccionados
              </span>
              <div className={styles.separator}></div>
              <button
                onClick={handleCreateRoll}
                className={styles.createRollButton}
              >
                Crear Rollo
              </button>
              <button
                onClick={handleDeselectAll}
                className={styles.deselectButton}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanillaBase;