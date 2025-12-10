import React from 'react';
import styles from './RollSidebar.module.css';

const RollSidebar = ({ orders, currentFilter, onFilterChange }) => {
  // ... tu lógica de reduce igual que antes ...
  const rolls = orders.reduce((acc, order) => {
    if (order.rollId) {
      if (!acc[order.rollId]) acc[order.rollId] = { id: order.rollId, orders: [] };
      acc[order.rollId].orders.push(order);
    }
    return acc;
  }, {});

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <h3>LOTES / ROLLOS</h3>
        <i className="fa-solid fa-angles-left" style={{color: '#cbd5e1', cursor: 'pointer'}}></i>
      </div>
      
      <div className={styles.sidebarContent}>
        {/* Opción TODOS con estilo "Activo" */}
        <div
          className={`${styles.rollItem} ${currentFilter === 'ALL' ? styles.active : ''}`}
          onClick={() => onFilterChange('ALL')}
        >
          <div className={styles.rollHeader}>
             <span className={styles.rollName}>Todos</span>
             <span className={styles.orderCount}>{orders.length}</span>
          </div>
        </div>
        
        {/* Lista de Rollos */}
        {Object.values(rolls).map(roll => (
          <div
            key={roll.id}
            className={`${styles.rollItem} ${currentFilter === roll.id ? styles.active : ''}`}
            onClick={() => onFilterChange(roll.id)}
          >
             <div className={styles.rollHeader}>
                <span className={styles.rollName} style={{color: '#6366f1'}}>Rollo #{roll.id.replace('R-','')}</span>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RollSidebar;