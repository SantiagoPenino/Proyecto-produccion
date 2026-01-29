import React, { useState, useMemo } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import Navbar from './Navbar';
import MachineDetailView from '../pages/MachineDetailView';
import Dashboard from '../pages/Dashboard';
import AreaView from '../production/areas/AreaView';
import ConfigPage from '../pages/ConfigPage';
import LogisticsDashboard from '../logistics/LogisticsDashboard';
import OrdersQueryView from '../pages/OrdersQueryView';
import RollHistory from '../pages/RollHistory';
import MenuAdmin from '../pages/MenuAdmin';
import RolesPage from '../pages/RolesPage';
import UsersPage from '../pages/UsersPage';
import AuditPage from '../pages/AuditPage';
import InventoryPage from '../pages/InventoryPage';
import InsumosCatalogPage from '../pages/InsumosCatalogPage';
import StockRequestsPage from '../pages/StockRequestsPage';
import ReceptionPage from '../pages/customer-service/ReceptionPage';
import LogisticsPage from '../pages/customer-service/LogisticsPage'; // Import LogisticsPage
import ActiveStockPage from '../pages/customer-service/ActiveStockPage';
import TransportControlPage from '../pages/TransportControlPage';
import ClientsIntegration from '../pages/ClientsIntegration';



import ChatWidget from '../common/ChatWidget';

// ============================================
// 1. COMPONENTE NAVNODE (Mejorado)
// ============================================
const NavNode = ({ item, openMenus, toggleMenu, navigate, location, level = 0, isCollapsed }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = openMenus[item.IdModulo];
    const isSelected = location.pathname === item.Ruta;

    const baseClasses = "flex items-center mx-2 mb-1 rounded-lg cursor-pointer select-none transition-all duration-200 group relative";
    const paddingLeft = isCollapsed ? '12px' : `${12 + (level * 12)}px`;

    return (
        <div className="w-full">
            <div
                className={`
                    ${baseClasses}
                    ${isSelected
                        ? "bg-blue-600 text-white shadow-md shadow-blue-200"
                        : "text-slate-600 hover:bg-slate-100 hover:text-blue-600"
                    }
                    ${!isCollapsed ? 'py-2.5' : 'py-3 justify-center'}
                `}
                style={{
                    paddingLeft: !isCollapsed ? paddingLeft : undefined,
                }}
                onClick={() => {
                    if (hasChildren) toggleMenu(item.IdModulo);
                    else if (item.Ruta) navigate(item.Ruta);
                }}
                title={isCollapsed ? item.Nombre : ''}
            >
                <div className={`
                    flex items-center justify-center 
                    ${isCollapsed ? 'w-full' : 'w-6 mr-3'} 
                    text-base transition-transform duration-300 group-hover:scale-110
                `}>
                    <i className={`
                        fa-solid ${item.Icono || (hasChildren ? 'fa-folder' : 'fa-circle')} 
                        ${isSelected ? "text-white" : "text-slate-400 group-hover:text-blue-500"}
                    `}></i>
                </div>

                {!isCollapsed && (
                    <>
                        <span className={`flex-1 text-sm font-medium tracking-wide truncate ${isSelected ? 'text-white' : ''}`}>
                            {item.Nombre}
                        </span>

                        {hasChildren && (
                            <i className={`
                                fa-solid fa-chevron-right text-[10px] ml-2 transition-transform duration-300
                                ${isOpen ? "rotate-90" : ""}
                                ${isSelected ? "text-blue-200" : "text-slate-300"}
                            `}></i>
                        )}
                    </>
                )}

                {isCollapsed && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity shadow-lg">
                        {item.Nombre}
                    </div>
                )}
            </div>

            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${hasChildren && isOpen && !isCollapsed ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                {hasChildren && (
                    <div className="mt-1">
                        {item.children.map(child => (
                            <NavNode
                                key={child.IdModulo}
                                item={child}
                                openMenus={openMenus}
                                toggleMenu={toggleMenu}
                                navigate={navigate}
                                location={location}
                                level={level + 1}
                                isCollapsed={isCollapsed}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ============================================
// 2. COMPONENTE PRINCIPAL (Layout)
// ============================================
const MainAppContent = ({ menuItems = [] }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [openMenus, setOpenMenus] = useState({});
    const [isCollapsed, setIsCollapsed] = useState(false);

    const toggleMenu = (id) => setOpenMenus(prev => ({ ...prev, [id]: !prev[id] }));

    const menuTree = useMemo(() => {
        const map = {};
        const tree = [];
        const items = menuItems.map(i => ({ ...i, children: [] }));

        items.forEach(item => { map[item.IdModulo] = item; });
        items.forEach(item => {
            if (item.IdPadre && map[item.IdPadre]) {
                map[item.IdPadre].children.push(item);
            } else if (!item.IdPadre) {
                tree.push(item);
            }
        });

        const sortFn = (a, b) => (a.IndiceOrden || 0) - (b.IndiceOrden || 0);
        const sortRecursive = (nodes) => {
            nodes.sort(sortFn);
            nodes.forEach(node => {
                if (node.children.length > 0) sortRecursive(node.children);
            });
        };
        sortRecursive(tree);
        return tree;
    }, [menuItems]);

    const expandAll = () => {
        const allIds = {};
        menuItems.forEach(item => {
            if (menuItems.some(child => child.IdPadre === item.IdModulo)) {
                allIds[item.IdModulo] = true;
            }
        });
        setOpenMenus(allIds);
    };

    const collapseAll = () => {
        setOpenMenus({});
    };

    return (
        <div className="flex flex-col h-screen bg-slate-50 font-sans">
            <Toaster
                position="top-center"
                richColors
                closeButton
                theme="light"
                toastOptions={{
                    className: 'bg-white/95 backdrop-blur-sm border border-slate-100 shadow-2xl rounded-2xl p-4 !py-4',
                    classNames: {
                        toast: 'group toast group-[.toaster]:bg-white group-[.toaster]:text-slate-800 group-[.toaster]:border-slate-200 group-[.toaster]:shadow-2xl group-[.toaster]:rounded-2xl',
                        title: 'text-slate-900 font-bold text-sm',
                        description: 'text-slate-500 text-xs font-medium',
                        actionButton: 'bg-indigo-600 text-white font-bold rounded-lg px-3 py-2',
                        cancelButton: 'bg-slate-100 text-slate-500 font-bold rounded-lg px-3 py-2',
                        error: 'bg-red-50 border-red-100 text-red-600',
                        success: 'bg-green-50 border-green-100 text-green-600',
                        warning: 'bg-orange-50 border-orange-100 text-orange-600',
                        info: 'bg-blue-50 border-blue-100 text-blue-600',
                    },
                    style: {
                        background: 'white',
                        border: '1px solid #E2E8F0',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    }
                }}
            />
            <Navbar />
            <div className="flex flex-1 overflow-hidden">
                <aside
                    className={`
                        flex flex-col bg-white border-r border-slate-200 shadow-xl z-20
                        transition-all duration-300 ease-in-out h-full
                        ${isCollapsed ? "w-20" : "w-[280px]"}
                    `}
                >
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white min-h-[64px]">
                        {!isCollapsed && (
                            <div className="flex-1 overflow-hidden animate-fade-in">
                                <h2 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-0.5">Sistema</h2>
                                <p className="text-sm font-bold text-slate-800 truncate leading-tight capitalize">
                                    {user?.nombre?.toLowerCase() || user?.usuario || 'Admin'}
                                </p>
                            </div>
                        )}

                        <button
                            className={`
                                flex items-center justify-center rounded-xl
                                w-8 h-8 
                                ${isCollapsed ? 'mx-auto bg-blue-50 text-blue-600 shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}
                                transition-all duration-200 border border-transparent hover:border-slate-200 hover:shadow-sm
                            `}
                            onClick={() => setIsCollapsed(!isCollapsed)}
                            title={isCollapsed ? "Expandir Panel" : "Colapsar Panel"}
                        >
                            <i className={`fa-solid ${isCollapsed ? 'fa-angles-right' : 'fa-angles-left'} text-xs`}></i>
                        </button>
                    </div>

                    {!isCollapsed && (
                        <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 border-b border-slate-100 mb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Navegación</span>
                            <div className="flex gap-1">
                                <button onClick={expandAll} className="p-1.5 rounded-md hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors" title="Expandir todo">
                                    <i className="fa-solid fa-folder-open text-xs"></i>
                                </button>
                                <button onClick={collapseAll} className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Colapsar todo">
                                    <i className="fa-solid fa-folder-closed text-xs"></i>
                                </button>
                            </div>
                        </div>
                    )}

                    <nav className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-1">
                        {menuTree.map(node => (
                            <NavNode
                                key={node.IdModulo}
                                item={node}
                                openMenus={openMenus}
                                toggleMenu={toggleMenu}
                                navigate={navigate}
                                location={location}
                                isCollapsed={isCollapsed}
                            />
                        ))}
                    </nav>

                    {!isCollapsed && (
                        <div className="p-3 border-t border-slate-100 text-center bg-white">
                            <p className="text-[10px] text-slate-300 font-mono">v1.0.5 Producción</p>
                        </div>
                    )}
                </aside>

                <main className="flex-1 overflow-hidden relative bg-slate-50/50 w-full">
                    <div className="absolute inset-0 overflow-y-auto p-6 scroll-smooth">
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/consultas/ordenes" element={<OrdersQueryView />} />
                            <Route path="/consultas/rollos" element={<RollHistory />} />
                            <Route path="/production/machine/:area/:machineId" element={<MachineDetailView />} />
                            <Route path="/area/:areaId/*" element={<DynamicRouter menuItems={menuItems} />} />
                            <Route path="/atencion-cliente/despachos" element={<ActiveStockPage />} />
                            <Route path="/logistica/transporte" element={<TransportControlPage />} />
                            <Route path="/admin/clientes-integration" element={<ClientsIntegration />} />
                            <Route path="/*" element={<DynamicRouter menuItems={menuItems} />} />
                        </Routes>
                    </div>
                </main>
            </div>
            <ChatWidget />
        </div>
    );
};

// ============================================
// 3. DYNAMIC ROUTER
// ============================================
const DynamicRouter = ({ menuItems }) => {
    const location = useLocation();
    const currentPath = location.pathname;

    if (!menuItems || menuItems.length === 0) return (
        <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );

    const matches = menuItems.filter(item => item.Ruta && (currentPath === item.Ruta || currentPath.startsWith(item.Ruta + '/')));
    const menuItem = matches.sort((a, b) => b.Ruta.length - a.Ruta.length)[0];

    // Fallback si no se encuentra ruta exacta
    if (!menuItem) {
        if (currentPath === '/consultas/ordenes') return <OrdersQueryView />;

        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <i className="fa-solid fa-ghost text-4xl mb-4 opacity-50"></i>
                <p className="text-lg font-medium">Ruta no definida</p>
                <p className="text-sm">No se encontró configuración para {currentPath}</p>
            </div>
        );
    }

    if (menuItem.Ruta === '/admin/database') return <ConfigPage />;
    if (menuItem.Ruta === '/admin/menu') return <MenuAdmin />;
    if (menuItem.Ruta === '/admin/roles') return <RolesPage />;
    if (menuItem.Ruta === '/admin/users') return <UsersPage />;
    if (menuItem.Ruta === '/admin/audit') return <AuditPage />;
    if (menuItem.Ruta === '/admin/clientes-integration') return <ClientsIntegration />;
    if (menuItem.Ruta === '/logistica' || menuItem.Ruta.toLowerCase() === '/logistica/') return <LogisticsDashboard />;
    if (menuItem.Ruta === '/ops/inventory') return <LogisticsDashboard />;
    if (menuItem.Ruta === '/inventario') return <InventoryPage />;
    if (menuItem.Ruta === '/insumos') return <InsumosCatalogPage />;
    if (menuItem.Ruta === '/solicitudes') return <StockRequestsPage />;
    if (menuItem.Ruta === '/atencion-cliente/recepcion') return <ReceptionPage />;
    if (menuItem.Ruta === '/atencion-cliente/control') return <LogisticsPage />;
    if (menuItem.Ruta === '/atencion-cliente/despachos') return <ActiveStockPage />;

    if (currentPath === '/consultas/ordenes') return <OrdersQueryView />;



    const segments = menuItem.Ruta.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    const areaKeyFinal = (lastSegment && !['area', 'procesos'].includes(lastSegment.toLowerCase())) ? lastSegment : menuItem.Nombre;

    let areaConfig = {};
    try {
        areaConfig = typeof menuItem.ui_config === 'string' ? JSON.parse(menuItem.ui_config) : (menuItem.ui_config || {});
    } catch (e) { console.error("Error UI Config:", e); }

    return <AreaView key={menuItem.IdModulo} areaKey={areaKeyFinal} areaConfig={areaConfig} />;
};

export default MainAppContent;