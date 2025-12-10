import React, { useState, useEffect } from 'react';
import { areasService } from '../../services/api';
import styles from './ConfigPage.module.css';

// Importamos los Modales (Asegúrate de haber creado estos archivos en el paso anterior)
import ConfigPrintersModal from '../modals/config/ConfigPrintersModal';
import ConfigInsumosModal from '../modals/config/ConfigInsumosModal';
import ConfigFlowsModal from '../modals/config/ConfigFlowsModal';
import ConfigStatusesModal from '../modals/config/ConfigStatusesModal';
import ConfigColumnsModal from '../modals/config/ConfigColumnsModal';

export default function ConfigPage({ onBack }) {
    // Inicializamos con Arrays vacíos para evitar el error de .map
    const [areas, setAreas] = useState([]);
    const [selectedArea, setSelectedArea] = useState(null);
    const [loading, setLoading] = useState(false);

    // Estado para detalles con estructura segura por defecto
    const [details, setDetails] = useState({
        equipos: [],
        insumos: [],
        columnas: []
    });

    const [activeModal, setActiveModal] = useState(null); // 'printers', 'insumos'

    useEffect(() => {
        loadAreas();
    }, []);

    const loadAreas = async () => {
        setLoading(true);
        console.log("1. Iniciando carga de áreas..."); // LOG 1

        try {
            const data = await areasService.getAll();
            console.log("2. Datos recibidos del backend:", data); // LOG 2

            if (Array.isArray(data) && data.length > 0) {
                setAreas(data);
                console.log("3. Estado 'areas' actualizado con", data.length, "elementos"); // LOG 3
            } else {
                console.warn("⚠️ Recibimos datos vacíos o formato incorrecto:", data);
                setAreas([]);
            }
        } catch (error) {
            console.error("❌ Error en loadAreas:", error);
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
            // Validación de seguridad para detalles
            setDetails({
                equipos: Array.isArray(data?.equipos) ? data.equipos : [],
                insumos: Array.isArray(data?.insumos) ? data.insumos : [],
                columnas: Array.isArray(data?.columnas) ? data.columnas : []
            });
        } catch (error) {
            console.error("Error cargando detalles:", error);
            // Reset seguro en caso de error
            setDetails({ equipos: [], insumos: [], columnas: [] });
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

                {/* SIDEBAR: Lista de Servicios */}
                <div className={styles.sidebar}>
                    <h3>Servicios Disponibles</h3>
                    {loading ? (
                        <p style={{ color: '#94a3b8', textAlign: 'center' }}>Cargando...</p>
                    ) : (
                        // Protección extra: (areas || []).map
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

                {/* CONTENIDO: Panel de Configuración con Tarjetas */}
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

                            {/* GRID DE BOTONES / TARJETAS */}
                            <div className={styles.cardsGrid}>

                                {/* 1. EQUIPOS */}
                                <div className={styles.configCard} onClick={() => setActiveModal('printers')}>
                                    <div className={styles.cardIcon} style={{ background: '#e0f2fe', color: '#0284c7' }}>
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
                                    <div className={styles.cardIcon} style={{ background: '#fef3c7', color: '#d97706' }}>
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

                                {/* 3. VISTAS (Futuro) */}
                                <div className={styles.configCard} style={{ opacity: 0.6, cursor: 'default' }}>
                                    <div className={styles.cardIcon} style={{ background: '#f3e8ff', color: '#9333ea' }}>
                                        <i className="fa-solid fa-table-columns"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Vistas y Columnas</h3>
                                        <p>Personalizar tabla (Próximamente).</p>
                                    </div>
                                </div>
                                {/* 4. FLUJOS DE TRABAJO (NUEVO) */}
                                <div className={styles.configCard} onClick={() => setActiveModal('flows')}>
                                    <div className={styles.cardIcon} style={{ background: '#dcfce7', color: '#166534' }}>
                                        <i className="fa-solid fa-diagram-project"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Rutas de Producción</h3>
                                        <p>Definir flujos paso a paso (Hojas de Ruta).</p>
                                    </div>
                                    <div className={styles.cardAction}>
                                        <i className="fa-solid fa-chevron-right"></i>
                                    </div>
                                </div>
                                {/* ... Tarjetas Equipos e Insumos ... */}

                                {/* 3. ESTADOS (WORKFLOW) */}
                                <div className={styles.configCard} onClick={() => setActiveModal('statuses')}>
                                    <div className={styles.cardIcon} style={{ background: '#dcfce7', color: '#166534' }}>
                                        <i className="fa-solid fa-list-check"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Estados y Proceso</h3>
                                        <p>Definir flujo (Pendiente, Impresión...).</p>
                                    </div>
                                    <div className={styles.cardAction}><i className="fa-solid fa-chevron-right"></i></div>
                                </div>

                                {/* 4. COLUMNAS */}
                                <div className={styles.configCard} onClick={() => setActiveModal('columns')}>
                                    <div className={styles.cardIcon} style={{ background: '#f3e8ff', color: '#9333ea' }}>
                                        <i className="fa-solid fa-table-columns"></i>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <h3>Columnas Tabla</h3>
                                        <p>Personalizar cabeceras visibles.</p>
                                    </div>
                                    <div className={styles.cardAction}><i className="fa-solid fa-chevron-right"></i></div>
                                </div>
                            </div>

                            {/* PREVISUALIZACIÓN RÁPIDA DE EQUIPOS */}
                            <div className={styles.quickPreview}>
                                <h4>Máquinas Activas:</h4>
                                <div className={styles.tagsContainer}>
                                    {details.equipos.length > 0 ? (
                                        details.equipos.map(e => (
                                            <span key={e.EquipoID} className={styles.tag}>
                                                <i className="fa-solid fa-circle" style={{ fontSize: '6px', color: '#22c55e', marginRight: '5px' }}></i>
                                                {e.Nombre}
                                            </span>
                                        ))
                                    ) : (
                                        <span className={styles.emptyTag}>Sin equipos asignados.</span>
                                    )}
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

            {/* --- INYECCIÓN DE MODALES --- */}
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
                    <ConfigFlowsModal
                        isOpen={activeModal === 'flows'}
                        onClose={() => setActiveModal(null)}
                    />
                    <ConfigStatusesModal
                        isOpen={activeModal === 'statuses'}
                        onClose={() => { setActiveModal(null); loadAreaDetails(selectedArea.code); }}
                        areaCode={selectedArea.code}
                        initialStatuses={details.estados || []}
                    />

                    <ConfigColumnsModal
                        isOpen={activeModal === 'columns'}
                        onClose={() => { setActiveModal(null); loadAreaDetails(selectedArea.code); }}
                        areaCode={selectedArea.code}
                        initialColumns={details.columnas || []}
                    />
                </>
            )}
        </div>
    );
}