import React from 'react';

const Infraestructura = ({ onSwitchTab }) => {
  const [infraTab, setInfraTab] = React.useState('tickets');

  const mockInfraTickets = [
    { id: 'INF-001', zona: 'Planta Principal', titulo: 'Luz quemada sector impresión', prioridad: 'Media', estado: 'Pendiente', fecha: '22/11/2024' },
    { id: 'INF-002', zona: 'Oficinas', titulo: 'Aire acondicionado no enfría', prioridad: 'Alta', estado: 'En Progreso', fecha: '21/11/2024' },
    { id: 'INF-003', zona: 'Almacén', titulo: 'Puerta corrediza atascada', prioridad: 'Baja', estado: 'Completado', fecha: '20/11/2024' }
  ];

  const renderTicketsTab = () => (
    React.createElement('div', null,
      React.createElement('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem'
        }
      },
        React.createElement('h3', {
          style: {
            fontSize: '1.25rem',
            fontWeight: 'bold',
            color: '#1e293b',
            margin: 0
          }
        }, 'Tickets de Infraestructura'),
        React.createElement('button', {
          style: {
            padding: '0.5rem 1rem',
            backgroundColor: '#d97706',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }
        },
          React.createElement('i', { className: 'fa-solid fa-plus' }),
          'Nuevo Ticket'
        )
      ),

      React.createElement('div', {
        style: {
          backgroundColor: 'white',
          borderRadius: '0.5rem',
          border: '1px solid #e2e8f0',
          overflow: 'hidden'
        }
      },
        React.createElement('table', {
          style: {
            width: '100%',
            borderCollapse: 'collapse'
          }
        },
          React.createElement('thead', null,
            React.createElement('tr', {
              style: {
                backgroundColor: '#fffbeb',
                borderBottom: '1px solid #fef3c7'
              }
            },
              ['ID', 'Zona', 'Problema', 'Prioridad', 'Estado', 'Fecha'].map(header => 
                React.createElement('th', {
                  key: header,
                  style: {
                    padding: '0.75rem',
                    textAlign: 'left',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    color: '#92400e',
                    textTransform: 'uppercase'
                  }
                }, header)
              )
            )
          ),
          React.createElement('tbody', null,
            mockInfraTickets.map(ticket => 
              React.createElement('tr', {
                key: ticket.id,
                style: {
                  borderBottom: '1px solid #fef3c7',
                  cursor: 'pointer'
                }
              },
                React.createElement('td', {
                  style: {
                    padding: '0.75rem',
                    fontWeight: 'bold',
                    color: '#1e293b',
                    fontFamily: 'monospace'
                  }
                }, ticket.id),
                React.createElement('td', {
                  style: {
                    padding: '0.75rem',
                    color: '#64748b'
                  }
                }, ticket.zona),
                React.createElement('td', {
                  style: {
                    padding: '0.75rem',
                    fontWeight: '600',
                    color: '#374151'
                  }
                }, ticket.titulo),
                React.createElement('td', {
                  style: {
                    padding: '0.75rem'
                  }
                },
                  React.createElement('span', {
                    style: {
                      padding: '0.25rem 0.5rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      backgroundColor: 
                        ticket.prioridad === 'Alta' ? '#fef2f2' :
                        ticket.prioridad === 'Media' ? '#fffbeb' : '#f0fdf4',
                      color: 
                        ticket.prioridad === 'Alta' ? '#dc2626' :
                        ticket.prioridad === 'Media' ? '#d97706' : '#16a34a'
                    }
                  }, ticket.prioridad)
                ),
                React.createElement('td', {
                  style: {
                    padding: '0.75rem'
                  }
                },
                  React.createElement('span', {
                    style: {
                      padding: '0.25rem 0.5rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      backgroundColor: 
                        ticket.estado === 'Pendiente' ? '#fef3c7' :
                        ticket.estado === 'En Progreso' ? '#dbeafe' : '#dcfce7',
                      color: 
                        ticket.estado === 'Pendiente' ? '#d97706' :
                        ticket.estado === 'En Progreso' ? '#1e40af' : '#166534'
                    }
                  }, ticket.estado)
                ),
                React.createElement('td', {
                  style: {
                    padding: '0.75rem',
                    color: '#64748b',
                    fontSize: '0.875rem'
                  }
                }, ticket.fecha)
              )
            )
          )
        )
      )
    )
  );

  const renderZonesTab = () => (
    React.createElement('div', {
      style: {
        backgroundColor: 'white',
        borderRadius: '0.5rem',
        border: '1px solid #e2e8f0',
        padding: '2rem',
        textAlign: 'center',
        color: '#64748b'
      }
    },
      React.createElement('i', {
        className: 'fa-solid fa-map',
        style: { fontSize: '3rem', marginBottom: '1rem', color: '#d1d5db' }
      }),
      React.createElement('h3', {
        style: { marginBottom: '0.5rem', color: '#374151' }
      }, 'Gestión de Zonas'),
      React.createElement('p', null, 'Mapa y gestión de zonas de la planta - En desarrollo')
    )
  );

  const renderContent = () => {
    switch (infraTab) {
      case 'tickets':
        return renderTicketsTab();
      case 'zones':
        return renderZonesTab();
      default:
        return renderTicketsTab();
    }
  };

  return (
    React.createElement('div', {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fffbeb'
      }
    },
      /* Header */
      React.createElement('div', {
        style: {
          padding: '1rem 1.5rem',
          backgroundColor: '#d97706',
          borderBottom: '1px solid #b45309',
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
              color: '#fef3c7',
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
          }, 'Infraestructura')
        ),
        React.createElement('div', {
          style: {
            display: 'flex',
            backgroundColor: '#b45309',
            borderRadius: '0.5rem',
            padding: '0.25rem',
            gap: '0.25rem'
          }
        },
          ['tickets', 'zones'].map(tab => 
            React.createElement('button', {
              key: tab,
              onClick: () => setInfraTab(tab),
              style: {
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 'bold',
                textTransform: 'capitalize',
                transition: 'all 0.2s',
                ...(infraTab === tab ? {
                  backgroundColor: '#f59e0b',
                  color: 'white'
                } : {
                  backgroundColor: 'transparent',
                  color: '#fef3c7'
                })
              }
            }, tab)
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

export default Infraestructura;