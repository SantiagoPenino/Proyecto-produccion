import { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import { LayoutDashboard, Warehouse, Printer, ClipboardList, Terminal, CircleUserRound, Tags, Headset, Calculator, Landmark, Shirt, Sun, Sparkles, Flame, Scissors, Pen, Shapes, PenLine, QrCode, ShieldBan, PrinterCheck, History, LayoutGrid, PackagePlus, PackageCheck, Truck, FileSearch, Boxes, Waypoints, Send, Package, Bus, ClipboardCheck, Menu, Users, Shield, Eye, Settings, Database, UserX, RefreshCw, BadgeDollarSign, Layers, BookOpen, Banknote, CreditCard, ShieldCheck, Calendar, CalendarCheck, MapPin, Store, LifeBuoy, Ticket, ScanLine, FileText, Cpu, FileDown, Inbox, Receipt, ShoppingCart, Palette } from 'lucide-react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { ToastContainer, Slide } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../client-portal/api/apiClient';
import { socket } from '../../services/socketService';
import Navbar from './Navbar';
import MaintenanceBanner from '../common/MaintenanceBanner';

// ── Auto-reload en caso de chunks desactualizados (cache stale post-deploy) ──
const lazyWithRetry = (importFn) => lazy(() =>
    importFn().catch((err) => {
        const key = 'chunk_reload_' + window.location.pathname;
        if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            console.warn('[LazyRetry] Chunk load failed, reloading page...', err);
            window.location.reload();
            return new Promise(() => {}); // never resolves — page is reloading
        }
        sessionStorage.removeItem(key);
        throw err; // already retried once, let it fail normally
    })
);

const MachineDetailView = lazyWithRetry(() => import('../pages/MachineDetailView'));
const Dashboard = lazyWithRetry(() => import('../pages/Dashboard'));
const ProductionDashboard = lazyWithRetry(() => import('../pages/ProductionDashboard'));
const AreaView = lazyWithRetry(() => import('../production/areas/AreaView'));
const ConfigPage = lazyWithRetry(() => import('../pages/ConfigPage'));
const LogisticsDashboard = lazyWithRetry(() => import('../logistics/LogisticsDashboard'));
const OrdersQueryView = lazyWithRetry(() => import('../pages/OrdersQueryView'));
const RollHistory = lazyWithRetry(() => import('../pages/RollHistory'));
const MenuAdmin = lazyWithRetry(() => import('../pages/MenuAdmin'));
const RolesPage = lazyWithRetry(() => import('../pages/RolesPage'));
const UsersPage = lazyWithRetry(() => import('../pages/UsersPage'));
const AuditPage = lazyWithRetry(() => import('../pages/AuditPage'));
const InventoryPage = lazyWithRetry(() => import('../pages/InventoryPage'));
const InsumosCatalogPage = lazyWithRetry(() => import('../pages/InsumosCatalogPage'));
const StockRequestsPage = lazyWithRetry(() => import('../pages/StockRequestsPage'));
const ReceptionPage = lazyWithRetry(() => import('../pages/customer-service/ReceptionPage'));
const VentaRolloAdelantoPage = lazyWithRetry(() => import('../pages/customer-service/VentaRolloAdelantoPage'));
const LogisticsPage = lazyWithRetry(() => import('../pages/customer-service/LogisticsPage'));
const ActiveStockPage = lazyWithRetry(() => import('../pages/customer-service/ActiveStockPage'));
const TransportControlPage = lazyWithRetry(() => import('../pages/TransportControlPage'));
const EcoUvFinishing = lazyWithRetry(() => import('../pages/EcoUvFinishing'));
const EcouvConfigPage = lazyWithRetry(() => import('../pages/EcouvConfigPage'));
const WebRetirosPage = lazyWithRetry(() => import('../logistics/WebRetirosPage'));
const ClientsIntegration = lazyWithRetry(() => import('../pages/ClientsIntegration'));
import ChatWidget from '../common/ChatWidget';
const ProductsIntegration = lazyWithRetry(() => import('../pages/ProductsIntegration'));
const SpecialPrices = lazyWithRetry(() => import('../pages/SpecialPrices'));
const BasePrices = lazyWithRetry(() => import('../pages/BasePrices'));
const PriceProfiles = lazyWithRetry(() => import('../pages/PriceProfiles'));
const LabelGenerationPage = lazyWithRetry(() => import('../pages/LabelGenerationPage'));
const DepositStockPage = lazyWithRetry(() => import('../logistics/DepositStockPage'));
const CustomerReplacementPage = lazyWithRetry(() => import('../pages/customer-service/CustomerReplacementPage'));
const CustomerPriceCatalogPage = lazyWithRetry(() => import('../pages/CustomerPriceCatalogPage'));
const IntegralOrderView = lazyWithRetry(() => import('../pages/IntegralOrderView'));
const CargaPagosView = lazyWithRetry(() => import('../pages/CargaPagosView'));
const VerificarPagosOnlineView = lazyWithRetry(() => import('../pages/VerificarPagosOnlineView'));
const ExcepcionesDeudaView = lazyWithRetry(() => import('../pages/ExcepcionesDeudaView'));
const CargaDepositoPage = lazyWithRetry(() => import('../logistics/CargaDepositoPage'));
const VerificarCodigoPage = lazyWithRetry(() => import('../logistics/VerificarCodigoPage'));
const CuadreDiarioView = lazyWithRetry(() => import('../pages/CuadreDiarioView'));
const ReporteCajaCentralAdminView = lazyWithRetry(() => import('../pages/ReporteCajaCentralAdminView'));
const DuplicateClientsPage = lazyWithRetry(() => import('../pages/admin/DuplicateClientsPage'));
const HelpDeskAdminView = lazyWithRetry(() => import('../pages/customer-service/HelpDeskAdminView').then(m => ({ default: m.HelpDeskAdminView })));
const OrderSearchPage = lazyWithRetry(() => import('../logistics/OrderSearchPage'));
const EntregaPedidosView = lazyWithRetry(() => import('../pages/customer-service/EntregaPedidosView'));
const DepositoDashboard = lazyWithRetry(() => import('../logistics/DepositoDashboard'));
const WmsOrderPage = lazyWithRetry(() => import('../pages/customer-service/WmsOrderPage'));
const WmsLogisticsPage = lazyWithRetry(() => import('../pages/customer-service/WmsLogisticsPage'));
const TelaClienteEstadoCuenta = lazyWithRetry(() => import('../pages/customer-service/TelaClienteEstadoCuenta'));
const TelaClienteInventarioPage = lazyWithRetry(() => import('../pages/TelaClienteInventarioPage'));
const NomenclatorsABM = lazyWithRetry(() => import('../pages/admin/NomenclatorsABM')); // <-- ADDED
const DesignersAdminPage = lazyWithRetry(() => import('../pages/DesignersAdminPage'));
const SysAdminPage = lazyWithRetry(() => import('../pages/admin/SysAdminPage'));
const LeadsCRMView = lazyWithRetry(() => import('../pages/ventas/LeadsCRMView'));
const PedidoPrendaPage = lazyWithRetry(() => import('../pages/ventas/PedidoPrendaPage')); // Alta interna de pedidos de prendas
const AuditDepositoView = lazyWithRetry(() => import('../pages/AuditDepositoView'));
const AdminEditarOrdenView = lazyWithRetry(() => import('../pages/AdminEditarOrdenView'));
const ContabilidadCuentasView    = lazyWithRetry(() => import('../pages/ContabilidadCuentasView'));
const ClienteVista360            = lazyWithRetry(() => import('../pages/ClienteVista360'));
const VendedorCliente360         = lazyWithRetry(() => import('../pages/VendedorCliente360'));
const PreFacturaPage             = lazyWithRetry(() => import('../pages/PreFacturaPage'));
const ContabilidadAntiguedadView  = lazyWithRetry(() => import('../pages/ContabilidadAntiguedadView'));
const ContabilidadColaEstadosView = lazyWithRetry(() => import('../pages/ContabilidadColaEstadosView'));
const ImportadorManualView         = lazyWithRetry(() => import('../production/ImportadorManualView'));
const CajaTransaccionView          = lazyWithRetry(() => import('../pages/CajaTransaccionView'));
const LibroMayorView               = lazyWithRetry(() => import('../pages/LibroMayorView'));
const PlanCuentasView              = lazyWithRetry(() => import('../pages/PlanCuentasView'));
const ContabilidadMotorReglasAdmin = lazyWithRetry(() => import('../pages/ContabilidadMotorReglasAdmin'));
const ContabilidadReconciliacionView = lazyWithRetry(() => import('../pages/ContabilidadReconciliacionView'));
const ContabilidadTesoreriaView    = lazyWithRetry(() => import('../pages/ContabilidadTesoreriaView'));
const ContabilidadBandejaCFE       = lazyWithRetry(() => import('../pages/ContabilidadBandejaCFE'));
const BandejaDocumentosInternos    = lazyWithRetry(() => import('../pages/BandejaDocumentosInternos'));
const CronAdminView                = lazyWithRetry(() => import('../pages/CronAdminView'));
const CoordinacionView             = lazyWithRetry(() => import('../pages/CoordinacionView'));
const ColorMatcherPage             = lazyWithRetry(() => import('../pages/ColorMatcherPage'));
const ReportesPage                 = lazyWithRetry(() => import('../pages/ReportesPage'));
const ContabilidadReportesPage     = lazyWithRetry(() => import('../pages/ContabilidadReportesPage'));

// ============================================
// 1. LUCIDE ICON MAP (override FA icons)
// ============================================
const lucideIconMapRaw = {
    'dashboard': LayoutDashboard,
    'logística wms': Warehouse,
    'logistica wms': Warehouse,
    'logística': Warehouse,
    'logistica': Warehouse,
    'producción': Printer,
    'produccion': Printer,
    'informes': ClipboardList,
    'sys admin': Terminal,
    'gestión clientes': CircleUserRound,
    'gestion clientes': CircleUserRound,
    'gestión de clientes': CircleUserRound,
    'gestion de clientes': CircleUserRound,
    'gestión productos': Tags,
    'gestion productos': Tags,
    'gestión de productos': Tags,
    'gestion de productos': Tags,
    'atención al cliente': Headset,
    'atencion al cliente': Headset,
    'gestión de precios': Calculator,
    'gestion de precios': Calculator,
    'administración': Landmark,
    'administracion': Landmark,
    // Producción sub-items
    'dtf': Shirt,
    'eco uv': Sun,
    'ecouv': Sun,
    'terminaciones eco uv': Sparkles,
    'terminaciones ecouv': Sparkles,
    'terminacionesecouv': Sparkles,
    'sublimación': Flame,
    'sublimacion': Flame,
    'corte': Scissors,
    'costura': Pen,
    'estampado': Shapes,
    'bordado': PenLine,
    'impresión': Printer,
    'impresion': Printer,
    'generar etiquetas': QrCode,
    'comprobar codigo qr': QrCode,
    'comprobar código qr': QrCode,
    'verificar codigo qr': QrCode,
    'verificar código qr': QrCode,
    'comprobar qr': QrCode,
    'tpu': ShieldBan,
    'impresión directa': PrinterCheck,
    'impresion directa': PrinterCheck,
    'historial de lotes': History,
    'importar ordenes': FileDown,
    'importar órdenes': FileDown,
    // Logística WMS sub-items
    'dashboard depósito': LayoutGrid,
    'dashboard deposito': LayoutGrid,
    'ingreso/aviso de órdenes': PackagePlus,
    'ingreso/aviso de ordenes': PackagePlus,
    'ingreso/ aviso de ordenes': PackagePlus,
    'ingreso/ aviso de órdenes': PackagePlus,
    'ingreso / aviso de ordenes': PackagePlus,
    'ingreso / aviso de órdenes': PackagePlus,
    'empaquetado de retiros': PackageCheck,
    'gestión de encomiendas': Truck,
    'gestion de encomiendas': Truck,
    'gestión de encomiendas y cadeteria': Truck,
    'gestion de encomiendas y cadeteria': Truck,
    'gestión de encomiendas y cadetería': Truck,
    'gestion de encomiendas y cadetería': Truck,
    'encomiendas y cadeteria': Truck,
    'encomiendas y cadetería': Truck,
    'buscar/actualizar órdenes': FileSearch,
    'buscar/actualizar ordenes': FileSearch,
    'buscar/actualizar ordenes de retiro': FileSearch,
    'buscar/actualizar órdenes de retiro': FileSearch,
    'buscar / actualizar órdenes': FileSearch,
    'buscar / actualizar ordenes': FileSearch,
    'buscar / actualizar ordenes de retiro': FileSearch,
    'buscar / actualizar órdenes de retiro': FileSearch,
    'inventario': Boxes,
    'control logístico': Waypoints,
    'control logistico': Waypoints,
    'enviar a react': Send,
    'inventario de insumos': Package,
    'inventarios de insumo': ClipboardCheck,
    'insumos': Package,
    'control de transporte': Bus,
    'control transporte': Bus,
    'auditoría de depósito': ScanLine,
    'auditoria de deposito': ScanLine,
    'auditoría depósito': ScanLine,
    'auditoria deposito': ScanLine,
    'control físico': ScanLine,
    'control fisico': ScanLine,
    // Sys Admin sub-items
    'gestion menu': Menu,
    'gestión menu': Menu,
    'gestión del menú': Menu,
    'gestion del menu': Menu,
    'usuarios': Users,
    'gestión de roles': Shield,
    'gestion de roles': Shield,
    'auditoría': Eye,
    'auditoria': Eye,
    'configuración': Settings,
    'configuracion': Settings,
    'admin db': Database,
    'depurar clientes': UserX,
    'sysadmin': Terminal,
    'consola': Terminal,
    'agencias': Store,
    'localidades': MapPin,
    'agencias y localidades': MapPin,
    'agencias/localidades': MapPin,
    'agencias / localidades': MapPin,
    // Atención al Cliente sub-items
    'ingreso materiales': PackagePlus,
    'reposiciones': RefreshCw,
    'pedido productos wms': ShoppingCart,
    'preparacion pedidos wms': Package,
    // Gestión de Precios sub-items
    'precios estándar': BadgeDollarSign,
    'precios estandar': BadgeDollarSign,
    'perfiles de precios': Layers,
    'catálogo por cliente': BookOpen,
    'catalogo por cliente': BookOpen,
    // Contabilidad
    'contabilidad cuentas': CreditCard,
    'cuentas clientes':     CreditCard,
    'cuentas':              CreditCard,
    'antigüedad de deuda':  Calendar,
    'antiguedad de deuda':  Calendar,
    'antiguedades de deuda': Calendar,
    'cola estados cuenta':  BookOpen,
    'estados de cuenta':    BookOpen,
    'plan de cuentas':      ClipboardList,
    'libro mayor':          BookOpen,
    'tipos movimientos':    FileText,
    'tipos de movimientos': FileText,
    'recursos y planes':    Layers,
    'recursos':             Layers,
    'motor asientos generales': Cpu,
    'reconciliación':       ShieldCheck,
    'reconciliacion':       ShieldCheck,
    'tesorería':            Banknote,
    'tesoreria':            Banknote,
    'bandeja de tesorería': Inbox,
    'bandeja de tesoreria': Inbox,
    'bandeja tesoreria':    Inbox,
    'bandeja cfe':          ClipboardList,
    'bandeja interna':      Receipt,
    'bandeja documentos internos': Receipt,
    'documentos internos':  Receipt,
    'recibos':              Receipt,
    'recibos y egresos':    Receipt,
    'cron':                 Terminal,
    // Color
    'color':               Palette,
    'igualador de color':  Palette,
    'igualador color':     Palette,
    // Reportes
    'reportes':            FileText,
    'reporte':             FileText,
    'reportes dtf':        FileText,
    // Administración sub-items
    'caja': Banknote,
    'pagos': CreditCard,
    'autorizaciones de pagos': ShieldCheck,
    'pagos online por la web (handy)': CreditCard,
    'pagos online / web (handy)': CreditCard,
    'operaciones de caja':  Banknote,
    'cierre diario': CalendarCheck,
    // Helpdesk
    'helpdesk': LifeBuoy,
    'helpdesk / tickets': LifeBuoy,
    'tickets': Ticket,
    // Ítems que quedaban sin ícono / con círculo (íconos Lucide agregados)
    'contabilidad': Landmark,
    'documentos': FileText,
    'cuenta corriente': CreditCard,
    'operaciones': Banknote,
    'reportes produccion': ClipboardList,
    'reportes producción': ClipboardList,
    'dashboard produccion': LayoutDashboard,
    'dashboard producción': LayoutDashboard,
    'reportes ordenes': FileText,
    'reportes órdenes': FileText,
    'control de tela de clientes': Boxes,
    'estado de cuenta tela cliente': BookOpen,
    'ventas': ShoppingCart,
    'venta de productos': Package,
    'bandeja tesorería': Inbox,
    'preparar ordenes de venta': PackageCheck,
    'preparar órdenes de venta': PackageCheck,
    'venta de recursos adelantados': BadgeDollarSign,
    'venta recursos adelantados': BadgeDollarSign,
    'recursos adelantados': BadgeDollarSign,
};
const getLucideIcon = (name) => lucideIconMapRaw[name?.toLowerCase?.()?.trim?.()?.replace(/\s+/g, ' ')];

// ============================================
// 2. COMPONENTE NAVNODE (Mejorado)
// ============================================
const NavNode = ({ item, openMenus, toggleMenu, navigate, location, level = 0, isCollapsed, setIsCollapsed, hasAdminPendingResponse }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = openMenus[item.IdModulo];
    const isChildActive = hasChildren && item.children.some(c => {
        if (!c.Ruta) return false;
        const nLoc = location.pathname.endsWith('/') && location.pathname !== '/' ? location.pathname.slice(0, -1) : location.pathname;
        const nRut = c.Ruta.endsWith('/') && c.Ruta !== '/' ? c.Ruta.slice(0, -1) : c.Ruta;
        return nLoc === nRut;
    });
    const isSelected = location.pathname === item.Ruta || (hasChildren && isChildActive);

    const isAtencionCliente = item.Nombre?.toLowerCase()?.trim() === 'atención al cliente' || item.Nombre?.toLowerCase()?.trim() === 'atencion al cliente';
    const isHelpdeskOption = item.Nombre?.toLowerCase()?.trim() === 'helpdesk' || item.Nombre?.toLowerCase()?.trim() === 'helpdesk / tickets' || item.Nombre?.toLowerCase()?.trim() === 'tickets';
    const showBadge = (isAtencionCliente || isHelpdeskOption) && hasAdminPendingResponse;

    const baseClasses = "flex items-center mx-2 rounded-md cursor-pointer select-none transition-all duration-200 group relative";

    return (
        <div className="w-full">
            <div
                className={`
                    ${baseClasses}
                    ${isSelected
                        ? "bg-brand-cyan text-white shadow-md shadow-brand-cyan/30"
                        : showBadge
                            ? "bg-red-500/20 text-white border border-red-500/30 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                            : isOpen && hasChildren
                                ? "bg-zinc-800/70 text-white opacity-100"
                                : "text-slate-100 opacity-70 hover:opacity-100 md:hover:bg-zinc-800 md:hover:text-white active:bg-zinc-800 active:text-white"
                    }
                    py-2.5
                `}
                style={{
                    paddingLeft: !isCollapsed && level > 0 ? `${level * 12}px` : undefined,
                }}
                onClick={() => {
                    if (hasChildren) {
                        if (isCollapsed) setIsCollapsed(false);
                        const wasOpen = openMenus[item.IdModulo];
                        toggleMenu(item.IdModulo);
                        if (!wasOpen) {
                            const firstChild = item.children.find(c => c.Ruta);
                            if (firstChild && window.innerWidth >= 768) {
                                navigate(firstChild.Ruta);
                                // Modificado: Eliminamos setIsCollapsed(true) para que el padre quede desplegado
                            }
                        }
                    } else if (item.Ruta) {
                        navigate(item.Ruta);
                        setIsCollapsed(true);
                    }
                }}
                title={isCollapsed ? item.Nombre : ''}
            >

                <div className="w-12 flex-shrink-0 flex items-center justify-center text-base md:group-hover:scale-110 transition-transform duration-300 relative">
                    {getLucideIcon(item.Nombre) ? (
                        (() => { const LucideIcon = getLucideIcon(item.Nombre); return <LucideIcon size={22} className={isSelected ? 'text-white' : (isOpen && hasChildren ? 'text-brand-cyan' : 'text-slate-300 md:group-hover:text-brand-cyan')} />; })()
                    ) : (
                        <i className={`
                            fa-solid ${item.Icono || (hasChildren ? 'fa-folder' : 'fa-circle')} 
                            ${isSelected ? "text-white" : (isOpen && hasChildren ? "text-brand-cyan" : "text-slate-300 md:group-hover:text-brand-cyan")}
                        `}></i>
                    )}
                </div>

                {!isCollapsed && (
                    <>
                        <span className={`flex-grow flex items-center justify-between text-xs font-medium tracking-wide whitespace-nowrap ${isSelected || isOpen ? 'text-white font-bold' : 'text-slate-100'}`}>
                            <span className="truncate">{item.Nombre}</span>
                        </span>

                        {hasChildren && (
                            <i className={`
                                fa-solid fa-chevron-right text-[10px] mr-4 transition-transform duration-300
                                ${isOpen ? "rotate-90" : ""}
                                ${isSelected || isOpen ? "text-blue-400" : "text-slate-100"}
                            `}></i>
                        )}
                    </>
                )}

            </div>

            <div
                className="grid transition-all duration-300 ease-in-out"
                style={{
                    gridTemplateRows: hasChildren && isOpen && !isCollapsed ? '1fr' : '0fr',
                    opacity: hasChildren && isOpen && !isCollapsed ? 1 : 0,
                    transform: hasChildren && isOpen && !isCollapsed ? 'translateY(0)' : 'translateY(-8px)',
                }}
            >
                <div className="overflow-hidden">
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
                                    hasAdminPendingResponse={hasAdminPendingResponse}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================
// 2. COMPONENTE PRINCIPAL (Layout)
// ============================================
const MainAppContent = ({ menuItems = [] }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [openMenus, setOpenMenus] = useState({});
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [hasAdminPendingResponse, setHasAdminPendingResponse] = useState(false);

    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [location.pathname]);

    // Fetch tickets for Admin Attention badge on mount or user change
    useEffect(() => {
        if (!user) return;

        const checkTicketsForBadge = async () => {
            try {
                const res = await apiClient.get('/tickets');
                if (res.success && Array.isArray(res.data)) {
                    const hasPending = res.data.some(t => Number(t.TicEstado) === 1);
                    setHasAdminPendingResponse(hasPending);
                }
            } catch (error) {
                console.error('Error fetching tickets for admin badge:', error);
            }
        };

        checkTicketsForBadge();
    }, [user]);

    // Socket subscription for Admin Attention badge
    useEffect(() => {
        if (!user) return;

        socket.emit('join:helpdesk_admin');

        const handleUpdate = (data, isNew = false) => {
            apiClient.get('/tickets').then(res => {
                if (res.success && Array.isArray(res.data)) {
                    const hasPending = res.data.some(t => Number(t.TicEstado) === 1);
                    setHasAdminPendingResponse(hasPending);
                }
            }).catch(e => console.error("Error refreshing admin tickets:", e));

            if (data) {
                if (isNew) {
                    const duration = 10000;
                    toast.custom((t) => (
                        <div 
                            className="relative flex items-center gap-3 w-full bg-zinc-100 p-4 rounded-none shadow-lg border border-zinc-200 cursor-pointer overflow-hidden min-w-[300px] group" 
                            onClick={() => {
                                const helpdeskPath = menuItems.find(item => item.Ruta?.includes('helpdesk'))?.Ruta || '/admin/helpdesk';
                                toast.dismiss(t);
                                navigate(`${helpdeskPath}?ticketId=${data.ticketId}`);
                            }}
                        >
                            <style>{`
                                @keyframes toast-shrink-progress { from { width: 100%; } to { width: 0%; } }
                                .group:hover .toast-progress-bar {
                                    animation-play-state: paused !important;
                                }
                            `}</style>
                            <div 
                                className="toast-progress-bar absolute top-0 left-0 h-1.5 bg-[#EC008C]" 
                                style={{ animation: `toast-shrink-progress ${duration}ms linear forwards` }} 
                            />
                            <Ticket className="text-brand-magenta shrink-0" size={24} />
                            <div className="flex flex-col mt-1">
                                <span className="text-brand-magenta font-black text-base leading-tight">Nuevo Ticket #{data.ticketId}</span>
                                <span className="text-brand-magenta/80 font-bold text-xs mt-0.5">{data.asunto || 'Sin asunto'}</span>
                            </div>
                        </div>
                    ), { duration });
                } else if (data.autor === 'client') {
                    const duration = 8000;
                    toast.custom((t) => (
                        <div 
                            className="relative flex items-center gap-3 w-full bg-zinc-100 p-4 rounded-none shadow-lg border border-zinc-200 cursor-pointer overflow-hidden min-w-[300px] group" 
                            onClick={() => {
                                const helpdeskPath = menuItems.find(item => item.Ruta?.includes('helpdesk'))?.Ruta || '/admin/helpdesk';
                                toast.dismiss(t);
                                navigate(`${helpdeskPath}?ticketId=${data.ticketId}`);
                            }}
                        >
                            <style>{`
                                @keyframes toast-shrink-progress { from { width: 100%; } to { width: 0%; } }
                                .group:hover .toast-progress-bar {
                                    animation-play-state: paused !important;
                                }
                            `}</style>
                            <div 
                                className="toast-progress-bar absolute top-0 left-0 h-1.5 bg-[#EC008C]" 
                                style={{ animation: `toast-shrink-progress ${duration}ms linear forwards` }} 
                            />
                            <Headset className="text-brand-magenta shrink-0" size={24} />
                            <div className="flex flex-col mt-1">
                                <span className="text-brand-magenta font-black text-base leading-tight">Respuesta en Ticket #{data.ticketId}</span>
                                <span className="text-brand-magenta/80 font-bold text-xs mt-0.5">El cliente ha enviado un mensaje.</span>
                            </div>
                        </div>
                    ), { duration });
                }
            }
        };

        const onTicketNew = (data) => handleUpdate(data, true);
        const onTicketUpdated = (data) => handleUpdate(data, false);
        const onForceLogout = (payload) => {
            // Convert to string for safe comparison
            if (String(payload.userId) === String(user?.id)) {
                logout();
                window.location.href = '/login'; // Hard redirect for safety
            }
        };

        socket.on('ticket:new', onTicketNew);
        socket.on('ticket:updated', onTicketUpdated);
        socket.on('force_logout_user', onForceLogout);

        return () => {
            socket.emit('leave:helpdesk_admin');
            socket.off('ticket:new', onTicketNew);
            socket.off('ticket:updated', onTicketUpdated);
            socket.off('force_logout_user', onForceLogout);
        };
    }, [user]);

    // Ocultador dinámico del glitch de Safari Mobile
    useEffect(() => {
        if (isMobileMenuOpen) {
            document.body.style.backgroundColor = '#18181b'; // Fondo negro continuo cuando el menú está abierto
        } else {
            document.body.style.backgroundColor = '#f8fafc'; // Fondo gris (slate-50) mimetizado cuando está cerrado
        }
        
        return () => {
            document.body.style.backgroundColor = '#18181b'; // Default al desmontar a login u otras rutas
        };
    }, [isMobileMenuOpen]);

    const handleSidebarEnter = useCallback(() => { if (window.innerWidth >= 768) setIsCollapsed(false); }, []);
    const handleSidebarLeave = useCallback(() => { if (window.innerWidth >= 768) setIsCollapsed(true); }, []);

    // Dynamic sidebar width based on which parent is expanded
    const expandedWidth = 300;

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

    const cachedRoutes = useMemo(() => (
        <Suspense fallback={
            <div className="flex items-center justify-center h-full ">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-cyan"></div>
            </div>
        }>
            <Routes location={location}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/produccion/analytics" element={<ProductionDashboard />} />
                <Route path="/consultas/ordenes" element={<OrdersQueryView />} />
                <Route path="/consultas/integral" element={<IntegralOrderView />} />
                <Route path="/consultas/rollos" element={<RollHistory />} />
                <Route path="/production/machine/:area/:machineId" element={<MachineDetailView />} />
                <Route path="/area/:areaId/*" element={<DynamicRouter menuItems={menuItems} />} />
                <Route path="/atencion-cliente/venta-rollo" element={<VentaRolloAdelantoPage />} />
                <Route path="/atencion-cliente/despachos" element={<ActiveStockPage />} />
                <Route path="/atencion-cliente/reposiciones" element={<CustomerReplacementPage />} />
                <Route path="/logistica/transporte" element={<TransportControlPage />} />
                <Route path="/logistica/stock-deposito" element={<DepositStockPage />} />
                <Route path="/logistica/retiros-web" element={<WebRetirosPage />} />
                <Route path="/logistica/excepciones" element={<ExcepcionesDeudaView />} />
                <Route path="/logistica/carga-deposito" element={<CargaDepositoPage />} />
                <Route path="/logistica/verificar-codigo" element={<VerificarCodigoPage />} />
                <Route path="/logistica/buscar-ordenes" element={<OrderSearchPage />} />
                <Route path="/logistica/dashboard-deposito" element={<DepositoDashboard />} />
                <Route path="/atencion-cliente/entrega-pedidos" element={<EntregaPedidosView />} />
                <Route path="/atencion-cliente/pedidos-wms" element={<WmsOrderPage />} />
                <Route path="/atencion-cliente/tela-cuenta" element={<TelaClienteEstadoCuenta />} />
<Route path="/atencion-cliente/inventario-tela" element={<TelaClienteInventarioPage />} />
                <Route path="/logistica/pedidos-wms" element={<WmsLogisticsPage />} />
                <Route path="/admin/clientes-integration" element={<ClientsIntegration />} />
                <Route path="/admin/duplicate-clients" element={<DuplicateClientsPage />} />
                <Route path="/designers" element={<DesignersAdminPage />} />
                <Route path="/admin/helpdesk" element={<HelpDeskAdminView />} />
                <Route path="/atencion-cliente/helpdesk" element={<HelpDeskAdminView />} />
                <Route path="/admin/products-integration" element={<ProductsIntegration />} />
                <Route path="/admin/special-prices" element={<SpecialPrices />} />
                <Route path="/admin/base-prices" element={<BasePrices />} />
                <Route path="/admin/price-profiles" element={<PriceProfiles />} />
                <Route path="/admin/price-catalog" element={<CustomerPriceCatalogPage />} />
                <Route path="/admin/nomencladores" element={<NomenclatorsABM />} />
                <Route path="/nomencladores" element={<NomenclatorsABM />} />
                <Route path="/admin/leads" element={<LeadsCRMView />} />
                <Route path="/leads" element={<LeadsCRMView />} />
                <Route path="/produccion/etiquetas" element={<LabelGenerationPage />} />
                <Route path="/caja/pagos" element={<CargaPagosView />} />
                <Route path="/caja/pagos-online" element={<VerificarPagosOnlineView />} />
                <Route path="/caja/cuadre" element={<CuadreDiarioView />} />
                <Route path="/caja/central-admin" element={<ReporteCajaCentralAdminView />} />
                <Route path="/admin/consola" element={<SysAdminPage />} />
                <Route path="/contabilidad/cuentas"          element={<ContabilidadCuentasView />} />
                <Route path="/contabilidad/cliente-360"      element={<ClienteVista360 />} />
                <Route path="/vendedores/cliente-360"        element={<VendedorCliente360 />} />
                <Route path="/contabilidad/prefactura"        element={<PreFacturaPage />} />
                <Route path="/contabilidad/antiguedad"        element={<ContabilidadAntiguedadView />} />
                <Route path="/contabilidad/cola-estados"      element={<ContabilidadColaEstadosView />} />
                <Route path="/contabilidad/recursos"          element={<Navigate to="/contabilidad/cuentas" replace />} />
                <Route path="/contabilidad/tipos-movimiento"  element={<Navigate to="/contabilidad/motor" replace />} />
                <Route path="/caja/transaccion"               element={<CajaTransaccionView />} />
                <Route path="/contabilidad/libro-mayor"       element={<LibroMayorView />} />
                <Route path="/contabilidad/plan-cuentas"      element={<PlanCuentasView />} />
                <Route path="/contabilidad/motor"             element={<ContabilidadMotorReglasAdmin />} />
                <Route path="/contabilidad/reconciliacion"    element={<ContabilidadReconciliacionView />} />
                <Route path="/contabilidad/bandeja-cfe"       element={<ContabilidadBandejaCFE />} />
                <Route path="/contabilidad/bandeja-interna"   element={<BandejaDocumentosInternos />} />
                <Route path="/contabilidad/tesoreria"         element={<ContabilidadTesoreriaView />} />
                <Route path="/contabilidad/reportes"          element={<ContabilidadReportesPage />} />
                <Route path="/contabilidad/caja-admin"        element={<CajaTransaccionView isAdminCaja={true} />} />
                <Route path="/admin/cron"                     element={<CronAdminView />} />
                <Route path="/coordinacion"                   element={<CoordinacionView />} />
                <Route path="/color"                          element={<ColorMatcherPage />} />
                <Route path="/reportes"                      element={<ReportesPage />} />
                <Route path="/*" element={<DynamicRouter menuItems={menuItems} />} />
            </Routes>
        </Suspense>
    ), [location, menuItems]);

    return (
        <div className="flex flex-col h-[100dvh] bg-slate-50 font-sans">
            <Toaster
                position="top-right"
                expand
                style={{ zIndex: 99999 }}
                gap={8}
                theme="light"
                toastOptions={{
                    className: 'shadow-xl rounded-xl',
                    classNames: {
                        toast: 'group toast group-[.toaster]:bg-white group-[.toaster]:text-slate-800 group-[.toaster]:border-slate-200 group-[.toaster]:shadow-xl group-[.toaster]:rounded-xl',
                        title: 'text-slate-800 font-semibold text-lg',
                        description: 'text-slate-500 text-xs font-medium',
                        error: '!bg-red-50 !border-red-500 !text-red-500',
                        success: '!bg-emerald-50 !border-emerald-500 !text-emerald-500',
                        warning: '!bg-yellow-50 !border-yellow-500 !text-yellow-600',
                        info: '!bg-blue-50 !border-blue-500 !text-blue-500',
                    },
                    style: {
                        background: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                    }
                }}
            />
            <MaintenanceBanner />
            <ToastContainer limit={5} position="top-right" autoClose={2500} transition={Slide} />
            <Navbar 
                onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)} 
                isMobileMenuOpen={isMobileMenuOpen} 
            />

            {/* Modal de Confirmación de Cierre de Sesión */}
            <AnimatePresence>
              {showLogoutModal && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 bg-black/60" 
                    onClick={() => setShowLogoutModal(false)} 
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    className="bg-custom-dark border border-zinc-700/50 rounded-xl max-w-sm w-full p-6 relative z-10 shadow-2xl"
                  >
                    <h3 className="text-xl font-bold text-white mb-2">Cerrar Sesión</h3>
                    <p className="text-zinc-400 text-sm mb-6">¿Estás seguro que deseas salir del sistema?</p>
                    <div className="flex gap-3 justify-end">
                      <button 
                        type="button"
                        onClick={() => setShowLogoutModal(false)}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setShowLogoutModal(false);
                          logout();
                        }}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
                      >
                        Salir
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Backdrop Móvil con Degradado animado */}
                <div 
                    className={`absolute inset-0 bg-gradient-to-r from-black/95 via-black/60 to-black/10 z-[4990] md:hidden transition-opacity duration-300 ease-in-out
                        ${isMobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
                    onClick={() => setIsMobileMenuOpen(false)}
                />
                
                {/* Spacer to reserve collapsed sidebar width - Solo en Desktop */}
                <div className="hidden md:block w-16 flex-shrink-0" />
                <aside
                    className={`
                        flex flex-col bg-custom-dark z-[5000]
                        transition-all duration-300 ease-in-out h-full absolute left-0 top-0
                        w-[280px] md:w-[300px]
                        ${isMobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"}
                        ${(isCollapsed && !isMobileMenuOpen) ? "!w-16" : ""}
                    `}
                    onMouseEnter={handleSidebarEnter}
                    onMouseLeave={handleSidebarLeave}
                >
                    <div className="hidden items-center justify-around px-4 border-b border-zinc-700 bg-custom-dark min-h-[64px]">
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
                    </div>



                    <nav className={`flex-1 overflow-y-auto overflow-x-hidden pt-4 pb-2 ${isCollapsed ? '' : 'pr-1'} custom-scrollbar space-y-1 uppercase`}>
                        {menuTree.map((node, idx) => (
                            <div key={node.IdModulo}>
                                {idx > 0 && <div className="mx-4 my-1 border-t border-zinc-700/50" />}
                                <NavNode
                                    item={node}
                                    openMenus={openMenus}
                                    toggleMenu={toggleMenu}
                                    navigate={navigate}
                                    location={location}
                                    isCollapsed={isCollapsed && !isMobileMenuOpen}
                                    setIsCollapsed={setIsCollapsed}
                                    hasAdminPendingResponse={hasAdminPendingResponse}
                                />
                            </div>
                        ))}
                    </nav>

                    {/* Botón de Cerrar Sesión en Sidebar */}
                    <div className="border-t border-zinc-700/50 p-2 mt-auto flex-shrink-0">
                        <button
                            onClick={() => setShowLogoutModal(true)}
                            className="flex items-center w-full rounded-md text-red-500 opacity-80 hover:opacity-100 md:hover:bg-zinc-800 active:bg-zinc-800 transition-all duration-200 group py-2.5"
                            title="Cerrar Sesión"
                        >
                            <div className="w-12 flex-shrink-0 flex items-center justify-center text-lg md:group-hover:scale-110 active:scale-110 transition-transform duration-300">
                                <i className="fa-solid fa-right-from-bracket"></i>
                            </div>
                            {(!isCollapsed || isMobileMenuOpen) && (
                                <span className="flex-1 text-xs font-bold tracking-wide whitespace-nowrap text-left overflow-hidden">
                                    CERRAR SESIÓN
                                </span>
                            )}
                        </button>
                    </div>

                </aside>

                <main className="flex-1 overflow-hidden relative bg-slate-100 w-full">
                    <div className={`absolute inset-0 overflow-y-auto scroll-smooth ${['/caja/transaccion', '/contabilidad/caja-admin', '/admin/helpdesk', '/atencion-cliente/helpdesk', '/consultas/ordenes'].includes(location.pathname) || location.pathname.startsWith('/production/machine') ? 'p-0' : 'p-0 md:p-6'}`}>
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={location.pathname}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                className="h-full"
                            >
                                {cachedRoutes}
                            </motion.div>
                        </AnimatePresence>
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

    const normalizedPath = currentPath.endsWith('/') && currentPath !== '/' ? currentPath.slice(0, -1) : currentPath;

    // Pedido de prendas: todavía no tiene ítem de menú, así que el matcher de abajo deja
    // menuItem undefined y el fallback `if (!menuItem)` la mandaría al dashboard. Match
    // directo por path (mismo criterio que /area/ecouv/config) pero ANTES del fallback.
    // Cuando exista la fila de menú con esta Ruta, esta línea se puede borrar.
    if (normalizedPath === '/ventas/pedido-prenda') return <PedidoPrendaPage />;
    // Configuración ECOUV: vive DEBAJO de /area/ecouv — sin ítem de menú propio, el
    // matcher longest-match la mandaría a AreaView. Match directo por path.
    if (normalizedPath === '/area/ecouv/config') return <EcouvConfigPage />;
    const matches = menuItems.filter(item => {
        if (!item.Ruta) return false;
        const normalizedRuta = item.Ruta.endsWith('/') && item.Ruta !== '/' ? item.Ruta.slice(0, -1) : item.Ruta;
        return normalizedPath === normalizedRuta || normalizedPath.startsWith(normalizedRuta + '/');
    });
    const menuItem = matches.sort((a, b) => b.Ruta.length - a.Ruta.length)[0];

    // Fallback si no se encuentra ruta exacta
    if (!menuItem) {
        if (currentPath === '/consultas/ordenes') return <OrdersQueryView />;
        if (currentPath === '/admin/helpdesk' || currentPath === '/atencion-cliente/helpdesk') return <HelpDeskAdminView />;
        if (currentPath === '/administracion/ordenes') return <AdminEditarOrdenView />;

        // En lugar del fantasma, rebotamos al usuario silenciosamente de vuelta a su dashboard
        return <Navigate to="/" replace />;
    }

    if (menuItem.Ruta === '/admin/database') return <ConfigPage />;
    if (menuItem.Ruta === '/admin/menu') return <MenuAdmin />;
    if (menuItem.Ruta === '/admin/roles') return <RolesPage />;
    if (menuItem.Ruta === '/admin/users') return <UsersPage />;
    if (menuItem.Ruta === '/admin/audit') return <AuditPage />;
    if (menuItem.Ruta === '/logistica/auditoria-deposito') return <AuditDepositoView />;
    if (menuItem.Ruta === '/administracion/ordenes') return <AdminEditarOrdenView />;
    if (menuItem.Ruta === '/produccion/etiquetas') return <LabelGenerationPage />;
    if (menuItem.Ruta === '/admin/clientes-integration') return <ClientsIntegration />;
    if (menuItem.Ruta === '/admin/nomencladores' || menuItem.Ruta === '/nomencladores') return <NomenclatorsABM />;
    if (menuItem.Ruta === '/admin/products-integration') return <ProductsIntegration />;
    if (menuItem.Ruta === '/admin/price-catalog') return <CustomerPriceCatalogPage />;
    if (menuItem.Ruta === '/produccion/terminaciones' || menuItem.Ruta === '/area/ecouv/terminaciones') return <EcoUvFinishing />;
    if (menuItem.Ruta === '/area/ecouv/config') return <EcouvConfigPage />;
    if (menuItem.Ruta === '/logistica' || menuItem.Ruta.toLowerCase() === '/logistica/') return <LogisticsDashboard />;
    if (menuItem.Ruta === '/ops/inventory') return <LogisticsDashboard />;
    if (menuItem.Ruta === '/inventario') return <InventoryPage />;
    if (menuItem.Ruta === '/insumos') return <InsumosCatalogPage />;
    if (menuItem.Ruta === '/solicitudes') return <StockRequestsPage />;
    if (menuItem.Ruta === '/atencion-cliente/recepcion') return <ReceptionPage />;
    if (menuItem.Ruta === '/atencion-cliente/venta-rollo') return <VentaRolloAdelantoPage />;
    if (menuItem.Ruta === '/atencion-cliente/control') return <LogisticsPage />;
    if (menuItem.Ruta === '/atencion-cliente/despachos') return <ActiveStockPage />;
    if (menuItem.Ruta === '/atencion-cliente/reposiciones') return <CustomerReplacementPage />;
    if (menuItem.Ruta === '/atencion-cliente/entrega-pedidos') return <EntregaPedidosView />;
    if (menuItem.Ruta === '/logistica/retiros-web') return <WebRetirosPage />;
    if (menuItem.Ruta === '/logistica/dashboard-deposito') return <DepositoDashboard />;
    if (menuItem.Ruta === '/caja/pagos' || menuItem.Ruta.toLowerCase() === '/caja/pagos/') return <CargaPagosView />;
    if (menuItem.Ruta === '/caja/cuadre') return <CuadreDiarioView />;
    if (menuItem.Ruta === '/caja/central-admin') return <ReporteCajaCentralAdminView />;
    if (menuItem.Ruta === '/logistica/verificar-codigo') return <VerificarCodigoPage />;
    if (menuItem.Ruta === '/logistica/carga-deposito') return <CargaDepositoPage />;
    if (menuItem.Ruta === '/admin/duplicados') return <DuplicateClientsPage />;
    if (menuItem.Ruta === '/admin/helpdesk' || menuItem.Ruta === '/atencion-cliente/helpdesk') return <HelpDeskAdminView />;
    if (menuItem.Ruta === '/logistica/precios') return <SpecialPrices />;
    if (menuItem.Ruta === '/admin/precios-base') return <BasePrices />;
    if (menuItem.Ruta === '/admin/perfiles-precio') return <PriceProfiles />;
    if (menuItem.Ruta === '/logistica/transporte') return <TransportControlPage />;
    if (menuItem.Ruta === '/logistica/buscar-ordenes') return <OrderSearchPage />;
    if (menuItem.Ruta === '/logistica/orden-integral') return <IntegralOrderView />;
    if (menuItem.Ruta === '/caja/verificar-pagos') return <VerificarPagosOnlineView />;
    if (menuItem.Ruta === '/admin/excepciones-deuda') return <ExcepcionesDeudaView />;
    if (menuItem.Ruta === '/admin/consola') return <SysAdminPage />;
    if (menuItem.Ruta === '/contabilidad/cuentas')              return <ContabilidadCuentasView />;
    if (menuItem.Ruta === '/contabilidad/cliente-360')          return <ClienteVista360 />;
    if (menuItem.Ruta === '/vendedores/cliente-360')            return <VendedorCliente360 />;
    if (menuItem.Ruta === '/contabilidad/antiguedad')            return <ContabilidadAntiguedadView />;
    if (menuItem.Ruta === '/contabilidad/cola-estados')          return <ContabilidadColaEstadosView />;
    if (menuItem.Ruta === '/contabilidad/recursos')              return <ContabilidadCuentasView />;
    if (menuItem.Ruta === '/caja/transaccion')                   return <CajaTransaccionView />;
    if (menuItem.Ruta === '/contabilidad/libro-mayor')           return <LibroMayorView />;
    if (menuItem.Ruta === '/contabilidad/plan-cuentas')          return <PlanCuentasView />;
    if (menuItem.Ruta === '/contabilidad/motor')                 return <ContabilidadMotorReglasAdmin />;
    if (menuItem.Ruta === '/contabilidad/reconciliacion')        return <ContabilidadReconciliacionView />;
    if (menuItem.Ruta === '/contabilidad/bandeja-cfe')           return <ContabilidadBandejaCFE />;
    if (menuItem.Ruta === '/contabilidad/tesoreria')             return <ContabilidadTesoreriaView />;
    if (menuItem.Ruta === '/contabilidad/reportes')              return <ContabilidadReportesPage />;
    if (menuItem.Ruta === '/contabilidad/caja-admin')            return <CajaTransaccionView isAdminCaja={true} />;
    if (menuItem.Ruta === '/admin/cron')                         return <CronAdminView />;
    if (menuItem.Ruta === '/color')                              return <ColorMatcherPage />;

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
