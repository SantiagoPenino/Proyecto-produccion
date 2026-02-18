import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const Navbar = ({ onSwitchTab, currentView }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);

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
    <nav className="h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-50 shadow-sm">
      {/* IZQUIERDA: Titulo y Breadcrumb */}
      <div
        className="flex flex-col justify-center cursor-pointer group"
        onClick={() => onSwitchTab?.('dashboard')}
      >
        <h1 className="font-black text-slate-800 tracking-tighter text-lg leading-none group-hover:text-cyan-600 transition-colors uppercase">
          USER PRODUCCION--MACROSOFT /  {user?.nombre || user?.usuario || 'INVITADO'}
        </h1>
        <span className="text-[10px] uppercase font-bold text-blue-500 tracking-widest mt-1">
          {getBreadcrumb()}
        </span>
      </div>

      {/* CENTRO: Botones de navegación (Estilo Pestañas Modernas) */}
      <div className="hidden md:flex items-center bg-slate-100 p-1 rounded-xl">
        {[
          { id: 'metrics', label: 'Métricas', icon: 'fa-chart-line' },
          { id: 'production', label: 'Planillas', icon: 'fa-layer-group' },
          { id: 'chat', label: 'Chat', icon: 'fa-comments' }
        ].map(tab => {
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300
                    ${isActive
                  ? 'bg-white text-slate-800 shadow-md shadow-slate-200/50 scale-105'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                }
                  `}
              onClick={() => onSwitchTab?.(tab.id)}
            >
              <i className={`fa-solid ${tab.icon} ${isActive ? 'text-cyan-500' : ''}`}></i>
              <span>{tab.label}</span>
            </button>
          )
        })}
        {/* LUPA DE BÚSQUEDA GLOBAL */}
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 text-slate-500 hover:text-blue-600 hover:bg-blue-50"
          onClick={() => navigate('/consultas/ordenes')}
          title="Búsqueda Avanzada de Órdenes"
        >
          <i className="fa-solid fa-magnifying-glass"></i>
          <span>Buscar</span>
        </button>
      </div>

      {/* DERECHA: Notificaciones y Usuario */}
      <div className="flex items-center gap-6">
        {/* Notificaciones */}
        <div
          className="relative cursor-pointer group"
          onClick={() => setShowNotifications(!showNotifications)}
        >
          <div className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 group-hover:bg-cyan-50 group-hover:text-cyan-500 transition-colors">
            <i className="fa-solid fa-bell"></i>
          </div>
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-white shadow-sm">
            3
          </span>
        </div>

        {/* Separador Vertical */}
        <div className="w-px h-8 bg-slate-200"></div>

        {/* Usuario */}
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-black text-slate-700 leading-none">{user?.nombre || user?.usuario}</div>
            <div className="flex items-center justify-end gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Online</span>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all shadow-sm hover:shadow active:scale-95"
            title="Cerrar Sesión"
          >
            <i className="fa-solid fa-right-from-bracket text-xs"></i>
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;