import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/apiClient';
import logoMini from '../../assets/images/logo/logo-mini.svg';
import { Bell, BellRing } from 'lucide-react';

const Navbar = ({ onSwitchTab, currentView, onToggleMobileMenu, isMobileMenuOpen }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchRef, setSearchRef] = useState('');
  const searchInputRef = useRef(null);
  const [serverStatus, setServerStatus] = useState('ok'); // 'ok' | 'slow' | 'error'

  useEffect(() => {
    const check = async () => {
      try {
        const start = Date.now();
        await api.get('/health');
        const ms = Date.now() - start;
        setServerStatus(ms > 3000 ? 'slow' : 'ok');
      } catch {
        setServerStatus('error');
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Helper to format breadcrumb
  const getBreadcrumb = () => {
    const path = location.pathname.split('/').filter(Boolean);
    if (path.length === 0) return 'INICIO';
    // Mapeo simple de nombres comunes
    const mapNames = {
      'area': 'ÁREA',
      'admin': 'ADMINISTRACIÓN',
      'users': 'USUARIOS',
      'database': 'CONFIGURACIÓN',
      'menu': 'MENÚ',
      'medicion': 'MEDICIÓN',
      'control': 'CONTROL DE CALIDAD',
      'planeacion': 'PLANEACIÓN',
      'logistica': 'LOGÍSTICA'
    };

    return path.map(p => mapNames[p.toLowerCase()] || p.toUpperCase()).join(' > ');
  };

  return (
    <nav className="h-14 px-4 sm:px-6 bg-zinc-900 border-b border-zinc-700 flex items-center justify-between sticky top-0 z-[5010] shadow-md gap-4">
      {/* Móvil: Logo Centrado Flotante */}
      <div 
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer group md:hidden flex items-center justify-center z-0"
        onClick={() => navigate('/')}
      >
        <img src={logoMini} alt="Logo" className="h-9 w-auto object-contain opacity-90 active:opacity-100 transition-opacity drop-shadow-md" />
      </div>

      {/* IZQUIERDA: Menú Móvil, Titulo y Logo */}
      <div className="flex items-center flex-1 min-w-0 relative z-10">
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="p-2 -ml-1 text-slate-300 hover:text-white active:bg-zinc-800 transition-colors md:hidden shrink-0 bg-transparent border-none cursor-pointer flex flex-col gap-[5px] rounded-lg relative z-10"
            title="Abrir Menú"
          >
            {[0, 1, 2].map(i => (
              <span key={i} className="block w-[22px] h-[2px] bg-current rounded-sm transition-all duration-300 origin-center"
                style={{
                  transform: isMobileMenuOpen
                    ? i === 0 ? 'translateY(7px) rotate(45deg)'
                      : i === 2 ? 'translateY(-7px) rotate(-45deg)'
                        : 'scaleX(0)'
                    : 'none',
                }}
              />
            ))}
          </button>
        )}
        
        {/* Escritorio: Título y Logo Lineal */}
        <div
          className="hidden md:flex items-center cursor-pointer group min-w-0"
          onClick={() => navigate('/')}
        >
          {/* Logo centrado en el ancho de la sidebar colapsada (w-16) → alineado con la columna de íconos. */}
          <div className="w-16 flex items-center justify-center shrink-0 -ml-4 sm:-ml-6">
            <img src={logoMini} alt="Logo" className="h-8 w-auto opacity-90 group-hover:opacity-100 transition-opacity drop-shadow-sm" />
          </div>
          <div className="w-px h-6 bg-zinc-600 mr-4 opacity-50 shrink-0"></div>
          <h1 className="font-black text-white tracking-tighter text-lg leading-none transition-colors uppercase mt-0.5 truncate">
            GESTIÓN DE PRODUCCIÓN
          </h1>
        </div>
      </div>
      {/* Centro: Búsqueda + Listado */}
      <div className="hidden md:flex items-center justify-center gap-3 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!searchRef.trim()) return;
            window.open(`/consultas/integral?ref=${encodeURIComponent(searchRef.trim())}`, '_blank');
            setSearchRef('');
          }}
          className="flex items-center h-9 w-40 focus-within:w-48 transition-all duration-300 bg-zinc-700 rounded-lg overflow-hidden"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchRef}
            onChange={(e) => setSearchRef(e.target.value)}
            placeholder="Buscar pedido"
            className="font-bold uppercase bg-transparent pl-3 text-xs min-w-0 outline-none placeholder-slate-300 text-white h-full"
          />
          <button
            type="submit"
            className="px-3 h-full text-slate-100 hover:text-blue-500 transition-colors shrink-0"
            title="Búsqueda Integral"
          >
            <i className="fa-solid fa-magnifying-glass text-md"></i>
          </button>
        </form>
        <button
          className="flex items-center justify-center gap-2 h-9 px-3 rounded-lg text-xs uppercase transition-all duration-300 text-slate-100 hover:text-blue-500 bg-zinc-700 shrink-0 active:scale-95"
          onClick={() => navigate('/consultas/ordenes')}
          title="Listado de Órdenes"
        >
          <span className="font-bold">Listado de ordenes</span>
          <i className="fa-solid fa-list-ul"></i>
        </button>
      </div>

      {/* DERECHA: Notificaciones y Usuario */}
      <div className="flex items-center gap-6">
        {/* Notificaciones */}
        <div
          className="relative cursor-pointer group"
          onClick={() => setShowNotifications(!showNotifications)}
        >
          <div className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-700 text-slate-300 group-hover:bg-zinc-600 group-hover:text-white transition-colors">
            <Bell size={20} className="group-hover:hidden" />
            <BellRing size={20} className="hidden group-hover:block animate-[bell-ring_0.5s_ease-in-out]" />
          </div>
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-magenta text-[9px] font-bold text-white border-2 border-white shadow-sm">
            3
          </span>
        </div>

        {/* Usuario */}
        <div className="flex items-center gap-4 scale-[0.80] sm:scale-100 origin-right">
          <div className="text-right px-2">
            <div className="flex text-base font-bold leading-none align-center justify-center text-white">{user?.nombre || user?.usuario}</div>
            <div className="w-full h-px bg-zinc-800 my-1"></div>
            <div className="flex items-center justify-center gap-1">
              <span className={`w-2 h-2 rounded-full ${serverStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : serverStatus === 'slow' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500 animate-pulse'}`}></span>
              <span className={`text-[11px] font-bold uppercase tracking-wider leading-none text-slate-100`}>
                {user?.rol || user?.role || user?.userType || 'Usuario'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </nav >
  );
};

export default Navbar;
