import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient';
import Swal from 'sweetalert2';
import {
    Factory,
    User,
    UserPen,
    Package,
    LogOut,
    Menu,
    X,
    Truck,
    Crown,
    ChevronDown,
    CreditCard,
    History,
    MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICES_LIST } from '../constants/services';
import { Logo } from '../../components/Logo';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { PushNotificationBanner } from '../components/PushNotificationBanner';
import LandingNavbar from '../../components/shared/LandingNavbar';

const BASE_URL = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '';

const getImageUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${BASE_URL}${url}`;
};

export const MainLayout = ({ children }) => {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [checking, setChecking] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isServicesOpen, setIsServicesOpen] = useState(false);
    const [visibleConfig, setVisibleConfig] = useState(null);
    const [webContent, setWebContent] = useState({ sidebar: [], popup: [] });
    const [showPopup, setShowPopup] = useState(false);
    const [showLogoutModal, setShowLogoutModal] = useState(false);

    // Push notifications (pre-permission banner)
    const { showBanner, acceptPush, dismissPush } = usePushNotifications();

    // Guard: si el token JWT indica requireReset, bloquear acceso al portal
    useEffect(() => {
        try {
            const token = localStorage.getItem('auth_token');
            if (token) {
                const payload = JSON.parse(atob(token.split('.')[1]));
                if (payload.requireReset) {
                    sessionStorage.setItem('reset_token', token);
                    localStorage.removeItem('auth_token');
                    localStorage.removeItem('user');
                    localStorage.removeItem('user_session');
                    window.location.href = '/login?reset=true';
                    return;
                }
            }
        } catch (e) {
            // token malformado, lo dejamos pasar
        }
        setChecking(false);
    }, []);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const [resConfig, resContent] = await Promise.all([
                    apiClient.get('/web-orders/area-mapping'),
                    apiClient.get('/web-content/active')
                ]);

                if (resConfig.success && resConfig.data?.visibility) {
                    setVisibleConfig(resConfig.data.visibility);
                } else {
                    setVisibleConfig({});
                }

                if (resContent.success && resContent.data) {
                    const sb = resContent.data.filter(i => i.Tipo === 'SIDEBAR');
                    const pp = resContent.data.filter(i => i.Tipo === 'POPUP');
                    setWebContent({ sidebar: sb, popup: pp });
                    if (pp.length > 0) setShowPopup(true);
                }
            } catch (error) {
                console.error("Error fetching config/content:", error);
                setVisibleConfig({});
            }
        };
        fetchConfig();
    }, []);

    // Early return AFTER all hooks — respeta las reglas de React
    if (checking) return <div style={{ width: '100vw', height: '100vh', background: '#18181b' }} />;

    const getErpCode = (serviceId) => {
        const map = {
            'DF': 'DF',
            'sublimacion': 'SB',
            'ecouv': 'ECOUV',
            'directa_320': 'DIRECTA',
            'directa_algodon': 'DIRECTA',
            'bordado': 'EMB',
            'corte-confeccion': 'TWT',
            'tpu': 'TPU'
        };
        return map[serviceId] || serviceId.toUpperCase();
    };

    const isActive = (path) => location.pathname === path;
    
    const handleLogout = () => {
        setShowLogoutModal(true);
    };

    const NavItem = ({ to, icon: Icon, label }) => (
        <Link
            to={to}
            onClick={() => setIsMobileMenuOpen(false)}
            className={`
        flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm
        ${isActive(to)
                    ? 'text-zinc-100 border border-brand-cyan/40 bg-brand-cyan/5'
                    : 'text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 hover:bg-brand-dark/50'}
      `}
        >
            <Icon size={20} strokeWidth={1.5} />
            <span className="font-medium tracking-wide">{label}</span>
        </Link>
    );

    return (
        <div className="flex h-screen bg-zinc-900 overflow-hidden font-sans text-zinc-100">
            <LandingNavbar />

            {/* Modal de Confirmación de Cierre de Sesión (Estilo Producción) */}
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
            {/* Sidebar Desktop */}
            <aside className="hidden md:flex flex-col w-72 bg-custom-dark text-zinc-100 shadow-2xl z-20 m-4 mt-[80px] rounded-2xl border border-brand-dark ">


                <nav className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
                    {/* 1. Mi Perfil (Primero según maqueta) */}
                    <NavItem to="/portal/profile" icon={User} label="Mi Perfil" />

                    {/* 2. Servicios (Link directo a catálogo) */}
                    <NavItem to="/portal" icon={Package} label="Servicios" />

                    {/* --- Servicios Collapsible (comentado temporalmente) ---
                    <div className="space-y-1">
                        <button
                            onClick={() => setIsServicesOpen(!isServicesOpen)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-sm ${isServicesOpen || location.pathname.includes('/order') || location.pathname === '/portal'
                                ? 'text-zinc-100 border border-brand-cyan/40 bg-brand-cyan/5'
                                : 'text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 hover:bg-brand-dark/50'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <Package size={20} strokeWidth={1.5} />
                                <span className="font-medium tracking-wide">Servicios</span>
                            </div>
                            <ChevronDown
                                size={16}
                                className={`transition-transform duration-200 ${isServicesOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        <AnimatePresence>
                            {isServicesOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="space-y-1.5 ml-2 mt-2">
                                        <Link
                                            to="/portal"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={`block w-full text-left px-3 py-2.5 text-xs rounded-xl transition-all uppercase tracking-wide ${location.pathname === '/portal'
                                                ? 'text-zinc-100 border border-brand-cyan/40 bg-brand-cyan/5 font-bold'
                                                : 'text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300'
                                                }`}
                                        >
                                            Ver Catálogo Completo
                                        </Link>
                                        {SERVICES_LIST.map((service) => {
                                            const erpCode = getErpCode(service.id);
                                            if (visibleConfig && visibleConfig[erpCode]?.visible === false) return null;

                                            return (
                                                <Link
                                                    key={service.id}
                                                    to={`/portal/order/${service.id}`}
                                                    onClick={() => setIsMobileMenuOpen(false)}
                                                    className={`block w-full text-left px-3 py-2.5 text-xs rounded-xl transition-all uppercase tracking-wide ${location.pathname === `/portal/order/${service.id}`
                                                        ? 'text-zinc-100 border border-brand-cyan/40 bg-brand-cyan/5 font-bold'
                                                        : 'text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300'
                                                        }`}
                                                >
                                                    {service.label}
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    --- Fin Servicios Collapsible --- */}

                    {/* <NavItem to="/portal/factory" icon={Factory} label="Fábrica / Estado" /> */}
                    <NavItem to="/portal/pickup" icon={Package} label="Retiro de Pedidos" />
                    <NavItem to="/portal/payments" icon={CreditCard} label="Pagos Pendientes" />
                    <NavItem to="/portal/history" icon={History} label="Historial" />
                    <NavItem to="/portal/soporte" icon={MessageSquare} label="Soporte / Ayuda" />

                    {/* <div className="pt-4 mt-4 border-t border-zinc-800">
                        <Link to="/portal/club">
                            <button className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/portal/club') ? 'bg-amber-500 text-white shadow-lg' : 'bg-gradient-to-r from-amber-500/20 to-yellow-600/20 border border-amber-500/30 text-amber-400 hover:text-amber-300'}`}>
                                <Crown size={20} className={isActive('/portal/club') ? "text-white" : "text-amber-400"} />
                                <span className="font-bold">CLUB MEMBER</span>
                            </button>
                        </Link>
                    </div> */}
                </nav>

                <style>{`
                    @keyframes dotPulse {
                        0%, 100% { transform: scale(1); opacity: 0.75; }
                        50% { transform: scale(1.25); opacity: 1; }
                    }
                `}</style>
                <div className="flex justify-evenly items-center w-full pt-3 pb-6">
                    {[
                        { color: '#00AEEF', glow: '0 0 12px 4px rgba(0,174,239,0.7)', delay: '0s' },
                        { color: '#EC008C', glow: '0 0 12px 4px rgba(236,0,140,0.7)', delay: '0.4s' },
                        { color: '#FFF200', glow: '0 0 12px 4px rgba(255,242,0,0.7)', delay: '0.8s' },
                        { color: '#ffffff', glow: '0 0 12px 4px rgba(255,255,255,0.6)', delay: '1.2s' },
                    ].map(({ color, glow, delay }) => (
                        <div key={color} style={{
                            width: 25, height: 25, borderRadius: '50%',
                            background: color, flexShrink: 0, boxShadow: glow,
                            animation: 'dotPulse 2s ease-in-out infinite',
                            animationDelay: delay,
                        }} />
                    ))}
                </div>

                <div className="p-4 border-t border-brand-dark bg-custom-dark rounded-b-2xl">
                    <div className="flex items-center gap-3 mb-4 px-2">
                        <div className="w-10 h-10 rounded-full bg-brand-dark flex items-center justify-center font-bold text-zinc-300 border border-zinc-300">
                            {user?.avatar || user?.name?.charAt(0) || 'U'}
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-sm font-medium truncate">{user?.name}</p>
                            <p className="text-xs text-zinc-300 truncate font-mono">{user?.idCliente}</p>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors w-full px-3 py-2.5 rounded-xl justify-center border border-zinc-800 hover:border-brand-magenta/40 hover:bg-brand-magenta/5"
                    >
                        <LogOut size={16} /> Cerrar Sesión
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto relative scrollbar-thin bg-zinc-900">
                <div className={location.pathname.match(/^\/portal\/soporte\/\d+/)
                    ? "p-4 pt-[90px] pb-4 md:p-6 md:pt-[90px] md:pb-6 w-full min-h-full"
                    : "p-4 pt-[90px] pb-6 md:p-8 md:pt-[90px] md:pb-8 max-w-7xl mx-auto min-h-full"
                }>
                    {children}
                </div>
            </main>

            {/* Right Sidebar (Promos) */}
            {webContent.sidebar.length > 0 && (
                <aside className="hidden xl:flex flex-col w-72 bg-white border-l border-zinc-200 h-screen overflow-y-auto p-6 space-y-6 shrink-0 shadow-xl z-20">
                    <div className="flex items-center gap-2 mb-2 text-amber-500">
                        <Crown size={16} />
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Novedades</h3>
                    </div>
                    {webContent.sidebar.map(item => (
                        <a
                            key={item.ID}
                            href={item.LinkDestino || '#'}
                            target={item.LinkDestino ? "_blank" : "_self"}
                            className={`block rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 group ring-4 ring-white ${!item.LinkDestino ? 'cursor-default pointer-events-none' : ''}`}
                        >
                            <div className="relative aspect-[3/4] w-full bg-zinc-100">
                                <img
                                    src={getImageUrl(item.ImagenUrl)}
                                    alt={item.Titulo}
                                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                                    {(item.Titulo || item.LinkDestino) && (
                                        <p className="text-white text-xs font-bold line-clamp-2">
                                            {item.Titulo || 'Ver Más'} &rarr;
                                        </p>
                                    )}
                                </div>
                            </div>
                        </a>
                    ))}
                </aside>
            )}

            {/* Popup Modal */}
            <AnimatePresence>
                {showPopup && webContent.popup.length > 0 && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/60 "
                            onClick={() => setShowPopup(false)}
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden max-h-[85vh] flex flex-col"
                        >
                            <button
                                onClick={() => setShowPopup(false)}
                                className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center  transition-colors"
                            >
                                <X size={16} />
                            </button>

                            {webContent.popup[0].ImagenUrl && (
                                <div className="relative w-full shrink-0">
                                    <img
                                        src={getImageUrl(webContent.popup[0].ImagenUrl)}
                                        alt={webContent.popup[0].Titulo}
                                        className="w-full h-auto max-h-[60vh] object-contain bg-zinc-900"
                                    />
                                </div>
                            )}

                            <div className="p-6 text-center space-y-4 bg-white grow">
                                {webContent.popup[0].Titulo && (
                                    <h3 className="text-xl font-bold text-zinc-800">{webContent.popup[0].Titulo}</h3>
                                )}

                                {webContent.popup[0].LinkDestino && (
                                    <a
                                        href={webContent.popup[0].LinkDestino}
                                        target="_blank"
                                        className="inline-block px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-lg shadow-amber-500/30 transition-all hover:scale-105"
                                    >
                                        VER PROMOCIÓN &rarr;
                                    </a>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Push Notification Banner */}
            <PushNotificationBanner show={showBanner} onAccept={acceptPush} onDismiss={dismissPush} />
        </div>
    );
};
