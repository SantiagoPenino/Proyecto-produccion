import React from 'react';

const Despacho = ({ onSwitchTab }) => {
  const [dispatchTab, setDispatchTab] = React.useState('scan');

  const renderScanTab = () => (
    React.createElement('div', {
      style: {
        padding: '2rem',
        backgroundColor: '#dcfce7',
        borderRadius: '1rem',
        marginBottom: '2rem'
      }
    },
      React.createElement('h3', {
        style: { color: '#166534', marginBottom: '1rem' }
      }, '1. Escaneo de Ingreso'),
      React.createElement('div', {
        style: {
          display: 'flex',
          gap: '1rem',
          alignItems: 'center'
        }
      },
        React.createElement('input', {
          type: 'text',
          placeholder: 'Escanear código QR o ingresar manualmente...',
          style: {
            flex: 1,
            padding: '1rem',
            border: '2px dashed #22c55e',
            borderRadius: '0.5rem',
            fontSize: '1rem'
          }
        }),
        React.createElement('button', {
          style: {
            padding: '1rem 2rem',
            backgroundColor: '#22c55e',
            color: 'white',
            border: 'none',
            borderRadius: '0.5rem',
            fontWeight: 'bold',
            cursor: 'pointer'
          }
        }, 'Escanear')
      )
    )
  );

  const renderNotifyTab = () => (
    React.createElement('div', {
      style: {
        padding: '2rem',
        backgroundColor: '#dbeafe',
        borderRadius: '1rem',
        marginBottom: '2rem'
      }
    },
      React.createElement('h3', {
        style: { color: '#1e40af', marginBottom: '1rem' }
      }, '2. Notificaciones a Clientes'),
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1rem'
        }
      },
        ['Listo para Retiro', 'En Camino', 'Entregado'].map((status, idx) => (
          React.createElement('div', {
            key: idx,
            style: {
              padding: '1.5rem',
              backgroundColor: 'white',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0'
            }
          },
            React.createElement('h4', {
              style: { marginBottom: '0.5rem', color: '#1e293b' }
            }, status),
            React.createElement('p', {
              style: { color: '#64748b', fontSize: '0.875rem' }
            }, `Órdenes en estado: ${status}`),
            React.createElement('button', {
              style: {
                marginTop: '1rem',
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }
            }, 'Notificar Clientes')
          )
        ))
      )
    )
  );

  const renderContent = () => {
    switch (dispatchTab) {
      case 'scan':
        return renderScanTab();
      case 'notify':
        return renderNotifyTab();
      case 'stock':
        return React.createElement('div', {
          style: {
            padding: '2rem',
            backgroundColor: '#fef3c7',
            borderRadius: '1rem',
            color: '#92400e'
          }
        }, '3. Gestión de Stock para Despacho - En desarrollo');
      case 'create_withdraw':
        return React.createElement('div', {
          style: {
            padding: '2rem',
            backgroundColor: '#fce7f3',
            borderRadius: '1rem',
            color: '#be185d'
          }
        }, '4. Crear Orden de Retiro - En desarrollo');
      case 'withdraw_list':
        return React.createElement('div', {
          style: {
            padding: '2rem',
            backgroundColor: '#e0e7ff',
            borderRadius: '1rem',
            color: '#3730a3'
          }
        }, '5. Lista de Órdenes a Retirar - En desarrollo');
      case 'delivery':
        return React.createElement('div', {
          style: {
            padding: '2rem',
            backgroundColor: '#dcfce7',
            borderRadius: '1rem',
            color: '#166534'
          }
        }, '6. Control de Entregas - En desarrollo');
      default:
        return renderScanTab();
    }
  };

  return (
    React.createElement('div', {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f0fdf4'
      }
    },
      /* Header */
      React.createElement('div', {
        style: {
          padding: '1rem 1.5rem',
          backgroundColor: '#166534',
          borderBottom: '1px solid #15803d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'white'
        }
      },
        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }
        },
          React.createElement('button', {
            onClick: () => onSwitchTab('dashboard'),
            style: {
              color: '#bbf7d0',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
              padding: '0.5rem',
              borderRadius: '0.375rem'
            }
          },
            React.createElement('i', { className: 'fa-solid fa-arrow-left' })
          ),
          React.createElement('h2', {
            style: {
              fontWeight: 'bold',
              fontSize: '1.5rem',
              margin: 0
            }
          }, 'Centro de Despacho')
        ),
        React.createElement('div', {
          style: {
            display: 'flex',
            backgroundColor: '#15803d',
            borderRadius: '0.5rem',
            padding: '0.25rem',
            gap: '0.25rem',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            overflowX: 'auto'
          }
        },
          ['scan', 'notify', 'stock', 'create_withdraw', 'withdraw_list', 'delivery'].map((tab, idx) => 
            React.createElement('button', {
              key: tab,
              onClick: () => setDispatchTab(tab),
              style: {
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                ...(dispatchTab === tab ? {
                  backgroundColor: '#bbf7d0',
                  color: '#166534'
                } : {
                  backgroundColor: 'transparent',
                  color: '#bbf7d0'
                })
              }
            }, `${idx + 1}. ${tab.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}`)
          )
        )
      ),

      /* Contenido */
      React.createElement('div', {
        style: {
          flex: 1,
          padding: '2rem',
          overflowY: 'auto'
        }
      },
        renderContent()
      )
    )
  );
};

export default Despacho;