import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import LandingNavbar from '../shared/LandingNavbar';
import Footer from '../Footer';
import ParticlesCanvas from '../ui/ParticlesCanvas';
import GuiaDtf from './guias/GuiaDtf';
import GuiaEcouv from './guias/GuiaEcouv';
import GuiaSublimacion from './guias/GuiaSublimacion';
import GuiaTelaCliente from './guias/GuiaTelaCliente';
import GuiaCenco from './guias/GuiaCenco';
import GuiaEmblemas from './guias/GuiaEmblemas';
import GuiaCanvas from './guias/GuiaCanvas';
import GuiaLona from './guias/GuiaLona';

// Las guías son código (guias/*.jsx) desde el 16/10/2026. Los PDF anteriores quedaron en
// public/guias/guiasenpdf/. «Descargar» imprime la guía elegida: el navegador ofrece «Guardar como PDF».
const GUIDES = [
  {
    id: 'dtf',
    label: 'DTF',
    description: 'Guía técnica de preparación de archivos para impresión DTF.',
    accent: '#EC008C',
    Guia: GuiaDtf,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>
      </svg>
    ),
  },
  {
    id: 'ecouv',
    label: 'ECOUV / Gran Formato',
    description: 'Guía de archivos para impresión ECOUV y gran formato.',
    accent: '#FFF200',
    Guia: GuiaEcouv,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
    ),
  },
  {
    id: 'lona',
    label: 'Terminaciones de Lona',
    description: 'Cuánto margen dejar en la lona según la terminación de cada lado.',
    accent: '#FFE600',
    Guia: GuiaLona,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="1"/><circle cx="5.5" cy="8.5" r="1"/><circle cx="18.5" cy="8.5" r="1"/><circle cx="5.5" cy="15.5" r="1"/><circle cx="18.5" cy="15.5" r="1"/>
      </svg>
    ),
  },
  {
    id: 'canvas',
    label: 'Cuadros Canvas',
    description: 'Cómo mandar el arte de un cuadro canvas: medida final + 5 cm por lado.',
    accent: '#22A8E0',
    Guia: GuiaCanvas,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10" strokeDasharray="2 2"/>
      </svg>
    ),
  },
  {
    id: 'sublimacion',
    label: 'Sublimación',
    description: 'Guía técnica de preparación de archivos para sublimación textil.',
    accent: '#00AEEF',
    Guia: GuiaSublimacion,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5c0 5-5 13-5 13S7 12 7 7a5 5 0 0 1 5-5z"/>
        <circle cx="12" cy="7" r="2"/>
      </svg>
    ),
  },
  {
    id: 'impritex',
    label: 'Sublimación — Tela Cliente',
    description: 'Guía técnica para sublimación sobre tela aportada por el cliente.',
    accent: '#f4f4f5',
    Guia: GuiaTelaCliente,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
      </svg>
    ),
  },
  {
    id: 'cenco',
    label: 'Corte Láser y Costura',
    description: 'Guía para solicitar corte láser y costura (CENCO).',
    accent: '#ED2423',
    Guia: GuiaCenco,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>
      </svg>
    ),
  },
  {
    id: 'emblemas',
    label: 'Bordados y Parches',
    description: 'Procedimiento para el servicio de bordados y parches (Emblemas).',
    accent: '#B46BC8',
    Guia: GuiaEmblemas,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>
      </svg>
    ),
  },
];

// Impresión: solo sale la copia de la guía que va en <body> (portal), una hoja A4 por <Hoja>.
// La hoja se imprime a escala 0.78 (más ancha que en pantalla): así cada <Hoja> entra en una A4.
const ESTILO_IMPRESION = `
@media screen { .guia-print-root { display: none; } }
@media print {
  @page { size: A4; margin: 0; }
  html, body { background: #fff !important; overflow: visible !important; height: auto !important; }
  body > *:not(.guia-print-root) { display: none !important; }
  /* index.css oculta body > * al imprimir (tickets de caja): acá hay que ganarle en especificidad */
  body > .guia-print-root { display: block !important; visibility: visible !important; }
  body > .guia-print-root * { visibility: visible !important; }
  .guia-print-root .guia-imprimible { gap: 0 !important; }
  .guia-print-root .guia-hoja {
    zoom: 0.78; width: calc(210mm / 0.78); min-height: calc(297mm / 0.78);
    border-radius: 0 !important; box-shadow: none !important;
    break-after: page; page-break-after: always;
  }
  .guia-print-root .guia-hoja:last-child { break-after: auto; page-break-after: auto; }
  .guia-print-root .guia-tarjeta { break-inside: avoid; }
  .guia-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default function GuidesPage() {
  const [selected, setSelected] = useState(GUIDES[0].id);
  const active = GUIDES.find(g => g.id === selected);
  const GuiaActiva = active.Guia;

  useEffect(() => {
    document.body.style.overflow = 'auto';
    window.scrollTo(0, 0);
    return () => { document.body.style.overflow = 'hidden'; };
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-custom-dark relative overflow-x-hidden font-sans">
      <style>{ESTILO_IMPRESION}</style>
      <LandingNavbar />
      <ParticlesCanvas />

      <div className="flex-1 z-10 pt-[85px] pb-10 flex flex-col">

        {/* Header */}
        <div className="px-6 md:px-12 pt-8 pb-6 max-w-7xl mx-auto w-full">
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-bold mb-2">Recursos</p>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
            Guías de Preparación
          </h1>
          <p className="text-zinc-400 text-sm md:text-base">
            Descargá o revisá las guías técnicas de cada técnica de impresión antes de subir tus archivos.
          </p>
        </div>

        {/* Selector — lista vertical en mobile, sidebar en desktop */}
        <div className="flex-1 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto w-full flex flex-col md:flex-row gap-6">

          {/* Sidebar / top-tabs */}
          <div className="grid grid-cols-2 md:grid-cols-1 gap-2 md:w-56 flex-shrink-0 md:self-start md:sticky md:top-[100px]">
            {GUIDES.map(g => {
              const isActive = selected === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setSelected(g.id)}
                  style={{
                    border: `1.5px solid ${isActive ? g.accent : 'rgba(255,255,255,0.10)'}`,
                    background: isActive ? `${g.accent}14` : 'transparent',
                    color: isActive ? g.accent : 'rgba(255,255,255,0.55)',
                    boxShadow: isActive ? `0 0 18px ${g.accent}28` : 'none',
                    transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                  }}
                  className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-bold cursor-pointer text-left"
                >
                  <span style={{ color: isActive ? g.accent : 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{g.icon}</span>
                  {g.label}
                </button>
              );
            })}
          </div>

          {/* Guía */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

            {/* Info strip */}
            <div
              style={{
                borderLeft: `3px solid ${active.accent}`,
                background: `${active.accent}10`,
                transition: 'all 0.3s ease',
              }}
              className="px-4 py-3 rounded-r-xl flex items-center justify-between gap-4 flex-wrap"
            >
              <p className="text-sm font-semibold text-zinc-200">{active.description}</p>
              <button
                type="button"
                onClick={() => window.print()}
                title="Abre la impresión: elegí «Guardar como PDF» para descargarla"
                style={{ border: `1.5px solid ${active.accent}`, color: active.accent }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-transparent hover:bg-white/5 transition-all flex-shrink-0 cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Descargar / Imprimir
              </button>
            </div>

            <div key={active.id} className="max-w-[920px] w-full">
              <GuiaActiva />
            </div>
          </div>
        </div>
      </div>

      <div className="z-10 bg-[#111] relative">
        <Footer />
      </div>

      {createPortal(<div className="guia-print-root"><GuiaActiva /></div>, document.body)}
    </div>
  );
}
