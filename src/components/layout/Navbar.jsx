import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/apiClient';
import logoMini from '../../assets/images/logo/logo-mini.svg';
import CampanaNotificaciones from './CampanaNotificaciones';
import BotonNuevaSolicitud from './BotonNuevaSolicitud';

const Navbar = ({ onSwitchTab, currentView, onToggleMobileMenu, isMobileMenuOpen }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
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

  const nombreUsuario = user?.nombre || user?.usuario;
  const rolUsuario = user?.rol || user?.role || user?.userType || 'Usuario';
  const puntoServidor = `w-2 h-2 rounded-full shrink-0 ${serverStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : serverStatus === 'slow' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500 animate-pulse'}`;

  // Celular (< md): a la izquierda el logo y el usuario; a la derecha Servicio Técnico, la campanita y,
  // al final, el menú. Escritorio: logo + título, búsqueda al centro, y a la derecha los botones y el usuario.
  return (
    <nav className="h-14 px-4 sm:px-6 bg-zinc-900 border-b border-zinc-700 flex items-center justify-between sticky top-0 z-[5010] shadow-md gap-4">
      {/* IZQUIERDA */}
      <div className="flex items-center flex-1 min-w-0 relative z-10">
        {/* Móvil: logo y usuario */}
        <button type="button" onClick={() => navigate('/')} title="Inicio" className="md:hidden shrink-0">
          <img src={logoMini} alt="Logo" className="h-8 w-auto object-contain opacity-90 active:opacity-100 transition-opacity drop-shadow-md" />
        </button>
        <div className="md:hidden ml-3 min-w-0 leading-none">
          <div className="truncate text-sm font-bold text-white">{nombreUsuario}</div>
          <div className="mt-1 flex items-center gap-1">
            <span className={puntoServidor}></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-100 truncate">{rolUsuario}</span>
          </div>
        </div>

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

      {/* DERECHA: Servicio Técnico, Notificaciones, Usuario (escritorio) y Menú (celular, al final) */}
      <div className="flex items-center gap-2 md:gap-6 shrink-0">
        <div className="flex items-center gap-2">
          {/* Pedir Servicio Técnico desde cualquier pantalla */}
          <BotonNuevaSolicitud />
          {/* Notificaciones: avisos por usuario (servicio técnico, …) */}
          <CampanaNotificaciones />
        </div>

        {/* Usuario (escritorio; en celular está a la izquierda) */}
        <div className="hidden md:flex items-center gap-4">
          <div className="text-right px-2">
            <div className="flex text-base font-bold leading-none justify-center text-white">{nombreUsuario}</div>
            <div className="w-full h-px bg-zinc-800 my-1"></div>
            <div className="flex items-center justify-center gap-1">
              <span className={puntoServidor}></span>
              <span className="text-[11px] font-bold uppercase tracking-wider leading-none text-slate-100">{rolUsuario}</span>
            </div>
          </div>
        </div>

        {/* Móvil: el menú, al final */}
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="p-2 -mr-1 text-slate-300 hover:text-white active:bg-zinc-800 transition-colors md:hidden shrink-0 bg-transparent border-none cursor-pointer flex flex-col gap-[5px] rounded-lg relative z-10"
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
      </div>
    </nav >
  );
};

export default Navbar;
