import React, { useState } from 'react';
import { Logo } from './Logo';
import Swal from 'sweetalert2';
import { useViewport } from '../hooks/useViewport';
import fbIcon from "../assets/images/social/facebook.svg";
import igIcon from "../assets/images/social/instagram.svg";
import ttIcon from "../assets/images/social/tiktok.svg";
import ShowroomMap from './ShowroomMap';
import Social from './icons/SocialIcons';
import handyLogo from '../assets/images/pasarelas/handy.svg';
import mpLogo from '../assets/images/pasarelas/mercadopago.svg';
import waColor from '../assets/images/social/whatsapp.svg';

const SOCIALS = [
  { label: 'Instagram User', href: 'https://www.instagram.com/user.uruguay/',                                       icon: 'ig' },
  { label: 'Facebook User',  href: 'https://www.facebook.com/profile.php?viewas=100000686899395&id=61572025574993', icon: 'fb' },
  { label: 'Tiktok User',    href: 'https://www.tiktok.com/@user.sublimacion.dtf.uy',                               icon: 'tt' },
];

const ICON = {
  fb: <img src={fbIcon} alt="FB" style={{ width: '100%', height: 'auto', display: 'block' }} />,
  ig: <img src={igIcon} alt="IG" style={{ width: '100%', height: 'auto', display: 'block' }} />,
  tt: <img src={ttIcon} alt="TikTok" style={{ width: '100%', height: 'auto', display: 'block' }} />
};



const sLink = {
  display: 'flex', alignItems: 'center', gap: 10,
  color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
  fontSize: 13, fontWeight: 500, transition: 'color 0.2s',
};

export default function Footer() {
  const { isMobile, isTablet } = useViewport();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  
  const isAuthPage = typeof window !== 'undefined' && 
    (window.location.pathname === '/login' || window.location.pathname === '/register');

  const handleSubscribe = async (e) => {
      e.preventDefault();
      if (!email) return;

      const Toast = Swal.mixin({
          toast: true,
          position: 'bottom-end',
          showConfirmButton: false,
          timer: 3000,
          background: '#18181b',
          color: '#e4e4e7',
          customClass: { popup: 'rounded-xl border border-zinc-700' }
      });

      setLoading(true);
      try {
          const res = await fetch('/api/web-content/newsletter', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email })
          });
          const data = await res.json();
          if (data.success) {
              Toast.fire({ icon: 'success', title: '¡Suscripción exitosa!' });
              setEmail('');
          } else {
              Toast.fire({ icon: 'error', title: 'Error', text: data.error || 'No se pudo procesar.' });
          }
      } catch (err) {
          Toast.fire({ icon: 'error', title: 'Error de red' });
      } finally {
          setLoading(false);
      }
  };

  return (
    <footer style={{ 
      background: isAuthPage ? 'rgba(17, 17, 17, 0.25)' : '#111', 
      borderTop: '1px solid rgba(255,255,255,0.07)', 
      fontFamily: "'Inter', sans-serif",
      backdropFilter: 'none'
    }}>

      {/* ── MAIN FOOTER ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3, 1fr)',
        gap: isMobile ? 32 : 48,
        padding: isMobile ? '40px 24px 32px' : '28px 80px 48px',
        alignItems: 'stretch',
      }}>

        {/* COL 1 — Redes */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', order: isMobile ? 1 : 0, ...(isMobile && { borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: 28 }) }}>
          <h4 className="text-[12px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6 text-center">
            SEGUINOS EN
          </h4>
          {isMobile ? (
            <div style={{ display: 'flex', gap: 32, flexDirection: 'row' }}>
              {SOCIALS.map(s => (
                <a 
                  key={s.icon} 
                  href={s.href} 
                  target="_blank" 
                  rel="noreferrer"
                  aria-label={s.label}
                  style={{ 
                    display: 'block', 
                    width: 54, 
                    height: 'auto',
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {ICON[s.icon]}
                </a>
              ))}
            </div>
          ) : (
            <Social
              instagramUrl={SOCIALS.find(s => s.icon === 'ig').href}
              facebookUrl={SOCIALS.find(s => s.icon === 'fb').href}
              tiktokUrl={SOCIALS.find(s => s.icon === 'tt').href}
              direction="column"
            />
          )}
        </div>

        {/* COL 2 — Showroom */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', order: isMobile ? 0 : 1, ...(isMobile && { borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: 28 }) }}>
          
          {/* Divisores decorativos (Solo Desktop/Tablet) */}
          {!isMobile && (
            <>
              <div style={{ position: 'absolute', left: -24, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.15)' }} />
              {!isTablet && (
                <div style={{ position: 'absolute', right: -24, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.15)' }} />
              )}
            </>
          )}

          <h4 className="text-[12px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6 text-center">
            VISITÁ NUESTRO SHOWROOM
          </h4>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#0ea5e9"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            Arenal Grande 2667, Montevideo
          </p>
          {/* Mapa interactivo Leaflet */}
          <div style={{ width: '100%', maxWidth: 340 }}>
            <ShowroomMap />
          </div>
        </div>

        {/* COL 3 — Ayuda, Newsletter y Pagos */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', height: '100%', order: isMobile ? 2 : 2 }}>
          
          <h4 className="text-[12px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6 text-center">
            AYUDA Y CONTACTO
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 280 }}>
            {/* 1. Botón WhatsApp */}
            <a 
              href="https://wa.me/59899503501"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '10px 16px',
                background: 'rgba(37, 211, 102, 0.1)',
                border: '1px solid rgba(37, 211, 102, 0.3)',
                borderRadius: 999, color: '#25D366',
                fontSize: 13, fontWeight: 600, textDecoration: 'none', transition: 'all 0.2s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(37, 211, 102, 0.2)'; e.currentTarget.style.borderColor = '#25D366'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(37, 211, 102, 0.1)'; e.currentTarget.style.borderColor = 'rgba(37, 211, 102, 0.3)'; }}
            >
              <img src={waColor} alt="WhatsApp" style={{ width: 18, height: 18, transform: 'scale(1.4)' }} />
              Contactar por WhatsApp
            </a>

            {/* Separador */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

            {/* 2. Newsletter */}
            <div style={{ textAlign: 'left', marginTop: -6 }}>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, margin: '0 0 8px', textAlign: 'center' }}>
                Recibí promociones y novedades exclusivas
              </p>
              <div style={{ display: 'flex', position: 'relative' }}>
                <input 
                  type="email" 
                  placeholder="Tu correo electrónico" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSubscribe(e);
                    }
                  }}
                  style={{
                    width: '100%', padding: '10px 40px 10px 16px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 999, color: '#fff', fontSize: 13, outline: 'none', transition: 'border-color 0.2s'
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(255,255,255,0.4)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
                />
                <button 
                  type="button" 
                  onClick={handleSubscribe}
                  disabled={loading} 
                  style={{
                    position: 'absolute', right: 4, top: 4, bottom: 4,
                    width: 32, 
                    background: loading ? '#334155' : 'linear-gradient(135deg, #06b6d4, #0ea5e9)', 
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: loading ? 'not-allowed' : 'pointer', 
                    transition: 'all 0.2s',
                    boxShadow: loading ? 'none' : '0 2px 10px rgba(6, 182, 212, 0.4)'
                  }}
                  onMouseEnter={e => {
                    if (!loading) {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 4px 14px rgba(6, 182, 212, 0.6)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!loading) {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 2px 10px rgba(6, 182, 212, 0.4)';
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </div>
            </div>

            {/* Trabaja con Nosotros */}
            <button style={{
              width: '100%',
              padding: '10px 18px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 999,
              color: 'rgba(255,255,255,0.7)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#fff'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onClick={() => window.location.href = '/trabaja-con-nosotros'}
            >
              Sumate al equipo
            </button>

            {/* Separador */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

            {/* 4. Medios de Pago y Seguridad */}
            <div style={{ textAlign: 'center', marginTop: -6 }}>
               <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Pagos 100% Seguros</p>
               <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center' }}>
                 
                 <div style={{ background: '#ffe600', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
                   <img src={mpLogo} alt="Mercado Pago" style={{ height: 18 }} />
                 </div>
                 
                 <div style={{ background: '#722efa', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
                   <img src={handyLogo} alt="Handy" style={{ height: 18 }} />
                 </div>

               </div>
            </div>

          </div>
        </div>

      </div>

      {/* ── COPYRIGHT BAR ── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: isMobile ? '20px 24px' : '20px 80px',
        display: 'flex',
        flexDirection: isMobile ? 'column-reverse' : 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: isMobile ? 16 : 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo style={{ height: 20, color: 'white', opacity: 0.4 }} />
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: 0, fontWeight: 500, letterSpacing: '0.02em' }}>
            &copy; {new Date().getFullYear()} USER. Todos los derechos reservados.
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a
            href="/terminos"
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
          >
            Términos y Condiciones
          </a>
          <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
          <a
            href="/privacidad"
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
          >
            Privacidad
          </a>
        </div>
      </div>

    </footer>
  );
}
