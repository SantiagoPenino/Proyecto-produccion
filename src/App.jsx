import React, { useState, useEffect } from 'react';
import { AppProvider } from './components/contexts/AppContext.jsx';
import { ProductionProvider } from './components/production/context/ProductionContext.jsx';

// Layout
import Navbar from './components/layout/Navbar.jsx';

// Páginas Generales
import Dashboard from './components/pages/Dashboard.jsx';
import Chat from './components/pages/Chat.jsx';
import Metricas from './components/pages/Metricas.jsx';
import Planilla from './components/pages/Planilla.jsx'; 
import ConfigPage from './components/pages/ConfigPage.jsx'; 

// Vista Genérica (Motor Dinámico)
import AreaView from './components/production/areas/AreaView.jsx';

// Vistas Manuales (Tus componentes específicos - Hardcoded)
import ECOUVArea from './components/production/areas/ECOUVArea.jsx';
import TPUUVArea from './components/production/areas/TPUUVArea.jsx';
import Directa320Area from './components/production/areas/Directa320Area.jsx';
import EstampadoArea from './components/production/areas/EstampadoArea.jsx';
import LaserArea from './components/production/areas/LaserArea.jsx';
import CosturaArea from './components/production/areas/CosturaArea.jsx';
import TerminacionUVArea from './components/production/areas/TerminacionUVArea.jsx';
import CoordinacionArea from './components/production/areas/CoordinacionArea.jsx';
import DepositoArea from './components/production/areas/DepositoArea.jsx';
import Despacho from './components/production/areas/Despacho.jsx';
import ServicioTecnico from './components/production/areas/ServicioTecnico.jsx';
import Infraestructura from './components/production/areas/Infraestructura.jsx';

// Servicios y Configs
import { areasService } from './services/api.js';
// Importamos las funciones de renderizado estáticas
import { areaConfigs as staticConfigs } from './components/utils/configs/areaConfigs.jsx'
import { mockMachines, mockOrders } from './data/mockData.js';

import './styles/custom.css';
import "./styles/area-theme.css";

function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [dbAreaConfigs, setDbAreaConfigs] = useState({});
  const [loading, setLoading] = useState(true);

  // 1. CARGAR Y FUSIONAR CONFIGURACIÓN
  useEffect(() => {
    const fetchConfigs = async () => {
        try {
            console.log("🔌 Conectando al backend...");
            // Intentamos obtener datos de la BD
            let areas = [];
            try {
                areas = await areasService.getAll();
            } catch (err) {
                console.warn("⚠️ Backend no disponible, usando modo local.");
            }
            
            const configMap = {};
            
            // Si hay datos de BD, los procesamos
            if (areas && areas.length > 0) {
                areas.forEach(area => {
                    const code = area.code.toUpperCase(); // Ej: 'DTF'
                    
                    // Buscamos la función de renderizado correspondiente en el archivo estático
                    // Clave esperada en areaConfigs.js: 'planilla-dtf'
                    const renderKey = `planilla-${area.code.toLowerCase()}`;
                    const staticConfig = staticConfigs[renderKey] || {};

                    // Parseamos el JSON de UI antiguo (Legacy) si existe
                    const uiConfig = typeof area.ui_config === 'string' 
                        ? JSON.parse(area.ui_config) 
                        : area.ui_config || {};

                    // FUSIÓN CRÍTICA:
                    configMap[code] = {
                        ...staticConfig, // 1. Funciones (renderRowCells)
                        ...uiConfig,     // 2. Datos Legacy JSON
                        
                        // 3. NUEVO: Configuración Relacional (Columnas, Equipos)
                        // Esto viene del backend gracias al join que hicimos en areasController
                        dbConfig: area.dbConfig || null, 
                        
                        renderRowCells: staticConfig.renderRowCells, // Aseguramos explícitamente la función
                        name: area.name,
                        code: area.code
                    };
                });
            } else {
                // Fallback: Si no hay BD, cargamos todo del estático mapeando las claves
                Object.keys(staticConfigs).forEach(key => {
                    const code = key.replace('planilla-', '').toUpperCase();
                    configMap[code] = { ...staticConfigs[key], code };
                });
            }
            
            setDbAreaConfigs(configMap);
            console.log("✅ Configuración lista:", configMap);
        } catch (error) {
            console.error("❌ Error fatal cargando configs:", error);
        } finally {
            setLoading(false);
        }
    };
    
    fetchConfigs();
  }, []);

  const switchTab = (view) => setCurrentView(view);

  const renderCurrentView = () => {
    if (loading) return <div className="loading-screen">Cargando Sistema...</div>;

    switch (currentView) {
      // --- VISTAS GENERALES ---
      case 'dashboard': return <Dashboard currentView={currentView} onSwitchTab={switchTab} machines={mockMachines} orders={mockOrders} />;
      case 'chat': return <Chat onSwitchTab={switchTab} />;
      case 'metricas': return <Metricas onSwitchTab={switchTab} machines={mockMachines} />;
      case 'planilla': return <Planilla onSwitchTab={switchTab} />;
      case 'config': return <ConfigPage onBack={() => switchTab('dashboard')} />;

      // --- VISTAS MANUALES (Prioridad Alta) ---
      // Estas usan componentes específicos y no la vista genérica
      case 'planilla-uv': return <ECOUVArea onSwitchTab={switchTab} />;
      case 'planilla-tpu-uv': return <TPUUVArea onSwitchTab={switchTab} />;
      case 'planilla-directa': return <Directa320Area onSwitchTab={switchTab} />;
      case 'planilla-estampado': return <EstampadoArea onSwitchTab={switchTab} />;
      case 'planilla-laser': return <LaserArea onSwitchTab={switchTab} />;
      case 'planilla-costura': return <CosturaArea onSwitchTab={switchTab} />;
      case 'planilla-terminacion': return <TerminacionUVArea onSwitchTab={switchTab} />;
      case 'planilla-coordinacion': return <CoordinacionArea onSwitchTab={switchTab} />;
      case 'planilla-deposito': return <DepositoArea onSwitchTab={switchTab} />;
      case 'servicio': return <ServicioTecnico onSwitchTab={switchTab} />;
      case 'infraestructura': return <Infraestructura onSwitchTab={switchTab} />;
      case 'despacho': return <Despacho onSwitchTab={switchTab} />;

      // --- VISTAS DINÁMICAS (DTF, Bordado, Sublimación, etc.) ---
      default:
        if (currentView.startsWith('planilla-')) {
            const areaCode = currentView.replace('planilla-', '').toUpperCase();
            
            // 1. Buscamos la configuración ya fusionada
            let config = dbAreaConfigs[areaCode];
            
            // 2. Fallback: Si no está en el mapa fusionado, intentamos buscar directo en estático
            if (!config) {
                config = staticConfigs[currentView];
                if (config) config.code = areaCode;
            }

            // 3. Renderizado Seguro
            if (config && typeof config.renderRowCells === 'function') {
                return (
                    <AreaView 
                        areaKey={areaCode} 
                        areaConfig={config} 
                        onSwitchTab={switchTab} 
                        orders={mockOrders} // Aquí luego usaremos ordersService.getByArea
                    />
                );
            } else {
                return (
                    <div style={{ padding: 40, textAlign: 'center', color: '#dc2626', background:'#fef2f2', margin:20, borderRadius:8 }}>
                        <h2><i className="fa-solid fa-bug"></i> Error de Configuración</h2>
                        <p>El área <strong>{areaCode}</strong> existe en base de datos, pero no tiene función de renderizado (renderRowCells).</p>
                        <p>Verifica que en <code>src/utils/configs/areaConfigs.js</code> exista la clave <code>{currentView}</code>.</p>
                        <button onClick={() => switchTab('dashboard')} style={{marginTop: 20, padding: '10px 20px', cursor:'pointer'}}>Volver al Inicio</button>
                    </div>
                );
            }
        }
        return <div style={{padding: 20}}>Vista desconocida: {currentView}</div>;
    }
  };

  return (
    <AppProvider value={{ currentView, switchTab }}>
      <ProductionProvider>
        <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Navbar currentView={currentView} onSwitchTab={switchTab} />
          {renderCurrentView()}
        </div>
      </ProductionProvider>
    </AppProvider>
  );
}

export default App;