/**
 * Términos y Condiciones como documento (29/10/2026): la misma estética que las guías de /guias
 * (hoja blanca, encabezado con el asterisco, textos en mono, pie con la barra CMYK), en negro, que es
 * el color de los documentos de soporte de la marca. Lo usan /terminos y el PDF para descargar
 * (scripts/generar-terminos-pdf.mjs abre /terminos?pdf=1). El texto está en ./contenido.js.
 */
import { Guia, Hoja, Titulo, Lista, ListaNumerada, QR } from '../guias/bloques';
import { BLOQUES, IDENTIDAD, VERSION, VIGENCIA } from './contenido';

const MONO = { fontFamily: "'Roboto Mono', 'Google Sans Code', monospace" };
const URL_PAGINA = 'https://user.com.uy/terminos';
const TEMA = { acento: '#000000', texto: '#000000', suave: '#F4F4F5', sobre: '#FFFFFF' };

// «**negrita**», saltos de línea y enlaces (direcciones web y mails) dentro de un texto
const RX_ENLACE = /(https?:\/\/[^\s)]+|www\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?|[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
function conEnlaces(texto, clave) {
    return texto.split(RX_ENLACE).map((parte, i) => {
        if (i % 2 === 0) return parte;
        const limpio = parte.replace(/[.,;:]+$/, '');
        const resto = parte.slice(limpio.length);
        const href = limpio.includes('@') ? `mailto:${limpio}` : limpio.startsWith('http') ? limpio : `https://${limpio}`;
        return (
            <span key={`${clave}-${i}`}>
                <a href={href} target={limpio.includes('@') ? undefined : '_blank'} rel="noreferrer"
                    className="underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-900 break-words">{limpio}</a>{resto}
            </span>
        );
    });
}
export function Rico({ texto }) {
    return String(texto).split('\n').map((linea, l) => (
        <span key={l}>
            {l > 0 && <br />}
            {linea.split('**').map((trozo, i) => (i % 2 === 1
                ? <strong key={i} className="font-semibold text-zinc-950">{conEnlaces(trozo, `${l}-${i}`)}</strong>
                : <span key={i}>{conEnlaces(trozo, `${l}-${i}`)}</span>))}
        </span>
    ));
}

const Asterisco = () => (
    <svg viewBox="0 0 25.19 25.19" className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M12.59 12.59L9.65 25.19L15.53 25.19ZM12.59 12.59L19.42 23.58L23.57 19.42ZM12.59 12.59L25.19 15.53L25.19 9.65ZM12.59 12.59L23.57 5.77L19.42 1.61ZM12.59 12.59L15.53 0L9.65 0ZM12.59 12.59L5.77 1.61L1.61 5.77ZM12.59 12.59L0 9.65L0 15.53ZM12.59 12.59L1.61 19.42L5.77 23.58Z" />
    </svg>
);

function Encabezado() {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-zinc-300 pb-2.5 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            <span className="flex items-center gap-2 text-zinc-900 whitespace-nowrap">
                <Asterisco />
                <span><span className="hidden sm:inline">Documento legal </span><b>Términos y condiciones</b></span>
            </span>
            <span className="hidden md:block text-center truncate">USER · Tu socio productivo</span>
            <span style={MONO} className="tracking-normal normal-case">v{VERSION}</span>
        </div>
    );
}

function Identidad() {
    return (
        <section className="guia-tarjeta rounded-2xl bg-[var(--g-sv)] px-5 py-4 flex flex-col gap-3">
            <p className="text-zinc-900 font-semibold leading-snug">
                {IDENTIDAD.titulares} — nombre comercial «{IDENTIDAD.nombreComercial}»
            </p>
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                {IDENTIDAD.datos.map(([dato, valor]) => (
                    <div key={dato} className="flex items-baseline justify-between gap-3 border-b border-zinc-300/70 py-1">
                        <dt style={MONO} className="text-[10.5px] uppercase tracking-[0.12em] text-zinc-500">{dato}</dt>
                        <dd className="text-zinc-900 font-medium text-right"><Rico texto={valor} /></dd>
                    </div>
                ))}
            </dl>
            <p className="self-start rounded-full bg-black text-white text-[12px] font-semibold px-4 py-1.5">
                <span style={MONO} className="text-[#FFFF00] mr-2">[ VERSIÓN {VERSION} ]</span>
                Vigente desde el {VIGENCIA}
            </p>
        </section>
    );
}

function Indice({ grupos }) {
    return (
        <nav className="grid md:grid-cols-2 gap-x-8 gap-y-4" aria-label="Índice">
            {grupos.map(g => (
                <div key={g.titulo} className="flex flex-col">
                    <p style={MONO} className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500 mb-1.5">{g.titulo}</p>
                    {g.entradas.map(e => (
                        <a key={e.ancla} href={`#${e.ancla}`}
                            className="flex items-baseline gap-3 py-[3px] border-b border-zinc-200 text-zinc-800 hover:text-black hover:border-zinc-500">
                            <span style={MONO} className="text-[11.5px] font-semibold text-zinc-500 w-[5.8em] flex-shrink-0 whitespace-nowrap">{e.numero.replace(/\*/g, '')}</span>
                            <span><Rico texto={e.titulo} /></span>
                        </a>
                    ))}
                </div>
            ))}
        </nav>
    );
}

// Los anexos van en mayúsculas en el documento: el título sale como en el índice («Venta de insumos»)
const TITULOS_INDICE = Object.fromEntries(BLOQUES.filter(b => b.tipo === 'indice')
    .flatMap(b => b.grupos.flatMap(g => g.entradas.map(e => [e.ancla, e.titulo]))));

// «1. Qué regula…» → insignia con el número; «ANEXO I — …» → etiqueta en mono
function TituloSeccion({ id, texto }) {
    const punto = texto.match(/^(\d+)\.\s+(.*)$/);
    const anexo = texto.match(/^(ANEXO [IVX]+)\s+—\s+(.*)$/);
    if (anexo && TITULOS_INDICE[id]) anexo[2] = TITULOS_INDICE[id];
    return (
        <h3 id={id} className="terminos-seccion scroll-mt-28 flex items-center gap-3 pt-3 border-t border-zinc-300 text-[18px] font-semibold text-zinc-950 leading-tight">
            {punto && (
                <span className="w-7 h-7 rounded-full bg-black text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0">{punto[1]}</span>
            )}
            {anexo && (
                <span style={MONO} className="rounded-md bg-black text-white text-[11px] font-semibold tracking-[0.08em] px-2 py-1 flex-shrink-0">{anexo[1]}</span>
            )}
            <span>{punto ? punto[2] : anexo ? anexo[2] : texto}</span>
        </h3>
    );
}

function Tabla({ filas }) {
    const [cabecera, ...cuerpo] = filas;
    return (
        <div className="guia-tarjeta overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-black text-white">
                        {cabecera.map((c, i) => (
                            <th key={i} className={`font-semibold text-[12px] px-3 py-1.5 ${i === 0 ? 'rounded-l-md' : ''} ${i === cabecera.length - 1 ? 'rounded-r-md' : ''}`}><Rico texto={c} /></th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {cuerpo.map((f, i) => (
                        <tr key={i} className="border-b border-zinc-300 align-top">
                            {f.map((celda, j) => <td key={j} className="px-3 py-1.5 text-zinc-800"><Rico texto={celda} /></td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Bloque({ b }) {
    switch (b.tipo) {
        case 'h1':
            return (
                <h2 id={b.id} className="terminos-parte scroll-mt-28 mt-4 rounded-2xl bg-black text-white px-5 py-4 text-[20px] sm:text-[24px] font-light tracking-tight">
                    {b.texto.replace(/^PARTE (\d+) — /, (m, n) => `Parte ${n} — `).replace(/(— )(.*)$/, (m, g, r) => g + r.charAt(0) + r.slice(1).toLowerCase())}
                </h2>
            );
        case 'h2': return <TituloSeccion id={b.id} texto={b.texto} />;
        case 'h3': return <h4 className="text-[15px] font-semibold text-zinc-900 mt-1">{b.texto}</h4>;
        case 'p': return <p className="text-zinc-800"><Rico texto={b.texto} /></p>;
        case 'lista': return <Lista items={b.items.map((t, i) => <Rico key={i} texto={t} />)} />;
        case 'numerada': return <ListaNumerada items={b.items.map((t, i) => <Rico key={i} texto={t} />)} />;
        case 'destacado':
            return (
                <div className="guia-tarjeta bg-[var(--g-sv)] border-l-4 border-black rounded-r-lg px-4 py-3 text-zinc-900 text-[14.5px]">
                    <Rico texto={b.texto} />
                </div>
            );
        case 'tabla': return <Tabla filas={b.filas} />;
        case 'indice': return <div className="terminos-indice flex flex-col gap-5"><TituloSeccion id="indice" texto="Índice" /><Indice grupos={b.grupos} /></div>;
        default: return null;
    }
}

// Para el PDF: cada punto va en su <section> y, adentro, cada subpunto («**4.3. …**», «II.A. …») en su grupo,
// así el generador puede pedir que no se corten entre hojas (scripts/generar-terminos-pdf.mjs). El título de
// una parte va con su primer punto y un título nunca queda solo en un grupo.
const RX_SUBPUNTO = /^\*\*[0-9IVX]+(\.[A-Z0-9]+)*\.[\s*]/;
const esTitulo = b => b.tipo === 'h1' || b.tipo === 'h2' || b.tipo === 'h3';
function agrupar(bloques) {
    const puntos = [];
    for (const b of bloques) {
        const punto = puntos[puntos.length - 1];
        const grupo = punto?.grupos[punto.grupos.length - 1];
        const trasParte = punto?.grupos.length === 1 && grupo.every(x => x.tipo === 'h1');
        if (!punto || b.tipo === 'h1' || b.tipo === 'indice' || (b.tipo === 'h2' && !trasParte)) {
            puntos.push({ parte: b.tipo === 'h1', grupos: [[b]] });
        } else if ((b.tipo === 'h3' || (b.tipo === 'p' && RX_SUBPUNTO.test(b.texto))) && !grupo.every(esTitulo)) {
            punto.grupos.push([b]);
        } else {
            grupo.push(b);
        }
    }
    return puntos;
}
const PUNTOS = agrupar(BLOQUES);

function Pie() {
    return (
        <footer className="terminos-pie mt-auto -mx-5 sm:-mx-8 md:-mx-10 -mb-8 pt-2">
            <div className="flex h-1.5">
                <span className="flex-1 bg-[#00ABFF]" /><span className="flex-1 bg-[#FF009D]" /><span className="flex-1 bg-[#FFFF00]" /><span className="flex-1 bg-black" />
            </div>
            <div className="bg-zinc-100 px-5 sm:px-8 md:px-10 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <QR url={URL_PAGINA} tamano={44} />
                    <div className="text-[11px] leading-snug">
                        <p className="font-bold">Leer QR para ver la versión vigente</p>
                        <p className="italic text-zinc-600">user.com.uy/terminos</p>
                    </div>
                </div>
                <p style={MONO} className="text-[10.5px] text-zinc-500 sm:text-right">
                    <b className="text-zinc-900">TÉRMINOS Y CONDICIONES</b> / Versión {VERSION} / Vigente desde el {VIGENCIA}
                </p>
            </div>
        </footer>
    );
}

export default function DocumentoTerminos() {
    return (
        <Guia tema={TEMA}>
            <Hoja>
                <Encabezado />
                <Titulo linea1="Términos y" linea2="Condiciones" />
                <Identidad />
                {PUNTOS.map((punto, i) => (
                    <section key={i} className={`terminos-punto flex flex-col gap-5 ${punto.parte ? 'terminos-nueva-pagina' : ''}`}>
                        {punto.grupos.map((grupo, j) => (
                            <div key={j} className="terminos-grupo flex flex-col gap-5">
                                {grupo.map((b, k) => <Bloque key={k} b={b} />)}
                            </div>
                        ))}
                    </section>
                ))}
                <Pie />
            </Hoja>
        </Guia>
    );
}
