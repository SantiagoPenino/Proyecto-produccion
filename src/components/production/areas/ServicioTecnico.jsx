import React, { useState, useEffect } from 'react';
import { failuresService } from '../../../services/api'; // Ajusta la ruta según tu estructura
import styles from './ServicioTecnico.module.css'; // Crearemos este CSS abajo

const ServicioTecnico = ({ onSwitchTab }) => {
  const [activeTab, setActiveTab] = useState('tickets');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);

  // Cargar tickets al montar
  useEffect(() => {
    if (activeTab === 'tickets') {
        loadTickets();
    }
  }, [activeTab]);

  const loadTickets = async () => {
      setLoading(true);
      try {
          const data = await failuresService.getAll();
          setTickets(data);
      } catch (error) {
          console.error("Error cargando tickets:", error);
      } finally {
          setLoading(false);
      }
  };

  // Función para obtener clase de color según prioridad
  const getPrioClass = (prio) => {
      switch(prio) {
          case 'Alta': case 'Urgente': return styles.prioHigh;
          case 'Media': return styles.prioMed;
          default: return styles.prioLow;
      }
  };

  return (
    <div className={styles.container}>
      {/* HEADER TIPO DASHBOARD */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
            <button className={styles.backBtn} onClick={() => onSwitchTab('dashboard')}>
                <i className="fa-solid fa-arrow-left"></i>
            </button>
            <div>
                <h1>Servicio Técnico</h1>
                <span className={styles.subtitle}>Gestión de Mantenimiento Global</span>
            </div>
        </div>
        
        {/* TABS DE NAVEGACIÓN */}
        <div className={styles.tabs}>
            {['tickets', 'machines', 'projects'].map(tab => (
                <button 
                    key={tab}
                    className={`${styles.tabBtn} ${activeTab === tab ? styles.active : ''}`}
                    onClick={() => setActiveTab(tab)}
                >
                    {tab === 'tickets' && <i className="fa-solid fa-ticket"></i>}
                    {tab === 'machines' && <i className="fa-solid fa-screwdriver-wrench"></i>}
                    {tab === 'projects' && <i className="fa-solid fa-clipboard-check"></i>}
                    <span style={{marginLeft:8, textTransform:'capitalize'}}>
                        {tab === 'machines' ? 'Máquinas' : tab === 'projects' ? 'Proyectos' : 'Tickets'}
                    </span>
                </button>
            ))}
        </div>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div className={styles.content}>
        
        {activeTab === 'tickets' && (
            <div className={styles.ticketsView}>
                <div className={styles.toolbar}>
                    <h3>Historial de Incidentes</h3>
                    <button className={styles.refreshBtn} onClick={loadTickets}>
                        <i className="fa-solid fa-rotate-right"></i> Actualizar
                    </button>
                </div>

                <div className={styles.tableCard}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Fecha</th>
                                <th>Área</th>
                                <th>Máquina</th>
                                <th>Falla / Título</th>
                                <th>Prioridad</th>
                                <th>Reportado Por</th>
                                <th>Estado</th>
                                <th>Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="9" style={{textAlign:'center', padding:20}}>Cargando...</td></tr>
                            ) : tickets.length === 0 ? (
                                <tr><td colSpan="9" style={{textAlign:'center', padding:20}}>No hay tickets pendientes.</td></tr>
                            ) : (
                                tickets.map(t => (
                                    <tr key={t.TicketID} className={styles.row}>
                                        <td className={styles.mono}>{t.TicketID}</td>
                                        <td>{new Date(t.FechaReporte).toLocaleDateString()}</td>
                                        <td><span className={styles.areaBadge}>{t.AreaID}</span></td>
                                        <td style={{fontWeight:'bold'}}>{t.Maquina}</td>
                                        <td>
                                            <div className={styles.ticketTitle}>{t.Titulo}</div>
                                            <div className={styles.ticketDesc}>{t.Descripcion?.substring(0, 40)}...</div>
                                        </td>
                                        <td><span className={`${styles.tag} ${getPrioClass(t.Prioridad)}`}>{t.Prioridad}</span></td>
                                        <td>{t.ReportadoPor}</td>
                                        <td>
                                            <span className={`${styles.statusBadge} ${t.Estado === 'Abierto' ? styles.open : styles.closed}`}>
                                                {t.Estado}
                                            </span>
                                        </td>
                                        <td>
                                            <button className={styles.actionBtn} title="Ver Detalles">
                                                <i className="fa-solid fa-eye"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {activeTab === 'machines' && (
            <div className={styles.placeholder}>
                <h3>Inventario de Máquinas</h3>
                <p>Aquí irá el listado de todas las máquinas y su estado operativo.</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default ServicioTecnico;