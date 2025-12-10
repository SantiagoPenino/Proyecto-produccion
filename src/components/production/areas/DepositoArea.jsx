import React from 'react';
import ProductionTable from '../components/ProductionTable.jsx';

const DepositoArea = ({ 
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

  const [activeTab, setActiveTab] = React.useState('inventario');

  const openModal = (modalName) => setModals(prev => ({ ...prev, [modalName]: true }));
  const closeModal = (modalName) => setModals(prev => ({ ...prev, [modalName]: false }));

  const areaConfig = {
    name: 'Depósito',
    gridTemplate: '40px 150px 100px 80px 120px 100px',
    headers: ['', 'Item', 'Ubicación', 'Stock', 'Estado', 'Categoría'],
    
    renderRowCells: (order, index, styles) => [
      // Checkbox
      React.createElement('div', { 
        key: 'checkbox',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('input', {
          type: 'checkbox',
          className: styles.checkbox,
          checked: selectedOrders.includes(order.id),
          onChange: () => onToggleSelection(order.id)
        })
      ),

      // Item
      React.createElement('div', { 
        key: 'item',
        className: styles.gridCell 
      },
        React.createElement('div', { className: styles.clientName }, order.item || 'Sin nombre')
      ),

      // Ubicación
      React.createElement('div', { 
        key: 'ubicacion',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { className: styles.locationBadge }, 'A-01-02')
      ),

      // Stock
      React.createElement('div', { 
        key: 'stock',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { className: styles.quantity }, '150u')
      ),

      // Estado
      React.createElement('div', { 
        key: 'estado',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { className: styles.statusBadge }, 'Disponible')
      ),

      // Categoría
      React.createElement('div', { 
        key: 'categoria',
        className: `${styles.gridCell} ${styles.gridCellCenter}` 
      },
        React.createElement('span', { className: styles.categoryBadge }, 'Insumos')
      )
    ]
  };

  const mockInventory = [
    { id: 'INV-001', item: 'Film DTF Blanco', ubicacion: 'A-01-01', stock: '45', estado: 'Disponible', categoria: 'Insumos' },
    { id: 'INV-002', item: 'Tinta DTF Cian', ubicacion: 'B-02-03', stock: '12', estado: 'Bajo Stock', categoria: 'Insumos' },
    { id: 'INV-003', item: 'Polvo DTF', ubicacion: 'C-01-05', stock: '8', estado: 'Crítico', categoria: 'Insumos' },
    { id: 'INV-004', item: 'Playeras Algodón M', ubicacion: 'D-03-02', stock: '150', estado: 'Disponible', categoria: 'Materiales' }
  ];

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
            <h2 style={headerStyles.areaTitle}>Depósito</h2>
            <p style={headerStyles.areaSubtitle}>Inventario</p>
          </div>
          
          <div style={{ height: '2rem', width: '1px', backgroundColor: '#e2e8f0', margin: '0 1rem' }}></div>
          
          <div style={headerStyles.tabButtons}>
            <button 
              onClick={() => setActiveTab('inventario')}
              style={{ 
                ...headerStyles.tabButton, 
                ...(activeTab === 'inventario' ? headerStyles.tabButtonActive : headerStyles.tabButtonInactive)
              }}
            >
              Inventario
            </button>
            <button 
              onClick={() => setActiveTab('movimientos')}
              style={{ 
                ...headerStyles.tabButton, 
                ...(activeTab === 'movimientos' ? headerStyles.tabButtonActive : headerStyles.tabButtonInactive)
              }}
            >
              Movimientos
            </button>
            <button 
              onClick={() => setActiveTab('alertas')}
              style={{ 
                ...headerStyles.tabButton, 
                ...(activeTab === 'alertas' ? headerStyles.tabButtonActive : headerStyles.tabButtonInactive)
              }}
            >
              Alertas Stock
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
            Nuevo Item
          </button>
          <button 
            onClick={() => openModal('report')}
            style={{ ...headerStyles.actionButton, ...headerStyles.buttonFalla }}
          >
            <i className="fa-solid fa-triangle-exclamation"></i>
            Ajuste
          </button>
          <button 
            style={{ ...headerStyles.actionButton, ...headerStyles.buttonNuevaOrden }}
          >
            <i className="fa-solid fa-file-export"></i>
            Exportar
          </button>
        </div>
      </div>

      {/* Contenido principal */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar de Categorías */}
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
              Categorías
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
            {['Insumos DTF', 'Materiales', 'Productos Terminados', 'Herramientas', 'Embalaje'].map((cat, idx) => (
              React.createElement('div', {
                key: idx,
                style: { 
                  padding: '0.5rem',
                  backgroundColor: '#f8fafc',
                  borderLeft: '4px solid #94a3b8',
                  borderRadius: '0.375rem',
                  marginBottom: '0.5rem',
                  cursor: 'pointer'
                }
              },
                React.createElement('div', {
                  style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }
                },
                  React.createElement('span', {
                    style: { fontWeight: 'bold', color: '#475569' }
                  }, cat),
                  React.createElement('span', {
                    style: { color: '#64748b' }
                  }, '25')
                )
              )
            ))}
          </div>
        </div>

        {/* Área de contenido dinámico */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, backgroundColor: 'white', position: 'relative' }}>
          {activeTab === 'inventario' && (
            <ProductionTable
              areaConfig={areaConfig}
              orders={mockInventory}
              selectedOrders={selectedOrders}
              onToggleSelection={onToggleSelection}
            />
          )}
          
          {activeTab === 'movimientos' && (
            React.createElement('div', {
              style: {
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f8fafc',
                color: '#64748b',
                fontSize: '1.125rem'
              }
            }, 'Historial de Movimientos - En desarrollo')
          )}
          
          {activeTab === 'alertas' && (
            React.createElement('div', {
              style: {
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#fef2f2',
                color: '#dc2626',
                fontSize: '1.125rem'
              }
            }, 'Alertas de Stock Bajo - En desarrollo')
          )}
        </div>
      </div>
    </div>
  );
};

// Estilos para Depósito
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
    backgroundColor: '#475569',
    color: 'white',
    boxShadow: '0 1px 3px rgba(71, 85, 105, 0.3)'
  }
};

export default DepositoArea;