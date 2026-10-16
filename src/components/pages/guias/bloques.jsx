/**
 * Bloques de las guías de preparación (/guias). Reproducen el diseño de los PDF de 2026 (los
 * originales quedaron en public/guias/guiasenpdf/): hoja blanca, franja de «Atención», tarjetas
 * numeradas, tablas de medidas y pie con la barra CMYK.
 *
 * El color de cada guía va en variables CSS que define <Guia tema={...}>:
 *   --g-ac  acento (rellenos: banner, insignias, píldoras)
 *   --g-tx  texto en color (bajadas, «+ ítems», valores)
 *   --g-sv  fondo suave (tarjetas de color, notas)
 *   --g-on  texto sobre el acento
 *   --g-in  número de la insignia
 * Cada <Hoja> es una página A4 al imprimir (ver estilos de impresión en GuidesPage).
 */
import { QRCodeSVG } from 'qrcode.react';

const MONO = { fontFamily: "'Roboto Mono', 'Google Sans Code', monospace" };
const URL_TERMINOS = 'https://user.com.uy/terminos';

export function Guia({ tema, children }) {
  const vars = {
    '--g-ac': tema.acento,
    '--g-tx': tema.texto,
    '--g-sv': tema.suave,
    '--g-on': tema.sobre,
    '--g-in': tema.insignia ?? tema.sobre,
    '--g-at': tema.atencion ?? tema.acento,
  };
  return <div className="guia-imprimible flex flex-col gap-6" style={vars}>{children}</div>;
}

export function Hoja({ children }) {
  return (
    <article className="guia-hoja bg-white text-zinc-900 rounded-2xl overflow-hidden flex flex-col shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
      <div className="flex-1 px-5 sm:px-8 md:px-10 pt-6 pb-8 flex flex-col gap-5 text-[13.5px] leading-relaxed">
        {children}
      </div>
    </article>
  );
}

/* ── Cabecera ─────────────────────────────────────────────────────────── */

const Asterisco = () => (
  <svg viewBox="0 0 25.19 25.19" className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" aria-hidden="true">
    <path d="M12.59 12.59L9.65 25.19L15.53 25.19ZM12.59 12.59L19.42 23.58L23.57 19.42ZM12.59 12.59L25.19 15.53L25.19 9.65ZM12.59 12.59L23.57 5.77L19.42 1.61ZM12.59 12.59L15.53 0L9.65 0ZM12.59 12.59L5.77 1.61L1.61 5.77ZM12.59 12.59L0 9.65L0 15.53ZM12.59 12.59L1.61 19.42L5.77 23.58Z" />
  </svg>
);

/** Fila de arriba: «✻ 01. GUÍA DE ARCHIVOS · MARCA · AÑO» + la franja negra de «Atención». */
export function Encabezado({ numero, seccion, destacado, marca, anio }) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-300 pb-2.5 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
        <span className="flex items-center gap-2 text-zinc-900 whitespace-nowrap">
          <Asterisco />
          <span><b>{numero}</b> {seccion} <b>{destacado}</b></span>
        </span>
        <span className="hidden md:block text-center truncate">{marca}</span>
        <span style={MONO} className="tracking-normal">{anio}</span>
      </div>
      <p className="rounded-full bg-black text-white text-[12px] font-semibold text-center px-5 py-2 leading-snug">
        <span style={MONO} className="text-[var(--g-at)] font-medium mr-2">[ ATENCIÓN ]</span>
        No se aceptarán reclamos por errores derivados del incumplimiento de estas instrucciones.
      </p>
    </header>
  );
}

/** Título de dos líneas: la primera liviana y la segunda en color (o resaltada, en ECOUV).
 *  `previo2` va al principio de la segunda línea sin color («con tintas»). */
export function Titulo({ linea1, previo2, linea2, resaltado = false, bajada }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h2 className="text-[30px] sm:text-[38px] md:text-[44px] font-light leading-[1.08] tracking-tight text-zinc-900">
          {linea1}
          <br />
          {previo2 && <span className="mr-3">{previo2}</span>}
          {resaltado ? (
            <span className="inline-block mt-1 px-2 rounded-lg bg-[var(--g-ac)] text-zinc-900 font-black italic">{linea2}</span>
          ) : (
            <span className="text-[var(--g-ac)] font-black italic">{linea2}</span>
          )}
        </h2>
        {bajada && <p className="mt-3 text-[13px] text-zinc-700">{bajada}</p>}
      </div>
      <div className="flex-shrink-0 flex flex-col items-center">
        <img src="/assets/images/logo/user-logo-reducido-sobre-claro.svg" alt="USER" className="h-12 sm:h-16 md:h-[72px] w-auto" />
        <span className="text-[9px] sm:text-[10px] font-semibold text-zinc-800 mt-0.5">Tu socio productivo</span>
      </div>
    </div>
  );
}

/** Recuadro de color debajo del título. */
export function Banner({ children }) {
  return (
    <div className="rounded-2xl bg-[var(--g-ac)] text-[var(--g-on)] px-5 sm:px-6 py-4 sm:py-5 text-[15px] sm:text-[17px] leading-snug">
      {children}
    </div>
  );
}

/* ── Tarjetas ─────────────────────────────────────────────────────────── */

/** Dos columnas independientes, como en los PDF. En celular quedan una debajo de la otra. */
export function Columnas({ izquierda, derecha }) {
  return (
    <div className="grid md:grid-cols-2 gap-5 items-start">
      <div className="flex flex-col gap-5 min-w-0">{izquierda}</div>
      <div className="flex flex-col gap-5 min-w-0">{derecha}</div>
    </div>
  );
}

export function Insignia({ children }) {
  return (
    <span className="w-6 h-6 rounded-full bg-[var(--g-ac)] text-[var(--g-in)] text-[11px] font-bold flex items-center justify-center flex-shrink-0">
      {children}
    </span>
  );
}

/** Tarjeta con borde (o de color suave) y título con número o ícono. */
export function Tarjeta({ numero, icono, titulo, nota, suave = false, children }) {
  return (
    <section className={`guia-tarjeta rounded-2xl p-5 flex flex-col gap-2.5 ${suave ? 'bg-[var(--g-sv)]' : 'border border-zinc-300'}`}>
      {titulo && (
        <h3 className="flex items-center gap-2.5 text-[16.5px] font-semibold text-zinc-900 leading-tight mb-1">
          {numero != null && <Insignia>{numero}</Insignia>}
          {icono && <Insignia>{icono}</Insignia>}
          <span>{titulo}</span>
          {nota && <span className="text-[11.5px] font-normal italic text-zinc-500">{nota}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Tarjeta de color suave con el título en una píldora (opciones, efectos especiales). */
export function TarjetaPildora({ titulo, children }) {
  return (
    <section className="guia-tarjeta rounded-2xl p-5 bg-[var(--g-sv)] flex flex-col gap-2.5">
      <span className="self-start rounded-full bg-[var(--g-ac)] text-[var(--g-on)] text-[13.5px] font-semibold px-4 py-1">{titulo}</span>
      {children}
    </section>
  );
}

/** Frase en color debajo del título de una tarjeta. */
export function Bajada({ children }) {
  return <p className="text-[var(--g-tx)] text-[15px] font-medium leading-snug">{children}</p>;
}

/** «+ Título» en color, con su texto debajo. */
export function Item({ titulo, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[var(--g-tx)] font-medium text-[14px] leading-snug">
        <span className="mr-1.5">+</span>{titulo}
      </p>
      {children && <div className="flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}

export function Texto({ children, className = '' }) {
  return <p className={`text-zinc-800 ${className}`}>{children}</p>;
}

/** Aclaración en cursiva gris (ejemplos). */
export function Aclaracion({ children }) {
  return <p className="text-[12px] italic text-zinc-500 leading-snug">{children}</p>;
}

/** Texto monoespaciado (medidas, rutas). */
export function M({ children }) {
  return <span style={MONO} className="font-medium">{children}</span>;
}

/** Resaltado sobre el texto: negro («Dado que el color oscuro invade al claro») o del color de la guía. */
export function Chip({ children, color = false }) {
  const fondo = color ? 'bg-[var(--g-ac)] text-[var(--g-on)]' : 'bg-black text-white';
  return <span className={`${fondo} font-semibold px-1.5 py-0.5 rounded leading-[1.9] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]`}>{children}</span>;
}

/** Enlace del sitio (en la web se puede tocar; en papel se lee la dirección). */
export function Enlace({ href, children }) {
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={MONO}
      className="font-medium text-zinc-900 underline decoration-[var(--g-ac)] decoration-2 underline-offset-2 hover:text-[var(--g-tx)]">
      {children}
    </a>
  );
}

/** Cifra grande con su explicación debajo («7,5 cm / del borde del archivo al centro del ojal»). */
export function Cifra({ valor, detalle, color }) {
  return (
    <div className="flex flex-col">
      <span className="text-[40px] sm:text-[48px] font-black leading-none tracking-tight" style={{ color: color || 'var(--g-tx)' }}>{valor}</span>
      {detalle && <span className="text-[12.5px] text-zinc-600 mt-1">{detalle}</span>}
    </div>
  );
}

/** Filas «concepto … valor» (ancho de hoja, largo máximo, mínimo). */
export function Medidas({ filas }) {
  return (
    <div className="flex flex-col">
      {filas.map(([concepto, valor]) => (
        <div key={concepto} className="flex items-baseline justify-between gap-4 border-b border-zinc-300 py-1.5 last:border-b-0">
          <span className="text-zinc-800">{concepto}</span>
          <span style={MONO} className="text-[var(--g-tx)] font-bold text-[15px] whitespace-nowrap">{valor}</span>
        </div>
      ))}
    </div>
  );
}

/** Lista con viñetas de color. */
export function Lista({ items, compacta = false }) {
  return (
    <ul className={`flex flex-col ${compacta ? 'gap-0.5' : 'gap-1.5'}`}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-zinc-800">
          <span className="mt-[0.55em] w-1.5 h-1.5 rounded-full bg-[var(--g-ac)] flex-shrink-0" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function ListaNumerada({ items }) {
  return (
    <ol className="flex flex-col gap-1.5 list-decimal pl-5 text-zinc-800 marker:font-semibold">
      {items.map((it, i) => <li key={i} className="pl-1">{it}</li>)}
    </ol>
  );
}

/** Nota con borde de color a la izquierda. */
export function Nota({ children }) {
  return (
    <div className="bg-[var(--g-sv)] border-l-4 border-[var(--g-ac)] rounded-r-lg px-4 py-3 text-zinc-800">
      {children}
    </div>
  );
}

/** Tabla con encabezado de color. */
export function Tabla({ columnas, filas, alinearUltimas = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-[var(--g-ac)] text-[var(--g-on)]">
            {columnas.map((c, i) => (
              <th key={c} className={`font-semibold text-[12px] px-3 py-1.5 ${i === 0 ? 'rounded-l-md' : ''} ${i === columnas.length - 1 ? 'rounded-r-md' : ''} ${alinearUltimas && i > 0 ? 'text-right' : ''}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-zinc-300">
              {f.map((celda, j) => (
                <td key={j} className={`px-3 py-1.5 text-zinc-800 ${alinearUltimas && j > 0 ? 'text-right tabular-nums' : ''}`}>{celda}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ícono de «no espejar»: letra al revés tachada. */
function NoEspejar() {
  return (
    <svg viewBox="0 0 40 40" className="w-9 h-9 flex-shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="#fff" stroke="#FF009D" strokeWidth="3" />
      <text x="20" y="28" textAnchor="middle" fontSize="23" fontWeight="900" fill="#111" transform="translate(40 0) scale(-1 1)">E</text>
      <line x1="8" y1="8" x2="32" y2="32" stroke="#FF009D" strokeWidth="3" />
    </svg>
  );
}

/** Píldora de aviso de ancho completo («No se debe espejar el diseño»). */
export function Aviso({ children, espejo = true }) {
  return (
    <div className="guia-tarjeta rounded-full bg-[var(--g-ac)] text-[var(--g-on)] pl-6 pr-2 py-2 flex items-center justify-between gap-3">
      <span className="font-semibold italic text-[14px]">{children}</span>
      {espejo && <NoEspejar />}
    </div>
  );
}

/** Código QR que en la web también es un enlace. */
export function QR({ url, tamano = 84, titulo }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" title={titulo || url}
      className="inline-flex flex-shrink-0 bg-white p-1.5 rounded-lg border border-zinc-300 hover:border-[var(--g-ac)]">
      <QRCodeSVG value={url} size={tamano} level="M" marginSize={0} />
    </a>
  );
}

/* ── Pies ─────────────────────────────────────────────────────────────── */

const telHref = (numero) => `https://wa.me/598${numero.replace(/\D/g, '').replace(/^0/, '')}`;

/** Recuadro de consultas por WhatsApp con la marca. */
export function Contacto({ texto = 'Por consultas, utilice nuestro servicio de chat por WhatsApp al número de atención.', logo, marca, whatsapp, compacto = false }) {
  return (
    <section className={`guia-tarjeta rounded-2xl border border-[var(--g-tx)] px-5 py-5 flex flex-col items-center justify-between gap-4 text-center ${compacto ? '' : 'sm:flex-row sm:text-left'}`}>
      <p className={`text-zinc-800 text-[13.5px] max-w-[300px] ${compacto ? '' : 'sm:text-center'}`}>{texto}</p>
      <div className={`flex flex-col items-center gap-4 ${compacto ? '' : 'sm:flex-row'}`}>
        {logo ? <img src={logo} alt={marca} className="h-9 w-auto" /> : <span className="text-[20px] font-black tracking-wide">{marca}</span>}
        <a href={telHref(whatsapp)} target="_blank" rel="noreferrer"
          className="rounded-full bg-[var(--g-ac)] text-[var(--g-on)] px-4 py-1.5 flex items-baseline gap-2 whitespace-nowrap hover:opacity-90">
          <span style={MONO} className="text-[9px] tracking-[0.15em]">WHATSAPP</span>
          <span style={MONO} className="text-[15px] font-bold">{whatsapp}</span>
        </a>
      </div>
    </section>
  );
}

/** Recuadro «enviar archivos por el portal» con su QR. */
export function Portal() {
  return (
    <section className="guia-tarjeta rounded-2xl bg-[var(--g-sv)] px-5 py-5 flex items-center gap-4">
      <div className="flex-1 flex flex-col gap-1.5">
        <p className="text-[var(--g-tx)] font-medium text-[15px] leading-snug">Si desea enviar archivos para impresión,</p>
        <p className="text-zinc-800">ingrese a los formularios de nuestro portal: <Enlace href="https://user.com.uy/portal">user.com.uy/portal</Enlace></p>
        <Aclaracion>Una vez que complete y envíe el formulario, comenzaremos con el proceso de producción de su pedido.</Aclaracion>
      </div>
      <QR url="https://user.com.uy/portal" tamano={76} />
    </section>
  );
}

/** Barra CMYK y pie de página: QR a los términos (o al portal) y «Página n de N». */
export function PieHoja({ etiqueta, fecha, pagina, total, portal = false }) {
  const url = portal ? 'https://user.com.uy/portal' : URL_TERMINOS;
  return (
    <footer className="mt-auto -mx-5 sm:-mx-8 md:-mx-10 -mb-8 pt-2">
      <div className="flex h-1.5">
        <span className="flex-1 bg-[#00ABFF]" /><span className="flex-1 bg-[#FF009D]" /><span className="flex-1 bg-[#FFFF00]" /><span className="flex-1 bg-black" />
      </div>
      <div className="bg-zinc-100 px-5 sm:px-8 md:px-10 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <QR url={url} tamano={44} />
          {portal ? (
            <div className="text-[11px] leading-snug">
              <p className="font-bold">Portal de pedidos: <Enlace href={url}>user.com.uy/portal</Enlace></p>
              <p className="italic text-zinc-600">Una vez que complete y envíe el formulario, comenzaremos con el proceso de producción de su pedido.</p>
            </div>
          ) : (
            <div className="text-[11px] leading-snug">
              <p className="font-bold">Leer QR para ver</p>
              <a href="/terminos" className="italic text-zinc-600 hover:text-zinc-900 underline-offset-2 hover:underline">
                “Términos y condiciones de tiempos de entrega, recargos por urgencia, cancelaciones, cambios de modalidad y bloqueo de ID”
              </a>
            </div>
          )}
        </div>
        <p style={MONO} className="text-[10.5px] text-zinc-500 whitespace-nowrap sm:text-right">
          <b className="text-zinc-900">{etiqueta}</b> / {fecha} / Página {pagina} de {total}
        </p>
      </div>
    </footer>
  );
}
