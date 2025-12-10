import React from 'react';
import styles from './MatrixSidebar.module.css';

const MatrixSidebar = ({ orders, currentFilter, onFilterChange }) => {
  // Agrupar por estado de matriz (específico de Bordado)
  const matrixGroups = orders.reduce((acc, order) => {
    const status = order.matrixStatus || 'PENDING';
    if (!acc[status]) {
      acc[status] = {
        status,
        orders: [],
        totalStitches: 0
      };
    }
    acc[status].orders.push(order);
    acc[status].totalStitches += order.stitches || 0;
    return acc;
  }, {});

  const getStatusColor = (status) => {
    const colors = {
      APPROVED: 'var(--color-green-500)',
      PENDING: 'var(--color-yellow-500)',
      TESTING: 'var(--color-blue-500)',
      REJECTED: 'var(--color-red-500)'
    };
    return colors[status] || 'var(--color-gray-500)';
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <h3>Matrices / Diseños</h3>
      </div>
      
      <div className={styles.sidebarContent}>
        {/* Filtro Todos */}
        <div
          className={`${styles.matrixItem} ${
            currentFilter === 'ALL' ? styles.active : ''
          }`}
          onClick={() => onFilterChange('ALL')}
        >
          <span className={styles.matrixName}>Todas las Matrices</span>
          <span className={styles.orderCount}>{orders.length}</span>
        </div>
        
        {/* Grupos por estado de matriz */}
        {Object.values(matrixGroups).map(group => (
          <div
            key={group.status}
            className={`${styles.matrixItem} ${
              currentFilter === group.status ? styles.active : ''
            }`}
            onClick={() => onFilterChange(group.status)}
            style={{
              borderLeftColor: getStatusColor(group.status)
            }}
          >
            <span className={styles.matrixName}>
              {group.status === 'APPROVED' ? 'Aprobadas' : 
               group.status === 'PENDING' ? 'Pendientes' : 
               group.status === 'TESTING' ? 'En Prueba' : 'Rechazadas'}
            </span>
            <div className={styles.matrixInfo}>
              <span className={styles.orderCount}>
                {group.orders.length} ord
              </span>
              <span className={styles.stitches}>
                {(group.totalStitches / 1000).toFixed(0)}K pts
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MatrixSidebar;