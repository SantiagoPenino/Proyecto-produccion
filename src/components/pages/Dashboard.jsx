import React, { useState, useEffect } from 'react'; // 1. Modificar import
import Sidebar from '../layout/Sidebar.jsx';
import ActivityFeed from '../dashboard/ActivityFeed.jsx';
import { stockService } from '../../services/api.js'; // 2. Importar servicio
import styles from './Dashboard.module.css';

const Dashboard = ({ currentView, onSwitchTab, machines, orders }) => {
  // 3. Crear estado para el contador
  const [urgentStock, setUrgentStock] = useState(0);

  // 4. Cargar el dato al montar el dashboard
  useEffect(() => {
    const loadData = async () => {
        try {
            const count = await stockService.getUrgentCount();
            setUrgentStock(count);
        } catch (error) {
            console.error("Error cargando stock urgente:", error);
        }
    };
    loadData();
  }, []);

  if (currentView !== 'dashboard') return null;

  // KPIs dinámicos
  const kpis = [
    {
      label: 'Órdenes Activas',
      value: orders.filter(o => o.status === 'active').length,
      color: { background: '#dbeafe', border: '#bfdbfe', text: '#1e40af', icon: '#60a5fa' },
      icon: 'fa-clipboard-list'
    },
    {
      label: 'Órdenes Retrasadas',
      value: orders.filter(o => o.status === 'delayed').length,
      color: { background: '#fee2e2', border: '#fecaca', text: '#991b1b', icon: '#f87171' },
      icon: 'fa-triangle-exclamation'
    },
    /* 5. NUEVA TARJETA: INSUMOS URGENTES */
    {
      label: 'Insumos Urgentes',
      value: urgentStock,
      color: { background: '#fff7ed', border: '#fed7aa', text: '#c2410c', icon: '#fb923c' }, // Naranja Alerta
      icon: 'fa-boxes-packing'
    },
    {
      label: 'Mensajes No Leídos',
      value: orders.filter(o => o.unreadMessages).length,
      color: { background: '#fef3c7', border: '#fde68a', text: '#92400e', icon: '#f59e0b' },
      icon: 'fa-comments'
    }
  ];

  return (
    <div className={styles.dashboard}>
      <Sidebar onNavigateToArea={onSwitchTab} />

      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Centro de Control</h1>
          <p>Bienvenido al panel integral de trazabilidad.</p>
        </header>

        {/* Buscador Global */}
        <div className={styles.searchContainer}>
          <div className={styles.searchCard}>
            <div className={styles.searchGradient}></div>
            <div className={styles.searchHeader}>
              <i className="fa-solid fa-magnifying-glass-location"></i>
              <label>Rastreo Global de Órdenes</label>
            </div>
            <div className={styles.searchInput}>
              <i className="fa-solid fa-magnifying-glass"></i>
              <input type="text" placeholder="Buscar por ID, Cliente o Trabajo..." />
            </div>
          </div>
        </div>
        
        <div className={styles.plantStatus}>
          <h3>Estado de Planta en Tiempo Real</h3>
          <div className={styles.statusBadges}>
            <span className={styles.badgeOk}>2 Áreas OK</span>
            <span className={styles.badgeDelayed}>1 Retraso</span>
            <span className={styles.badgeSupport}>1 Soporte</span>
          </div>
        </div>
        
        {/* KPIs */}
        <div className={styles.kpis}>
          {kpis.map((kpi, idx) => (
            <div
              key={idx}
              className={styles.kpiCard}
              style={{ backgroundColor: kpi.color.background, border: `1px solid ${kpi.color.border}` }}
            >
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'start', width:'100%'}}>
                  <div>
                      <p style={{ color: kpi.color.text }} className={styles.kpiLabel}>{kpi.label}</p>
                      <h4 style={{ color: kpi.color.text }} className={styles.kpiValue}>{kpi.value}</h4>
                  </div>
                  <i className={`fa-solid ${kpi.icon}`} style={{ color: kpi.color.icon, fontSize: '1.5rem', opacity: 0.8 }}></i>
              </div>
            </div>
          ))}
        </div>

        {/* Feed de Actividad */}
        <ActivityFeed />
      </main>
    </div>
  );
};

export default Dashboard;