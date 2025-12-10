import React, { useState } from 'react';
import styles from './Navbar.module.css';

const Navbar = ({ currentView, onSwitchTab }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState({
    chat: 15, // Notificaciones de chat
    bell: 3   // Notificaciones generales
  });

  const handleBellClick = () => {
    setShowNotifications(!showNotifications);
  };

  const handleChatClick = () => {
    onSwitchTab('chat');
    setNotifications(prev => ({
      ...prev,
      chat: 0
    }));
  };

  const notificationItems = [
    { id: 1, text: 'Nueva orden #1234 recibida', time: 'Hace 5min', type: 'order' },
    { id: 2, text: 'Máquina DTF-01 necesita mantenimiento', time: 'Hace 15min', type: 'warning' },
    { id: 3, text: 'Pedro te mencionó en el chat', time: 'Hace 1h', type: 'mention' }
  ];

  return (
    <nav className={styles.navbar}>
      {/* IZQUIERDA */}
      <div className={styles.navLeft}>
        <div className={styles.logo} onClick={() => onSwitchTab('dashboard')}>
          <i className="fa-solid fa-industry"></i>
        </div>
        <div className={styles.title}>
          <h1>Producción<span className={styles.pro}>Pro</span></h1>
          <p>Control de Planta</p>
        </div>

        <button 
  onClick={() => onSwitchTab('dashboard')} 
  className={currentView === 'dashboard' ? styles.activeBtn : styles.navBtn}
>
  <i className="fa-solid fa-house"></i> Inicio
</button>

<button 
  onClick={() => onSwitchTab('metricas')}
  className={currentView === 'metricas' ? styles.activeBtn : styles.navBtn}
>
  <i className="fa-solid fa-chart-pie"></i> Métricas
</button>

<button 
  onClick={() => onSwitchTab('planilla')}   // ← 🔥 FIX REAL
  className={currentView === 'planilla' ? styles.activeBtn : styles.navBtn}
>
  <i className="fa-solid fa-table-list"></i> Planilla Área
</button>

<button 
  onClick={handleChatClick}
  className={currentView === 'chat' ? styles.activeBtn : styles.navBtn}
>
  <i className="fa-solid fa-comments"></i> Chat 
  {notifications.chat > 0 && <span className={styles.notification}></span>}
</button>

      </div>

      {/* DERECHA */}
      <div className={styles.navRight}>
        <div className={styles.viewSelector}>
          <span>Vista:</span>
          <select className={styles.select}>
            <option value="staff">👷‍♂️ Producción</option>
            <option value="client">👤 Cliente</option>
          </select>
        </div>

        <div className={styles.notificationContainer}>
          <div className={styles.notificationBell} onClick={handleBellClick}>
            <i className="fa-solid fa-bell"></i>
            {notifications.bell > 0 && <span className={styles.bellNotification}>{notifications.bell}</span>}
          </div>

          {showNotifications && (
            <div className={styles.notificationDropdown}>
              <div className={styles.dropdownHeader}>
                <h3>Notificaciones</h3>
                <span className={styles.notificationCount}>{notifications.bell} nuevas</span>
              </div>
              <div className={styles.notificationList}>
                {notificationItems.map(item => (
                  <div key={item.id} className={`${styles.notificationItem} ${styles[item.type]}`}>
                    <div className={styles.notificationText}>{item.text}</div>
                    <div className={styles.notificationTime}>{item.time}</div>
                  </div>
                ))}
              </div>
              <div className={styles.dropdownFooter}>
                <button 
                  className={styles.clearAllBtn}
                  onClick={() => setShowNotifications(false)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.avatar}></div>
      </div>
    </nav>
  );
};

export default Navbar;
