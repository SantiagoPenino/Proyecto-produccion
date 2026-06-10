import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useViewport } from '../../hooks/useViewport';
import logoWhite from '../../assets/images/logo/logo-white.webp';
import logoMini from '../../assets/images/logo/logo-mini.svg';
import { LogOut, MessageSquare, HelpCircle } from 'lucide-react';
import Swal from 'sweetalert2';
import { motion, AnimatePresence } from 'framer-motion';
import PreciosLeadModal from './PreciosLeadModal';
import PreciosListModal from './PreciosListModal';
import { apiClient } from '../../client-portal/api/apiClient';
import { socket } from '../../services/socketService';



function NavBtn({ onClick, children, forceHover = false, style = {} }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', padding: '8px 4px',
        border: 'none', background: 'transparent',
        fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', cursor: 'pointer',
        ...style
      }}
    >
      <span style={{
        background: 'linear-gradient(to right, #00AEEF 0%, #EC008C 16.5%, #FFF200 33%, #fff 50%, #fff 100%)',
        backgroundSize: '200% 100%',
        backgroundPosition: (hovered || forceHover) ? '0% 0%' : '100% 0%',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        transition: 'background-position 0.4s ease-out',
        whiteSpace: 'nowrap'
      }}>
        {children}
      </span>
    </button>
  );
}

function DropdownRecursosDesktop({ navigate, sessionType }) {
  const [open, setOpen] = useState(false);

  const ITEMS = [
    { label: 'Guías', path: '/guias' },
    { label: 'Plantillas', path: '/plantillas' },
    { label: 'Paletas', path: '/paletas' },
    { label: 'Precios', path: '/portal/precios', requiresAuth: true },
  ];

  return (
    <div
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2, height: '100%' }}
      className="cursor-pointer"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <NavBtn onClick={(e) => e.preventDefault()} forceHover={open}>
        Recursos
      </NavBtn>
      <svg className="transition-transform duration-300 text-white opacity-80" style={{ transform: open ? 'rotate(-180deg)' : 'none', marginTop: 1, marginLeft: -2 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>

      <div
        style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          paddingTop: 8,
          opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden', pointerEvents: open ? 'auto' : 'none',
          transition: 'all 0.3s ease', zIndex: 50
        }}
      >
        <div style={{
          background: 'rgba(17,17,17,0.95)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 8,
          minWidth: 140,
          boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {ITEMS.filter(item => !item.requiresAuth || sessionType).map(item => (
            <a
              key={item.label}
              href={item.path || '#'}
              onClick={e => {
                e.preventDefault();
                if (!item.path) return;
                if (item.requiresAuth && !sessionType) {
                  setOpen(false);
                  navigate(`/login?redirect=${item.path}`);
                } else {
                  setOpen(false);
                  navigate(item.path);
                }
              }}
              style={{
                color: item.path ? (item.requiresAuth ? '#F5C842' : 'rgba(255,255,255,0.85)') : 'rgba(255,255,255,0.4)',
                fontSize: 13, fontWeight: 600, padding: '10px 16px', borderRadius: 10,
                textDecoration: 'none', transition: 'all 0.2s', whiteSpace: 'nowrap',
                cursor: item.path ? 'pointer' : 'default',
                textTransform: 'uppercase', textAlign: 'center', letterSpacing: '0.05em'
              }}
              onMouseEnter={e => { if (item.path) { e.target.style.background = 'rgba(255,255,255,0.06)'; e.target.style.color = item.requiresAuth ? '#F5C842' : '#fff'; } }}
              onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = item.path ? (item.requiresAuth ? '#F5C842' : 'rgba(255,255,255,0.85)') : 'rgba(255,255,255,0.4)'; }}
            >
              {item.label}
              {!item.path && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.4 }}>Próx.</span>}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

const PORTAL_ITEMS = [
  { label: 'Mi Perfil', path: '/portal/profile' },
  { label: 'Servicios', path: '/portal' },
  { label: 'Retiro de Pedidos', path: '/portal/pickup' },
  { label: 'Pagos Pendientes', path: '/portal/payments' },
  { label: 'Historial', path: '/portal/history' },
];

function DropdownPortalDesktop({ navigate, user, sessionLabel, handleSessionBtn, handleLogout }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2, height: '100%' }}
      className="cursor-pointer"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <NavBtn onClick={handleSessionBtn} forceHover={open}>
        {sessionLabel}
      </NavBtn>
      <svg className="transition-transform duration-300 text-white opacity-80" style={{ transform: open ? 'rotate(-180deg)' : 'none', marginTop: 1, marginLeft: -2 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>

      <div
        style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          paddingTop: 8,
          opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden', pointerEvents: open ? 'auto' : 'none',
          transition: 'all 0.3s ease', zIndex: 50
        }}
      >
        <div style={{
          background: 'rgba(17,17,17,0.95)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 8,
          minWidth: 160,
          boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); handleLogout(); }}
            style={{
              color: '#EC008C',
              fontSize: 13, fontWeight: 600, padding: '10px 16px', borderRadius: 10,
              textDecoration: 'none', transition: 'all 0.2s', whiteSpace: 'nowrap',
              cursor: 'pointer',
              background: 'transparent', border: 'none',
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(236, 0, 140, 0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={16} /> Cerrar Sesión
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LandingNavbar({ onOpenLoginModal }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isMobile } = useViewport();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [pedidoHovered, setPedidoHovered] = useState(false);
  const [preciosHovered, setPreciosHovered] = useState(false);
  const [showPreciosModal, setShowPreciosModal] = useState(false);
  const [showPreciosListModal, setShowPreciosListModal] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [hasPendingResponse, setHasPendingResponse] = useState(false);

  const pathname = location?.pathname || (typeof window !== 'undefined' ? window.location.pathname : '');
  const isAuthPage = pathname === '/login' || pathname === '/register';
  const isPortalPage = pathname.startsWith('/portal');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Fetch tickets for support badge in LandingNavbar
  useEffect(() => {
    if (!user || user.role === 'ADMIN' || user.role === 'STAFF') return;

    const fetchTickets = async () => {
      try {
        const res = await apiClient.get('/tickets');
        if (res.success && Array.isArray(res.data)) {
          setTickets(res.data);
          const hasPending = res.data.some(t => t.TicEstado === 3);
          setHasPendingResponse(hasPending);
        }
      } catch (error) {
        console.error('Error fetching tickets in LandingNavbar:', error);
      }
    };

    fetchTickets();
  }, [user]);

  // Socket updates for support badge in LandingNavbar
  useEffect(() => {
    if (!user || user.role === 'ADMIN' || user.role === 'STAFF' || tickets.length === 0) return;

    tickets.forEach(t => {
      socket.emit('join:ticket', { ticketId: t.TicIdTicket });
    });

    const handleSocketUpdate = () => {
      apiClient.get('/tickets').then(res => {
        if (res.success && Array.isArray(res.data)) {
          setTickets(res.data);
          const hasPending = res.data.some(t => t.TicEstado === 3);
          setHasPendingResponse(hasPending);
        }
      }).catch(err => console.error("Error refreshing tickets in LandingNavbar on socket event:", err));
    };

    socket.on('ticket:new_message', handleSocketUpdate);
    socket.on('ticket:updated', handleSocketUpdate);

    return () => {
      tickets.forEach(t => {
        socket.emit('leave:ticket', { ticketId: t.TicIdTicket });
      });
      socket.off('ticket:new_message', handleSocketUpdate);
      socket.off('ticket:updated', handleSocketUpdate);
    };
  }, [user, tickets.length]);

  const isClient = user?.userType === 'CLIENT' || user?.role === 'WEB_CLIENT';
  let sessionType = null;
  if (user && isClient) sessionType = 'client';
  else if (user && !isClient) sessionType = 'production';
  else {
    try {
      const authToken = localStorage.getItem('auth_token');
      const sessionStr = localStorage.getItem('user_session');
      if (authToken && sessionStr) {
        const payload = JSON.parse(atob(authToken.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) sessionType = 'client';
      }
    } catch { }
  }

  const sessionLabel = sessionType === 'production' ? 'Producción' : sessionType === 'client' ? 'Mi Portal' : 'Iniciar sesión';

  const handleSessionBtn = () => {
    if (sessionType === 'production') {
      navigate('/retiros');
    } else if (sessionType === 'client') {
      navigate('/portal/profile');
    } else {
      if (onOpenLoginModal && !isMobile) {
        onOpenLoginModal();
      } else {
        navigate('/login');
      }
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  return (
    <>
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
              className="bg-[#18181b] border border-zinc-700/50 rounded-xl max-w-sm w-full p-6 relative z-[100000] shadow-2xl"
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
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand-magenta hover:bg-custom-magenta transition-colors"
                >
                  Salir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <nav style={{
        position: isAuthPage ? 'absolute' : 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '0 20px' : '0 48px',
        height: '70px',
        background: (!isMobile && isPortalPage) ? 'rgba(24,24,27,0.75)' : (isPortalPage || menuOpen || scrolled) ? 'rgba(13,13,13,0.98)' : 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderBottom: ((isPortalPage || scrolled) && !menuOpen && isMobile) ? '1px solid rgba(255,255,255,0.08)' : 'none',
        transition: 'all 0.3s ease',
      }}>
        <div onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src={isMobile ? logoMini : logoWhite} alt="Logo" style={{ height: isMobile ? 32 : 48, display: 'block' }} />
          {isPortalPage && (
            <>
              <div style={{ width: '1px', height: isMobile ? '28px' : '36px', background: 'rgba(255,255,255,0.2)' }}></div>
              <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: isMobile ? '15px' : '17px', color: '#fff', letterSpacing: '0.04em' }}>AUTOGESTIÓN</span>
            </>
          )}
        </div>

        {/* Desktop nav */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
            <NavBtn onClick={() => {
              if (sessionType) {
                navigate('/portal/pickup');
              } else if (onOpenLoginModal) {
                onOpenLoginModal('/portal/pickup');
              } else {
                navigate('/login?redirect=/portal/pickup');
              }
            }}>Retirá aquí</NavBtn>

            <button
              type="button"
              className="nav-gradient-btn"
              onMouseEnter={() => setPedidoHovered(true)}
              onMouseLeave={() => setPedidoHovered(false)}
              onClick={() => {
                if (sessionType) {
                  navigate('/portal');
                } else if (onOpenLoginModal) {
                  onOpenLoginModal('/portal');
                } else {
                  navigate('/login?redirect=/portal');
                }
              }}
              style={{
                borderRadius: 8,
                padding: '7px 16px',
                fontSize: 13, fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{
                background: 'linear-gradient(to right, #00AEEF 0%, #EC008C 16.5%, #FFF200 33%, #fff 50%, #fff 100%)',
                backgroundSize: '200% 100%',
                backgroundPosition: pedidoHovered ? '0% 0%' : '100% 0%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                transition: 'background-position 0.4s ease-out',
                whiteSpace: 'nowrap',
              }}>
                Hacé tu pedido
              </span>
            </button>

            {!sessionType && (
            <button
              onClick={() => setShowPreciosModal(true)}
              onMouseEnter={() => setPreciosHovered(true)}
              onMouseLeave={() => setPreciosHovered(false)}
              style={{
                position: 'relative', padding: '8px 4px',
                border: 'none', background: 'transparent',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <span style={{
                background: 'linear-gradient(to right, #00AEEF 0%, #EC008C 16.5%, #FFF200 33%, #F5C842 50%, #F5C842 100%)',
                backgroundSize: '200% 100%',
                backgroundPosition: preciosHovered ? '0% 0%' : '100% 0%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                transition: 'background-position 0.4s ease-out',
                whiteSpace: 'nowrap',
              }}>
                Precios
              </span>
            </button>
            )}

            {/* Desktop Dropdown Recursos */}
            <DropdownRecursosDesktop navigate={navigate} sessionType={sessionType} />

            {/* Autenticación o Mi Portal dependiendo del estado */}
            {sessionType ? (
              <DropdownPortalDesktop navigate={navigate} user={user} sessionLabel={sessionLabel} handleSessionBtn={handleSessionBtn} handleLogout={handleLogout} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <NavBtn onClick={handleSessionBtn} style={{ padding: '0px 10px', fontSize: 13 }}>{sessionLabel}</NavBtn>
                <div style={{ width: '80%', height: 1, background: 'rgba(255,255,255,0.1)', margin: '1px 0' }} />
                <NavBtn onClick={() => navigate('/register')} style={{ padding: '0px 10px', fontSize: 13 }}>Registrarse</NavBtn>
              </div>
            )}


            <NavBtn onClick={() => navigate('/contacto')}>Contacto</NavBtn>
          </div>
        )}

        {/* Mobile hamburger */}
        {isMobile && (
          <button onClick={() => setMenuOpen(o => !o)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 8, display: 'flex', flexDirection: 'column', gap: 5,
          }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                display: 'block', width: 24, height: 2, background: '#fff',
                borderRadius: 2, transition: 'all 0.3s',
                transform: menuOpen
                  ? i === 0 ? 'rotate(45deg) translate(5px,5px)'
                    : i === 2 ? 'rotate(-45deg) translate(5px,-5px)'
                      : 'scaleX(0)'
                  : 'none',
              }} />
            ))}
          </button>
        )}
      </nav>

      {/* Mobile drawer */}
      {isMobile && (
        <div style={{
          position: isAuthPage ? 'absolute' : 'fixed', top: 70, left: 0, right: 0, bottom: 0, zIndex: 9998,
          overflowY: 'auto',
          pointerEvents: menuOpen ? 'auto' : 'none',
          opacity: menuOpen ? 1 : 0,
          transform: menuOpen ? 'translateY(0)' : 'translateY(-12px)',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
        }}>
          <div style={{
            background: 'rgba(13,13,13,0.98)', backdropFilter: 'none', WebkitBackdropFilter: 'none',
            padding: '24px 24px 32px',
            display: 'flex', flexDirection: 'column', gap: 20,
            minHeight: '100%',
          }}>
            {!sessionType && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); setMenuOpen(false); navigate('/login?redirect=/portal'); }} style={{
                  color: '#00AEEF', textDecoration: 'none', fontSize: 14, fontWeight: 700,
                  padding: '12px 10px', borderRadius: 12, textAlign: 'center',
                  border: '1px solid rgba(0,174,239,0.3)', background: 'rgba(0,174,239,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>Hacé tu pedido</a>
                <a href="#" onClick={(e) => { e.preventDefault(); setMenuOpen(false); navigate(sessionType ? '/portal/pickup' : '/login?redirect=/portal/pickup'); }} style={{
                  color: '#00AEEF', textDecoration: 'none', fontSize: 14, fontWeight: 700,
                  padding: '12px 10px', borderRadius: 12, textAlign: 'center',
                  border: '1px solid rgba(0,174,239,0.3)', background: 'rgba(0,174,239,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>Retirá aquí</a>
              </div>
            )}

            {!sessionType && <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 12 }}>
              {sessionType ? (
                <div style={{ width: '85%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button onClick={() => { setMenuOpen(false); navigate('/portal/profile'); }} style={{
                    height: 48, padding: '0 10px', border: '1px solid rgba(0, 174, 239, 0.3)',
                    borderRadius: 12, background: 'rgba(0, 174, 239, 0.08)', color: '#00AEEF',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>Mi Perfil</button>
                  <button onClick={() => { setMenuOpen(false); navigate('/portal/factory'); }} style={{
                    height: 48, padding: '0 10px', border: '1px solid rgba(0, 174, 239, 0.3)',
                    borderRadius: 12, background: 'rgba(0, 174, 239, 0.08)', color: '#00AEEF',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>Mi Fábrica</button>
                </div>
              ) : (
                <button onClick={() => { setMenuOpen(false); handleSessionBtn(); }} style={{
                  width: '85%', height: 48, padding: '0 10px', border: '1px solid rgba(0, 174, 239, 0.3)',
                  borderRadius: 12, background: 'rgba(0, 174, 239, 0.08)', color: '#00AEEF',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{sessionLabel}</button>
              )}

              {/* Portal links debajo (Servicios, Retiro, etc.) */}
              {sessionType && (
                <div style={{ width: '85%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {PORTAL_ITEMS.filter(i => i.label !== 'Mi Perfil').map(item => (
                    <a key={item.label} href={item.path} onClick={e => {
                      e.preventDefault();
                      setMenuOpen(false);
                      navigate(item.path);
                    }} style={{
                      color: '#00AEEF',
                      fontSize: 14, fontWeight: 600, textDecoration: 'none',
                      height: 48, padding: '0 10px', borderRadius: 12, textAlign: 'center',
                      border: '1px solid rgba(0,174,239,0.3)',
                      background: 'rgba(0,174,239,0.06)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {item.label}
                    </a>
                  ))}
                </div>
              )}

              {!sessionType && (
                <button
                  onClick={() => { setMenuOpen(false); navigate('/register'); }}
                  style={{
                    width: '85%', padding: '14px',
                    border: '1px solid #3f3f46',
                    borderRadius: 12, background: '#111', color: '#fff',
                    fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  }}
                >Crear Cuenta</button>
              )}

            </div>

            {/* Recursos — al final, separado */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recursos</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Guías', path: '/guias' },
                  { label: 'Plantillas', path: '/plantillas' },
                  { label: 'Paletas', path: '/paletas' },
                  { label: 'Precios', path: '/portal/precios', requiresAuth: true },
                ].map(item => (
                  <a key={item.label} href={item.path || '#'} onClick={e => {
                    e.preventDefault();
                    if (!item.path) return;
                    setMenuOpen(false);
                    if (item.label === 'Precios' && !sessionType) {
                      setShowPreciosModal(true);
                    } else if (item.requiresAuth && !sessionType) {
                      navigate(`/login?redirect=${item.path}`);
                    } else {
                      navigate(item.path);
                    }
                  }} style={{
                    color: (item.label === 'Precios' && !sessionType) ? '#FFF200' : '#a1a1aa',
                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                    padding: '10px 8px', borderRadius: 8, textAlign: 'center',
                    background: (item.label === 'Precios' && !sessionType) ? 'rgba(255, 242, 0, 0.05)' : 'rgba(255,255,255,0.03)',
                    border: (item.label === 'Precios' && !sessionType) ? '1px solid rgba(255, 242, 0, 0.2)' : '1px solid rgba(255,255,255,0.05)',
                    cursor: item.path ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.08)' }} />

              <button onClick={() => { setMenuOpen(false); navigate('/contacto'); }} style={{
                width: '85%', padding: '14px', border: '1px solid #3f3f46', borderRadius: 12,
                background: '#18181b', color: '#f4f4f5', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}>
                <MessageSquare size={16} /> Contacto
              </button>

              <button 
                onClick={() => { setMenuOpen(false); navigate('/portal/soporte'); }} 
                className={hasPendingResponse ? "animate-pulse" : ""}
                style={{
                  width: '85%', padding: '14px', borderRadius: 12,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  ...(hasPendingResponse ? {
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fff',
                    boxShadow: '0 0 15px rgba(239, 68, 68, 0.2)',
                  } : {
                    border: '1px solid rgba(0,174,239,0.3)',
                    background: 'rgba(0,174,239,0.06)',
                    color: '#00AEEF',
                  })
                }}
              >
                <HelpCircle size={16} /> Soporte / Ayuda
              </button>

              {sessionType && (
                <>
                  <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.08)' }} />
                  <button onClick={() => { setMenuOpen(false); handleLogout(); }} style={{
                    width: '85%', padding: '14px', border: '1px solid rgba(236,0,140,0.3)',
                    borderRadius: 12, background: 'rgba(236,0,140,0.06)', color: '#EC008C',
                    fontSize: 15, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    marginBottom: '10px'
                  }}>
                    Cerrar Sesión <LogOut size={18} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <PreciosLeadModal 
        isOpen={showPreciosModal} 
        onClose={() => setShowPreciosModal(false)} 
        onConfirm={(formData) => {
          console.log('Lead capture:', formData);
          // Opcional: Llamada al endpoint para registrar lead, por ahora cerramos el modal
          setShowPreciosModal(false);
          setShowPreciosListModal(true);
        }}
      />

      <PreciosListModal 
        isOpen={showPreciosListModal}
        onClose={() => setShowPreciosListModal(false)}
      />
    </>
  );
}
