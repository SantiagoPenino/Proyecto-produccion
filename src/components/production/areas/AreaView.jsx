import React, { useState, useEffect, useMemo } from "react";
import ProductionTable from "../components/ProductionTable";
import AreaFilters from "../components/AreaFilters";

// Panel de Detalle Deslizante
import OrderDetailPanel from "../../production/components/OrderDetailPanel";

// Servicios
import { ordersService } from '../../../services/api';

// Vistas Alternativas
import RollsKanban from "../../pages/RollsKanban";
import ProductionKanban from "../../pages/ProductionKanban";

// Modales
import NewOrderModal from "../../modals/NewOrderModal";
import SettingsModal from "../../modals/SettingsModal";
import ReportFailureModal from "../../modals/ReportFailureModal";
import StockRequestModal from "../../modals/StockRequestModal";
import LogisticsCartModal from "../../modals/LogisticsCartModal";
import RollAssignmentModal from "../../modals/RollAssignmentModal";

// Sidebars
import SidebarProcesses from "../../layout/SidebarProcesses";
import RollSidebar from "../../layout/RollSidebar";
import MatrixSidebar from "../../layout/MatrixSidebar";

import { areaConfigs } from "../../utils/configs/areaConfigs";

import styles from "./AreaView.module.css";

export default function AreaView({
  areaKey,
  areaConfig,
  filters = {},
  updateFilter = () => {},
  views = { currentView: "table" },
  switchView = () => {},
  onSwitchTab
}) {
  // --- ESTADOS DE NAVEGACIÓN ---
  const [activeTab, setActiveTab] = useState("todo");
  const [isKanbanMode, setIsKanbanMode] = useState(false);      // Armado de Lotes
  const [isProductionMode, setIsProductionMode] = useState(false); // Lote a Producción

  // --- ESTADOS DE FILTRO ---
  const [sidebarFilter, setSidebarFilter] = useState("ALL"); 
  const [sidebarMode, setSidebarMode] = useState("rolls"); 
  const [clientFilter, setClientFilter] = useState(""); 
  const [variantFilter, setVariantFilter] = useState("ALL");

  // --- DATOS ---
  const [dbOrders, setDbOrders] = useState([]); 
  const [loadingOrders, setLoadingOrders] = useState(false);

  // --- SELECCIÓN ---
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrders, setSelectedOrders] = useState([]);

  // --- MODALES ---
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFailureOpen, setIsFailureOpen] = useState(false);
  const [isStockOpen, setIsStockOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isRollModalOpen, setIsRollModalOpen] = useState(false);

  // 1. CARGAR ÓRDENES
  const fetchOrders = async () => {
      setLoadingOrders(true);
      try {
          const mode = activeTab === 'todo' ? 'active' : 'history';
          const data = await ordersService.getByArea(areaKey, mode);
          setDbOrders(data);
      } catch (error) {
          console.error("Error cargando órdenes:", error);
      } finally {
          setLoadingOrders(false);
      }
  };

  useEffect(() => { if (areaKey) fetchOrders(); }, [areaKey, activeTab]);
  
  // Resetear al cambiar de área
  useEffect(() => { 
      setSidebarFilter("ALL"); 
      setClientFilter("");
      setVariantFilter("ALL");
      setSelectedOrders([]);
      setSidebarMode("rolls");
      setIsKanbanMode(false);
      setIsProductionMode(false);
  }, [areaKey]);

  useEffect(() => {
    if (activeTab === "todo") switchView("table");
    else switchView("history");
  }, [activeTab]);

  // 2. FILTRADO
  const filteredOrders = useMemo(() => {
    let result = dbOrders;
    
    if (sidebarFilter !== 'ALL') {
        if (sidebarMode === 'rolls') result = result.filter(o => o.rollId === sidebarFilter);
        else if (sidebarMode === 'machines') result = result.filter(o => o.printer === sidebarFilter);
        
        if (areaKey === 'BORD' && sidebarMode === 'rolls') result = result.filter(o => o.matrixStatus === sidebarFilter);
    }

    if (clientFilter) result = result.filter(o => o.client.toLowerCase().includes(clientFilter.toLowerCase()));
    if (variantFilter !== 'ALL') result = result.filter(o => o.variant === variantFilter);
    if (filters.printer) result = result.filter(o => o.printer === filters.printer);
    
    return result;
  }, [dbOrders, sidebarFilter, sidebarMode, clientFilter, variantFilter, areaKey, filters]);

  // 3. SIDEBAR (Solo se muestra en vista de tabla)
  const renderSidebar = () => {
    if (areaKey === 'DTF' || areaKey === 'SUB' || areaKey === 'DIRECTA') {
        let sidebarData = dbOrders;
        if (sidebarMode === 'machines') {
            sidebarData = dbOrders.map(o => ({ ...o, rollId: o.printer || 'Sin Asignar' }));
        }

        return (
            <div style={{display:'flex', flexDirection:'column', height:'100%'}}>
                <div className={styles.sidebarSwitcher}>
                    <button className={sidebarMode === 'rolls' ? styles.switchActive : styles.switchBtn} onClick={() => { setSidebarMode('rolls'); setSidebarFilter('ALL'); }}>Lotes</button>
                    <button className={sidebarMode === 'machines' ? styles.switchActive : styles.switchBtn} onClick={() => { setSidebarMode('machines'); setSidebarFilter('ALL'); }}>Equipos</button>
                </div>
                <RollSidebar orders={sidebarData} currentFilter={sidebarFilter} onFilterChange={setSidebarFilter} />
            </div>
        );
    }
    if (areaKey === 'BORD') return <MatrixSidebar orders={dbOrders} currentFilter={sidebarFilter} onFilterChange={setSidebarFilter} />;
    return <SidebarProcesses allAreaConfigs={areaConfigs} currentArea={areaKey} onAreaChange={(key) => onSwitchTab(`planilla-${key.toLowerCase()}`)} />;
  };

  const handleGoBack = () => onSwitchTab && onSwitchTab('dashboard');
  const handleToggleSelection = (id) => setSelectedOrders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const readyCount = dbOrders.filter(o => o.status === 'Finalizado').length;
  const uniqueVariants = [...new Set(dbOrders.map(o => o.variant).filter(Boolean))];

  if (!areaConfig) return <div>Cargando configuración...</div>;

  return (
    <div className={styles.layoutContainer}>
      
      {/* MODALES */}
      <NewOrderModal isOpen={isNewOrderOpen} onClose={() => { setIsNewOrderOpen(false); fetchOrders(); }} areaName={areaConfig.name} areaCode={areaKey} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} area={areaConfig.name} />
      <ReportFailureModal isOpen={isFailureOpen} onClose={() => setIsFailureOpen(false)} areaName={areaConfig.name} areaCode={areaKey} />
      <StockRequestModal isOpen={isStockOpen} onClose={() => setIsStockOpen(false)} areaName={areaConfig.name} areaCode={areaKey} />
      <LogisticsCartModal isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} areaName={areaConfig.name} areaCode={areaKey} onSuccess={() => { setActiveTab('history'); fetchOrders(); }} />
      <RollAssignmentModal isOpen={isRollModalOpen} onClose={() => setIsRollModalOpen(false)} selectedIds={selectedOrders} onSuccess={() => { setSelectedOrders([]); fetchOrders(); }} />

      <header className={styles.headerContainer}>
        <div className={styles.headerTopRow}>
            <div className={styles.titleGroup}>
                <button className={styles.backButton} onClick={handleGoBack}><i className="fa-solid fa-arrow-left"></i></button>
                <div className={styles.titles}><h1>{areaConfig.name}</h1><span className={styles.breadcrumb}>PRODUCCIÓN</span></div>
            </div>
            <div className={styles.navCenter}>
                <div className={styles.viewTabs}>
                    <button className={views.currentView === "table" ? styles.viewTabActive : styles.viewTab} onClick={() => switchView("table")}>Producción</button>
                    <button className={views.currentView === "kanban" ? styles.viewTabActive : styles.viewTab} onClick={() => switchView("kanban")}>Logística</button>
                </div>
                <div className={styles.verticalDivider}></div>
                <div className={styles.filterTabs}>
                    <button className={activeTab === "todo" ? styles.filterTabActive : styles.filterTab} onClick={() => setActiveTab("todo")}>Para Hacer</button>
                    <button className={activeTab === "all" ? styles.filterTabActive : styles.filterTab} onClick={() => setActiveTab("all")}>Historial</button>
                </div>
            </div>
            <div className={styles.actionButtons}>
                 <button className={styles.btnConfig} onClick={() => onSwitchTab('config')} title="Configuración"><i className="fa-solid fa-gear"></i></button>
                 <button className={styles.btnInsumos} onClick={() => setIsStockOpen(true)}><i className="fa-solid fa-boxes-stacked"></i> Insumos</button>
                 <button className={styles.btnFalla} onClick={() => setIsFailureOpen(true)}><i className="fa-solid fa-triangle-exclamation"></i> Falla</button>
                 <button className={styles.btnNew} onClick={() => setIsNewOrderOpen(true)}><i className="fa-solid fa-plus"></i> Nueva Orden</button>
            </div>
        </div>

        {/* FILA DE PROCESOS */}
        <div className={styles.processControlRow}>
            <div className={styles.processActions}>
                {/* Armado de Lotes */}
                <button 
                    className={isKanbanMode ? styles.btnPrimary : styles.btnSecondary} 
                    onClick={() => { setIsKanbanMode(!isKanbanMode); setIsProductionMode(false); }}
                >
                    <i className={`fa-solid ${isKanbanMode ? 'fa-table' : 'fa-layer-group'}`}></i> 
                    {isKanbanMode ? 'Ver Tabla' : 'Armado de Lotes'}
                </button>

                {/* Lote a Producción */}
                {(areaKey === 'DTF' || areaKey === 'SUB') && (
                    <button 
                        className={isProductionMode ? styles.btnPrimary : styles.btnSecondary} 
                        onClick={() => { setIsProductionMode(!isProductionMode); setIsKanbanMode(false); }}
                    >
                        <i className="fa-solid fa-scroll"></i> 
                        {isProductionMode ? 'Ver Tabla' : 'Lote a Producción'}
                    </button>
                )}

                {/* Entrega */}
                <button className={styles.btnEntrega} onClick={() => setIsCartOpen(true)}>
                    <i className="fa-solid fa-cart-shopping" style={{ fontSize: '1.1rem' }}></i>
                    <span style={{marginLeft:5}}>Entrega</span>
                    {readyCount > 0 && <span className={styles.cartBadge}>{readyCount > 99 ? '99+' : readyCount}</span>}
                </button>
            </div>

            <div className={styles.quickFilters}>
                <div className={styles.filterInputGroup}>
                    <i className="fa-solid fa-magnifying-glass"></i>
                    <input type="text" placeholder="Buscar Cliente..." value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} />
                </div>
                <div className={styles.filterInputGroup}>
                    <i className="fa-solid fa-filter"></i>
                    <select value={variantFilter} onChange={(e) => setVariantFilter(e.target.value)}>
                        <option value="ALL">Todas Variantes</option>
                        {uniqueVariants.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                </div>
            </div>
        </div>
      </header>

      {/* CUERPO */}
      <div className={styles.bodyContainer}>
        {/* Sidebar se oculta en modos Kanban */}
        {!isKanbanMode && !isProductionMode && (
            <aside className={styles.sidebarColumn}>
                {renderSidebar()}
            </aside>
        )}
        
        <main className={styles.mainContent}>
            {loadingOrders ? (
                <div style={{textAlign:'center', padding:40, color:'#64748b'}}>Cargando datos...</div>
            ) : (
                <>
                    {isKanbanMode ? (
                        <RollsKanban areaCode={areaKey} />
                    ) : isProductionMode ? (
                        <ProductionKanban areaCode={areaKey} />
                    ) : (
                        <ProductionTable 
                            areaConfig={areaConfig} 
                            orders={filteredOrders} 
                            selectedOrders={selectedOrders}
                            onToggleSelection={handleToggleSelection}
                            onRowClick={(order) => setSelectedOrder(order)}
                        />
                    )}
                </>
            )}
        </main>
      </div>

      <OrderDetailPanel order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </div>
  );
}