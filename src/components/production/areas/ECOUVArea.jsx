import React from 'react';
import PlanillaBase from '../PlanillaBase.jsx';
import SettingsModal from '../../modals/SettingsModal.jsx';
//import StockModal from '../../modals/StockModal.jsx';
import ReportModal from '../../modals/ReportModal.jsx';
import NewOrderModal from '../../modals/NewOrderModal.jsx';

import styles from './ECOUVArea.module.css';

const ECOUVArea = ({ 
  orders = [], 
  selectedOrders = [], 
  onToggleSelection, 
  onCreateRoll, 
  onSwitchTab 
}) => {
  
  const [modals, setModals] = React.useState({
    settings: false,
    stock: false,
    report: false,
    newOrder: false
  });

  const [activeTab, setActiveTab] = React.useState('todo');
  const [selectedMachine, setSelectedMachine] = React.useState('ALL');

  const openModal = (modalName) => 
    setModals(prev => ({ ...prev, [modalName]: true }));

  const closeModal = (modalName) => 
    setModals(prev => ({ ...prev, [modalName]: false }));

  const areaConfig = {
    name: 'ECO UV',
    gridTemplate:
      '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 60px 70px 90px 120px 50px',

    headers: [
      '',
      'Pos',
      'Orden',
      'Ingreso',
      'Tiempo',
      'Material',
      'Cliente',
      'Trabajo',
      'Nota',
      'Modo',
      'Arch.',
      'Unidades',
      'Estado',
      'Impresora',
      'Chat'
    ],

    renderRowCells: (order, index, cellStyles) => [
      <div key="pos" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <span className={cellStyles.positionNumber}>
          {(index + 1).toString().padStart(2, '0')}
        </span>
      </div>,

      <div key="order" className={cellStyles.gridCell}>
        <span className={cellStyles.orderNumber}>#{order.id}</span>
      </div>,

      <div key="ingreso" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <div className={cellStyles.date}>22/11</div>
        <div className={cellStyles.time}>09:00</div>
      </div>,

      <div key="tiempo" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <div className={cellStyles.timeBadge}>3h</div>
      </div>,

      <div key="material" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <span className={cellStyles.materialBadge}>Acrílico</span>
      </div>,

      <div key="cliente" className={cellStyles.gridCell}>
        <div className={cellStyles.clientName}>{order.client || 'Sin cliente'}</div>
      </div>,

      <div key="trabajo" className={cellStyles.gridCell}>
        <div className={cellStyles.jobDescription}>{order.desc || 'Sin descripción'}</div>
      </div>,

      <div key="nota" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        {order.note && (
          <i className="fa-solid fa-note-sticky" title={order.note} />
        )}
      </div>,

      <div key="modo" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <span className={cellStyles.modeText}>Blanco/Negro</span>
      </div>,

      <div key="archivo" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <i className="fa-solid fa-file" title="Archivo listo" />
      </div>,

      <div key="unidades" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <span className={cellStyles.quantity}>250u</span>
      </div>,

      <div key="estado" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <span className={cellStyles.statusBadge}>{order.status || 'Pendiente'}</span>
      </div>,

      <div key="impresora" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <span className={cellStyles.machine}>Roland LEF</span>
      </div>,

      <div key="chat" className={`${cellStyles.gridCell} ${cellStyles.center}`}>
        <button className={cellStyles.chatButton}>
          <i className="fa-regular fa-comment-dots" />
        </button>
      </div>
    ]
  };

  return (
    <div className={styles.pageWrapper}>
      
      {/* HEADER */}
      <header className={styles.headerContainer}>
        <div className={styles.headerLeft}>
          <button
            onClick={() => onSwitchTab('dashboard')}
            className={styles.backButton}
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>

          <div>
            <h2 className={styles.areaTitle}>ECO UV</h2>
            <p className={styles.areaSubtitle}>Producción</p>
          </div>

          <div className={styles.divider} />

          {/* TABS */}
          <div className={styles.tabButtons}>
            <button
              onClick={() => setActiveTab("todo")}
              className={`${styles.tabButton} ${
                activeTab === "todo" ? styles.tabButtonActive : ""
              }`}
            >
              Para Hacer
            </button>

            <button
              onClick={() => setActiveTab("all")}
              className={`${styles.tabButton} ${
                activeTab === "all" ? styles.tabButtonActive : ""
              }`}
            >
              Todos / Historial
            </button>
          </div>

          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            className={styles.machineFilter}
          >
            <option value="ALL">Todas las Máquinas</option>
            <option value="ROLAND-LEF">Roland LEF</option>
            <option value="UV-02">UV-02</option>
          </select>
        </div>

        <div className={styles.headerRight}>
          <button
            onClick={() => openModal("settings")}
            className={`${styles.actionButton} ${styles.buttonConfig}`}
          >
            <i className="fa-solid fa-gear"></i>
          </button>

          <button
            onClick={() => openModal("stock")}
            className={`${styles.actionButton} ${styles.buttonInsumos}`}
          >
            <i className="fa-solid fa-boxes-stacked"></i>
            Insumos
          </button>

          <button
            onClick={() => openModal("report")}
            className={`${styles.actionButton} ${styles.buttonFalla}`}
          >
            <i className="fa-solid fa-triangle-exclamation"></i>
            Falla
          </button>

          <button
            onClick={() => openModal("newOrder")}
            className={`${styles.actionButton} ${styles.buttonNuevaOrden}`}
          >
            <i className="fa-solid fa-plus"></i>
            Nueva Orden
          </button>
        </div>
      </header>

      {/* CONTENIDO */}
      <div className={styles.contentWrapper}>
        
        {/* SIDEBAR */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h3>Materiales / Lotes</h3>
            <button className={styles.sidebarCollapseButton}>
              <i className="fa-solid fa-angles-left" />
            </button>
          </div>

          <div className={styles.sidebarList}>
            <div className={styles.sidebarItem}>
              <div className={styles.sidebarItemTop}>
                <span className={styles.sidebarItemTitle}>Lote Acrílico</span>
                <span className={styles.sidebarItemCount}>5 Ord.</span>
              </div>
            </div>
          </div>
        </aside>

        {/* TABLA */}
        <main className={styles.tableWrapper}>
          <PlanillaBase
            areaConfig={areaConfig}
            orders={orders}
            selectedOrders={selectedOrders}
            onToggleSelection={onToggleSelection}
            onCreateRoll={onCreateRoll}
            onSwitchTab={onSwitchTab}
          />
        </main>
      </div>

      {/* MODALES */}
      <SettingsModal isOpen={modals.settings} onClose={() => closeModal('settings')} area="UV" />
      <StockModal isOpen={modals.stock} onClose={() => closeModal('stock')} />
      <ReportModal isOpen={modals.report} onClose={() => closeModal('report')} />
      <NewOrderModal isOpen={modals.newOrder} onClose={() => closeModal('newOrder')} area="UV" />

    </div>
  );
};

export default ECOUVArea;
