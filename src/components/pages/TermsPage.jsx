import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import LandingNavbar from '../shared/LandingNavbar';
import Footer from '../Footer';
import ParticlesCanvas from '../ui/ParticlesCanvas';
import DocumentoTerminos from './terminos/DocumentoTerminos';
import { PDF_URL, VERSION, VIGENCIA } from './terminos/contenido';

// Términos y Condiciones v1.0 (29/10/2026): el documento va con la estética de las guías (hoja blanca) y se
// descarga como PDF ya generado (public/legal/, ver scripts/generar-terminos-pdf.mjs).
// /terminos?pdf=1 muestra solo la hoja, a ancho A4: es lo que imprime el generador del PDF.
const ESTILO_PDF = `
  html, body, #root, #root > * { background: #fff !important; overflow: visible !important; height: auto !important; }
  /* todo el ancho de la página (210 mm justos dejaban ver el fondo del sitio en el borde derecho) */
  .terminos-pdf { width: 100%; }
  /* cada página ya lleva su pie con la versión y la dirección (lo pone el generador) */
  .terminos-pdf .terminos-pie { display: none !important; }
  /* overflow visible: al paginar, los saltos agregan espacio y lo que se pasa del alto de la hoja quedaba recortado */
  .terminos-pdf .guia-hoja { border-radius: 0 !important; box-shadow: none !important; overflow: visible !important; }
  .terminos-pdf .terminos-nueva-pagina { break-before: page; }
  /* un punto, o si no entra un subpunto, que cabe en lo que queda de la hoja no se corta: pasa entero a la
     siguiente. El generador mide cada uno y les pone .terminos-junto a los que entran en una hoja. */
  .terminos-pdf .terminos-junto { break-inside: avoid; }
  .terminos-pdf .terminos-seccion, .terminos-pdf h4 { break-after: avoid; }
  .terminos-pdf .guia-tarjeta, .terminos-pdf tr, .terminos-pdf li, .terminos-pdf .terminos-pie, .terminos-pdf .terminos-indice { break-inside: avoid; }
  .terminos-pdf * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
// Si alguien imprime la página sale solo el documento: una copia en <body> (portal), como en /guias, porque
// index.css oculta todo lo de #root al imprimir (tickets de caja).
const ESTILO_IMPRESION = `
@media screen { .terminos-print-root { display: none; } }
@media print {
  @page { size: A4; margin: 12mm 0 14mm; }
  html, body { background: #fff !important; overflow: visible !important; height: auto !important; }
  body > *:not(.terminos-print-root) { display: none !important; }
  body > .terminos-print-root { display: block !important; visibility: visible !important; }
  body > .terminos-print-root * { visibility: visible !important; }
  .terminos-print-root .guia-hoja { border-radius: 0 !important; box-shadow: none !important; overflow: visible !important; }
  .terminos-print-root .terminos-nueva-pagina { break-before: page; }
  .terminos-print-root .terminos-seccion, .terminos-print-root h4 { break-after: avoid; }
  .terminos-print-root .guia-tarjeta, .terminos-print-root tr, .terminos-print-root li, .terminos-print-root .terminos-indice { break-inside: avoid; }
  .terminos-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const esPdf = () => new URLSearchParams(window.location.search).has('pdf');

export default function TermsPage() {
  const modoPdf = esPdf();

  useEffect(() => {
    document.body.style.overflow = 'auto';
    if (!window.location.hash) window.scrollTo(0, 0);
    return () => { document.body.style.overflow = 'hidden'; };
  }, []);

  if (modoPdf) {
    return (
      <div className="terminos-pdf bg-white font-sans">
        <style>{ESTILO_PDF}</style>
        <DocumentoTerminos />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-custom-dark relative overflow-x-hidden font-sans">
      <style>{ESTILO_IMPRESION}</style>
      <LandingNavbar />
      <ParticlesCanvas />

      <div className="flex-1 z-10 pt-[85px] pb-12">
        {/* Encabezado de la página */}
        <div className="px-6 md:px-12 pt-10 pb-6 max-w-[920px] mx-auto w-full">
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-bold mb-3">Documento legal</p>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-4 leading-tight">
            Términos y Condiciones
          </h1>
          <p className="text-zinc-400 text-sm md:text-base leading-relaxed max-w-2xl">
            Cómo trabaja USER: qué hace la empresa, qué hace el Cliente y de qué se hace cargo cada uno cuando algo sale mal.
            Le recomendamos leerlos antes de mandar su pedido.
          </p>

          <div className="mt-6 px-4 py-3 rounded-r-xl border-l-[3px] border-white/60 bg-white/[0.04] flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm font-semibold text-zinc-200">
              Versión {VERSION} · vigente desde el {VIGENCIA}
            </p>
            <a
              href={PDF_URL}
              download
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white border-[1.5px] border-white/70 hover:bg-white/10 transition-all flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Descargar PDF
            </a>
          </div>
        </div>

        {/* El documento */}
        <div className="px-4 sm:px-6 md:px-12 max-w-[920px] mx-auto w-full">
          <DocumentoTerminos />
        </div>
      </div>

      <div className="z-10 bg-[#111] relative">
        <Footer />
      </div>

      {createPortal(<div className="terminos-print-root"><DocumentoTerminos /></div>, document.body)}
    </div>
  );
}
