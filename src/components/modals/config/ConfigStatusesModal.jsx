import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';
import styles from '../Modals.module.css';

// Importamos los Modales
//import ConfigPrintersModal from '../
//import ConfigInsumosModal from '../../modals/config/ConfigInsumosModal';
//mport ConfigStatusesModal from '../../modals/config/ConfigStatusesModal';
//import ConfigColumnsModal from '../../modals/config/ConfigColumnsModal';

export default function ConfigPage({ onBack }) {
    const [areas, setAreas] = useState([]); 
    const [selectedArea, setSelectedArea] = useState(null);
    const [loading, setLoading] = useState(false);

    // Estado para detalles (Inicializado completo)
    const [details, setDetails] = useState({ 
        equipos: [], 
        insumos: [], 
        columnas: [],
        estados: [] // <--- ESTE ERA EL QUE FALTABA
    });

    const [activeModal, setActiveModal] = useState(null); 

    useEffect(() => {
        loadAreas();
    }, []);

    const loadAreas = async () => {
        try {
            setLoading(true);
            const data = await areasService.getAll();
            setAreas(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error cargando áreas:", error);
            setAreas([]); 
        } finally {
            setLoading(false);
        }
    };

    const handleSelectArea = (area) => {
        setSelectedArea(area);
        loadAreaDetails(area.code);
    };

    const loadAreaDetails = async (code) => {
        try {
            const data = await areasService.getDetails(code);
            
            // 👇 AQUÍ ESTABA EL ERROR, FALTABA 'estados'
            setDetails({
                equipos: Array.isArray(data?.equipos) ? data.equipos : [],
                insumos: Array.isArray(data?.insumos) ? data.insumos : [],
                columnas: Array.isArray(data?.columnas) ? data.columnas : [],
                estados: Array.isArray(data?.estados) ? data.estados : [] // ¡AGREGADO!
            });
        } catch (error) {
            console.error("Error cargando detalles:", error);
            setDetails({ equipos: [], insumos: [], columnas: [], estados: [] });
        }
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <button onClick={onBack} className={styles.backBtn}>
                    <i className="fa-solid fa-arrow-left"></i> Volver
                </button>
                <h1>Configuración del Sistema</h1>
            </div>

            <div className={styles.layout}>
                
                {/* SIDEBAR */}
                <div className={styles.sidebar}>
                    <h3>Servicios Disponibles</h3>
                    {loading ? (
                        <p style={{color:'#94a3b8', textAlign:'center'}}>Cargando...</p>
                    ) : (
                        (areas || []).map(area => (
                            <div 
                                key={area.code} 
                                className={`${styles.areaItem} ${selectedArea?.code === area.code ? styles.active : ''}`}
                                onClick={() => handleSelectArea(area)}
                            >
                                <span className={styles.areaName}>{area.name}</span>
                                <span className={styles.areaCode}>{area.code}</span>
                            </div>
                        ))
                    )}
                </div>

                {/* CONTENIDO */}
                <div className={styles.content}>
                    {selectedArea ? (
                        <div className={styles.configDashboard}>
                            <div className={styles.dashboardHeader}>
                                <h2>{selectedArea.name}</h2>
                                <span className={styles.badge}>{selectedArea.category || 'General'}</span>
                            </div>
                            
                            <p className={styles.instructionText}>
                                Seleccione qué aspecto desea configurar:
                            </p>

                            {/* GRID DE TARJETAS */}
                            <div className={styles.cardsGrid}>
                                
                                {/* 1. EQUIPOS */}
                                <div className={styles.configCard} onClick={() => setActiveModal('printers')}>
                                    <div className={styles.cardIcon} style={{background: '#e0f2fe', color: '#0284c7'}}>
                                        <i className="fa-solid fa-print"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Equipos y Maquinaria</h3>
                                        <p>Gestionar las {details.equipos.length} máquinas asignadas.</p>
                                    </div>
                                    <div className={styles.cardAction}>
                                        <i className="fa-solid fa-chevron-right"></i>
                                    </div>
                                </div>

                                {/* 2. INSUMOS */}
                                <div className={styles.configCard} onClick={() => setActiveModal('insumos')}>
                                    <div className={styles.cardIcon} style={{background: '#fef3c7', color: '#d97706'}}>
                                        <i className="fa-solid fa-boxes-stacked"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Insumos Habilitados</h3>
                                        <p>Definir materiales productivos.</p>
                                    </div>
                                    <div className={styles.cardAction}>
                                        <i className="fa-solid fa-chevron-right"></i>
                                    </div>
                                </div>

                                {/* 3. ESTADOS (Flujo) */}
                                <div className={styles.configCard} onClick={() => setActiveModal('statuses')}>
                                    <div className={styles.cardIcon} style={{background: '#dcfce7', color: '#166534'}}>
                                        <i className="fa-solid fa-list-check"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Flujo de Estados</h3>
                                        <p>Configurar pasos: {details.estados.length} activos.</p>
                                    </div>
                                    <div className={styles.cardAction}>
                                        <i className="fa-solid fa-chevron-right"></i>
                                    </div>
                                </div>

                                {/* 4. COLUMNAS (Vistas) */}
                                <div className={styles.configCard} onClick={() => setActiveModal('columns')}>
                                    <div className={styles.cardIcon} style={{background: '#f3e8ff', color: '#9333ea'}}>
                                        <i className="fa-solid fa-table-columns"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Vistas y Columnas</h3>
                                        <p>Personalizar tabla de producción.</p>
                                    </div>
                                    <div className={styles.cardAction}>
                                        <i className="fa-solid fa-chevron-right"></i>
                                    </div>
                                </div>

                            </div>
                        </div>
                    ) : (
                        <div className={styles.emptyState}>
                            <div className={styles.emptyIcon}><i className="fa-solid fa-sliders"></i></div>
                            <h3>Selecciona un servicio</h3>
                            <p>Elige un área del menú izquierdo para configurar sus parámetros.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* --- MODALES --- */}
            {selectedArea && (
                <>
                    <ConfigPrintersModal 
                        isOpen={activeModal === 'printers'}
                        onClose={() => { setActiveModal(null); loadAreaDetails(selectedArea.code); }}
                        areaCode={selectedArea.code}
                        equipos={details.equipos}
                    />
                    
                    <ConfigInsumosModal 
                        isOpen={activeModal === 'insumos'}
                        onClose={() => { setActiveModal(null); loadAreaDetails(selectedArea.code); }}
                        areaCode={selectedArea.code}
                        insumos={details.insumos} 
                    />

                    <ConfigStatusesModal 
                        isOpen={activeModal === 'statuses'}
                        onClose={() => { setActiveModal(null); loadAreaDetails(selectedArea.code); }}
                        areaCode={selectedArea.code}
                        initialStatuses={details.estados} // <--- AHORA SÍ TIENE DATOS
                    />

                    <ConfigColumnsModal 
                        isOpen={activeModal === 'columns'}
                        onClose={() => { setActiveModal(null); loadAreaDetails(selectedArea.code); }}
                        areaCode={selectedArea.code}
                        initialColumns={details.columnas}
                    />
                </>
            )}
        </div>
    );
}