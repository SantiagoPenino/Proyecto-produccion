import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
    Factory,
    User,
    Package,
    LogOut,
    Menu,
    X,
    Truck,
    Crown,
    ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICES_LIST } from '../constants/services';

export const MainLayout = ({ children }) => {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isServicesOpen, setIsServicesOpen] = useState(true);

    const isActive = (path) => location.pathname === path;

    const NavItem = ({ to, icon: Icon, label }) => (
        <Link
            to={to}
            onClick={() => setIsMobileMenuOpen(false)}
            className={`
        flex items-center gap-3 px-4 py-3 rounded-xl transition-all
        ${isActive(to)
                    ? 'bg-zinc-800 text-white shadow-lg shadow-zinc-900/20'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}
      `}
        >
            <Icon size={20} />
            <span className="font-medium">{label}</span>
        </Link>
    );

    return (
        <div className="flex h-screen bg-zinc-50 overflow-hidden font-sans text-zinc-900">
            {/* Sidebar Desktop */}
            <aside className="hidden md:flex flex-col w-72 bg-zinc-900 text-white shadow-2xl z-20 m-4 rounded-2xl border border-zinc-800/50 backdrop-blur-xl">
                <div className="p-6 border-b border-zinc-800 leading-none">
                    <div className="flex items-center gap-3 text-amber-500">
                        <div className="p-2 bg-amber-500/10 rounded-lg">
                            <Factory size={24} />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight text-white">PRO-SERVICES</h1>
                    </div>
                    <p className="text-xs text-zinc-600 mt-2 ml-12">Portal de Clientes</p>
                </div>

                <nav className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
                    {/* 1. Mi Perfil (Primero según maqueta) */}
                    <NavItem to="/profile" icon={User} label="Mi Perfil" />

                    {/* 2. Servicios (Collapsible) */}
                    <div className="space-y-1">
                        <button
                            onClick={() => setIsServicesOpen(!isServicesOpen)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${location.pathname.includes('/order') || location.pathname === '/'
                                ? 'bg-zinc-800 text-white'
                                : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <Package size={20} />
                                <span className="font-medium">Servicios</span>
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
                                    <div className="pl-4 space-y-1 border-l-2 border-zinc-800 ml-4 mt-1">
                                        <Link
                                            to="/"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={`block w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${location.pathname === '/' ? 'text-amber-400 bg-zinc-800/50 font-medium' : 'text-zinc-500 hover:text-zinc-300'
                                                }`}
                                        >
                                            Ver Catálogo Completo
                                        </Link>
                                        {SERVICES_LIST.map((service) => (
                                            <Link
                                                key={service.id}
                                                to={`/order/${service.id}`}
                                                onClick={() => setIsMobileMenuOpen(false)}
                                                className={`block w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${location.pathname === `/order/${service.id}`
                                                    ? 'text-white bg-zinc-800 font-medium'
                                                    : 'text-zinc-500 hover:text-zinc-300'
                                                    }`}
                                            >
                                                {service.label}
                                            </Link>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <NavItem to="/factory" icon={Factory} label="Fábrica / Estado" />
                    <NavItem to="/pickup" icon={Truck} label="Retiro de Pedidos" />

                    <div className="pt-4 mt-4 border-t border-zinc-800">
                        <Link to="/club">
                            <button className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/club') ? 'bg-amber-500 text-white shadow-lg' : 'bg-gradient-to-r from-amber-500/20 to-yellow-600/20 border border-amber-500/30 text-amber-400 hover:text-amber-300'}`}>
                                <Crown size={20} className={isActive('/club') ? "text-white" : "text-amber-400"} />
                                <span className="font-bold">CLUB MEMBER</span>
                            </button>
                        </Link>
                    </div>
                </nav>

                <div className="p-4 border-t border-zinc-800 bg-zinc-950/30 rounded-b-2xl">
                    <div className="flex items-center gap-3 mb-4 px-2">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 border border-zinc-700">
                            {user?.avatar || user?.name?.charAt(0) || 'U'}
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-sm font-medium truncate">{user?.name}</p>
                            <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors w-full px-2 py-2 rounded-lg hover:bg-white/5"
                    >
                        <LogOut size={16} /> Cerrar Sesión
                    </button>
                </div>
            </aside>

            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 w-full bg-zinc-900/95 backdrop-blur-md text-white z-30 px-4 py-3 flex justify-between items-center shadow-lg border-b border-zinc-800">
                <div className="flex items-center gap-2 text-amber-500">
                    <Factory size={20} />
                    <span className="font-bold text-white">PRO-SERVICES</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 rounded-lg hover:bg-white/10">
                    {isMobileMenuOpen ? <X /> : <Menu />}
                </button>
            </div>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="md:hidden fixed inset-0 bg-zinc-900 z-20 pt-20 px-4 pb-4 overflow-y-auto"
                    >
                        <div className="flex flex-col gap-2">
                            <NavItem to="/" icon={Package} label="Servicios" />
                            <NavItem to="/profile" icon={User} label="Mi Perfil" />
                            <NavItem to="/factory" icon={Factory} label="Fábrica / Estado" />
                            <NavItem to="/pickup" icon={Truck} label="Retiro de Pedidos" />
                            <NavItem to="/club" icon={Crown} label="Club Member" />

                            <button onClick={logout} className="mt-8 flex items-center gap-3 px-4 py-3 text-red-400">
                                <LogOut size={20} /> Cerrar Sesión
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto relative scrollbar-thin">
                <div className="md:hidden h-16"></div> {/* Spacer for mobile header */}
                <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-full">
                    {children}
                </div>
            </main>
        </div>
    );
};
