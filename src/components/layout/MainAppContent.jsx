import { useState, useMemo, Suspense, lazy } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import Navbar from './Navbar';
const MachineDetailView = lazy(() => import('../pages/MachineDetailView'));
import Dashboard from '../pages/Dashboard';
import AreaView from '../production/areas/AreaView';
const ConfigPage = lazy(() => import('../pages/ConfigPage'));
const LogisticsDashboard = lazy(() => import('../logistics/LogisticsDashboard'));
const OrdersQueryView = lazy(() => import('../pages/OrdersQueryView'));
const RollHistory = lazy(() => import('../pages/RollHistory'));
const MenuAdmin = lazy(() => import('../pages/MenuAdmin'));
const RolesPage = lazy(() => import('../pages/RolesPage'));
const UsersPage = lazy(() => import('../pages/UsersPage'));
const AuditPage = lazy(() => import('../pages/AuditPage'));
const InventoryPage = lazy(() => import('../pages/InventoryPage'));
const InsumosCatalogPage = lazy(() => import('../pages/InsumosCatalogPage'));
const StockRequestsPage = lazy(() => import('../pages/StockRequestsPage'));
const ReceptionPage = lazy(() => import('../pages/customer-service/ReceptionPage'));
const LogisticsPage = lazy(() => import('../pages/customer-service/LogisticsPage'));
const ActiveStockPage = lazy(() => import('../pages/customer-service/ActiveStockPage'));
const TransportControlPage = lazy(() => import('../pages/TransportControlPage'));
const EcoUvFinishing = lazy(() => import('../pages/EcoUvFinishing'));
const WebRetirosPage = lazy(() => import('../logistics/WebRetirosPage'));
const ClientsIntegration = lazy(() => import('../pages/ClientsIntegration'));
import ChatWidget from '../common/ChatWidget';
const ProductsIntegration = lazy(() => import('../pages/ProductsIntegration'));
const SpecialPrices = lazy(() => import('../pages/SpecialPrices'));
const BasePrices = lazy(() => import('../pages/BasePrices'));
const PriceProfiles = lazy(() => import('../pages/PriceProfiles'));
const LabelGenerationPage = lazy(() => import('../pages/LabelGenerationPage'));
const DepositStockPage = lazy(() => import('../logistics/DepositStockPage'));
const CustomerReplacementPage = lazy(() => import('../pages/customer-service/CustomerReplacementPage'));
const CustomerPriceCatalogPage = lazy(() => import('../pages/CustomerPriceCatalogPage'));
const IntegralOrderView = lazy(() => import('../pages/IntegralOrderView'));
const CargaPagosView = lazy(() => import('../pages/CargaPagosView'));
const VerificarPagosOnlineView = lazy(() => import('../pages/VerificarPagosOnlineView'));

// ============================================
// 1. COMPONENTE NAVNODE (Mejorado)
// ============================================
const NavNode = ({ item, openMenus, toggleMenu, navigate, location, level = 0, isCollapsed, setIsCollapsed }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = openMenus[item.IdModulo];
    const isChildActive = hasChildren && item.children.some(c => location.pathname === c.Ruta || (c.Ruta && location.pathname.startsWith(c.Ruta + '/')));
    const isSelected = location.pathname === item.Ruta || (hasChildren && isChildActive);

    const baseClasses = "flex items-center mx-2 mb-2 rounded-lg cursor-pointer select-none transition-all duration-200 group relative";
    const paddingLeft = isCollapsed ? '12px' : `${12 + (level * 12)}px`;

    return (
        <div className="w-full">
            <div
                className={`
                    ${baseClasses}
                    ${isSelected
                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                        : "text-slate-100 opacity-70 hover:opacity-100 hover:bg-zinc-800 hover:text-white hover:scale-[1.05]"
                    }
                    ${!isCollapsed ? 'py-2.5' : 'py-3 justify-center'}
                `}
                style={{
                    paddingLeft: !isCollapsed ? paddingLeft : undefined,
                }}
                onClick={() => {
                    if (hasChildren) {
                        if (isCollapsed) setIsCollapsed(false);
                        const wasOpen = openMenus[item.IdModulo];
                        toggleMenu(item.IdModulo);
                        if (!wasOpen) {
                            const firstChild = item.children.find(c => c.Ruta);
                            if (firstChild) navigate(firstChild.Ruta);
                        }
                    } else if (item.Ruta) navigate(item.Ruta);
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
                        ${isSelected ? "text-white" : "text-slate-300 group-hover:text-blue-500"}
                    `}></i>
                </div>

                {!isCollapsed && (
                    <>
                        <span className={`flex-1 text-xs font-medium tracking-wide truncate ${isSelected ? 'text-white' : 'text-slate-100'}`}>
                            {item.Nombre}
                        </span>

                        {hasChildren && (
                            <i className={`
                                fa-solid fa-chevron-right text-[10px] mr-2 transition-transform duration-300
                                ${isOpen ? "rotate-90" : ""}
                                ${isSelected ? "text-blue-500" : "text-slate-100"}
                            `}></i>
                        )}
                    </>
                )}

            </div>

            <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                    maxHeight: hasChildren && isOpen && !isCollapsed ? '1000px' : '0px',
                    opacity: hasChildren && isOpen && !isCollapsed ? 1 : 0,
                }}
            >
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
                                setIsCollapsed={setIsCollapsed}
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

    console.log(`[MainAppContent] Render! Path: ${location.pathname}, Key: ${location.key}`);

    const toggleMenu = (id) => setOpenMenus(prev => {
        const wasOpen = prev[id];
        if (!wasOpen) {
            // Encontrar hermanos (mismo padre) para cerrarlos
            const item = menuItems.find(m => m.IdModulo === id);
            const siblings = menuItems.filter(m => m.IdPadre === (item?.IdPadre || null) && m.IdModulo !== id);
            const siblingIds = new Set(siblings.map(s => s.IdModulo));
            const next = {};
            // Mantener ancestros abiertos, cerrar hermanos
            Object.entries(prev).forEach(([k, v]) => {
                if (v && !siblingIds.has(Number(k) || k)) next[k] = true;
            });
            next[id] = true;
            return next;
        }
        return { ...prev, [id]: false };
    });

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
                        flex flex-col bg-zinc-900 border-r border-zinc-700 shadow-xl z-20
                        transition-all duration-300 ease-in-out h-full
                        ${isCollapsed ? "w-20" : "w-[280px]"}
                    `}
                >
                    <div className="flex items-center justify-around px-4 border-b border-zinc-700 bg-zinc-900 min-h-[64px]">
                        {!isCollapsed && (
                            <div className="flex px-2 items-center justify-between">
                                <button
                                    onClick={() => Object.values(openMenus).some(v => v) ? collapseAll() : expandAll()}
                                    className="rounded-md text-slate-100 hover:text-blue-500 transition-colors"
                                    title={Object.values(openMenus).some(v => v) ? "Colapsar todo" : "Expandir todo"}
                                >
                                    <i className={`fa-solid ${Object.values(openMenus).some(v => v) ? 'fa-angles-up' : 'fa-angles-down'} `}></i>
                                </button>
                            </div>

                        )}
                        <button
                            className={`
                                flex items-center justify-center 
                                hover:text-blue-500 transition-colors
                                ${isCollapsed ? 'mx-auto text-slate-100' : 'text-slate-100'}
                            `}
                            onClick={() => setIsCollapsed(!isCollapsed)}
                            title={isCollapsed ? "Expandir Panel" : "Colapsar Panel"}
                        >
                            <i className={`fa-solid ${isCollapsed ? 'fa-angles-right' : 'fa-angles-left'}`}></i>
                        </button>
                    </div>



                    <nav className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-2 uppercase">
                        {menuTree.map(node => (
                            <NavNode
                                key={node.IdModulo}
                                item={node}
                                openMenus={openMenus}
                                toggleMenu={toggleMenu}
                                navigate={navigate}
                                location={location}
                                isCollapsed={isCollapsed}
                                setIsCollapsed={setIsCollapsed}
                            />
                        ))}
                    </nav>

                    {!isCollapsed && (
                        <div className="p-3 border-t border-zinc-700 text-center bg-zinc-900">
                            <p className="text-[10px] text-slate-300 font-mono">v1.0.5 Producción</p>
                        </div>
                    )}
                </aside>

                <main className="flex-1 overflow-hidden relative bg-slate-50/50 w-full">
                    <div className="absolute inset-0 overflow-y-auto p-6 scroll-smooth">
                        <Suspense fallback={
                            <div className="flex items-center justify-center h-full ">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                            </div>
                        }>
                            <Routes>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/consultas/ordenes" element={<OrdersQueryView />} />
                                <Route path="/consultas/integral" element={<IntegralOrderView />} />
                                <Route path="/consultas/rollos" element={<RollHistory />} />
                                <Route path="/production/machine/:area/:machineId" element={<MachineDetailView />} />
                                <Route path="/area/:areaId/*" element={<DynamicRouter menuItems={menuItems} />} />
                                <Route path="/atencion-cliente/despachos" element={<ActiveStockPage />} />
                                <Route path="/atencion-cliente/reposiciones" element={<CustomerReplacementPage />} />
                                <Route path="/logistica/transporte" element={<TransportControlPage />} />
                                <Route path="/logistica/stock-deposito" element={<DepositStockPage />} />
                                <Route path="/logistica/retiros-web" element={<WebRetirosPage />} />
                                <Route path="/admin/clientes-integration" element={<ClientsIntegration />} />
                                <Route path="/admin/products-integration" element={<ProductsIntegration />} />
                                <Route path="/admin/special-prices" element={<SpecialPrices />} />
                                <Route path="/admin/base-prices" element={<BasePrices />} />
                                <Route path="/admin/price-profiles" element={<PriceProfiles />} />
                                <Route path="/admin/price-catalog" element={<CustomerPriceCatalogPage />} />
                                <Route path="/produccion/etiquetas" element={<LabelGenerationPage />} />
                                <Route path="/caja/pagos" element={<CargaPagosView />} />
                                <Route path="/caja/pagos-online" element={<VerificarPagosOnlineView />} />
                                <Route path="/*" element={<DynamicRouter menuItems={menuItems} />} />
                            </Routes>
                        </Suspense>
                    </div>
                </main>
            </div>
            {/* <ChatWidget /> */}
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
    if (menuItem.Ruta === '/produccion/etiquetas') return <LabelGenerationPage />;
    if (menuItem.Ruta === '/admin/clientes-integration') return <ClientsIntegration />;
    if (menuItem.Ruta === '/admin/products-integration') return <ProductsIntegration />;
    if (menuItem.Ruta === '/admin/price-catalog') return <CustomerPriceCatalogPage />;
    if (menuItem.Ruta === '/produccion/terminaciones' || menuItem.Ruta === '/area/ecouv/terminaciones') return <EcoUvFinishing />;
    if (menuItem.Ruta === '/logistica' || menuItem.Ruta.toLowerCase() === '/logistica/') return <LogisticsDashboard />;
    if (menuItem.Ruta === '/ops/inventory') return <LogisticsDashboard />;
    if (menuItem.Ruta === '/inventario') return <InventoryPage />;
    if (menuItem.Ruta === '/insumos') return <InsumosCatalogPage />;
    if (menuItem.Ruta === '/solicitudes') return <StockRequestsPage />;
    if (menuItem.Ruta === '/atencion-cliente/recepcion') return <ReceptionPage />;
    if (menuItem.Ruta === '/atencion-cliente/control') return <LogisticsPage />;
    if (menuItem.Ruta === '/atencion-cliente/despachos') return <ActiveStockPage />;
    if (menuItem.Ruta === '/atencion-cliente/reposiciones') return <CustomerReplacementPage />;
    if (menuItem.Ruta === '/logistica/retiros-web') return <WebRetirosPage />;
    if (menuItem.Ruta === '/caja/pagos' || menuItem.Ruta.toLowerCase() === '/caja/pagos/') return <CargaPagosView />;

    // NEW: Historial de Lotes
    if (menuItem.Ruta === '/consultas/rollos') return <RollHistory />;

    if (currentPath === '/consultas/ordenes') return <OrdersQueryView />;



    const segments = menuItem.Ruta.split('/').filter(Boolean);

    // CORRECCIÓN: Si la ruta actual es más profunda (ej: /area/ecouv), usar ese segmento
    let areaKeyFinal = '';

    const pathSegments = currentPath.split('/').filter(Boolean);
    const areaIndex = pathSegments.findIndex(s => s.toLowerCase() === 'area');

    if (areaIndex !== -1 && pathSegments[areaIndex + 1]) {
        areaKeyFinal = pathSegments[areaIndex + 1];
    } else {
        // Fallback lógica anterior
        const lastSegment = segments[segments.length - 1];
        areaKeyFinal = (lastSegment && !['area', 'procesos'].includes(lastSegment.toLowerCase())) ? lastSegment : menuItem.Nombre;
    }

    console.log(`[DynamicRouter] Path: ${currentPath}, Extracted Key: ${areaKeyFinal}`);

    let areaConfig = {};
    try {
        areaConfig = typeof menuItem.ui_config === 'string' ? JSON.parse(menuItem.ui_config) : (menuItem.ui_config || {});
    } catch (e) { console.error("Error UI Config:", e); }

    return <AreaView key={menuItem.IdModulo} areaKey={areaKeyFinal} areaConfig={areaConfig} />;
};

export default MainAppContent;