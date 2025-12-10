import React from 'react';
import ProductionTable from '../components/ProductionTable.jsx';
import Workflow from '../components/Workflow.jsx';

const CosturaArea = ({ 
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
  const [costuraView, setCosturaView] = React.useState('table');

  const openModal = (modalName) => setModals(prev => ({ ...prev, [modalName]: true }));
  const closeModal = (modalName) => setModals(prev => ({ ...prev, [modalName]: false }));

  const areaConfig = {
    name: 'Costura',
    gridTemplate: '40px 40px 60px 80px 150px 150px 200px 80px 60px 70px 90px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Cliente', 'Prenda', 'Flujo', 'Nota', 'Arch.', 'Unid.', 'Estado', 'Chat'],
    
    renderRowCells: (order, index, styles) => [
      // Posición
      React.createElement('div', { 
        key: 'pos',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { 
          className: styles.positionNumber 
        }, (index + 1).toString().padStart(2, '0'))
      ),

      // Orden
      React.createElement('div', { 
        key: 'order',
        className: styles.gridCell 
      },
        React.createElement('span', { 
          className: styles.orderNumber 
        }, `#${order.id}`)
      ),

      // Ingreso
      React.createElement('div', { 
        key: 'ingreso',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('div', { className: styles.date }, '22/11'),
        React.createElement('div', { className: styles.time }, '09:00')
      ),

      // Cliente
      React.createElement('div', { 
        key: 'cliente',
        className: styles.gridCell 
      },
        React.createElement('div', { className: styles.clientName }, order.client || 'Sin cliente')
      ),

      // Prenda
      React.createElement('div', { 
        key: 'prenda',
        className: styles.gridCell 
      },
        React.createElement('div', { className: styles.jobDescription }, order.desc || 'Sin descripción')
      ),

      // Flujo
      React.createElement('div', { 
        key: 'flujo',
        className: styles.gridCell 
      },
        React.createElement('span', { className: styles.flowBadge }, 'Recta>Over')
      ),

      // Nota
      React.createElement('div', { 
        key: 'nota',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        order.note && 
          React.createElement('i', { 
            className: 'fa-solid fa-note-sticky',
            title: order.note 
          })
      ),

      // Archivo
      React.createElement('div', { 
        key: 'archivo',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('i', { 
          className: 'fa-solid fa-file',
          title: 'Patrón listo' 
        })
      ),

      // Unidades
      React.createElement('div', { 
        key: 'unidades',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { className: styles.quantity }, '20u')
      ),

      // Estado
      React.createElement('div', { 
        key: 'estado',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { className: styles.statusBadge }, order.status || 'Confección')
      ),

      // Chat
      React.createElement('div', { 
        key: 'chat',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('button', { className: styles.chatButton },
          React.createElement('i', { className: 'fa-regular fa-comment-dots' })
        )
      )
    ]
  };

  const openFlowManager = () => {
    setCosturaView('flows');
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <div style={headerStyles.headerContainer}>
        <div style={headerStyles.headerLeft}>
          <button
            onClick={() => onSwitchTab('dashboard')}
            style={headerStyles.backButton}
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div>
            <h2 style={headerStyles.areaTitle}>Costura</h2>
            <p style={headerStyles.areaSubtitle}>Producción</p>
          </div>
          
          <div style={{ height: '2rem', width: '1px', backgroundColor: '#e2e8f0', margin: '0 1rem' }}></div>
          
          {/* Tabs principales */}
          <div style={headerStyles.tabButtons}>
            <button 
              onClick={() => setActiveTab('todo')}
              style={{ 
                ...headerStyles.tabButton, 
                ...(activeTab === 'todo' ? headerStyles.tabButtonActive : headerStyles.tabButtonInactive)
              }}
            >
              Para Hacer
            </button>
            <button 
              onClick={() => setActiveTab('all')}
              style={{ 
                ...headerStyles.tabButton, 
                ...(activeTab === 'all' ? headerStyles.tabButtonActive : headerStyles.tabButtonInactive)
              }}
            >
              Todos / Historial
            </button>
          </div>
          
          {/* Tabs específicos de Costura */}
          <div style={costuraTabStyles.tabContainer}>
            <button 
              onClick={() => setCosturaView('table')}
              style={{ 
                ...costuraTabStyles.tabButton, 
                ...(costuraView === 'table' ? costuraTabStyles.tabButtonActive : costuraTabStyles.tabButtonInactive)
              }}
            >
              Órdenes
            </button>
            <button 
              onClick={openFlowManager}
              style={{ 
                ...costuraTabStyles.tabButton, 
                ...(costuraView === 'flows' ? costuraTabStyles.tabButtonActive : costuraTabStyles.tabButtonInactive)
              }}
            >
              <i className="fa-solid fa-list-check"></i> Flujos
            </button>
          </div>
        </div>
        
        <div style={headerStyles.headerRight}>
          <button 
            onClick={() => openModal('settings')}
            style={{ ...headerStyles.actionButton, ...headerStyles.buttonConfig }}
          >
            <i className="fa-solid fa-gear"></i>
          </button>
          <button 
            onClick={() => openModal('stock')}
            style={{ ...headerStyles.actionButton, ...headerStyles.buttonInsumos }}
          >
            <i className="fa-solid fa-boxes-stacked"></i>
            Insumos
          </button>
          <button 
            onClick={() => openModal('report')}
            style={{ ...headerStyles.actionButton, ...headerStyles.buttonFalla }}
          >
            <i className="fa-solid fa-triangle-exclamation"></i>
            Falla
          </button>
          <button 
            onClick={() => openModal('newOrder')}
            style={{ ...headerStyles.actionButton, ...headerStyles.buttonNuevaOrden }}
          >
            <i className="fa-solid fa-plus"></i>
            Nueva Orden
          </button>
        </div>
      </div>

      {/* Contenido principal */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar de Talleres */}
        <div style={{ 
          width: '16rem', 
          backgroundColor: 'white', 
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          <div style={{ 
            padding: '1rem', 
            borderBottom: '1px solid #f1f5f9', 
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ 
              fontWeight: 'bold', 
              fontSize: '0.875rem', 
              color: '#374151',
              margin: 0
            }}>
              Talleres
            </h3>
            <button style={{ 
              color: '#9ca3af',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.75rem'
            }}>
              <i className="fa-solid fa-angles-left"></i>
            </button>
          </div>
          
          <div style={{ flex: 1, overflow: 'auto', padding: '0.5rem' }}>
            <div style={{ 
              padding: '0.5rem',
              backgroundColor: '#fdf2f8',
              borderLeft: '4px solid #f472b6',
              borderRadius: '0.375rem',
              marginBottom: '0.5rem',
              cursor: 'pointer'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ fontWeight: 'bold', color: '#db2777' }}>Taller 1</span>
                <span style={{ color: '#64748b' }}>5 Ord.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Área de contenido dinámico */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, backgroundColor: 'white', position: 'relative' }}>
          {costuraView === 'table' ? (
            <ProductionTable
              areaConfig={areaConfig}
              orders={orders}
              selectedOrders={selectedOrders}
              onToggleSelection={onToggleSelection}
            />
          ) : (
            <WorkflowFlows area="Costura" />
          )}
        </div>
      </div>
    </div>
  );
};

// Estilos para Costura
const headerStyles = {
  headerContainer: {
    backgroundColor: 'white',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'sticky',
    top: 0,
    zIndex: 20
  },
  headerLeft: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center'
  },
  headerRight: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center'
  },
  backButton: {
    color: '#9ca3af',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: '0.5rem',
    borderRadius: '0.375rem',
    transition: 'all 0.2s'
  },
  areaTitle: {
    fontWeight: 'bold',
    fontSize: '1.125rem',
    color: '#1e293b',
    lineHeight: '1.25',
    margin: 0
  },
  areaSubtitle: {
    fontSize: '0.625rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    margin: 0
  },
  tabButtons: {
    display: 'flex',
    backgroundColor: '#f1f5f9',
    borderRadius: '0.375rem',
    padding: '0.25rem',
    gap: '0.25rem'
  },
  tabButton: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    borderRadius: '0.25rem',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  tabButtonActive: {
    backgroundColor: 'white',
    color: '#1e293b',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
  },
  tabButtonInactive: {
    backgroundColor: 'transparent',
    color: '#64748b'
  },
  actionButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s'
  },
  buttonConfig: {
    backgroundColor: '#f1f5f9',
    color: '#64748b'
  },
  buttonInsumos: {
    backgroundColor: '#ffedd5',
    color: '#ea580c',
    border: '1px solid #fdba74'
  },
  buttonFalla: {
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca'
  },
  buttonNuevaOrden: {
    backgroundColor: '#f472b6',
    color: 'white',
    boxShadow: '0 1px 3px rgba(244, 114, 182, 0.3)'
  }
};

const costuraTabStyles = {
  tabContainer: {
    display: 'flex',
    backgroundColor: '#fdf2f8',
    borderRadius: '0.375rem',
    padding: '0.25rem',
    gap: '0.25rem',
    marginLeft: '0.5rem'
  },
  tabButton: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    borderRadius: '0.25rem',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem'
  },
  tabButtonActive: {
    backgroundColor: 'white',
    color: '#db2777',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
  },
  tabButtonInactive: {
    backgroundColor: 'transparent',
    color: '#9ca3af'
  }
};

export default CosturaArea;