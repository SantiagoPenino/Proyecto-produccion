import { useState, useEffect, useRef, cloneElement, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../Logo';
import logoWhite from "../../assets/images/logo/logo-white.webp";
import { LoginFormBox } from './LoginPage';
import LandingNavbar from '../shared/LandingNavbar';
import { motion, AnimatePresence } from 'framer-motion';
import Footer from '../Footer';
import { useViewport } from '../../hooks/useViewport';
import heroVideo from '../../assets/videos/hero.mp4';
import heroMobileVideo from '../../assets/videos/hero_mobile.webm';
import imgSublimacion from '../../assets/images/general/service_sublimacion.webp';
import imgDtf from '../../assets/images/general/service_dtf.webp';
import imgGranFormato from '../../assets/images/general/service_gran_formato.webp';
import imgTpu from '../../assets/images/general/service_tpu.webp';
import imgBordado from '../../assets/images/general/service_bordado.webp';
import imgCorte from '../../assets/images/general/service_corte.webp';
import { IdeaIcon, DisenoIcon, ProduccionIcon, EntregaIcon, PrinterCartridgeIcon } from '../icons/ProcessIcons.jsx';

const SERVICES = [
  {
    title: 'Bordado',
    desc: 'Acabado premium que dura. Logos y parches con presencia real en prendas, uniformes y accesorios.',
    img: imgBordado,
    accent: '#00AEEF',
    gradFrom: 'rgba(0,174,239,0.18)',
    gradTo: 'rgba(0,174,239,0)',
  },
  {
    title: 'Gran Formato',
    desc: 'Impacto visual donde lo necesitás. Banners, lonas y vinilos para locales, eventos y campañas.',
    img: imgGranFormato,
    accent: '#FFF200',
    gradFrom: 'rgba(255,242,0,0.18)',
    gradTo: 'rgba(255,242,0,0)',
  },
  {
    title: 'DTF Textil',
    desc: 'Full color en cualquier tela, sin límites de diseño. Estampado vibrante con resistencia real al uso y al lavado.',
    img: imgDtf,
    accent: '#EC008C',
    gradFrom: 'rgba(236,0,140,0.18)',
    gradTo: 'rgba(236,0,140,0)',
  },
  {
    title: 'Sublimación',
    desc: 'Color integrado a la tela, sin tacto ni relieve. La solución ideal para deportiva, banderas y gorras en volumen.',
    img: imgSublimacion,
    accent: '#00AEEF',
    gradFrom: 'rgba(0,174,239,0.18)',
    gradTo: 'rgba(0,174,239,0)',
  },
  {
    title: 'TPU',
    desc: 'Parches con relieve, texturas y acabados especiales. Para marcas que no se conforman con lo estándar.',
    img: imgTpu,
    accent: '#f4f4f5',
    gradFrom: 'rgba(244,244,245,0.18)',
    gradTo: 'rgba(244,244,245,0)',
  },
  {
    title: 'Corte y Costura',
    desc: 'Confección industrial de punta a punta. Desde el molde hasta el producto terminado, sin tercerizaciones.',
    img: imgCorte,
    accent: '#EC008C',
    gradFrom: 'rgba(236,0,140,0.18)',
    gradTo: 'rgba(236,0,140,0)',
  },
  {
    title: 'Impresión Directa',
    desc: 'Impresión directa sobre telas. Mesh, blackout y bandera ideal para publicidad, locales y eventos.',
    img: null,
    accent: '#FFF200',
    gradFrom: 'rgba(255,242,0,0.18)',
    gradTo: 'rgba(255,242,0,0)',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile, isTablet } = useViewport();
  const videoRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionDropdown, setSessionDropdown] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalRedirect, setLoginModalRedirect] = useState('/portal/profile');

  const openLoginModal = (redirect = '/portal/profile') => {
    setLoginModalRedirect(redirect);
    setShowLoginModal(true);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Detectar tipo de sesión — misma lógica que App.jsx
  const isClient = user?.userType === 'CLIENT' || user?.role === 'WEB_CLIENT';
  let sessionType = null;
  if (user && isClient) sessionType = 'client';
  else if (user && !isClient) sessionType = 'production';
  else {
    // Fallback: cliente logueado solo por portal (sin user en AuthContext principal)
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
    // El interno va al inicio de la app (antes iba a /retiros, ruta que no existe y rebotaba a /)
    if (sessionType === 'production') navigate('/');
    else if (sessionType === 'client') navigate('/portal');
    else {
      if (isMobile) navigate('/login');
      else setShowLoginModal(true);
    }
  };

  // El index.css global tiene body { overflow: hidden } para el app interno.
  // Acá lo habilitamos solo mientras el landing está montado.
  useEffect(() => {
    document.body.style.overflow = 'auto';
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  // Recarga el video si cambia el viewport sin recrear el elemento
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(e => console.warn('Autoplay prevented:', e));
    }
  }, [isMobile]);

  return (
    <div style={{ background: '#0d0d0d', color: '#fff', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", minHeight: '100vh' }}>

      {/* ── GOOGLE FONT ── */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" />

      {/* ══════════ NAVBAR ══════════ */}
      <LandingNavbar onOpenLoginModal={openLoginModal} />

      {/* ══════════ HERO ══════════ */}
      <section style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: (isMobile || isTablet) ? 'center' : 'flex-start',
        paddingTop: '70px', /* Compensación para la Navbar */
        overflow: 'hidden',
      }}>
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          src={isMobile ? heroMobileVideo : heroVideo}
          onCanPlay={() => setHeroLoaded(true)}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            objectPosition: 'center center',
            opacity: heroLoaded ? 0.55 : 0,
            transition: 'opacity 1s ease',
          }}
        />
        {/* Left gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, rgba(13,13,13,0.85) 0%, rgba(13,13,13,0.4) 50%, transparent 90%)',
        }} />
        {/* Bottom gradient */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 200,
          background: 'linear-gradient(to top, #0d0d0d, transparent)',
        }} />

        {/* Content */}
        <div style={{
          position: 'relative', zIndex: 2,
          padding: isMobile ? '0 24px' : isTablet ? '0 48px' : '0 80px',
          maxWidth: isMobile ? '100%' : 680,
          margin: (isMobile || isTablet) ? '0 auto' : '0',
          textAlign: (isMobile || isTablet) ? 'center' : 'left',
          display: 'flex', flexDirection: 'column',
          alignItems: (isMobile || isTablet) ? 'center' : 'flex-start',
        }}>
          <h1 style={{
            fontSize: isMobile ? 'clamp(26px, 7.5vw, 38px)' : 'clamp(32px, 3.8vw, 64px)',
            fontWeight: 900,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 20px',
            textTransform: 'uppercase',
          }}>
            Industrializamos<br /><span style={{ whiteSpace: 'nowrap' }}>tu producción</span>
          </h1>

          <div style={{ margin: '0 0 32px', minHeight: isMobile ? 24 : 28 }}>
            <VideoTypewriter videoRef={videoRef} isMobile={isMobile} />
          </div>

          {/* CTA buttons */}
          <div style={{
            display: 'flex',
            gap: 16,
            flexDirection: 'column',
            alignItems: (isMobile || isTablet) ? 'center' : 'flex-start',
            justifyContent: (isMobile || isTablet) ? 'center' : 'flex-start'
          }}>
            <button 
              className={`py-[14px] px-8 bg-[#00AEEF]/[0.08] border border-[#00AEEF]/30 hover:bg-[#00AEEF]/20 text-[#00AEEF] rounded-xl font-bold active:scale-[0.98] transition-all flex justify-center items-center gap-2 text-[15px] !shadow-none ${isMobile ? 'w-full' : 'w-[260px]'}`}
              onClick={handleSessionBtn}
            >
              Hacé tu pedido aquí →
            </button>

            <button 
              className={`py-[14px] px-8 bg-[#EC008C]/[0.08] border border-[#EC008C]/30 hover:bg-[#EC008C]/20 text-[#EC008C] rounded-xl font-bold active:scale-[0.98] transition-all flex justify-center items-center gap-2 text-[15px] !shadow-none ${isMobile ? 'w-full' : 'w-[260px]'}`}
              onClick={() => navigate('/contacto')}
            >
              Solicitar cotización →
            </button>
          </div>


        </div>
      </section>

      {/* ══════════ PROCESS FLOW ══════════ */}
      <ProcessFlow isMobile={isMobile} isTablet={isTablet} />

      {/* ══════════ STATS COUNTER ══════════ */}
      {/* <StatsCounter isMobile={isMobile} /> */}

      {/* ══════════ SERVICES (INFINITE CAROUSEL) ══════════ */}
      <section style={{
        padding: isMobile ? '24px 0 64px' : '32px 0 80px',
        background: '#111',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Title for the section */}
        <div style={{ padding: isMobile ? '0 24px 24px' : '0 80px 40px' }}>
          <h2 style={{
            fontSize: isMobile ? 24 : 32,
            fontWeight: 900,
            textTransform: 'uppercase',
            color: '#fff',
            margin: 0
          }}>
            Nuestros <span style={{ color: '#00AEEF' }}>Servicios</span>
          </h2>
        </div>

        <InfiniteMarquee isMobile={isMobile} />
      </section>

      <Footer />

      {/* Login Modal Overlay para Desktop (Framer Motion) */}
      <AnimatePresence>
        {showLoginModal && !isMobile && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ fontFamily: "'Inter', sans-serif" }}>
            {/* Backdrop con Framer Motion puro (sin blur para evitar matar los FPS) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-[#000000e6]"
              style={{ willChange: 'opacity' }}
              onClick={() => setShowLoginModal(false)}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 30,
                mass: 0.8
              }}
              style={{ willChange: 'transform, opacity' }}
              className="relative w-full max-w-sm rounded-3xl z-10 p-[2px] login-gradient-border shadow-2xl shadow-black/50"
            >

              {/* Close button */}
              <button
                onClick={() => setShowLoginModal(false)}
                className="absolute top-4 right-4 z-50 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none p-2"
                aria-label="Cerrar modal"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>

              {/* Inyectamos el form puramente dentro de un contenedor oscuro */}
              <div className="bg-custom-dark rounded-[22px] overflow-hidden">
                <LoginFormBox
                  onRequireReset={(result) => {
                    window.location.href = '/login?reset=true';
                  }}
                  onLoginSuccess={(result) => {
                    setShowLoginModal(false);
                    if (result.userType === 'CLIENT') navigate(loginModalRedirect);
                    else navigate('/');
                  }}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// SIN USO (13/10): useCountUp, StatCard y StatsCounter (hasta antes de la siguiente sección): el único <StatsCounter /> está comentado. Pide /api/stats/public. Ver docs/auditoria-limpieza-2026-10-09.md.
function useCountUp(target, duration = 2000, started = false) {
  const [count, setCount] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    if (!started || target === 0) return;
    const start = performance.now();
    const animate = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      // Easing: ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
      else setCount(target);
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [target, started, duration]);
  return count;
}

function StatCard({ value, label, prefix = '', suffix = '', accent, started, isMobile }) {
  const safeValue = typeof value === 'number' && isFinite(value) ? value : 0;
  const count = useCountUp(safeValue, 2200, started);
  const formatted = Number.isFinite(count) ? count.toLocaleString('es-UY') : '0';
  return (
    <div style={{
      flex: 1,
      minWidth: isMobile ? '100%' : 220,
      background: 'transparent',
      border: 'none',
      borderRadius: 20,
      padding: isMobile ? '28px 24px' : '36px 32px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Glow */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: 100, height: 100,
        background: `radial-gradient(circle, ${accent}28 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        fontSize: isMobile ? 48 : 64,
        fontWeight: 900,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        background: `linear-gradient(135deg, #fff 30%, ${accent} 100%)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {prefix}{formatted}{suffix}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 600,
        color: 'rgba(255,255,255,0.45)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        textAlign: 'center',
      }}>
        {label}
      </div>
    </div>
  );
}

function StatsCounter({ isMobile }) {
  const ref = useRef(null);
  const [started, setStarted] = useState(false);
  const [stats, setStats] = useState({ totalOrdenes: 0, totalClientes: 0 });

  useEffect(() => {
    fetch('/api/stats/public')
      .then(r => r.json())
      .then(data => {
        setStats({
          totalOrdenes: Number(data?.totalOrdenes) || 0,
          totalClientes: Number(data?.totalClientes) || 0,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStarted(true); observer.disconnect(); } },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} style={{
      padding: isMobile ? '48px 24px' : '72px 80px',
      background: '#111',
      position: 'relative',
      overflow: 'hidden',
      borderTop: '1px solid rgba(255,255,255,0.07)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
    }}>


      <div style={{
        maxWidth: 900,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 40,
        alignItems: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.15em',
            textTransform: 'uppercase', color: '#00AEEF',
            margin: '0 0 10px',
          }}>En números</p>
          <h2 style={{
            fontSize: isMobile ? 24 : 32, fontWeight: 900,
            color: '#fff', margin: 0, letterSpacing: '-0.02em',
          }}>Lo que hacemos, en tiempo real</h2>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 16,
          width: '100%',
        }}>
          <StatCard
            value={stats.totalOrdenes}
            label="Órdenes procesadas"
            accent="#00AEEF"
            started={started}
            isMobile={isMobile}
          />
          <StatCard
            value={stats.totalClientes}
            label="Clientes activos"
            accent="#EC008C"
            started={started}
            isMobile={isMobile}
          />
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ title, desc, img, accent, gradFrom, gradTo, isMobile, forceActive, onToggleActive, setHoverCount }) {
  const [localHover, setLocalHover] = useState(false);

  // En móvil usamos el tap forzado, en escritorio usamos el hover nativo
  const isActive = isMobile ? forceActive : localHover;

  const handleMouseEnter = () => {
    if (!isMobile) {
      setLocalHover(true);
      setHoverCount(prev => prev + 1);
    }
  };

  const handleMouseLeave = () => {
    if (!isMobile) {
      setLocalHover(false);
      setHoverCount(prev => Math.max(0, prev - 1));
    }
  };

  const handleClick = (e) => {
    if (isMobile) {
      e.stopPropagation();
      onToggleActive();
    }
  };

  return (
    <div
      className="service-card-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{
        position: 'relative',
        borderRadius: 20,
        overflow: 'hidden',
        border: `1.5px solid ${isActive ? accent : 'rgba(255,255,255,0.1)'}`,
        background: '#111',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        transform: isActive ? 'translateY(-6px)' : 'none',
        boxShadow: isActive ? `0 8px 24px ${accent}33` : '0 4px 20px rgba(0,0,0,0.4)',
        height: 200,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Background image */}
      {img && (
        <img src={img} alt={title} style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          opacity: isActive ? 0.35 : 0.18,
          transition: 'opacity 0.4s ease',
        }} />
      )}

      {/* Glass/Glow effect for cards without images */}
      {!img && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at 50% 120%, ${accent}33 0%, transparent 70%)`,
          opacity: isActive ? 1 : 0.5,
          transition: 'opacity 0.3s'
        }} />
      )}

      {/* Color gradient overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(135deg, ${gradFrom} 0%, ${gradTo} 100%)`,
        opacity: isActive ? 1 : 0.5,
        transition: 'opacity 0.3s',
      }} />

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '20px 22px',
        display: 'flex', flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
      }}>
        <h3 style={{
          fontSize: 18,
          fontWeight: 800,
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
        }}>{title}</h3>

        <p style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.55,
          margin: 0,
        }}>{desc}</p>
      </div>
    </div>
  );
}

function InfiniteMarquee({ isMobile }) {
  const doubledServices = [...SERVICES, ...SERVICES];
  const trackRef = useRef(null);
  const posRef = useRef(0);
  const currentSpeedRef = useRef(0);
  const targetSpeedRef  = useRef(0);
  const rafRef = useRef(null);
  const dragRef = useRef({ isDragging: false, startX: 0, currentX: 0 });
  const velocityRef = useRef(0);

  const [hoverCount, setHoverCount] = useState(0);
  const [activeIdx, setActiveIdx] = useState(null);

  const NORMAL_SPEED = isMobile ? 0.85 : 0.75; // Doble de rápido que antes por defecto
  const SLOW_SPEED   = isMobile ? 0.10 : 0.08;   

  // Manejo reactivo de la velocidad del carrusel
  useEffect(() => {
    if (isMobile) {
      targetSpeedRef.current = activeIdx !== null ? SLOW_SPEED : NORMAL_SPEED;
    } else {
      targetSpeedRef.current = hoverCount > 0 ? SLOW_SPEED : NORMAL_SPEED;
    }
  }, [activeIdx, hoverCount, isMobile, SLOW_SPEED, NORMAL_SPEED]);

  // Inyectar detector de touch global para toques en "vacíos" fuera de la pista
  useEffect(() => {
    if (!isMobile) return;
    const handleGlobalTouch = (e) => {
      // Si tocaron algo pero no fue una tarjeta, apagar
      if (!e.target.closest('.service-card-wrapper')) {
        setActiveIdx(null);
      }
    };
    
    document.addEventListener('touchstart', handleGlobalTouch);
    return () => document.removeEventListener('touchstart', handleGlobalTouch);
  }, [isMobile]);

  useEffect(() => {
    currentSpeedRef.current = NORMAL_SPEED;
    targetSpeedRef.current  = NORMAL_SPEED;

    const track = trackRef.current;
    if (!track) return;

    const animate = () => {
      if (!dragRef.current.isDragging) {
        if (Math.abs(velocityRef.current) > 0.5) {
          // Fase de inercia: decaer la velocidad del drag con fricción
          velocityRef.current *= 0.93;
          posRef.current += velocityRef.current;
        } else {
          // Auto-scroll normal
          velocityRef.current = 0;
          currentSpeedRef.current += (targetSpeedRef.current - currentSpeedRef.current) * 0.04;
          posRef.current -= currentSpeedRef.current;
        }
      }

      const halfWidth = track.scrollWidth / 2;
      
      // Control seamless para movimiento izquierdo natural
      if (posRef.current <= -halfWidth) {
        posRef.current += halfWidth;
      }
      // Control seamless para drag manual forzado hacia la derecha
      else if (posRef.current > 0) {
        posRef.current -= halfWidth;
      }

      track.style.transform = `translateX(${posRef.current}px)`;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      style={{ width: '100%', overflow: 'hidden', userSelect: 'none', touchAction: 'pan-y' }}
      onClick={() => {
        // Si tocan el fondo vacío en mobile, reseteamos la card activa
        if (isMobile) setActiveIdx(null);
      }}
      onClickCapture={(e) => {
        // Si soltaron el dedo pero fue después de un drag importante, matamos el evento
        // click para evitar que se auto-seleccione una Card falsamente.
        if (isMobile) {
          const totalMoved = Math.abs(dragRef.current.currentX - dragRef.current.startX);
          if (totalMoved > 10) {
            e.stopPropagation();
            e.preventDefault();
          }
        }
      }}
      onTouchStart={(e) => {
        if (!isMobile) return;
        dragRef.current.isDragging = true;
        dragRef.current.startX = e.touches[0].clientX;
        dragRef.current.currentX = e.touches[0].clientX;
        velocityRef.current = 0; // reset inercia al iniciar nuevo drag
      }}
      onTouchMove={(e) => {
        if (!isMobile || !dragRef.current.isDragging) return;
        const currentX = e.touches[0].clientX;
        const delta = currentX - dragRef.current.currentX;
        // EMA para suavizar: evita que el último delta raro defina toda la inercia
        velocityRef.current = velocityRef.current * 0.6 + delta * 0.4;
        posRef.current += delta;
        dragRef.current.currentX = currentX;
      }}
      onTouchEnd={() => {
        if (!isMobile) return;
        dragRef.current.isDragging = false;
        // velocityRef mantiene la última velocidad suavizada → la inercia se aplica en animate()
      }}
      onTouchCancel={() => {
        if (!isMobile) return;
        dragRef.current.isDragging = false;
        velocityRef.current = 0; // cancelar inercia si el touch fue cancelado
      }}
    >
      <div
        ref={trackRef}
        style={{
          display: 'flex',
          gap: isMobile ? 16 : 24,
          padding: '10px 0 40px',
          willChange: 'transform',
        }}
      >
        {doubledServices.map((svc, idx) => (
          <div
            key={`${svc.title}-${idx}`}
            style={{ width: isMobile ? 280 : 340, flexShrink: 0 }}
          >
            <ServiceCard 
              {...svc} 
              isMobile={isMobile}
              forceActive={activeIdx === idx}
              onToggleActive={() => setActiveIdx(prev => prev === idx ? null : idx)}
              setHoverCount={setHoverCount}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcessFlow({ isMobile, isTablet }) {
  const [activeStep, setActiveStep] = useState(null);
  const [hoveredStep, setHoveredStep] = useState(null);

  const handleStepClick = (idx) => {
    setHoveredStep(null); // siempre limpiar hover al hacer click
    setActiveStep(prev => prev === idx ? null : idx);
  };

  const steps = [
    {
      title: 'Idea',
      icon: <IdeaIcon size={isMobile ? 52 : 72} />,
      colorMain: '#006E97', colorCustom: '#00AEEF',
      description: 'Todo empieza con una idea. Nos contás qué querés lograr — un uniforme, una promo, una colección — y nuestro equipo te ayuda a darle forma. Traducimos tu visión en un concepto viable, elegimos los materiales y técnicas más adecuadas, y te orientamos para que el resultado final supere tus expectativas.',
    },
    {
      title: 'Diseño',
      icon: <DisenoIcon size={isMobile ? 52 : 72} />,
      colorMain: '#BD0C7E', colorCustom: '#EC008C',
      description: 'Te damos los recursos necesarios para producir y te conectamos con una red de freelancers especializados para que puedas llevar tus diseños a la realidad. No importa en qué etapa estés — tenemos el entorno para que el proceso creativo fluya sin fricciones hasta la producción.',
    },
    {
      title: 'Producción',
      icon: <ProduccionIcon size={isMobile ? 52 : 72} />,
      colorMain: '#DCB308', colorCustom: '#FDE047',
      description: 'Sublimación textil, DTF, impresión directa, corte láser, parches TPU y bordados — cubrimos todos los procesos bajo un mismo techo. Cada trabajo pasa por control de calidad interno antes de salir de planta, ya sea una pieza única o una tirada a gran escala.',
    },
    {
      title: 'Entrega',
      icon: <EntregaIcon size={isMobile ? 52 : 72} />,
      colorMain: '#71717a', colorCustom: '#d4d4d8',
      description: 'Coordinamos el envío o retiro de tu pedido con total transparencia. Te mantenemos informado en cada etapa, desde que el producto sale de producción hasta que llega a tus manos. Trabajamos con logística confiable para que recibas tu pedido en tiempo y forma, donde estés.',
    },
  ];


  return (
    <section style={{
      padding: isMobile ? '48px 20px' : isTablet ? '56px 40px' : '64px 80px',
      background: '#111',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{
          color: '#f4f4f5',
          fontSize: isMobile ? 16 : 20,
          fontWeight: 600,
          letterSpacing: '-0.5px',
          margin: 0,
          marginBottom: isMobile ? 28 : 40,
          textAlign: isMobile ? 'center' : 'left',
        }}>
          ¿Qué es USER?
        </h2>

        {/* Icons row */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-evenly',
          gap: isMobile ? 16 : 0,
          width: '100%',
        }}>
          {steps.map((step, idx) => {
            const isActive = activeStep === idx;
            const isHovered = hoveredStep === idx;
            return (
              <Fragment key={idx}>
                {/* Step button (now acts as the direct flex item) */}
                <div
                  onClick={() => handleStepClick(idx)}
                  onMouseEnter={isMobile ? undefined : () => setHoveredStep(idx)}
                  onMouseLeave={isMobile ? undefined : () => setHoveredStep(null)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    flex: isMobile ? 'none' : 1,
                    width: isMobile ? '100%' : 'auto',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                    padding: '16px 8px',
                    borderRadius: 12,
                    transition: isMobile ? 'none' : 'background 0.15s ease, border-color 0.15s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    background: isActive ? `${step.colorMain}1E` : isHovered ? `${step.colorMain}0D` : 'transparent',
                    border: isActive ? `1px solid ${step.colorCustom}40` : isHovered ? `1px solid ${step.colorCustom}20` : '1px solid transparent',
                    boxShadow: isHovered && !isActive ? `0 12px 30px -10px ${step.colorCustom}33` : 'none',
                    transform: isHovered && !isActive ? 'translateY(-4px)' : 'none',
                    userSelect: 'none',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: 1,
                    transform: (isActive || isHovered) ? 'translateY(-3px) scale(1.03)' : 'none',
                    transition: isMobile ? 'none' : 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  }}>
                    {cloneElement(step.icon, { isActive })}
                  </div>
                  <span style={{
                    marginTop: 10,
                    fontSize: 14, fontWeight: 600,
                    color: isActive ? step.colorCustom : '#f4f4f5',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    transition: isMobile ? 'none' : 'color 0.2s',
                  }}>
                    {step.title}
                  </span>
                  {/* indicator dot */}
                  <div style={{
                    width: 4, borderRadius: '50%',
                    background: step.colorMain,
                    marginTop: 10,
                    height: 4,
                    opacity: isActive ? 1 : 0,
                    transition: isMobile ? 'none' : 'all 0.2s',
                  }} />
                  {/* inline mobile text */}
                  {isMobile && (
                    <div style={{
                      overflow: 'hidden',
                      maxHeight: isActive ? 300 : 0,
                      opacity: isActive ? 1 : 0,
                      transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease',
                      width: '100%',
                    }}>
                      <div style={{
                        padding: isActive ? '12px 8px 0' : '0 8px',
                        textAlign: 'center'
                      }}>
                        <p style={{
                          color: 'rgba(255,255,255,0.75)', fontSize: 13,
                          lineHeight: 1.6, margin: 0
                        }}>
                          {step.description}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Arrow between steps (now a sibling) */}
                {idx < steps.length - 1 && (
                  <div style={{
                    opacity: 0.2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: isMobile ? 0 : '0 4px',
                    width: isMobile ? '100%' : 'auto',
                    height: isMobile ? 24 : 'auto',
                    flexShrink: 0,
                  }}>
                    <svg
                      width="24" height="12" viewBox="0 0 32 16"
                      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: isMobile ? 'rotate(90deg)' : 'none', display: 'block' }}
                    >
                      <path d="M0 8h30M24 2l6 6-6 6" />
                    </svg>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>

        {/* Desktop Drawer panel */}
        {!isMobile && (
          <div style={{
            overflow: 'hidden',
            maxHeight: activeStep !== null ? 240 : 0,
            opacity: activeStep !== null ? 1 : 0,
            transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
            maxWidth: 820,
            margin: '0 auto',
          }}>
            {activeStep !== null && (
              <div style={{
                marginTop: 24,
                padding: '24px 32px',
                background: `${steps[activeStep].colorMain}1E`,
                borderRadius: 12,
                border: `1px solid ${steps[activeStep].colorCustom}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 24,
                minHeight: 190,
                boxSizing: 'border-box',
              }}>
                <div style={{ flexShrink: 0, opacity: 0.5, width: 72, display: 'flex', justifyContent: 'center' }}>
                  {cloneElement(steps[activeStep].icon, { isActive: true })}
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{
                    color: '#fff', fontSize: 17, fontWeight: 600,
                    margin: '0 0 8px', letterSpacing: '-0.3px',
                    textTransform: 'uppercase'
                  }}>
                    {steps[activeStep].title}
                  </h3>
                  <p style={{
                    color: 'rgba(255,255,255,0.55)', fontSize: 14,
                    lineHeight: 1.7, margin: 0, maxWidth: 700
                  }}>
                    {steps[activeStep].description}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const VIDEO_TEXTS = [
  { time: 0, text: 'ECOSISTEMA INTEGRAL' },
  { time: 1.567, text: 'IMPRESIÓN' },
  { time: 3.600, text: 'SUBLIMACIÓN' },
  { time: 5.566, text: 'CORTE LÁSER' },
  { time: 7.767, text: 'BORDADO' },
  { time: 9.933, text: 'ESTAMPADO' },
  { time: 12.766, text: 'DTF UV' },
  { time: 14.001, text: 'ECO UV' },
  { time: 16.200, text: 'DTF TEXTIL' },
  { time: 19.166, text: 'COSTURA' },
  { time: 21.967, text: 'TPU' },
  { time: 24.033, text: 'IMPORTADORES DIRECTOS' },
  { time: 9999, text: '' }
];

function VideoTypewriter({ videoRef, isMobile }) {
  const [currentText, setCurrentText] = useState('');
  const maskRef = useRef(null);
  const printheadRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const vid = videoRef.current;
    let reqId;
    let lastText = '';

    let lastTime = performance.now();
    let smoothCt = vid.currentTime;

    const loop = (nowTime) => {
      // Lerp temporal para que no dependa de la baja resolución de actualización de vid.currentTime (que salta en bloques)
      const delta = (nowTime - lastTime) / 1000;
      lastTime = nowTime;

      if (!vid.paused) {
        smoothCt += delta;
        const diff = vid.currentTime - smoothCt;
        if (Math.abs(diff) > 0.1) {
          smoothCt = vid.currentTime; // Snap si hay un salto fuerte (como cuando reinicia el loop del video)
        } else {
          smoothCt += diff * 0.1; // Suavizado micro por si derrapa de sincronía
        }
      } else {
        smoothCt = vid.currentTime;
      }

      const ct = smoothCt;

      const currentIndex = VIDEO_TEXTS.findIndex((item, i, arr) => {
        const next = arr[i + 1];
        return ct >= item.time && (!next || ct < next.time);
      });

      if (currentIndex !== -1) {
        const currentItem = VIDEO_TEXTS[currentIndex];
        const nextItem = VIDEO_TEXTS[currentIndex + 1];

        const targetText = currentItem.text;

        // Evitamos que React renderice a lo bobo. Solo forzamos re-render si cambió la palabra base.
        if (targetText !== lastText) {
          lastText = targetText;
          // Ocultamos la máscara ANTES del re-render para evitar el flash de ~1 frame
          if (maskRef.current) maskRef.current.style.clipPath = 'inset(0 100% 0 0)';
          if (printheadRef.current) printheadRef.current.style.left = '0%';
          setCurrentText(targetText);
        }

        const timeInState = Math.max(0, ct - currentItem.time);

        // Usamos el tiempo restante real del video (vid.duration) como tope para que el rebobinado termine idénticamente con el loop
        const duration = (nextItem && nextItem.time < 999) ? (nextItem.time - currentItem.time) : (vid.duration ? vid.duration - currentItem.time : 3.0);

        // Curva ease-in-out (sinusoidal) para suavizar la aceleración en extremos
        const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

        // ── TIMING REDESIGN ──
        // 38% ida | 8% pausa derecha | 38% vuelta | 16% pausa izquierda (esperando próxima palabra)
        // Ida y vuelta exactamente igual de rápidas. Entrada/salida suaves con easing.
        const typePhaseTime = duration * 0.38;
        const holdRightTime = duration * 0.08;
        const returnPhaseTime = duration * 0.38;
        const startHold = typePhaseTime;
        const startReturn = startHold + holdRightTime;
        const endReturn = startReturn + returnPhaseTime;

        let sliderPhase = 0;

        if (timeInState <= typePhaseTime) {
          // Ida: 0 → 1 con ease-in-out
          sliderPhase = easeInOut(Math.min(1, timeInState / typePhaseTime));
        } else if (timeInState <= startReturn) {
          // Pausa a la derecha
          sliderPhase = 1;
        } else if (timeInState <= endReturn) {
          // Vuelta: 1 → 0 con ease-in-out (misma curva, simétrica)
          sliderPhase = 1 - easeInOut((timeInState - startReturn) / returnPhaseTime);
        } else {
          // Pausa a la izquierda (off-screen) hasta la siguiente palabra
          sliderPhase = 0;
        }

        // En mobile la máscara es exactamente del mismo tamaño de la pista de 130vw (1:1 sliderPhase)
        // En desktop mantenemos la exclusión de las zonas de parking asimétricas.
        let clipProgress = 0;
        if (isMobile) {
          clipProgress = sliderPhase;
        } else {
          clipProgress = (sliderPhase - 0.15) / 0.85;
        }
        clipProgress = Math.max(0, Math.min(1, clipProgress));

        // Aplicamos matemáticas flotantes a 60FPS directamente al motor de Render
        if (maskRef.current && printheadRef.current) {
          maskRef.current.style.clipPath = `inset(0 ${100 - (clipProgress * 100)}% 0 0)`;
          printheadRef.current.style.left = `${sliderPhase * 100}%`;
        }
      }

      reqId = requestAnimationFrame(loop);
    };

    reqId = requestAnimationFrame(loop);

    // Ya no usamos timeupdate porque corre a poquísimos hertz y entorpece la animación.
    // Con un requestAnimationFrame ininterrumpido atado a performanceNow tenemos 60 cuadros reales.
    return () => {
      cancelAnimationFrame(reqId);
    };
  }, [videoRef]);

  return (
    <div style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: isMobile ? 'clamp(16px, 5.5vw, 24px)' : 44,
      fontWeight: 600,
      color: '#fff',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap'
    }}>
      {/* Contenedor estático que dicta el tamaño y centra la disposición en el layout padre */}
      <span style={{
        opacity: 0,
        userSelect: 'none',
        padding: isMobile ? '0' : '0 65px 0 80px',
        minWidth: 100
      }}>
        {currentText}
      </span>

      {/* Riel fantasma desvinculado de flexbox para que no se escale ni achique */}
      <span style={{
        position: 'absolute',
        top: 0, bottom: 0,
        // En mobile forzamos 120vw centrado, en desktop el 100% de la caja de arriba
        left: isMobile ? '50%' : 0,
        right: isMobile ? 'auto' : 0,
        width: isMobile ? '120vw' : '100%',
        transform: isMobile ? 'translateX(-50%)' : 'none',
        display: 'flex',
        justifyContent: isMobile ? 'center' : 'flex-start',
        alignItems: 'center',
        padding: isMobile ? '0' : '0 65px 0 80px',
      }}>

        {/* Enmascarador del texto visible atado al porcentaje del cabezal */}
        <span
          ref={maskRef}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: isMobile ? 'center' : 'inherit',
            alignItems: 'center',
            padding: isMobile ? '0' : '0 65px 0 80px',
            clipPath: 'inset(0 100% 0 0)',
            whiteSpace: 'nowrap',
            zIndex: 1
          }}
        >
          {currentText}
        </span>

        {/* Cabezal magnético operado por useRef a 60fps */}
        <span
          ref={printheadRef}
          style={{
            position: 'absolute',
            left: '0%', // Corre localmente sobre su pista (de 0 a 100%)
            top: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'inline-flex',
            alignItems: 'center',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <PrinterCartridgeIcon size={isMobile ? 70 : 130} />
        </span>
      </span>
    </div>
  );
}
