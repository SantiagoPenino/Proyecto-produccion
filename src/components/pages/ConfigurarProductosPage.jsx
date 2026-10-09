import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import StockArtEditModal from '../modals/config/StockArtEditModal';
import TerminacionesEcouvModal from '../modals/config/TerminacionesEcouvModal';
import NuevoProductoTerminadoModal from '../modals/config/NuevoProductoTerminadoModal';
import Selector from '../ui/Selector';
import { PasosCosturaEditor, TablaPasosCostura } from './ConfiguradorPasosCostura';   // [PASO A PASO]
import { GrillaAvioTalles, TablaAviosTalle, resumenPorTalle, esMedida } from './ConfiguradorAviosTalle';   // [AVÍOS POR TALLE]
import { PaintBucket, Flag, Image as IconoImagen, Scissors, Shirt, Spool, Sticker, Palette, Factory, Check, ChevronDown, Pencil, Save, Star, Store, Handshake, Shuffle, TriangleAlert, X, RefreshCw, FolderOpen, CircleCheck, Lock, Upload, Printer, RotateCcw, Package, Boxes, SlidersHorizontal, Tag, ChevronRight, Box, Info, Copy } from 'lucide-react';

/*
 * CONFIGURAR PRODUCTOS — /configurar-productos (F3 del configurador)
 * ──────────────────────────────────────────────────────────────────
 * Hub con dos familias:
 *  - Prendas y Combos: lista + editor por pasos (origen / técnicas /
 *    precio y cantidades / componentes y apliques / publicar) contra
 *    /api/configurador (camino aislado, F2).
 *  - EcoUV: la Configuración ECOUV existente, embebida con sus mismos
 *    modales (StockArt grupo 1.3, Terminaciones, Nuevo PT).
 * Decisiones 11-ago: surtido específico o todas; cobro por técnica en
 * combos; stock se descuenta al retirar (acá no se toca); "producto del
 * local" automático con bypass ValidarStock; menú cuelga de Configuración;
 * componentes constructivos con precio previsto.
 */

const API = '/configurador';
const GRUPO_ECOUV = '1.3';

// Construcción (SB/TWC/TWT): lo que arma la prenda — casi siempre obligatorio.
// Decoración (EMB/TPU/DF): personalización que el cliente elige agregar o no.
// Ícono (02/10): Lucide, todos en brand-cyan y sin fondo (antes Font Awesome sobre un cuadrado con degradé
// de un color por área).
const AREAS_CONSTRUCCION = [
    { id: 'SB', label: 'Sublimación', desc: 'Estampado full print de la tela · área SB', Icono: PaintBucket },
    // F1 (29-sep): otras producciones principales. Solo se muestra la que el producto tiene en "Producción principal".
    { id: 'DIRECTA', label: 'Impresión directa', desc: 'Impresión directa sobre tela de bandera / blackout · área DIRECTA', Icono: Flag },
    { id: 'ECOUV', label: 'Gran formato', desc: 'Lona, canvas, vinilo · área ECOUV', Icono: IconoImagen },
    { id: 'TWC', label: 'Corte', desc: 'Corte láser y tizada · área TWC', Icono: Scissors },
    { id: 'TWT', label: 'Costura', desc: 'Confección de la prenda · área TWT', Icono: Shirt },
];
const AREAS_DECORACION = [
    { id: 'EMB', label: 'Bordado', desc: 'Hilado sobre la prenda · área EMB', Icono: Spool },
    { id: 'TPU', label: 'Estampado TPU', desc: 'Aplique termoadhesivo en relieve · área TPU', Icono: Sticker },
    { id: 'DF', label: 'Estampado DTF', desc: 'Transfer film full color · área DTF', Icono: Palette },
];
const AREAS = [...AREAS_CONSTRUCCION, ...AREAS_DECORACION];
// Ícono de un área, sin fondo. Un área sin ícono propio (otra producción principal) va con una fábrica.
const IconoArea = ({ area, size = 18 }) => {
    const Icono = area?.Icono || Factory;
    return <Icono size={size} className="shrink-0 text-brand-cyan" aria-hidden="true" />;
};
// Nombre corto de cada servicio para chips/resúmenes. OJO: antes había un ternario
// EMB/TPU/else→'DTF' que etiquetaba "DTF" a Sublimación, Corte y Costura — en el armado
// del combo se veían 4 chips "DTF" que en realidad eran áreas distintas.
const servicioCorto = (areaId) => ({
    SB: 'Sublimación', TWC: 'Corte', TWT: 'Costura', DIRECTA: 'Imp. directa', ECOUV: 'Gran formato',
    EMB: 'Bordado', TPU: 'TPU', DF: 'DTF',
}[areaId] || areaId);
// Producción principal: las áreas de impresión que pueden ser la principal (no Corte/Costura)
const AREAS_PRINCIPAL = ['SB', 'DIRECTA', 'ECOUV'];
// Pestañas de la página (02/10): una sola fila. A la izquierda lo que se vende; a la derecha, separados,
// los catálogos que usan los productos.
const PESTANAS_PRODUCTOS = [['confeccionados', 'Confeccionados'], ['combos', 'Combos y Promos'], ['ecouv', 'EcoUV']];
const PESTANAS_CATALOGOS = [['tecnicas', 'Técnicas'], ['avios', 'Avíos'], ['costuras', 'Costuras']];
// Filtro de la lista por estado (02/10). Son los contadores de arriba: cada uno con su color apagado,
// prendido y el de la cuenta.
const FILTROS_ESTADO = [
    { id: '',          label: 'Todos',          off: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',             on: 'bg-slate-800 text-white border-slate-800',     cuenta: 'bg-slate-100 text-slate-500' },
    { id: 'PUBLICADO', label: 'Publicados',     off: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', on: 'bg-emerald-600 text-white border-emerald-600', cuenta: 'bg-emerald-100 text-emerald-700' },
    { id: 'BORRADOR',  label: 'Borradores',     off: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',       on: 'bg-slate-600 text-white border-slate-600',     cuenta: 'bg-white text-slate-500' },
    { id: 'SIN',       label: 'Sin configurar', off: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',         on: 'bg-amber-500 text-white border-amber-500',     cuenta: 'bg-amber-100 text-amber-700' },
];
// Política de cantidad del producto (paso Precio y cantidades): [valor, título, detalle]
const POLITICAS = [
    ['LIBRE', 'Libre', 'El cliente pide la cantidad que quiera.'],
    ['MINIMA', 'Cantidad mínima', 'El cliente pide desde un mínimo por pedido.'],
    ['PAQUETE', 'Paquete fijo', 'Paquete cerrado: no se puede pedir más ni menos, y el precio es el del paquete.'],
];
const MOLDE_OPCIONES = [
    ['OBLIGATORIO', 'Obligatorio', 'Prendas: no se publica sin molde de TizadaPro; en la solicitud se eligen modelo y tela por pieza.'],
    ['OPCIONAL', 'Opcional', 'Windflags, fundas, banderas con forma: si hay molde se usa; si no, el cliente manda el archivo pronto a la medida fija.'],
    ['NO', 'No lleva', 'Cuadros, roll ups, productos de stock: archivo a la medida fija, sin piezas ni planilla de talles.'],
];
const AREA_APLIQUE_EXTRA = { id: 'ETIQUETA', label: 'Etiqueta (grifa)' };
const areaMeta = (id) => AREAS.find(a => a.id === id) || AREA_APLIQUE_EXTRA;

// De dónde sale la prenda. Desde el 02/10 se elige en el encabezado del editor (antes era el paso 1).
const ORIGENES = [
    { id: 'LOCAL', t: 'Producto del local', d: 'Sale del stock del local, con talle/color y stock en vivo.', Icono: Store },
    { id: 'CLIENTE', t: 'Prenda del cliente', d: 'El cliente la trae; se recibe por remito PRE.', Icono: Handshake },
    { id: 'CONFECCIONADO', t: 'Confeccionado por USER', d: 'Se corta y confecciona: habilita componentes y apliques.', Icono: Scissors },
    { id: 'AMBOS', t: 'Local o del cliente', d: 'El cliente elige el origen al pedir.', Icono: Shuffle },
];

const MODOS = [
    { id: 'LIBRE', label: 'Libre elección', hint: 'todas las opciones activas del catálogo' },
    { id: 'RESTRINGIDO', label: 'Solo las marcadas', hint: 'el cliente elige entre las tildadas' },
    { id: 'FIJA', label: 'Fija', hint: 'se aplica siempre la marcada, sin elección' },
];

// Precio con el símbolo de su moneda (02/10): "$" para pesos (UYU) y "US$" para dólares (USD); otra moneda,
// con su código. Antes iba siempre "$" y el código atrás ("$ 15 USD").
const simboloMoneda = (m) => { const c = String(m || '').trim().toUpperCase(); return !c || c === 'UYU' ? '$' : c === 'USD' ? 'US$' : c; };
const fmtPrecio = (p, m) => (p == null ? '—' : `${simboloMoneda(m)} ${Number(p).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`);

// Familia = variante real de StockArt (Grupo '2.1'), igual que EcoUV con sus
// materiales — Categoria ya viene de ahí (join con StockArt.Articulo en el
// backend). Se administra con los mismos endpoints del Editor StockArt:
// GET /stockart?grupo=2.1 (listar), POST /stockart (crear variante nueva),
// PUT /stockart/articulos/:cod/mover (mover un producto a otra variante).
const GRUPO_PRENDAS = '2.1';
const CODSTOCK_COMBOS = '2.2.1.4'; // variante fija de combos, no aparece como opción de familia
const familiaDeProducto = (p) => {
    if (p.EsCombo || p.CantidadFija || p.ComboItems > 0) return 'Combos y promos';
    return p.Categoria || 'Sin clasificar';
};

// ── UI mínimos ───────────────────────────────────────────────────────────
// Botón del desplegable propio (ui/Selector) con el aspecto de los campos de esta página (02/10): reemplazó
// a los desplegables nativos del navegador. Recibe las clases que tenía cada uno (borde, tamaño, ancho, rojo si falta elegir).
const claseSel = (clases) => `flex items-center gap-1.5 bg-white text-left text-slate-700 outline-none transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 ${clases}`;
// Mayúscula inicial en cada palabra, para nombres que vienen de la base en mayúsculas ("IMPRESION DIRECTA" →
// "Impresion Directa"). El CSS capitalize no baja el resto de las letras.
const capitalizar = (v) => String(v || '').toLowerCase().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

const Toggle = ({ on, onChange, disabled }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
        className={`w-10 h-[22px] rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-slate-300'} ${disabled ? 'opacity-50' : ''}`}>
        <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'right-[3px]' : 'left-[3px]'}`}></span>
    </button>
);

// Miniatura de producto: foto del catálogo si hay; si no, placeholder con ícono.
// Si la imagen no carga se oculta por estado (nunca tocando el DOM a mano: sacar el nodo con
// e.currentTarget.remove() hacía que React fallara al desmontar — "removeChild… not a child").
// El ícono (02/10) es de Lucide, en gris sobre fondo liso; antes Font Awesome sobre un degradé. Se sigue
// pidiendo con el nombre de Font Awesome que ya usaban las llamadas.
const ICONOS_THUMB = { 'fa-shirt': Shirt, 'fa-box': Package, 'fa-boxes-stacked': Boxes };
const Thumb = ({ src, size = 40, icon = 'fa-shirt', rounded = 'rounded-lg' }) => {
    const [fallo, setFallo] = useState(null);   // src que no cargó
    const mostrar = !!src && fallo !== src;
    const Icono = ICONOS_THUMB[icon] || Shirt;
    return (
        <div className={`${rounded} bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0 relative`}
            style={{ width: size, height: size }}>
            <Icono size={Math.round(size * 0.42)} className="text-slate-400" aria-hidden="true" />
            {mostrar && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setFallo(src)} />}
        </div>
    );
};

// Rectángulo a escala para los tamaños de parche/estampa (4×4 vs 10×8 se VE)
const SizeBox = ({ w, h }) => {
    const k = Math.min(3.6, 48 / w, 30 / h);
    const pw = Math.max(14, Math.round(w * k));
    const ph = Math.max(11, Math.round(h * k));
    const fmt = (n) => (Number(n) % 1 ? String(n).replace('.', ',') : String(Math.round(n)));
    return (
        <span className="inline-flex items-end justify-center" style={{ width: 52, height: 32 }}>
            <span className="border-2 border-dashed border-sky-400 bg-sky-50 rounded-[3px] flex items-center justify-center text-[8px] font-black text-sky-700"
                style={{ width: pw, height: ph }}>
                {fmt(w)}×{fmt(h)}
            </span>
        </span>
    );
};

// ── Resumen del molde de TizadaPro (solo lectura) ─────────────────────────
// Talles agrupados por curva y en orden real (no alfabético): bebé (meses), niño, adulto, femenino.
const ORDEN_ADULTO = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL'];
const agruparTalles = (talles) => {
    const g = { bebe: [], nino: [], adulto: [], fem: [], otros: [] };
    (talles || []).forEach(t => {
        const x = String(t).trim();
        if (/^\d+(-\d+)?M$/i.test(x)) g.bebe.push(x);
        else if (/^\d+$/.test(x)) g.nino.push(x);
        else if (/fem$/i.test(x)) g.fem.push(x);
        else if (ORDEN_ADULTO.includes(x.toUpperCase())) g.adulto.push(x);
        else g.otros.push(x);
    });
    const num = (x) => parseInt(x, 10) || 0;
    g.bebe.sort((a, b) => num(a) - num(b));
    g.nino.sort((a, b) => num(a) - num(b));
    const rank = (x) => ORDEN_ADULTO.indexOf(x.toUpperCase().replace(/FEM$/, ''));
    g.adulto.sort((a, b) => rank(a) - rank(b));
    g.fem.sort((a, b) => rank(a) - rank(b));
    return [['Bebé', g.bebe], ['Niño', g.nino], ['Adulto', g.adulto], ['Femenino', g.fem], ['Otros', g.otros]].filter(([, l]) => l.length);
};
// Silueta a escala de una pieza (rectángulo que ocupa en el talle guía). TizadaPro no expone el
// contorno real en su base: para ver la forma hay que abrir el molde en TizadaPro.
const SiluetaPieza = ({ ancho, alto, svgPath }) => {
    if (svgPath) {
        return (
            <svg viewBox="0 0 100 100" className="w-10 h-10" title={`${ancho} × ${alto} cm`}>
                <path d={svgPath} fill="#e0e7ff" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
        );
    }
    if (!ancho || !alto) return <div className="w-10 h-10 rounded border border-dashed border-slate-200" title="Sin medidas en TizadaPro" />;
    const k = Math.min(40 / ancho, 40 / alto);
    const w = Math.max(6, Math.round(ancho * k)), h = Math.max(6, Math.round(alto * k));
    // Rectángulo punteado = el espacio que ocupa la pieza (ancho × alto reales), NO su contorno
    return (
        <div className="w-10 h-10 flex items-center justify-center" title={`Ocupa ${ancho} × ${alto} cm. Es el espacio de la pieza, no su forma: el contorno está solo en el PDF del molde, en TizadaPro.`}>
            <div className="border border-dashed border-slate-400 bg-slate-100/60 rounded-[2px]" style={{ width: w, height: h }} />
        </div>
    );
};
const MoldeResumen = ({ molde, modeloVista = '', setModeloVista, vendidos, onLeerCarpeta, leyendoCarpeta }) => {
    const modelo = (molde.modelos || []).find(m => m.clave === modeloVista) || null;
    const detalle = molde.piezasDetalle || [];
    // Piezas en vista: las del modelo elegido (por id_en_molde) o todas las del molde
    const enVista = modelo && modelo.piezasIds?.length ? detalle.filter(d => modelo.piezasIds.includes(d.idEnMolde)) : detalle;
    const piezas = enVista.map(d => d.nombre);
    const conSilueta = enVista.filter(d => d.svgPath).length;
    const telaDe = (pz) => ((molde.telasPorPieza || {})[pz] || []).map(x => x.nombre).join(', ');
    const telaDePieza = (d) => telaDe(d.nombre) || telaDe(d.generico);
    const fijas = enVista.filter(telaDePieza).length;
    const grupos = agruparTalles(molde.talles);
    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Piezas {modelo ? 'del modelo' : 'del molde'}</span>
                    <span className="text-[11px] text-slate-400">{modelo ? `${piezas.length} de ${detalle.length} piezas del molde` : `${piezas.length} piezas`} · {fijas} con tela fija</span>
                </div>
                {(molde.modelos || []).length > 0 && setModeloVista && (
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-[11px]">
                        <span className="font-bold text-slate-500">Ver las piezas de</span>
                        <Selector value={modeloVista} onChange={e => setModeloVista(e.target.value)} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold bg-white min-w-[190px]')} anchoLista={260}>
                            <option value="">Todo el molde ({detalle.length} piezas)</option>
                            {(molde.modelos || []).map(m => <option key={m.clave} value={m.clave}>{m.nombre}{vendidos?.has(m.clave) ? (vendidos.get(m.clave)?.esDefault ? ' · primero' : ' · se vende') : ''}</option>)}
                        </Selector>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 text-[11px]">
                    {onLeerCarpeta && conSilueta === 0 && (
                        <button type="button" onClick={onLeerCarpeta} disabled={leyendoCarpeta} className="ml-auto order-last rounded-lg border border-slate-300 px-2.5 py-1 font-bold text-slate-600 hover:border-slate-400 disabled:opacity-50"
                            title="Busca en la carpeta de PDFs de moldes del servidor y arma las siluetas de los moldes que aún no las tienen">
                            <FolderOpen size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />{leyendoCarpeta ? 'Leyendo la carpeta…' : 'Leer PDFs de la carpeta de moldes'}
                        </button>
                    )}
                    {conSilueta > 0
                        ? <span className="text-emerald-700 font-bold"><CircleCheck size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />Siluetas reales: {conSilueta} de {piezas.length} piezas</span>
                        : <span className="text-slate-500">Los cuadros muestran el espacio que ocupa cada pieza, no su forma.</span>}
                </div>
                <table className="w-full text-xs">
                    <tbody>
                        {enVista.map((det, i) => {
                            const pz = det.nombre;
                            const tela = telaDePieza(det);
                            return (
                                <tr key={det.idEnMolde ?? pz} className={i % 2 ? 'bg-slate-50/50' : ''}>
                                    <td className="pl-3 py-1 w-14"><SiluetaPieza ancho={det?.anchoCm} alto={det?.altoCm} svgPath={det?.svgPath} /></td>
                                    <td className="px-2 py-1.5 whitespace-nowrap">
                                        <div className="font-bold text-slate-700">{det.generico && det.generico !== pz ? <>{det.generico} <span className="font-normal text-slate-400">· {pz}</span></> : pz}</div>
                                        {det.anchoCm && det.altoCm && <div className="text-[10px] text-slate-400">{det.anchoCm} × {det.altoCm} cm · talle {molde.talleGuia}</div>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                        {tela
                                            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 font-bold whitespace-nowrap" title="Tela fija del molde en TizadaPro"><Lock size={10} aria-hidden="true" />{tela}</span>
                                            : <span className="text-slate-400">tela del pedido</span>}
                                    </td>
                                </tr>
                            );
                        })}
                        {enVista.length === 0 && <tr><td className="px-3 py-3 text-slate-400" colSpan={3}>{modelo ? 'Este modelo no tiene piezas asignadas en TizadaPro.' : 'El molde no tiene piezas cargadas en TizadaPro.'}</td></tr>}
                    </tbody>
                </table>
                {fijas > 0 && <div className="px-3 py-2 border-t border-slate-100 text-[10.5px] text-slate-400">Las piezas con candado van siempre en esa tela, la elija el cliente o no. Se cambia en TizadaPro.</div>}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Talles</span>
                    <span className="text-[11px] text-slate-400">{(molde.talles || []).length} en total</span>
                </div>
                <div className="p-3 space-y-2.5">
                    {grupos.map(([nombre, lista]) => (
                        <div key={nombre} className="flex items-start gap-2">
                            <span className="w-16 shrink-0 text-[10px] font-black uppercase tracking-wider text-slate-400 pt-1">{nombre}</span>
                            <div className="flex flex-wrap gap-1">
                                {lista.map(t => <span key={t} className="rounded-md bg-slate-100 text-slate-700 px-1.5 py-0.5 font-mono text-[10.5px]">{t.replace(/fem$/i, '')}</span>)}
                            </div>
                        </div>
                    ))}
                    {grupos.length === 0 && <div className="text-xs text-slate-400">El molde no tiene talles cargados en TizadaPro.</div>}
                </div>
            </div>
        </div>
    );
};

// Grupo de opciones excluyentes con check (una sola elegida), para las tarjetas de técnicas
const GrupoCheck = ({ titulo, children, className = '' }) => (
    <div className={`rounded-lg border border-slate-200 bg-white px-3 py-2 ${className}`}>
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">{titulo}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{children}</div>
    </div>
);
// Un solo check que cambia de texto según esté marcado o no (obligatoria/opcional, incluida/aparte)
const CheckUnico = ({ on, onChange, si, no }) => (
    <button type="button" onClick={() => onChange(!on)} className="flex items-start gap-2 text-left w-full py-0.5">
        <i className={`mt-0.5 text-base ${on ? 'fa-solid fa-square-check text-emerald-600' : 'fa-regular fa-square text-slate-300'}`}></i>
        <span className="text-xs">
            <span className="font-bold text-slate-800">{on ? si[0] : no[0]}</span>
            <span className="block text-[10.5px] text-slate-400 leading-tight">{on ? si[1] : no[1]}</span>
        </span>
    </button>
);
const OpcionCheck = ({ on, onClick, children, hint }) => (
    <button type="button" onClick={onClick} className={`flex items-start gap-1.5 text-left text-xs py-0.5 ${on ? 'text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
        <i className={`mt-0.5 ${on ? 'fa-solid fa-circle-check text-emerald-600' : 'fa-regular fa-circle text-slate-300'}`}></i>
        <span><span className={on ? 'font-bold' : 'font-medium'}>{children}</span>{hint && <span className="block text-[10.5px] text-slate-400 font-normal leading-tight">{hint}</span>}</span>
    </button>
);

// Tarjeta de herramienta de EcoUV. Ícono (05/10): Lucide en brand-cyan y sin fondo; antes Font Awesome sobre un
// cuadrado con un degradé distinto por tarjeta (violeta, naranja, morado). El resaltado al pasar el mouse
// también pasa a brand-cyan.
const ToolCard = ({ Icono, title, subtitle, onClick, footer }) => (
    <button onClick={onClick}
        className="group bg-white rounded-2xl border border-slate-200 hover:border-brand-cyan/50 hover:shadow-xl hover:shadow-brand-cyan/10 transition-all p-6 text-left flex flex-col gap-3 relative overflow-hidden">
        <Icono size={28} className="text-brand-cyan" aria-hidden="true" />
        <div>
            <h3 className="font-black text-slate-800 group-hover:text-brand-cyan transition-colors">{title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-snug">{subtitle}</p>
        </div>
        {footer && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-auto">{footer}</span>}
        <ChevronRight size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300 group-hover:text-brand-cyan group-hover:translate-x-1 transition-all" aria-hidden="true" />
    </button>
);

// ── Posición del aplique: pieza del nomenclador + detalle libre ──────────
// En la base sigue siendo UNA sola columna de texto (ProductoApliques.Posicion),
// escrita como "Frente" o "Frente — pecho izquierdo". Acá se parte en dos para
// poder elegir la pieza de una lista y escribir el detalle aparte. Lo que ya
// estaba cargado a mano se sigue leyendo tal cual (queda como pieza suelta).
const SEP_POSICION = ' — ';
const partirPosicion = (txt) => {
    const s = String(txt || '').trim();
    const i = s.indexOf('—');
    return i < 0
        ? { pieza: s, detalle: '' }
        : { pieza: s.slice(0, i).trim(), detalle: s.slice(i + 1).trim() };
};
const unirPosicion = (pieza, detalle) =>
    [String(pieza || '').trim(), String(detalle || '').trim()].filter(Boolean).join(SEP_POSICION);

// ── Ficha → estado del editor ────────────────────────────────────────────
const fichaToForm = (d) => ({
    proId: d.ProIdProducto,
    codArticulo: d.CodArticulo,
    codStock: d.CodStock,
    descripcion: d.Descripcion,
    categoria: d.Categoria,
    imagen: d.Imagen || null,
    precio: d.Precio ?? '',
    moneda: (d.Moneda || 'UYU').trim() || 'UYU',
    // Confeccionado, no Local: este catálogo se fabrica a pedido salvo que se
    // diga lo contrario (12-ago, "todos los productos son confeccionados en
    // USER y no admiten otro origen"). "Local" queda para lo que de verdad
    // sale del stock del local.
    origenTipo: d.config?.OrigenTipo || 'CONFECCIONADO',
    origenProIdProducto: d.config?.OrigenProIdProducto || null,
    origenNombre: d.origen?.Descripcion || null,
    tizadaProMoldeRef: d.config?.TizadaProMoldeRef || '',
    // F1: producción principal, molde, medida fija, unidad y canales
    tecnicaPrincipal: d.config?.TecnicaPrincipal || 'SB',
    molde: d.config?.Molde || 'OBLIGATORIO',
    um: d.config?.UM || 'u',
    anchoM: d.config?.AnchoM ?? '',
    altoM: d.config?.AltoM ?? '',
    bordeCm: d.config?.BordeCm ?? '',
    visiblePortal: !!d.config?.VisiblePortal,
    visibleTienda: !!d.config?.VisibleTienda,
    visibleInterno: d.config ? d.config.VisibleInterno !== false : true,
    validarStock: d.config ? !!d.config.ValidarStock : true,
    estado: d.config?.Estado || 'BORRADOR',
    esCombo: !!d.config?.EsCombo,
    politica: (d.config?.EsCombo || d.config?.CantidadFija) ? 'PAQUETE' : (d.config?.CantidadMinima ? 'MINIMA' : 'LIBRE'),
    cantidadMinima: d.config?.CantidadMinima || '',
    cantidadFija: d.config?.CantidadFija || '',
    tecnicas: Object.fromEntries(AREAS.map(a => {
        const t = (d.tecnicas || []).find(x => x.AreaID === a.id);
        return [a.id, t
            ? { on: true, obligatorio: !!t.Obligatorio, modo: t.Modo || 'LIBRE', cobro: t.Cobro || 'APARTE' }
            // Toda técnica nace obligatoria e incluida en el precio del producto (28-sep).
            : { on: false, obligatorio: true, modo: 'LIBRE', cobro: 'INCLUIDA' }];
    })),
    opcionesPermitidas: new Set((d.opcionesPermitidas || []).map(o => o.TecnicaOpcionID)),
    surtido: new Set((d.surtido || []).map(s => s.WmsVarianteId)),
    // Molde de TizadaPro: qué modelos y qué telas (con precio propio) se venden
    modelos: new Map((d.modelos || []).map(m => [m.ModeloClave, { nombre: m.ModeloNombre || '', esDefault: !!m.EsDefault }])),
    telas: new Map((d.telas || []).map(t => [t.TelaProIdProducto, { codArticulo: t.CodArticulo || '', material: t.Material || '', esDefault: !!t.EsDefault }])),
    apliques: (d.apliques || []).map(a => ({
        ...partirPosicion(a.Posicion), areaId: a.AreaID, tecnicaOpcionId: a.TecnicaOpcionID || '',
        cantidad: a.Cantidad || 1, incluido: !!a.Incluido
    })),
    comboItems: (d.comboItems || []).map(it => ({
        itemProIdProducto: it.ItemProIdProducto, itemNombre: it.ItemDescripcion || '',
        wmsVarianteId: it.WmsVarianteId || '', varianteNombre: it.VarianteNombre || '',
        cantidad: it.Cantidad || 1,
        servicios: (it.servicios || []).map(s => ({
            areaId: s.AreaID, tecnicaOpcionId: s.TecnicaOpcionID || '', incluido: !!s.Incluido
        }))
    })),
    // [ACCESORIOS] artículos de stock que salen con el producto
    accesorios: (d.accesorios || []).map(a => ({
        itemProIdProducto: a.ItemProIdProducto, itemNombre: a.ItemDescripcion || '',
        wmsVarianteId: a.WmsVarianteId || '', varianteNombre: a.VarianteNombre || '',
        cantidad: a.Cantidad || 1, obligatorio: !(a.Obligatorio === false || a.Obligatorio === 0), cobro: a.Cobro || 'INCLUIDO',
        wmsDepositoId: a.WmsDepositoId || '',   // '' = depósito de ventas
    })),
    fichaDiseno: {
        ref: d.fichaDiseno?.Ref || '',
        marca: d.fichaDiseno?.Marca || 'USER',
        material: d.fichaDiseno?.Material || '',
        tallas: d.fichaDiseno?.Tallas || '',
        marcacion: d.fichaDiseno?.Marcacion || '',
        colores: d.fichaDiseno?.Colores || '',
        proveedor: d.fichaDiseno?.Proveedor || '',
        dibujoUrl: d.fichaDiseno?.DibujoUrl || null,
    },
    fichaDisenoAnotaciones: (d.fichaDisenoAnotaciones || []).map(a => ({ x: Number(a.PosX), y: Number(a.PosY), texto: a.Texto })),
    fichaDisenoExtra: (d.fichaDisenoExtra || []).map(c => ({ label: c.Etiqueta, valor: c.Valor || '' })),
    // [PASO A PASO] cada costura es un paso de la secuencia de confección
    fichaDisenoCosturas: (d.fichaDisenoCosturas || []).map(c => ({
        union: c.UnionNombre || '', iso: c.CodigoISO || '', etapa: c.Etapa || '', descripcion: c.Descripcion || '',
        maquinaId: c.MaquinaCosturaID ? String(c.MaquinaCosturaID) : '', tiempoMin: c.TiempoMin != null ? String(Number(c.TiempoMin)) : '',
        observaciones: c.Observaciones || '', imagenUrl: c.ImagenUrl || '',
        avioId: c.AvioID ? String(c.AvioID) : '',   // [AVÍOS POR TALLE] avío que usa el paso
    })),
    avios: (d.avios || []).map(a => {
        // [AVÍOS POR TALLE] valor de cada talle, en el orden del molde
        const talles = (a.talles || []).map(t => ({ talle: t.Talle, valor: t.Valor != null ? String(Number(t.Valor)) : '', avioId: t.AvioID ? String(t.AvioID) : '' }));
        return {
            avioId: a.AvioID || '', nombre: a.Nombre || '', cantidad: a.Cantidad ?? 1, unidad: a.Unidad || 'u', medida: a.Medida || '', nota: a.Nota || '',
            porTalle: !!a.VariaPorTalle, talles,
            articuloPorTalle: talles.some(t => t.avioId && String(t.avioId) !== String(a.AvioID || '')),   // solo de pantalla
        };
    }),
    aviosPorTalleOk: d.aviosPorTalle === true,   // ¿se corrió configurador_ficha_avios_talle.sql?
});

const formToPayload = (f) => ({
    ...(f.esCombo ? {} : { tizadaProMoldeRef: f.tizadaProMoldeRef || null }),
    ...(f.esCombo ? {} : { tecnicaPrincipal: f.tecnicaPrincipal || 'SB', molde: f.molde || 'OBLIGATORIO', um: f.um || 'u', anchoM: f.anchoM === '' ? null : Number(f.anchoM), altoM: f.altoM === '' ? null : Number(f.altoM), bordeCm: f.bordeCm === '' ? null : Number(f.bordeCm) }),
    visiblePortal: !!f.visiblePortal, visibleTienda: !!f.visibleTienda, visibleInterno: f.visibleInterno !== false,
    origenTipo: f.origenTipo,
    origenProIdProducto: (f.origenTipo === 'LOCAL' || f.origenTipo === 'AMBOS') ? (f.origenProIdProducto || null) : null,
    cantidadMinima: f.politica === 'MINIMA' && f.cantidadMinima ? Number(f.cantidadMinima) : null,
    // Con combo, la cantidad fija de un solo producto no aplica (la composición manda)
    cantidadFija: f.politica === 'PAQUETE' && !f.esCombo && f.cantidadFija ? Number(f.cantidadFija) : null,
    validarStock: f.validarStock,
    estado: f.estado,
    ...(f.precio !== '' && f.precio != null ? { precio: Number(f.precio), moneda: f.moneda } : {}),
    tecnicas: AREAS.filter(a => f.tecnicas[a.id].on).map(a => ({
        areaId: a.id,
        obligatorio: f.tecnicas[a.id].obligatorio,
        modo: f.tecnicas[a.id].modo,
        cobro: f.tecnicas[a.id].cobro,
    })),
    opcionesPermitidas: [...f.opcionesPermitidas],
    surtido: [...f.surtido],
    modelos: [...f.modelos.entries()].map(([clave, m]) => ({ clave, nombre: m.nombre, esDefault: m.esDefault })),
    telas: [...f.telas.entries()].map(([telaProIdProducto, t]) => ({ telaProIdProducto, esDefault: t.esDefault })),
    apliques: f.apliques
        .map(a => ({ ...a, posicion: unirPosicion(a.pieza, a.detalle) }))
        .filter(a => a.posicion)
        .map(a => ({
            posicion: a.posicion, areaId: a.areaId,
            tecnicaOpcionId: a.tecnicaOpcionId || null,
            cantidad: Number(a.cantidad) || 1, incluido: a.incluido,
        })),
    comboItems: (f.esCombo ? f.comboItems : []).filter(it => it.itemProIdProducto).map(it => ({
        itemProIdProducto: Number(it.itemProIdProducto),
        wmsVarianteId: it.wmsVarianteId || null,
        cantidad: Number(it.cantidad) || 1,
        servicios: (it.servicios || []).map(s => ({
            areaId: s.areaId, tecnicaOpcionId: s.tecnicaOpcionId || null, incluido: s.incluido !== false
        })),
    })),
    ...(f.esCombo ? {} : {
        accesorios: (f.accesorios || []).filter(a => a.itemProIdProducto).map(a => ({
            itemProIdProducto: Number(a.itemProIdProducto), wmsVarianteId: a.wmsVarianteId || null,
            cantidad: Number(a.cantidad) || 1, obligatorio: a.obligatorio !== false, cobro: a.cobro === 'APARTE' ? 'APARTE' : 'INCLUIDO',
            wmsDepositoId: Number(a.wmsDepositoId) > 0 ? Number(a.wmsDepositoId) : null,
        })),
        fichaDiseno: {
            ref: f.fichaDiseno.ref?.trim() || null,
            marca: f.fichaDiseno.marca?.trim() || null,
            material: f.fichaDiseno.material?.trim() || null,
            tallas: f.fichaDiseno.tallas?.trim() || null,
            marcacion: f.fichaDiseno.marcacion?.trim() || null,
            colores: f.fichaDiseno.colores?.trim() || null,
            proveedor: f.fichaDiseno.proveedor?.trim() || null,
        },
        fichaDisenoAnotaciones: f.fichaDisenoAnotaciones.map(a => ({ x: a.x, y: a.y, texto: a.texto })),
        fichaDisenoExtra: f.fichaDisenoExtra.filter(c => (c.label || '').trim()).map(c => ({ label: c.label.trim(), valor: c.valor || '' })),
        fichaDisenoCosturas: f.fichaDisenoCosturas.filter(c => (c.union || '').trim()).map(c => ({
            union: c.union.trim(), iso: c.iso || null, etapa: c.etapa || null, descripcion: (c.descripcion || '').trim() || null,
            maquinaId: c.maquinaId ? Number(c.maquinaId) : null, tiempoMin: c.tiempoMin === '' || c.tiempoMin == null ? null : Number(c.tiempoMin),
            observaciones: (c.observaciones || '').trim() || null, imagenUrl: c.imagenUrl || null,
            avioId: c.avioId ? Number(c.avioId) : null,
        })),
        avios: f.avios.filter(a => (a.nombre || '').trim()).map(a => ({
            avioId: a.avioId || null, nombre: a.nombre.trim(), cantidad: Number(a.cantidad) || 1, unidad: a.unidad || null, medida: a.medida || null, nota: a.nota || null,
            variaPorTalle: !!a.porTalle,
            talles: a.porTalle ? (a.talles || []).filter(t => (t.valor !== '' && t.valor != null) || t.avioId)
                .map(t => ({ talle: t.talle, valor: t.valor === '' || t.valor == null ? null : Number(t.valor), avioId: t.avioId ? Number(t.avioId) : null })) : [],
        })),
    }),
});

// Huella de lo que manda "Guardar" (02/10), para saber si hay cambios sin guardar. Las listas que salen de
// un Set o un Map se ordenan: prender y apagar una opción la cambia de lugar pero no es un cambio.
const firmaForm = (f) => {
    const p = formToPayload(f);
    const ordenar = (arr, clave) => [...(arr || [])].sort((a, b) => String(clave ? a[clave] : a).localeCompare(String(clave ? b[clave] : b)));
    return JSON.stringify({ ...p, opcionesPermitidas: ordenar(p.opcionesPermitidas), surtido: ordenar(p.surtido), modelos: ordenar(p.modelos, 'clave'), telas: ordenar(p.telas, 'telaProIdProducto') });
};

// Código sugerido para una copia (09-oct): si el original sigue un patrón con número al final
// ("PR-002"), el siguiente libre de ese prefijo entre los productos de la lista ("PR-058"). Vacío =
// lo decide el backend, que además revisa que no lo use ningún artículo ni precio.
const sugerirCodigoCopia = (cod, productos) => {
    const m = /^(.*\D)(\d+)$/.exec((cod || '').trim());
    if (!m) return '';
    const [, prefijo, numero] = m;
    const patron = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    const max = productos.reduce((mx, p) => { const k = patron.exec((p.CodArticulo || '').trim()); return k ? Math.max(mx, Number(k[1])) : mx; }, 0);
    return `${prefijo}${String(max + 1).padStart(numero.length, '0')}`;
};

// Ventana "Copiar producto": pide el nombre (y deja ajustar el código). La copia nace igual al
// original pero sin precio y en borrador (backend: configuradorController.copiarProducto).
function CopiarProductoModal({ form, productos, hayCambios, onClose, onCopiado }) {
    const [nombre, setNombre] = useState(`${form.descripcion} (copia)`.slice(0, 100));
    const [codigo, setCodigo] = useState(() => sugerirCodigoCopia(form.codArticulo, productos));
    const [copiando, setCopiando] = useState(false);
    const [error, setError] = useState(null);
    const nombreRef = useRef(null);
    useEffect(() => { nombreRef.current?.focus(); nombreRef.current?.select(); }, []);
    useEffect(() => {
        const alTeclear = (e) => { if (e.key === 'Escape' && !copiando) onClose(); };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [onClose, copiando]);

    const copiar = async () => {
        if (!nombre.trim()) return setError('Poné el nombre de la copia.');
        setCopiando(true);
        setError(null);
        try {
            const { data } = await api.post(`${API}/productos/${form.proId}/copiar`, { descripcion: nombre.trim(), codArticulo: codigo.trim() || undefined });
            onCopiado(data);
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally { setCopiando(false); }
    };

    const seCopia = form.esCombo
        ? ['Los productos del combo y sus servicios', 'Las cantidades', 'La foto y la categoría']
        : ['Producción principal, molde y medidas', 'Técnicas y sus opciones', 'Cantidad y accesorios', 'Molde, telas, avíos y apliques', 'Ficha de diseño y pasos de costura', 'La foto, la familia y la etiqueta'];

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !copiando && onClose()}>
            <div role="dialog" aria-modal="true" aria-labelledby="copiar-producto-titulo"
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="px-6 pt-6 flex items-start gap-4">
                    <div className="w-11 h-11 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center shrink-0"><Copy size={20} /></div>
                    <div className="min-w-0 flex-1">
                        <h3 id="copiar-producto-titulo" className="text-lg font-black text-slate-800">Copiar {form.esCombo ? 'combo' : 'producto'}</h3>
                        <p className="text-sm text-slate-500 truncate">De <b className="text-slate-700">{form.descripcion}</b> <span className="font-mono text-xs">[{form.codArticulo}]</span></p>
                    </div>
                    <button type="button" onClick={onClose} disabled={copiando} title="Cerrar" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                </div>

                <div className="px-6 pt-5 space-y-4">
                    <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Nombre de la copia</label>
                        <input ref={nombreRef} value={nombre} maxLength={100} onChange={e => { setNombre(e.target.value); setError(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') copiar(); }}
                            className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Código</label>
                        <input value={codigo} maxLength={20} placeholder="Automático" onChange={e => { setCodigo(e.target.value); setError(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') copiar(); }}
                            className="w-40 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-mono outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
                        <p className="text-[11px] text-slate-400 mt-1">El siguiente libre. Si lo dejás vacío, se asigna solo.</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                        <p className="font-bold text-slate-700 mb-1.5">Se copia igual:</p>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                            {seCopia.map(t => <li key={t} className="flex items-start gap-1.5"><Check size={13} className="text-emerald-600 mt-px shrink-0" />{t}</li>)}
                        </ul>
                        <p className="mt-3 flex items-start gap-1.5 text-slate-700">
                            <Info size={13} className="text-brand-cyan mt-px shrink-0" />
                            <span>Queda <b>sin precio</b> y en <b>borrador</b>: cargale el precio y publicala cuando esté lista.</span>
                        </p>
                    </div>

                    {hayCambios && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                            <TriangleAlert size={14} className="shrink-0 mt-px" />
                            Este producto tiene cambios sin guardar: la copia se hace con lo último guardado, y al abrirla esos cambios se pierden. Guardá primero si los querés.
                        </div>
                    )}
                    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
                </div>

                <div className="px-6 py-4 mt-5 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" onClick={onClose} disabled={copiando}
                        className="px-4 py-2.5 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
                    <button type="button" onClick={copiar} disabled={copiando || !nombre.trim()}
                        className="px-4 py-2.5 rounded-xl font-bold text-sm text-white bg-brand-cyan hover:bg-brand-cyan/90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
                        <Copy size={16} /> {copiando ? 'Copiando…' : 'Crear copia'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════
export default function ConfigurarProductosPage() {
    // Pestaña abierta: 'confeccionados' | 'combos' | 'ecouv' | 'tecnicas' | 'avios' | 'costuras'. EcoUV era
    // una "familia" aparte con sus propias pastillas; desde el 02/10 es una pestaña más.
    const [vista, setVista] = useState('confeccionados');

    // Datos compartidos
    const [productos, setProductos] = useState([]);
    const [tecnicasCat, setTecnicasCat] = useState([]);       // TecnicaOpciones (all)
    const [moldesTp, setMoldesTp] = useState([]);             // moldes de TizadaPro (solo lectura): modelos, piezas, talles, telas
    const [areasPrincipales, setAreasPrincipales] = useState([]);   // F1: áreas que pueden producir un producto (ConfigMapeoERP)
    const [materialesArea, setMaterialesArea] = useState({});       // F1: materiales de impresión por área (para productos sin molde)
    const [filtroArea, setFiltroArea] = useState('');               // F1: filtro de la lista por producción principal
    const [moldesTpError, setMoldesTpError] = useState(null);  // TizadaPro no se puede leer (base o permiso)
    const [costurasIsoCat, setCosturasIsoCat] = useState([]); // CosturasISO (catálogo, ficha de diseño; incluye inactivas)
    const [maquinasCosturaCat, setMaquinasCosturaCat] = useState([]); // [PASO A PASO] MaquinasCostura (incluye inactivas)
    const [costurasPasoAPaso, setCosturasPasoAPaso] = useState(false); // [PASO A PASO] ¿se corrió configurador_costuras_paso_a_paso.sql?
    const [aviosCat, setAviosCat] = useState([]);             // CatalogoAvios (incluye inactivos)
    const [locales, setLocales] = useState([]);               // productos del local
    const [stockArts, setStockArts] = useState([]);           // [ACCESORIOS] cualquier artículo con variantes WMS (mástil, base…)
    const [depositosWms, setDepositosWms] = useState([]);     // [ACCESORIOS] depósitos del WMS de donde puede salir un accesorio
    const [stockPorDep, setStockPorDep] = useState({});       // [ACCESORIOS] { depId: { varianteId: stock } } — stock vivo de otros depósitos
    const cargarStockDep = useCallback(async (dep) => {
        const d = Number(dep); if (!d) return;
        setStockPorDep(prev => (prev[d] ? prev : { ...prev, [d]: {} }));
        try { const { data } = await api.get(`${API}/stock-wms/${d}`); setStockPorDep(prev => ({ ...prev, [d]: data?.data || {} })); }
        catch { /* sin stock vivo: la fila lo muestra como "sin dato" */ }
    }, []);
    const [stockDisponible, setStockDisponible] = useState(true);
    const [familiasCat, setFamiliasCat] = useState([]);        // variantes StockArt del grupo 2.1 (familias reales)
    const [loading, setLoading] = useState(false);

    // Editor
    const [form, setForm] = useState(null);
    const [paso, setPaso] = useState('principal');
    const [saving, setSaving] = useState(false);
    const [fichaLoading, setFichaLoading] = useState(false);

    // Lista
    const [busca, setBusca] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('');
    const [nuevoNombre, setNuevoNombre] = useState('');
    const [creando, setCreando] = useState(false);
    const [copiando, setCopiando] = useState(false);   // ventana "Copiar producto" abierta
    const [showNuevo, setShowNuevo] = useState(false);
    const [moviendoFamilia, setMoviendoFamilia] = useState(false);
    const [showNuevaFamilia, setShowNuevaFamilia] = useState(false);
    const [eligiendoLocal, setEligiendoLocal] = useState(false);   // origen del local: mostrar la lista aunque ya haya uno elegido
    const [nuevaFamiliaNombre, setNuevaFamiliaNombre] = useState('');
    const [creandoFamilia, setCreandoFamilia] = useState(false);

    // Etiqueta (árbol: Familia → Etiqueta → Producto). Dice para qué es el producto
    // (Básquet, Fútbol…). Se aplica al instante, igual que mover de familia.
    const [etiquetasCat, setEtiquetasCat] = useState([]);                // ProductoEtiqueta (todas)
    const [etiquetasAbiertas, setEtiquetasAbiertas] = useState(() => new Set()); // clave "familia|etiquetaId"
    const [showNuevaEtiqueta, setShowNuevaEtiqueta] = useState(false);
    const [nuevaEtiquetaNombre, setNuevaEtiquetaNombre] = useState('');
    const [renombreEtiqueta, setRenombreEtiqueta] = useState(null);      // null = no renombrando; string = nombre en edición
    const [guardandoEtiqueta, setGuardandoEtiqueta] = useState(false);

    // Ficha de diseño (paso 6 del confeccionado)
    const [subiendoDibujo, setSubiendoDibujo] = useState(false);
    const [fichaPreview, setFichaPreview] = useState(false); // modal "Ver ficha técnica"

    // EcoUV embebido
    const [ecouvModal, setEcouvModal] = useState(null);
    const [ecouvStats, setEcouvStats] = useState(null);

    const loadProductos = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`${API}/productos`);
            setProductos(data.data || []);
        } catch (e) {
            toast.error('Error cargando productos: ' + (e.response?.data?.error || e.message));
        } finally { setLoading(false); }
    }, []);

    const loadCatalogos = useCallback(async () => {
        try {
            const [t, iso, av, ar, maq] = await Promise.all([
                api.get(`${API}/tecnicas?all=1`),
                api.get(`${API}/costuras-iso?all=1`),
                api.get(`${API}/avios?all=1`),
                api.get(`${API}/areas-principales`).catch(() => ({ data: { data: [] } })),
                api.get(`${API}/maquinas-costura?all=1`).catch(() => ({ data: { data: [] } })),   // [PASO A PASO]
            ]);
            setMaquinasCosturaCat(maq.data?.data || []);
            setCosturasPasoAPaso(!!iso.data?.pasoAPaso);
            setAreasPrincipales(ar.data?.data || []);
            setTecnicasCat(t.data?.data || []);
            setCosturasIsoCat(iso.data?.data || []);
            setAviosCat(av.data?.data || []);
        } catch (e) {
            toast.error('Error cargando catálogos: ' + (e.response?.data?.error || e.message));
        }
    }, []);

    const loadLocales = useCallback(async () => {
        try {
            const { data } = await api.get(`${API}/productos-local`);
            setLocales(data.data || []);
            // [ACCESORIOS] los accesorios pueden ser de cualquier familia (mástiles, bases…): lista sin filtro
            try { const r2 = await api.get(`${API}/productos-local`, { params: { todos: 1 } }); setStockArts(r2.data?.data || []); } catch { setStockArts([]); }
            try { const r3 = await api.get(`${API}/depositos-wms`); setDepositosWms(r3.data?.data || []); } catch { setDepositosWms([]); }
            setStockDisponible(data.stockDisponible !== false);
        } catch (e) {
            toast.error('Error cargando productos del local: ' + (e.response?.data?.error || e.message));
        }
    }, []);

    // Familias = variantes de StockArt (Editor StockArt las administra igual que EcoUV)
    const loadFamilias = useCallback(async () => {
        try {
            // Por SupFlia (no por un Grupo fijo): las familias de "Prendas" ya viven en
            // grupos distintos (2.1 tipos de prenda, 2.2 Combos, 2.3 Productos del Local...).
            const { data } = await api.get('/stockart?supflia=2');
            setFamiliasCat((data.data || []).filter(v => v.CodStock !== CODSTOCK_COMBOS));
        } catch (e) {
            toast.error('Error cargando familias: ' + (e.response?.data?.error || e.message));
        }
    }, []);

    // Moldes de TizadaPro. Si no se puede leer (falta la base o el permiso), la pantalla sigue y el paso Molde lo avisa.
    const loadMoldesTp = useCallback(async () => {
        try {
            const { data } = await api.get(`${API}/tizadapro/moldes`);
            setMoldesTp(data.data || []); setMoldesTpError(null);
        } catch (e) {
            setMoldesTp([]); setMoldesTpError(e.response?.data?.error || e.message);
        }
    }, []);
    useEffect(() => { loadProductos(); loadCatalogos(); loadLocales(); loadFamilias(); loadMoldesTp(); }, [loadProductos, loadCatalogos, loadLocales, loadFamilias, loadMoldesTp]);

    const loadEcouvStats = useCallback(async () => {
        try {
            const [va, te] = await Promise.all([
                api.get(`/stockart?grupo=${GRUPO_ECOUV}`),
                api.get('/stockart/terminaciones'),
            ]);
            const rows = va.data?.data || [];
            setEcouvStats({
                variantes: rows.filter(r => r.Mostrar).length,
                articulos: rows.reduce((acc, r) => acc + (r.CantArticulos || 0), 0),
                terminaciones: (te.data?.data || []).length,
            });
        } catch { /* chips opcionales */ }
    }, []);
    useEffect(() => { if (vista === 'ecouv' && !ecouvStats) loadEcouvStats(); }, [vista, ecouvStats, loadEcouvStats]);

    // Mover el producto a otra familia = mover el artículo a otra variante de
    // StockArt (mismo endpoint que usa el Editor StockArt de EcoUV).
    const moverAFamilia = async (codStockDestino) => {
        if (!form) return;
        setMoviendoFamilia(true);
        try {
            await api.put(`/stockart/articulos/${form.codArticulo}/mover`, { codStockDestino });
            toast.success('✅ Movido de familia');
            await Promise.all([loadProductos(), abrirProducto(form.proId)]);
        } catch (e) {
            toast.error('Error moviendo: ' + (e.response?.data?.error || e.message));
        } finally { setMoviendoFamilia(false); }
    };

    // Nueva familia = nueva variante de StockArt bajo el grupo de Prendas,
    // con el mismo criterio de código sugerido que usa el Editor StockArt.
    const sugerirCodStockFamilia = () => {
        // Escala solo dentro de Grupo 2.1: "+ Nueva familia" siempre nace ahí
        // (mismo grupo que Camisetas/Shorts/...), aunque familiasCat ahora mezcle
        // varios grupos (Combos en 2.2, Productos del Local en 2.3).
        const codes = familiasCat.filter(v => v.Grupo === GRUPO_PRENDAS).map(v => v.CodStock);
        if (!codes.length) return '2.2.1.5';
        const base = codes[0].split('.').slice(0, -1).join('.');
        const maxN = Math.max(...codes.map(c => parseInt(c.split('.').pop()) || 0));
        return `${base}.${maxN + 1}`;
    };
    const crearFamiliaNueva = async () => {
        if (!nuevaFamiliaNombre.trim()) return toast.error('Poné el nombre de la familia.');
        setCreandoFamilia(true);
        try {
            await api.post('/stockart', {
                grupo: GRUPO_PRENDAS, codStock: sugerirCodStockFamilia(),
                articulo: nuevaFamiliaNombre.trim(), um: 'U', tipoStock: 'PRODUCTO_TERMINADO'
            });
            toast.success(`✅ Familia "${nuevaFamiliaNombre.trim()}" creada`);
            setNuevaFamiliaNombre(''); setShowNuevaFamilia(false);
            loadFamilias();
        } catch (e) {
            toast.error('Error creando familia: ' + (e.response?.data?.error || e.message));
        } finally { setCreandoFamilia(false); }
    };

    // F1: materiales de impresión de un área (una vez por área)
    const loadMaterialesArea = useCallback(async (areaId) => {
        if (!areaId || materialesArea[areaId]) return;
        try {
            const { data } = await api.get(`${API}/materiales-area/${areaId}`);
            setMaterialesArea(prev => ({ ...prev, [areaId]: data.data || [] }));
        } catch (e) { toast.error('Error leyendo los materiales del área: ' + (e.response?.data?.error || e.message)); }
    }, [materialesArea]);
    useEffect(() => { if (form?.tecnicaPrincipal && !form.esCombo) loadMaterialesArea(form.tecnicaPrincipal); }, [form?.tecnicaPrincipal, form?.esCombo, loadMaterialesArea]);

    // Lo último leído del servidor por producto, para marcar los cambios sin guardar (ver firmaForm).
    const leidoRef = useRef({});
    const abrirProducto = async (proId) => {
        setFichaLoading(true);
        try {
            const { data } = await api.get(`${API}/productos/${proId}`);
            const f = fichaToForm(data.data);
            leidoRef.current[f.proId] = { form: f, firma: firmaForm(f) };
            setForm(f);
            // El origen ya no es un paso (02/10): se abre en el primero de los que quedan
            setPaso(f.esCombo ? 'combo' : f.origenTipo === 'CONFECCIONADO' ? 'principal' : 'tecnicas');
        } catch (e) {
            toast.error('Error abriendo la ficha: ' + (e.response?.data?.error || e.message));
        } finally { setFichaLoading(false); }
    };

    // Lo abierto en cada pestaña de lista (02/10): al ir de Confeccionados a Combos y volver, cada una
    // muestra el suyo, en el paso en que estaba y con lo que se haya cambiado sin guardar. Antes el
    // producto abierto quedaba el mismo en las dos: el combo seguía a la vista en Confeccionados.
    // Los catálogos no muestran el editor, así que no tocan lo abierto.
    const abiertoPorVista = useRef({});
    const cambiarVista = (nueva) => {
        if (nueva === vista) return;
        const esLista = (v) => v === 'confeccionados' || v === 'combos';
        if (esLista(vista)) abiertoPorVista.current[vista] = form ? { form, paso } : null;
        if (esLista(nueva)) {
            const antes = abiertoPorVista.current[nueva];
            setForm(antes ? antes.form : null);
            if (antes) setPaso(antes.paso);
        }
        setVista(nueva);
    };

    // Una pestaña de la fila de arriba. Los catálogos van en un tono más suave: son datos de apoyo.
    const cuentaPestana = (id) => (id === 'confeccionados' ? confeccionadosFiltrados.length : id === 'combos' ? combosFiltrados.length : null);
    const pestana = (id, label, catalogo) => {
        const on = vista === id;
        const n = cuentaPestana(id);
        return (
            <button key={id} type="button" onClick={() => cambiarVista(id)} aria-current={on ? 'page' : undefined}
                className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${on
                    ? 'border-brand-cyan text-brand-cyan font-bold'
                    : `border-transparent hover:border-slate-300 ${catalogo ? 'font-semibold text-slate-400 hover:text-slate-600' : 'font-bold text-slate-500 hover:text-slate-700'}`}`}>
                {label}
                {n != null && <span className={`rounded-full px-1.5 text-[11px] font-black ${on ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-slate-200 text-slate-500'}`}>{n}</span>}
            </button>
        );
    };


    // El dibujo se sube al toque (como el resto de las imágenes de la app) — no
    // espera al "Guardar cambios" del producto, así el usuario ve el resultado ya.
    const subirDibujoFicha = async (file) => {
        if (!form?.proId || !file) return;
        setSubiendoDibujo(true);
        try {
            const fd = new FormData();
            fd.append('dibujo', file);
            // El cliente HTTP manda JSON por defecto: sin este header el FormData viaja como JSON y el
            // servidor responde "No se subió ninguna imagen" (400).
            const { data } = await api.post(`${API}/productos/${form.proId}/ficha-diseno/dibujo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setF({ fichaDiseno: { ...form.fichaDiseno, dibujoUrl: data.dibujoUrl } });
            // [FOTO ÚNICA] sin foto de catálogo, el dibujo pasa a ser la foto del producto (la publica el backend)
            if (!form.imagen) { setForm(prev => ({ ...prev, imagen: data.dibujoUrl })); loadProductos(); }
            toast.success(form.imagen ? '✅ Dibujo cargado' : '✅ Dibujo cargado. Como el producto no tenía foto, queda también como foto del producto.');
        } catch (e) {
            toast.error('Error subiendo el dibujo: ' + (e.response?.data?.error || e.message));
        } finally { setSubiendoDibujo(false); }
    };

    // Arrastrar una anotación sobre el dibujo — mueve el DOM directo durante el
    // drag (sin re-render por cada mousemove) y recién confirma en el estado al soltar.
    // elDot = el punto que se arrastra (evDown.currentTarget); elCanvas = su contenedor.
    const arrastrarAnotacion = (i) => (evDown) => {
        evDown.preventDefault();
        evDown.stopPropagation(); // no disparar el onClick del canvas (agregaría una anotación nueva)
        const elDot = evDown.currentTarget;
        const elCanvas = elDot.parentElement;
        const rect = elCanvas.getBoundingClientRect();
        const mover = (ev) => {
            const x = Math.max(0, Math.min(100, (ev.clientX - rect.left) / rect.width * 100));
            const y = Math.max(0, Math.min(100, (ev.clientY - rect.top) / rect.height * 100));
            elDot.style.left = x + '%'; elDot.style.top = y + '%';
            elDot.dataset.x = x; elDot.dataset.y = y;
        };
        const soltar = () => {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            const x = Number(elDot.dataset.x), y = Number(elDot.dataset.y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                setF({ fichaDisenoAnotaciones: form.fichaDisenoAnotaciones.map((a, j) => j === i ? { ...a, x, y } : a) });
            }
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    };

    const guardar = async () => {
        if (!form) return;
        if (form.esCombo && form.comboItems.filter(it => it.itemProIdProducto).length === 0)
            return toast.error('El combo necesita al menos un producto en la composición.');
        if (!form.esCombo && form.politica === 'MINIMA' && (!form.cantidadMinima || Number(form.cantidadMinima) <= 0))
            return toast.error('Poné la cantidad mínima (entero mayor a 0).');
        if (!form.esCombo && form.politica === 'PAQUETE' && (!form.cantidadFija || Number(form.cantidadFija) <= 0))
            return toast.error('Poné la cantidad fija del paquete (entero mayor a 0).');
        if (!form.esCombo && form.tizadaProMoldeRef && form.apliques.some(ap => !ap.pieza))
            return toast.error('Cada aplique necesita una pieza del molde. Elegila en "Molde, telas y apliques".');
        if (!form.esCombo && form.estado === 'PUBLICADO' && form.origenTipo === 'CONFECCIONADO') {
            if (form.molde === 'OBLIGATORIO' && !form.tizadaProMoldeRef) return toast.error('Para publicar, primero vinculá el molde de TizadaPro (paso "Molde, telas y apliques"), o marcá en "Producción principal" que el molde es opcional o que no lleva.');
            if (form.molde !== 'OBLIGATORIO' && !form.tizadaProMoldeRef && !(Number(form.anchoM) > 0 && Number(form.altoM) > 0)) return toast.error('Sin molde, para publicar hace falta la medida fija (ancho × alto en metros) en "Producción principal".');
            const apagadas = form.apliques.filter(ap => ap.areaId !== 'ETIQUETA' && !form.tecnicas[ap.areaId]?.on).map(ap => areaMeta(ap.areaId).label);
            if (apagadas.length) return toast.error(`Para publicar, los apliques tienen que ser de técnicas activas. Activá ${[...new Set(apagadas)].join(', ')} en "Técnicas" o quitá esos apliques.`);
        }
        setSaving(true);
        try {
            await api.put(`${API}/productos/${form.proId}`, formToPayload(form));
            toast.success(`✅ Guardado — ${form.descripcion} (${form.estado === 'PUBLICADO' ? 'publicado' : 'borrador'})`);
            loadProductos();
            abrirProducto(form.proId); // re-lee para reflejar lo persistido
        } catch (e) {
            toast.error('Error guardando: ' + (e.response?.data?.error || e.message));
        } finally { setSaving(false); }
    };

    // La pestaña activa decide qué se crea — Confeccionados o Combos y Promos.
    const crearProducto = async () => {
        if (!nuevoNombre.trim()) return toast.error(vista === 'combos' ? 'Poné el nombre del combo.' : 'Poné el nombre del producto.');
        const esComboNuevo = vista === 'combos';
        setCreando(true);
        try {
            const { data } = await api.post(`${API}/productos`, { descripcion: nuevoNombre.trim(), esCombo: esComboNuevo });
            toast.success(`✅ ${esComboNuevo ? 'Combo creado' : 'Creado'} con código ${data.codArticulo}`);
            setNuevoNombre(''); setShowNuevo(false);
            await loadProductos();
            abrirProducto(data.proIdProducto);
        } catch (e) {
            toast.error('Error creando: ' + (e.response?.data?.error || e.message));
        } finally { setCreando(false); }
    };

    // Combo = EsCombo (creado como combo) o tiene señales de combo (cantidad fija / ítems armados)
    const esCombo = (p) => !!(p.EsCombo || p.CantidadFija || p.ComboItems > 0);

    // Filtros de la lista (02/10): búsqueda, área y estado. El área (F1: producción principal) solo filtra
    // los confeccionados, que es donde se elige: antes también sacaba combos de la otra pestaña sin que se
    // viera por qué.
    const pasaBusquedaYArea = (p) => {
        if (busca && !(`${p.Descripcion} ${p.CodArticulo} ${p.Etiqueta || ''}`.toLowerCase().includes(busca.toLowerCase()))) return false;
        if (filtroArea && !esCombo(p) && (p.TecnicaPrincipal || 'SB') !== filtroArea) return false;
        return true;
    };

    // Contadores del filtro por estado: lo de la pestaña abierta, con la búsqueda y el área ya aplicadas
    // (cada número es lo que muestra la lista al tocarlo).
    const conteoEstados = useMemo(() => {
        const base = productos.filter(p => (vista === 'combos' ? esCombo(p) : !esCombo(p)) && pasaBusquedaYArea(p));
        return {
            '': base.length,
            PUBLICADO: base.filter(p => p.Estado === 'PUBLICADO').length,
            BORRADOR: base.filter(p => p.Estado === 'BORRADOR').length,
            SIN: base.filter(p => !p.Estado).length,
        };
    }, [productos, vista, busca, filtroArea]);

    const productosFiltrados = useMemo(() => productos.filter(p => {
        if (!pasaBusquedaYArea(p)) return false;
        if (filtroEstado === 'PUBLICADO' || filtroEstado === 'BORRADOR') return p.Estado === filtroEstado;
        if (filtroEstado === 'SIN') return !p.Estado;
        return true;
    }), [productos, busca, filtroEstado, filtroArea]);
    // Áreas del filtro: las que pueden ser producción principal, más las que ya tiene algún producto
    const areasFiltro = areasPrincipales.filter(a => AREAS_PRINCIPAL.includes(a.AreaID) || productos.some(p => p.TecnicaPrincipal === a.AreaID));

    // Dos pestañas separadas: confeccionados (agrupados por familia) y combos (lista simple)
    const confeccionadosFiltrados = useMemo(() => productosFiltrados.filter(p => !esCombo(p)), [productosFiltrados]);
    const combosFiltrados = useMemo(() => productosFiltrados.filter(esCombo), [productosFiltrados]);

    // Lista agrupada por tipo de prenda. Acordeón (02/10): al abrir una familia se cierran las demás, y al entrar
    // están todas cerradas. Con búsqueda se ven todas abiertas, como antes.
    const [grupoAbierto, setGrupoAbierto] = useState(null);
    const gruposLista = useMemo(() => {
        const g = {};
        confeccionadosFiltrados.forEach(p => {
            const f = familiaDeProducto(p);
            (g[f] = g[f] || []).push(p);
        });
        const orden = [...familiasCat.map(v => v.Articulo).sort((a, b) => a.localeCompare(b)), 'Sin clasificar'];
        return orden.filter(f => g[f]?.length).map(f => {
            // Dentro de la familia: un nodo por etiqueta (Básquet, Fútbol…) con sus
            // productos, y después los productos sin etiqueta, sueltos.
            const porEtiqueta = new Map();
            const sueltos = [];
            g[f].forEach(p => {
                if (p.EtiquetaID) {
                    if (!porEtiqueta.has(p.EtiquetaID)) porEtiqueta.set(p.EtiquetaID, { tipo: 'etiqueta', id: p.EtiquetaID, nombre: p.Etiqueta || '', items: [] });
                    porEtiqueta.get(p.EtiquetaID).items.push(p);
                } else sueltos.push({ tipo: 'item', p });
            });
            const etiquetas = [...porEtiqueta.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
            return { nombre: f, items: g[f], nodos: [...etiquetas, ...sueltos], etiquetas: etiquetas.length };
        });
    }, [confeccionadosFiltrados, familiasCat]);
    const toggleGrupo = (nombre) => setGrupoAbierto(prev => (prev === nombre ? null : nombre));
    // La familia del producto abierto se abre sola cuando se abre otro producto o cuando él cambia de familia:
    // al crearlo o al moverlo cae en una familia que puede estar cerrada. Si después se la cierra a mano, queda así.
    const ultimoAbierto = useRef(null);
    useEffect(() => {
        const p = form?.proId ? productos.find(x => x.ProIdProducto === form.proId) : null;
        if (!p || esCombo(p)) return;   // recién creado: todavía no está en la lista; se vuelve a mirar cuando llega
        const clave = `${p.ProIdProducto}|${familiaDeProducto(p)}`;
        if (clave === ultimoAbierto.current) return;
        ultimoAbierto.current = clave;
        setGrupoAbierto(familiaDeProducto(p));
    }, [form?.proId, productos]);
    const toggleEtiqueta = (clave) => setEtiquetasAbiertas(prev => {
        const next = new Set(prev);
        next.has(clave) ? next.delete(clave) : next.add(clave);
        return next;
    });

    // Etiquetas: catálogo + asignar / crear / renombrar (se aplica al instante)
    const loadEtiquetas = useCallback(async () => {
        try {
            const { data } = await api.get(`${API}/etiquetas`);
            setEtiquetasCat(data.data || []);
        } catch (e) {
            toast.error('Error cargando etiquetas: ' + (e.response?.data?.error || e.message));
        }
    }, []);
    useEffect(() => { loadEtiquetas(); }, [loadEtiquetas]);
    useEffect(() => { setShowNuevaEtiqueta(false); setNuevaEtiquetaNombre(''); setRenombreEtiqueta(null); setShowNuevaFamilia(false); setNuevaFamiliaNombre(''); setEligiendoLocal(false); }, [form?.proId]);
    const asignarEtiqueta = async (etiquetaId) => {
        if (!form) return;
        setGuardandoEtiqueta(true);
        try {
            await api.put(`${API}/productos/${form.proId}/etiqueta`, { etiquetaId });
            toast.success(etiquetaId ? '✅ Etiqueta asignada' : '✅ Etiqueta quitada');
            await Promise.all([loadProductos(), loadEtiquetas()]);
        } catch (e) {
            toast.error('Error asignando etiqueta: ' + (e.response?.data?.error || e.message));
        } finally { setGuardandoEtiqueta(false); }
    };
    const crearYAsignarEtiqueta = async () => {
        const nombre = nuevaEtiquetaNombre.trim();
        if (!nombre) return toast.error('Poné el nombre de la etiqueta.');
        if (!form) return;
        setGuardandoEtiqueta(true);
        try {
            const { data } = await api.post(`${API}/etiquetas`, { nombre });
            await api.put(`${API}/productos/${form.proId}/etiqueta`, { etiquetaId: data.data.EtiquetaID });
            toast.success(`✅ Etiqueta "${nombre}" creada y asignada`);
            setNuevaEtiquetaNombre(''); setShowNuevaEtiqueta(false);
            await Promise.all([loadProductos(), loadEtiquetas()]);
        } catch (e) {
            toast.error('Error creando etiqueta: ' + (e.response?.data?.error || e.message));
        } finally { setGuardandoEtiqueta(false); }
    };
    const renombrarEtiqueta = async (id) => {
        const nombre = String(renombreEtiqueta || '').trim();
        if (!nombre) return toast.error('Poné el nombre de la etiqueta.');
        setGuardandoEtiqueta(true);
        try {
            await api.put(`${API}/etiquetas/${id}`, { nombre });
            toast.success('✅ Etiqueta renombrada');
            setRenombreEtiqueta(null);
            await Promise.all([loadProductos(), loadEtiquetas()]);
        } catch (e) {
            toast.error('Error renombrando: ' + (e.response?.data?.error || e.message));
        } finally { setGuardandoEtiqueta(false); }
    };

    // Fila de un producto en la lista (suelto, dentro de su etiqueta o en Combos y Promos). Siempre con su
    // nombre completo. Desde el 02/10:
    // - el estado va escrito entero y con los colores del filtro de arriba (antes "● PUB" / "○ BORR", y
    //   nada si no estaba configurado);
    // - las técnicas son sus íconos, en el orden de la página (antes los códigos: "DF,EMB,SB,TPU,TWC,TWT");
    // - el elegido va en brand-cyan, como la pestaña y el paso;
    // - el paquete de los combos va con ícono y sin el ámbar (antes un emoji).
    const estadoFila = (estado) => (estado === 'PUBLICADO'
        ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Publicado</span>
        : estado === 'BORRADOR'
            ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Borrador</span>
            : <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Sin configurar</span>);
    const tecnicasFila = (txt) => {
        const ids = String(txt || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length) return null;
        const orden = [...AREAS.map(a => a.id).filter(id => ids.includes(id)), ...ids.filter(id => !AREAS.some(a => a.id === id))];
        const nombre = (id) => AREAS.find(a => a.id === id)?.label || id;
        return (
            <span className="ml-auto flex shrink-0 items-center gap-1" title={orden.map(nombre).join(' · ')}>
                {orden.map(id => { const Icono = AREAS.find(a => a.id === id)?.Icono || Factory; return <Icono key={id} size={13} className="text-brand-cyan" aria-hidden="true" />; })}
                <span className="sr-only">{orden.map(nombre).join(', ')}</span>
            </span>
        );
    };
    const filaProducto = (p, anidado = false) => {
        const sel = form?.proId === p.ProIdProducto;
        const combo = esCombo(p);
        return (
            <button key={p.ProIdProducto} onClick={() => abrirProducto(p.ProIdProducto)} aria-current={sel ? 'true' : undefined}
                className={`w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2.5 border-l-4 ${sel ? 'bg-brand-cyan/5 border-brand-cyan' : 'border-transparent hover:bg-slate-50'}`}>
                <Thumb src={p.Imagen} size={anidado ? 32 : 36} icon={combo ? 'fa-boxes-stacked' : 'fa-shirt'} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-[13px] font-bold ${sel ? 'text-brand-cyan' : 'text-slate-700'}`}>{p.Descripcion}</span>
                        {estadoFila(p.Estado)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                        <span className="font-mono">{p.CodArticulo}</span>
                        <span>{p.Precio == null ? 'sin precio' : fmtPrecio(p.Precio, p.Moneda)}</span>
                        {combo ? <>
                            {p.CantidadFija && <span className="inline-flex items-center gap-1 font-bold text-slate-500"><Package size={12} className="text-brand-cyan" aria-hidden="true" />×{p.CantidadFija}</span>}
                            {p.ComboItems > 0 && <span className="inline-flex items-center gap-1 font-bold text-slate-500"><Package size={12} className="text-brand-cyan" aria-hidden="true" />{p.ComboItems} productos</span>}
                        </> : <>
                            {p.CantidadMinima && <span>mín. {p.CantidadMinima}</span>}
                            {tecnicasFila(p.Tecnicas)}
                        </>}
                    </div>
                </div>
            </button>
        );
    };

    const origenSel = useMemo(() => locales.find(l => l.ProIdProducto === form?.origenProIdProducto) || null, [locales, form?.origenProIdProducto]);

    const pasos = useMemo(() => {
        if (!form) return [];
        if (form.esCombo) return [
            // El precio del paquete se edita en el encabezado (02/10): ya no tiene paso propio
            { id: 'combo', n: 1, label: 'Composición del combo' },
            { id: 'resumen', n: 2, label: 'Revisar y publicar' },
        ];
        const conf = form.origenTipo === 'CONFECCIONADO';
        // El origen ya no es un paso (02/10): se elige en el encabezado
        return [
            ...(conf ? [{ id: 'principal', label: 'Producción principal' }] : []),
            { id: 'tecnicas', label: 'Técnicas' },
            // 02/10: el precio pasó al encabezado y la política de cantidad, a Cantidad y accesorios
            { id: 'accesorios', label: 'Cantidad y accesorios' },   // [ACCESORIOS] artículos de stock que salen con el producto
            // Sin molde ("No lleva") no hay piezas ni telas del molde: el paso se salta (los materiales van en Producción principal)
            ...(conf && form.molde !== 'NO' ? [{ id: 'molde', label: form.molde === 'OPCIONAL' ? 'Molde (opcional), telas y apliques' : 'Molde, telas y apliques' }] : []),
            ...(conf ? [{ id: 'ficha', label: 'Ficha de diseño' }] : []),
            { id: 'resumen', label: 'Revisar y publicar' },
        ].map((p, i) => ({ ...p, n: i + 1 }));
    }, [form]);
    // Si el paso abierto deja de existir (se cambió el origen, el molde pasó a "no lleva"), se va al primero
    useEffect(() => {
        if (pasos.length && !pasos.some(s => s.id === paso)) setPaso(pasos[0].id);
    }, [pasos, paso]);
    // Animación al cambiar de paso (02/10): el contenido aparece deslizándose desde el lado hacia el que se va
    // (a un paso de adelante, desde la derecha; a uno de atrás, desde la izquierda). Sin animación si el
    // sistema pide reducir el movimiento. Va en useLayoutEffect para arrancar antes de que se pinte el paso
    // nuevo (con useEffect se veía un cuadro del paso entero antes de la animación).
    const contenidoPasoRef = useRef(null);
    const pasoPrevio = useRef(paso);
    useLayoutEffect(() => {
        const el = contenidoPasoRef.current;
        const previo = pasoPrevio.current;
        pasoPrevio.current = paso;
        if (!el?.animate || previo === paso) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const i = pasos.findIndex(s => s.id === paso);
        const j = pasos.findIndex(s => s.id === previo);
        const dx = i < 0 || j < 0 ? 0 : (i > j ? 12 : -12);
        el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'translateX(0)' }],
            { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    }, [paso]);

    // Estado de cada paso (02/10): 'ok' = tiene lo suyo; 'falta' = algo impide guardar o publicar (las mismas
    // reglas que revisa guardar()); sin estado = todavía no tiene nada. El motivo va en el globito del paso.
    const estadoPasos = useMemo(() => {
        if (!form) return {};
        const r = {};
        const falta = (id, motivo) => { r[id] = { estado: 'falta', motivos: [...(r[id]?.motivos || []), motivo] }; };
        const completo = (id, si) => { if (si && !r[id]) r[id] = { estado: 'ok', motivos: [] }; };
        if (form.esCombo) {
            if (!form.comboItems.some(it => it.itemProIdProducto)) falta('combo', 'al menos un producto en el combo');
            completo('combo', true);
        } else {
            const conf = form.origenTipo === 'CONFECCIONADO';
            // La política de cantidad está en Cantidad y accesorios (02/10)
            if (form.politica === 'MINIMA' && !(Number(form.cantidadMinima) > 0)) falta('accesorios', 'la cantidad mínima');
            if (form.politica === 'PAQUETE' && !(Number(form.cantidadFija) > 0)) falta('accesorios', 'la cantidad fija del paquete');
            if (form.tizadaProMoldeRef && form.apliques.some(ap => !ap.pieza)) falta('molde', 'la pieza del molde de cada aplique');
            if (conf && form.molde === 'OBLIGATORIO' && !form.tizadaProMoldeRef) falta('molde', 'vincular el molde de TizadaPro (o marcar en Producción principal que es opcional o que no lleva)');
            if (conf && form.molde !== 'OBLIGATORIO' && !form.tizadaProMoldeRef && !(Number(form.anchoM) > 0 && Number(form.altoM) > 0)) falta('principal', 'la medida fija (ancho × alto en metros)');
            const apagadas = conf ? [...new Set(form.apliques.filter(ap => ap.areaId !== 'ETIQUETA' && !form.tecnicas[ap.areaId]?.on).map(ap => areaMeta(ap.areaId).label))] : [];
            if (apagadas.length) falta('tecnicas', `activar ${apagadas.join(', ')}, que ${apagadas.length > 1 ? 'tienen' : 'tiene'} apliques (o quitar esos apliques)`);
            const fd = form.fichaDiseno || {};
            completo('principal', conf);   // tiene valores por defecto: si no le falta nada, está completo
            completo('tecnicas', AREAS.some(a => form.tecnicas[a.id]?.on));
            completo('accesorios', (form.accesorios || []).some(a => a.itemProIdProducto));
            completo('molde', !!form.tizadaProMoldeRef);
            // Material y tallas se rellenan solos y la marca viene puesta: no cuentan
            completo('ficha', !!(fd.dibujoUrl || fd.ref || fd.marcacion || fd.colores || fd.proveedor || form.fichaDisenoAnotaciones.length
                || form.fichaDisenoExtra.length || form.fichaDisenoCosturas.length || form.avios.length));
        }
        completo('resumen', form.estado === 'PUBLICADO');
        return r;
    }, [form]);

    const setF = (patch) => setForm(prev => ({ ...prev, ...patch }));
    // Primera opción activa del catálogo de una técnica (default de un aplique nuevo); '' = opción libre
    const primeraOpcionDe = (areaId) => tecnicasCat.find(o => o.AreaID === areaId && o.Activo)?.TecnicaOpcionID ?? '';
    const moldeSel = useMemo(() => (form?.tizadaProMoldeRef ? moldesTp.find(m => m.ref === form.tizadaProMoldeRef) || null : null), [moldesTp, form?.tizadaProMoldeRef]);
    // Material y Tallas de la ficha salen del molde de TizadaPro y de las telas ofrecidas.
    // Se rellenan solos cuando están vacíos; el usuario puede pisarlos o volver al automático.
    const autoFicha = useMemo(() => {
        // F1: el material sale de los materiales marcados, vengan del molde de TizadaPro o del área
        // (producto sin molde). Las tallas solo existen si hay molde.
        const telas = [...(form?.telas || new Map()).values()];
        if (!moldeSel) {
            const primera = telas.find(t => t.esDefault) || telas[0];
            const material = telas.length ? (telas.length === 1 ? primera.material : `${primera.material} (o ${telas.filter(t => t !== primera).map(t => t.material).join(', ')})`) : '';
            return { material, tallas: '' };
        }
        const primera = telas.find(t => t.esDefault) || telas[0];
        const material = telas.length ? (telas.length === 1 ? primera.material : `${primera.material} (o ${telas.filter(t => t !== primera).map(t => t.material).join(', ')})`) : '';
        const tallas = agruparTalles(moldeSel.talles).map(([g, l]) => `${g} ${l[0].replace(/fem$/i, '')}–${l[l.length - 1].replace(/fem$/i, '')}`).join(' · ');
        return { material, tallas };
    }, [moldeSel, form?.telas]);
    useEffect(() => {
        if (!form || form.esCombo) return;
        const patch = {};
        if (!form.fichaDiseno.material && autoFicha.material) patch.material = autoFicha.material;
        if (!form.fichaDiseno.tallas && autoFicha.tallas) patch.tallas = autoFicha.tallas;
        if (!Object.keys(patch).length) return;
        setForm(prev => ({ ...prev, fichaDiseno: { ...prev.fichaDiseno, ...patch } }));
        // El relleno automático no es un cambio del usuario: se suma también a lo leído
        const leido = leidoRef.current[form.proId];
        if (leido) {
            const f = { ...leido.form, fichaDiseno: { ...leido.form.fichaDiseno, ...patch } };
            leidoRef.current[form.proId] = { form: f, firma: firmaForm(f) };
        }
    }, [autoFicha, form?.proId]);

    // Cambios sin guardar (02/10): lo que mandaría "Guardar" contra lo último leído. La foto, el nombre y el
    // código, la familia y la etiqueta se guardan al instante y no entran.
    const hayCambios = useMemo(() => {
        const leido = form && leidoRef.current[form.proId];
        return !!leido && firmaForm(form) !== leido.firma;
    }, [form]);

    // Foto del producto (Articulos_Imagenes): la que ve el cliente en el pedido web y la solicitud.
    // Mismo endpoint que Marketing › Productos; se aplica al instante.
    const [subiendoFoto, setSubiendoFoto] = useState(false);
    const subirFoto = async (file) => {
        if (!form || !file) return;
        setSubiendoFoto(true);
        try {
            const fd = new FormData();
            fd.append('image', file);
            const res = await api.post(`/products-integration/upload-image/${form.proId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            const url = res.data?.imageUrl || null;
            if (url) setForm(prev => ({ ...prev, imagen: url }));
            toast.success('✅ Foto del producto actualizada');
            loadProductos();
        } catch (e) {
            toast.error('No se pudo subir la foto: ' + (e.response?.data?.error || e.message));
        } finally { setSubiendoFoto(false); }
    };

    // Nombre y código del artículo (se aplican al instante, no esperan al Guardar)
    const [editIdent, setEditIdent] = useState(null);
    const [guardandoIdent, setGuardandoIdent] = useState(false);
    useEffect(() => { setEditIdent(null); }, [form?.proId]);
    const guardarIdentidad = async () => {
        if (!form || !editIdent) return;
        if (!editIdent.descripcion.trim()) return toast.error('Poné el nombre del producto.');
        if (!editIdent.codArticulo.trim()) return toast.error('Poné el código del producto.');
        setGuardandoIdent(true);
        try {
            const { data } = await api.put(`${API}/productos/${form.proId}/identidad`, { descripcion: editIdent.descripcion.trim(), codArticulo: editIdent.codArticulo.trim() });
            toast.success(`✅ Ahora es "${data.data.descripcion}" [${data.data.codArticulo}]`);
            setEditIdent(null);
            setForm(prev => ({ ...prev, descripcion: data.data.descripcion, codArticulo: data.data.codArticulo }));
            loadProductos();
        } catch (e) {
            toast.error('No se pudo cambiar: ' + (e.response?.data?.error || e.message));
        } finally { setGuardandoIdent(false); }
    };
    // Siluetas: leer la carpeta de PDFs de moldes del servidor (TIZADAPRO_MOLDES_DIR)
    const [leyendoCarpeta, setLeyendoCarpeta] = useState(false);
    const leerCarpetaMoldes = async () => {
        setLeyendoCarpeta(true);
        try {
            const { data } = await api.post(`${API}/tizadapro/moldes/procesar-carpeta`);
            const r = data.data;
            if (!r.pdfs) toast.warning(`La carpeta ${r.carpeta} no tiene PDFs.`);
            else if (!r.procesados.length) toast.warning(`Ningún PDF de la carpeta coincide con un molde sin siluetas (${r.pdfs} PDF, ${r.moldesSinSilueta} moldes pendientes).`);
            else toast.success(`✅ Siluetas armadas: ${r.procesados.map(x => `${x.molde} (${x.piezas} piezas)`).join(' · ')}${r.sinCoincidencia.length ? ` · sin coincidencia: ${r.sinCoincidencia.join(', ')}` : ''}`);
            await loadMoldesTp();
        } catch (e) {
            toast.error('No se pudo leer la carpeta: ' + (e.response?.data?.error || e.message));
        } finally { setLeyendoCarpeta(false); }
    };
    // Qué modelo se muestra en la tabla de piezas ('' = todas las piezas del molde)
    const [modeloVista, setModeloVista] = useState('');
    useEffect(() => {
        const entradas = [...(form?.modelos || new Map()).entries()];
        setModeloVista((entradas.find(([, v]) => v.esDefault) || entradas[0] || [''])[0] || '');
    }, [form?.proId, form?.tizadaProMoldeRef]);
    // Piezas donde puede ir un aplique: las de los modelos que se venden (unión), por su nombre
    // genérico (Frente, Cuello…). Si todavía no se marcó ningún modelo, todas las del molde.
    const piezasParaApliques = useMemo(() => {
        if (!moldeSel) return [];
        const vendidos = (moldeSel.modelos || []).filter(m => form?.modelos?.has(m.clave));
        const ids = new Set(vendidos.flatMap(m => m.piezasIds || []));
        const det = (moldeSel.piezasDetalle || []).filter(d => !vendidos.length || ids.has(d.idEnMolde));
        return [...new Set(det.map(d => d.generico || d.nombre))];
    }, [moldeSel, form?.modelos]);
    // [AVÍOS POR TALLE] talles del molde por curva y en orden real: las columnas de la grilla de avíos
    const gruposTalles = useMemo(() => agruparTalles(moldeSel?.talles), [moldeSel]);
    // Técnicas que admiten aplique: las de decoración activas en el paso Técnicas, más Etiqueta (siempre)
    const tecnicasApliqueActivas = useMemo(() => [...AREAS_DECORACION.filter(x => form?.tecnicas?.[x.id]?.on), AREA_APLIQUE_EXTRA], [form?.tecnicas]);

    // ── Encabezado del editor (02/10) ────────────────────────────────────
    // Debajo del nombre: código · familia › etiqueta · origen · precio. Familia y etiqueta eran dos franjas de
    // botones y el origen era el paso 1; ahora son desplegables que se ven como texto con una flechita.
    const claseMeta = (extra = '') => `flex max-w-[240px] items-center rounded-md border px-1.5 py-0.5 text-[12px] font-bold outline-none transition-colors focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15 disabled:cursor-not-allowed disabled:opacity-50 ${extra || 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white'}`;
    const claseInputMeta = 'w-52 rounded-md border border-brand-cyan/40 bg-white px-2 py-0.5 text-[12px] font-bold text-slate-700 outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
    const claseBotonMeta = 'rounded-md bg-brand-cyan px-2 py-0.5 text-[11px] font-bold text-white hover:bg-brand-cyan/90 disabled:opacity-50';
    const valorMeta = (contenido, Icono, claseIcono = 'text-brand-cyan') => (
        <span className="flex min-w-0 items-center gap-1">
            {Icono && <Icono size={13} className={`shrink-0 ${claseIcono}`} aria-hidden="true" />}
            <span className="truncate">{contenido}</span>
            <ChevronDown size={12} className="shrink-0 text-slate-400" aria-hidden="true" />
        </span>
    );
    const cancelarMeta = (alCancelar) => (
        <button type="button" onClick={alCancelar} className="rounded p-0.5 text-slate-400 hover:text-slate-600" title="Cancelar" aria-label="Cancelar">
            <X size={13} />
        </button>
    );

    // Familia: mover acá mueve el artículo de variante en StockArt (se aplica al instante)
    const metaFamilia = () => {
        const cerrarNueva = () => { setShowNuevaFamilia(false); setNuevaFamiliaNombre(''); };
        if (showNuevaFamilia) return (
            <span className="inline-flex items-center gap-1">
                <input value={nuevaFamiliaNombre} onChange={e => setNuevaFamiliaNombre(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') crearFamiliaNueva(); if (e.key === 'Escape') cerrarNueva(); }}
                    placeholder="Familia nueva (ej. Medias)" aria-label="Nombre de la familia nueva" className={claseInputMeta} />
                <button type="button" onClick={crearFamiliaNueva} disabled={creandoFamilia} className={claseBotonMeta}>{creandoFamilia ? '…' : 'Crear'}</button>
                {cancelarMeta(cerrarNueva)}
            </span>
        );
        const sinClasificar = form.categoria === 'Prendas';
        const familias = [...familiasCat].sort((a, b) => String(a.Articulo).localeCompare(String(b.Articulo), 'es'));
        return (
            <Selector value={form.codStock} disabled={moviendoFamilia} anchoLista={260} sinFlecha aria-label="Familia"
                title={sinClasificar ? 'Sin clasificar: elegí la familia del producto. Se aplica al instante.' : 'Familia (tipo de prenda). Se aplica al instante.'}
                onChange={e => (e.target.value === '__nueva__' ? setShowNuevaFamilia(true) : moverAFamilia(e.target.value))}
                claseBoton={claseMeta(sinClasificar ? 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300' : '')}
                renderValor={o => (sinClasificar
                    ? valorMeta(`${o?.texto || form.categoria} · sin clasificar`, TriangleAlert, 'text-amber-500')
                    : valorMeta(o?.contenido ?? form.categoria))}>
                <optgroup label="Familias">
                    {familias.map(f => <option key={f.CodStock} value={f.CodStock}>{f.Articulo}</option>)}
                    {!familias.some(f => f.CodStock === form.codStock) && <option value={form.codStock}>{form.categoria || 'Sin familia'}</option>}
                </optgroup>
                <option value="__nueva__">+ Nueva familia</option>
            </Selector>
        );
    };

    // Etiqueta: para qué es el producto (Básquet, Fútbol…), el nivel entre la familia y el producto en la
    // lista. Asignar, crear y renombrar se aplican al instante.
    const metaEtiqueta = () => {
        const prod = productos.find(p => p.ProIdProducto === form.proId);
        const etqId = prod?.EtiquetaID || null;
        const etqNombre = prod?.Etiqueta || '';
        if (showNuevaEtiqueta) {
            const cerrarNueva = () => { setShowNuevaEtiqueta(false); setNuevaEtiquetaNombre(''); };
            return (
                <span className="inline-flex items-center gap-1">
                    <input value={nuevaEtiquetaNombre} onChange={e => setNuevaEtiquetaNombre(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') crearYAsignarEtiqueta(); if (e.key === 'Escape') cerrarNueva(); }}
                        placeholder="Etiqueta nueva (ej. Hándbol)" aria-label="Nombre de la etiqueta nueva" className={claseInputMeta} />
                    <button type="button" onClick={crearYAsignarEtiqueta} disabled={guardandoEtiqueta} className={claseBotonMeta}>{guardandoEtiqueta ? '…' : 'Crear y asignar'}</button>
                    {cancelarMeta(cerrarNueva)}
                </span>
            );
        }
        if (etqId && renombreEtiqueta !== null) return (
            <span className="inline-flex items-center gap-1">
                <input value={renombreEtiqueta} onChange={e => setRenombreEtiqueta(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') renombrarEtiqueta(etqId); if (e.key === 'Escape') setRenombreEtiqueta(null); }}
                    aria-label="Nombre nuevo de la etiqueta" className={claseInputMeta} />
                <button type="button" onClick={() => renombrarEtiqueta(etqId)} disabled={guardandoEtiqueta} className={claseBotonMeta}>{guardandoEtiqueta ? '…' : 'Guardar nombre'}</button>
                {cancelarMeta(() => setRenombreEtiqueta(null))}
            </span>
        );
        const etiquetas = [...etiquetasCat].sort((a, b) => String(a.Nombre).localeCompare(String(b.Nombre), 'es'));
        return (
            <>
                <Selector value={etqId ?? ''} disabled={guardandoEtiqueta} anchoLista={240} sinFlecha aria-label="Etiqueta"
                    title="Etiqueta: para qué es el producto (Básquet, Fútbol…). Agrupa la lista: familia › etiqueta › producto. Se aplica al instante."
                    onChange={e => {
                        const v = e.target.value;
                        if (v === '__nueva__') { setShowNuevaEtiqueta(true); setRenombreEtiqueta(null); }
                        else asignarEtiqueta(v ? Number(v) : null);
                    }}
                    claseBoton={claseMeta(etqId ? '' : 'border-transparent text-slate-400 hover:border-slate-200 hover:bg-white')}
                    renderValor={o => valorMeta(o?.contenido ?? 'Sin etiqueta', etqId ? Tag : null, 'text-brand-magenta')}>
                    <option value="">Sin etiqueta</option>
                    <optgroup label="Etiquetas">
                        {etiquetas.map(e => <option key={e.EtiquetaID} value={e.EtiquetaID}>{e.Nombre}</option>)}
                        {etqId && !etiquetas.some(e => e.EtiquetaID === etqId) && <option value={etqId}>{etqNombre}</option>}
                    </optgroup>
                    <option value="__nueva__">+ Nueva etiqueta</option>
                </Selector>
                {etqId && (
                    <button type="button" onClick={() => { setRenombreEtiqueta(etqNombre); setShowNuevaEtiqueta(false); }}
                        className="rounded p-0.5 text-slate-300 hover:text-brand-cyan" title={`Renombrar "${etqNombre}" en todos los productos que la tienen`} aria-label="Renombrar la etiqueta">
                        <Pencil size={12} />
                    </button>
                )}
            </>
        );
    };

    // Origen: de dónde sale la prenda. Casi siempre es Confeccionado por USER. Se guarda con "Guardar".
    const metaOrigen = () => {
        const og = ORIGENES.find(o => o.id === form.origenTipo) || ORIGENES[2];
        return (
            <Selector value={form.origenTipo} onChange={e => setF({ origenTipo: e.target.value })} anchoLista={320} sinFlecha aria-label="Origen"
                title="De dónde sale la prenda. Se guarda con «Guardar»." claseBoton={claseMeta()} renderValor={() => valorMeta(og.t, og.Icono)}>
                {ORIGENES.map(o => <option key={o.id} value={o.id} descripcion={o.d}>{o.t}</option>)}
            </Selector>
        );
    };

    // ── Piezas comunes de los pasos (02/10) ──────────────────────────────
    // Para que los pasos se vean igual: secciones con el título y la ayuda arriba, las elecciones como
    // tarjetas en una grilla a todo el ancho con un círculo que marca la elegida, y los campos con el mismo
    // borde y tamaño. Empezó en Producción principal (antes las áreas ocupaban poco más de la mitad del
    // ancho y el molde, todo) y sigue en Precio y cantidades.
    const tituloSeccion = (titulo, ayuda, extra = null) => (
        <div className="mb-3">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{titulo}{extra}</p>
            {ayuda && <p className="text-[11px] text-slate-400 mt-0.5">{ayuda}</p>}
        </div>
    );
    const tarjetaOpcion = ({ id, sel, onClick, Icono, titulo, detalle }) => (
        <button key={id} type="button" role="radio" aria-checked={sel} onClick={onClick}
            className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${sel ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
            {Icono && <Icono size={20} className="mt-0.5 shrink-0 text-brand-cyan" aria-hidden="true" />}
            <span className="min-w-0 flex-1">
                <span className="block font-black text-sm text-slate-800">{titulo}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">{detalle}</span>
            </span>
            <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${sel ? 'border-emerald-500 bg-emerald-500 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300'}`} aria-hidden="true" />
        </button>
    );
    // Todas en una fila de columnas iguales (3 o 4 opciones); en celular, una debajo de otra
    const claseOpciones = 'grid gap-2 md:grid-flow-col md:auto-cols-fr';
    // Campo de número o texto de los pasos (el foco, como el de los desplegables de la página)
    const claseCampo = 'border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200';
    const claseEtiquetaCampo = 'text-[11px] font-bold text-slate-500';
    // Campo dentro de un renglón de una lista (accesorio, aplique, avío, nota…): un poco más bajo
    const claseCampoFila = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200';
    // Etiqueta de la tarjeta de vista previa (Revisar y publicar): todas iguales, sin un color por área
    const claseChipPrevia = 'inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600';
    // "+ Agregar…" al pie de una lista, a todo el ancho
    const claseAgregar = 'border border-dashed border-slate-300 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:border-slate-400 w-full disabled:opacity-50';

    // Precio (02/10): antes tenía su paso; ahora se escribe acá, en la línea de abajo del nombre. Se ve como
    // texto ("sin precio" si está vacío) hasta que se lo toca. Se guarda con "Guardar", como antes.
    const metaPrecio = () => {
        const conPrecio = form.precio !== '' && form.precio != null;
        const ayuda = form.esCombo ? 'Precio cerrado del paquete completo: incluye todo lo marcado “incluido” en la composición.'
            : form.politica === 'PAQUETE' ? 'Es el precio cerrado DEL PAQUETE completo (las técnicas incluidas no generan línea aparte).'
            : 'Precio base sin servicios: bordado, TPU y DTF se suman al cotizar según el catálogo.';
        return (
            <span className="inline-flex items-center" title={`${ayuda} Se guarda con «Guardar».`}>
                {conPrecio && <span className="pl-1 text-[12px] font-bold text-slate-600" aria-hidden="true">{simboloMoneda(form.moneda)}</span>}
                <input type="number" step="0.1" min="0" value={form.precio} onChange={e => setF({ precio: e.target.value })}
                    placeholder="sin precio" aria-label={form.esCombo ? 'Precio del paquete' : 'Precio del producto'}
                    className="w-24 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[12px] font-bold text-slate-600 outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 hover:border-slate-200 hover:bg-white focus:border-brand-cyan focus:bg-white focus:ring-2 focus:ring-brand-cyan/15 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                {conPrecio && (
                    <Selector value={form.moneda} onChange={e => setF({ moneda: e.target.value })} sinFlecha aria-label="Moneda" anchoLista={120}
                        claseBoton={claseMeta()} renderValor={o => valorMeta(o?.contenido ?? form.moneda)}>
                        <option>UYU</option><option>USD</option>
                    </Selector>
                )}
            </span>
        );
    };

    // Guardar (02/10): sin emoji, y resaltado cuando hay cambios sin guardar. Va arriba y en el último paso.
    const botonGuardar = (extra = '') => (
        <button type="button" onClick={guardar} disabled={saving} title={hayCambios ? 'Hay cambios sin guardar' : 'No hay cambios sin guardar'}
            className={`inline-flex min-w-[11rem] items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 ${hayCambios
                ? 'border-brand-cyan bg-brand-cyan text-white hover:bg-brand-cyan/90'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'} ${extra}`}>
            <Save size={16} aria-hidden="true" />
            {saving ? 'Guardando…' : hayCambios ? 'Guardar cambios' : 'Guardar'}
        </button>
    );

    // ── render ───────────────────────────────────────────────────────────
    // Todo el ancho de la pantalla (02/10): con max-w-7xl centrado quedaban franjas vacías a los
    // costados en pantallas anchas. Los párrafos y los formularios angostos conservan su ancho máximo.
    return (
        <div className="p-6">
            {/* Header. Ícono (02/10): Lucide en brand-cyan y sin fondo; antes Font Awesome sobre un cuadrado con degradé violeta. */}
            <div className="flex items-center gap-3 mb-2">
                <SlidersHorizontal size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Configurar Productos</h1>
                    <p className="text-sm text-slate-400">Especificaciones, terminaciones y precios de todo lo que se vende armado</p>
                </div>
            </div>

            {/* Navegación (02/10): una sola fila de pestañas, con el estilo de Servicio Técnico (la elegida
                subrayada en brand-cyan). Antes había dos niveles, Prendas y Combos / EcoUV y abajo cinco
                pestañas, y se veían igual que los filtros y los pasos del editor. En celular, un desplegable con
                la pestaña actual. En la misma fila, a la derecha, los filtros de la lista (02/10).
                La línea de abajo es un fondo de 1 px a la altura de las pestañas (2.5rem + 2 px del subrayado): así
                cruza toda la fila, también debajo de los filtros, y si los filtros no entran y bajan a otra fila, la
                línea queda bajo las pestañas. Con un borde, el subrayado desbordaba 1 px y aparecía una barra de scroll. */}
            <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 sm:bg-[linear-gradient(#e2e8f0,#e2e8f0)] sm:bg-no-repeat sm:bg-[length:100%_1px] sm:bg-[position:0_calc(2.5rem_+_1px)]">
                <div className="w-full sm:hidden">
                    <Selector value={vista} onChange={e => cambiarVista(e.target.value)} aria-label="Sección" anchoLista={260}>
                        <optgroup label="Productos">
                            {PESTANAS_PRODUCTOS.map(([id, label]) => (
                                <option key={id} value={id}>{label}{cuentaPestana(id) != null ? ` · ${cuentaPestana(id)}` : ''}</option>
                            ))}
                        </optgroup>
                        <optgroup label="Catálogos">
                            {PESTANAS_CATALOGOS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </optgroup>
                    </Selector>
                </div>
                <div className="hidden sm:flex items-center overflow-x-auto no-scrollbar">
                    {PESTANAS_PRODUCTOS.map(([id, label]) => pestana(id, label, false))}
                    <span className="mx-3 h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
                    {PESTANAS_CATALOGOS.map(([id, label]) => pestana(id, label, true))}
                </div>
                {/* Filtros de la lista (02/10): los contadores son los botones del filtro por estado (antes eran un
                    resumen arriba y se repetían como botones en la lista) y el área va en el desplegable propio
                    (el nativo se cortaba: "Todas l…"). Tocar el filtro prendido vuelve a Todos. */}
                {(vista === 'confeccionados' || vista === 'combos') && (
                    <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center sm:justify-end gap-2">
                        {FILTROS_ESTADO.map(f => {
                            const on = filtroEstado === f.id;
                            return (
                                <button key={f.id || 'todos'} type="button" aria-pressed={on}
                                    onClick={() => setFiltroEstado(on && f.id ? '' : f.id)}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${on ? f.on : f.off}`}>
                                    {f.label}
                                    <span className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-black ${on ? 'bg-white/25 text-white' : f.cuenta}`}>{conteoEstados[f.id]}</span>
                                </button>
                            );
                        })}
                        {vista === 'confeccionados' && areasFiltro.length > 0 && (
                            <Selector filtro value={filtroArea} onChange={e => setFiltroArea(e.target.value)} anchoLista={260}
                                title="Ver solo los productos que produce un área (producción principal)">
                                <option value="">Todas las áreas</option>
                                {areasFiltro.map(a => <option key={a.AreaID} value={a.AreaID}>{capitalizar(a.Nombre)}</option>)}
                            </Selector>
                        )}
                    </div>
                )}
            </div>

            {/* ══════════ ECOUV (embebida, mismos modales) ══════════ */}
            {vista === 'ecouv' && (
                <div>
                    {ecouvStats && (
                        <div className="flex flex-wrap gap-3 mb-5">
                            <span className="bg-cyan-50 text-cyan-700 border border-cyan-200 px-3 py-1.5 rounded-full text-xs font-bold">{ecouvStats.variantes} variantes visibles</span>
                            <span className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-bold">{ecouvStats.articulos} artículos</span>
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full text-xs font-bold">{ecouvStats.terminaciones} terminaciones activas</span>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        <ToolCard Icono={Boxes} title="Variantes y Artículos"
                            subtitle="Lonas, Canvas, Vinilos, Cuadros, Pasacalles... Crear variantes, cambiar el tipo, ocultar del portal y mover artículos."
                            footer="Editor StockArt · grupo 1.3" onClick={() => setEcouvModal('variantes')} />
                        <ToolCard Icono={Scissors} title="Terminaciones"
                            subtitle="Catálogo con manera de aplicación, precio directo y en qué materiales se ofrece cada una."
                            footer="Única puerta de la matriz material ↔ terminación" onClick={() => setEcouvModal('terminaciones')} />
                        <ToolCard Icono={Box} title="Nuevo Producto Terminado"
                            subtitle="Alta completa en un paso: datos, ficha de producción, terminaciones incluidas y precio cerrado."
                            footer="Artículo + ficha + precio juntos" onClick={() => setEcouvModal('nuevo-pt')} />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-6">
                        <Info size={12} className="inline -mt-0.5 mr-1.5" aria-hidden="true" />
                        Es la misma Configuración ECOUV de siempre — la página del sector (/area/ecouv/config) sigue funcionando igual.
                    </p>
                    {ecouvModal === 'variantes' && <StockArtEditModal isOpen={true} initialGrupo={GRUPO_ECOUV} onClose={() => { setEcouvModal(null); loadEcouvStats(); }} />}
                    {ecouvModal === 'terminaciones' && <TerminacionesEcouvModal isOpen={true} onClose={() => { setEcouvModal(null); loadEcouvStats(); }} />}
                    {ecouvModal === 'nuevo-pt' && <NuevoProductoTerminadoModal isOpen={true} onClose={() => setEcouvModal(null)} onCreated={loadEcouvStats} />}
                </div>
            )}

            {/* ══════════ PRENDAS Y COMBOS, Y CATÁLOGOS ══════════ */}
            {vista !== 'ecouv' && (
                <div>
                    {(vista === 'confeccionados' || vista === 'combos') && (
                        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] 2xl:grid-cols-[400px_1fr] gap-5 items-start">
                            {/* ── Lista ── */}
                            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                                <div className="p-3 border-b border-slate-100 space-y-2">
                                    <div className="flex gap-2">
                                        <input value={busca} onChange={e => setBusca(e.target.value)}
                                            placeholder={vista === 'combos' ? '🔍 Buscar combo…' : '🔍 Buscar producto…'}
                                            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                        <button onClick={() => setShowNuevo(v => !v)} title={vista === 'combos' ? 'Nuevo combo' : 'Nuevo producto'}
                                            className="bg-slate-800 text-white rounded-lg px-3 text-sm font-bold hover:bg-slate-700">+</button>
                                    </div>
                                    {showNuevo && (
                                        <div className="space-y-2 pt-1">
                                            <div className="flex gap-2">
                                                <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && crearProducto()}
                                                    placeholder={vista === 'combos' ? 'Nombre (ej. Combo Short + Medias)' : 'Nombre (ej. Gorro de lana con TPU)'}
                                                    className="flex-1 border border-indigo-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" autoFocus />
                                                <button onClick={crearProducto} disabled={creando}
                                                    className="bg-indigo-600 text-white rounded-lg px-3 text-xs font-bold hover:bg-indigo-500 disabled:opacity-50">
                                                    {creando ? '…' : 'Crear'}
                                                </button>
                                            </div>
                                            {vista === 'combos' && <p className="text-[10px] text-slate-400">El combo es su propia categoría de artículos: le agregás productos y a cada uno sus servicios, con precio cerrado del paquete.</p>}
                                        </div>
                                    )}
                                </div>
                                <div className="max-h-[62vh] overflow-y-auto">
                                    {loading && <div className="p-6 text-center text-slate-400 text-sm">Cargando…</div>}

                                    {/* ── Pestaña Productos Confeccionados: agrupada por familia ── */}
                                    {vista === 'confeccionados' && <>
                                        {!loading && confeccionadosFiltrados.length === 0 && (
                                            <div className="p-6 text-center text-slate-400 text-sm">Sin resultados</div>
                                        )}
                                        {gruposLista.map(g => {
                                            const cerrado = !busca && grupoAbierto !== g.nombre;
                                            const publicados = g.items.filter(p => p.Estado === 'PUBLICADO').length;
                                            return (
                                                <div key={g.nombre}>
                                                    <button onClick={() => toggleGrupo(g.nombre)} aria-expanded={!cerrado}
                                                        className={`w-full sticky top-0 z-10 flex items-center gap-2 px-3.5 py-2 border-y text-left ${g.nombre === 'Sin clasificar' ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
                                                        <i className={`fa-solid fa-chevron-right text-[9px] transition-transform duration-200 motion-reduce:transition-none ${cerrado ? '' : 'rotate-90'} ${g.nombre === 'Sin clasificar' ? 'text-amber-500' : 'text-slate-400'}`}></i>
                                                        {g.nombre === 'Sin clasificar' && <i className="fa-solid fa-triangle-exclamation text-[9px] text-amber-500"></i>}
                                                        <span className={`text-[11px] font-black uppercase tracking-wider ${g.nombre === 'Sin clasificar' ? 'text-amber-700' : 'text-slate-500'}`}>{g.nombre}</span>
                                                        <span className="text-[10px] font-bold text-slate-400">{g.items.length}</span>
                                                        {publicados > 0 && <span className="ml-auto text-[9px] font-black text-emerald-600">{publicados} pub.</span>}
                                                    </button>
                                                    {/* Abre y cierra con animación (02/10): la fila de la grilla va de 0 al alto del contenido y la
                                                        flecha gira. El contenido queda montado; cerrado es invisible, así Tab no entra ahí. */}
                                                    <div className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none ${cerrado ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
                                                        <div className={`min-h-0 overflow-hidden divide-y divide-slate-50 transition-[visibility] duration-300 motion-reduce:transition-none ${cerrado ? 'invisible' : 'visible'}`}>
                                                            {g.nodos.map(n => {
                                                                if (n.tipo === 'item') return filaProducto(n.p);
                                                                // Nodo etiqueta (Básquet, Fútbol…): se despliega con sus productos.
                                                                // Abierto si lo abrió el usuario, si hay búsqueda, o si contiene el producto abierto.
                                                                const clave = `${g.nombre}|${n.id}`;
                                                                const abierta = !!busca || etiquetasAbiertas.has(clave) || n.items.some(p => p.ProIdProducto === form?.proId);
                                                                const pubEt = n.items.filter(p => p.Estado === 'PUBLICADO').length;
                                                                return (
                                                                    <div key={`etq-${n.id}`}>
                                                                        <button onClick={() => toggleEtiqueta(clave)} aria-expanded={abierta}
                                                                            className="w-full text-left pl-2 pr-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2 border-l-4 border-transparent">
                                                                            <i className={`fa-solid fa-chevron-right text-[9px] text-slate-400 w-3 text-center transition-transform duration-200 motion-reduce:transition-none ${abierta ? 'rotate-90' : ''}`}></i>
                                                                            {/* Etiqueta en brand-magenta (02/10, antes índigo), con el ícono de Lucide */}
                                                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-magenta/10 text-brand-magenta text-[12px] font-black">
                                                                                <Tag size={11} aria-hidden="true" />{n.nombre}
                                                                            </span>
                                                                            <span className="text-[11px] text-slate-400">{n.items.length} producto{n.items.length === 1 ? '' : 's'}</span>
                                                                            {pubEt > 0 && <span className="ml-auto text-[9px] font-black text-emerald-600">{pubEt} pub.</span>}
                                                                        </button>
                                                                        {/* Misma animación que la familia (02/10) */}
                                                                        <div className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none ${abierta ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                                                                            <div className={`min-h-0 overflow-hidden ml-5 border-l-2 border-brand-magenta/20 divide-y divide-slate-50 transition-[visibility] duration-300 motion-reduce:transition-none ${abierta ? 'visible' : 'invisible'}`}>
                                                                                {n.items.map(p => filaProducto(p, true))}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>}

                                    {/* ── Pestaña Combos y Promos: lista simple, sin agrupar (ya son todos "combo") ── */}
                                    {vista === 'combos' && <>
                                        {!loading && combosFiltrados.length === 0 && (
                                            <div className="p-6 text-center text-slate-400 text-sm">
                                                Sin combos todavía — creá el primero con “+”.
                                            </div>
                                        )}
                                        <div className="divide-y divide-slate-50">
                                            {/* Misma fila que la de los confeccionados (filaProducto) */}
                                            {combosFiltrados.map(p => filaProducto(p))}
                                        </div>
                                    </>}
                                </div>
                            </div>

                            {/* ── Editor ── */}
                            <div className="bg-white rounded-2xl border border-slate-200 min-h-[420px]">
                                {fichaLoading && <div className="p-10 text-center text-slate-400">Cargando ficha…</div>}
                                {!fichaLoading && !form && (
                                    <div className="p-10 text-center text-slate-400">
                                        <i className="fa-solid fa-hand-pointer text-2xl mb-3 block"></i>
                                        Elegí {vista === 'combos' ? 'un combo' : 'un producto'} de la lista (o creá uno con “+”) para configurarlo.
                                    </div>
                                )}
                                {!fichaLoading && form && (
                                    <div>
                                        {/* Encabezado del editor (02/10): foto, nombre y, abajo, código · familia › etiqueta ·
                                            origen · precio (las funciones meta* de arriba). */}
                                        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 flex-wrap">
                                            {!form.esCombo && (
                                                <label className={`relative cursor-pointer group ${subiendoFoto ? 'opacity-50 pointer-events-none' : ''}`} title={form.imagen ? 'Cambiar la foto del producto' : 'Subir la foto del producto (la ve el cliente en el pedido web y en la solicitud)'}>
                                                    <Thumb src={form.imagen} size={56} rounded="rounded-xl" icon="fa-shirt" />
                                                    <span className="absolute inset-0 rounded-xl bg-slate-900/55 text-white text-[10px] font-black flex items-center justify-center opacity-0 group-hover:opacity-100 text-center leading-tight px-1">{subiendoFoto ? '…' : (form.imagen ? 'Cambiar foto' : 'Subir foto')}</span>
                                                    <input type="file" accept="image/*" className="hidden" disabled={subiendoFoto} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) subirFoto(file); }} />
                                                </label>
                                            )}
                                            <div className="flex-1 min-w-[220px]">
                                                {editIdent ? (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <input value={editIdent.descripcion} maxLength={100} autoFocus placeholder="Nombre del producto"
                                                            onChange={e => setEditIdent({ ...editIdent, descripcion: e.target.value })}
                                                            onKeyDown={e => { if (e.key === 'Enter') guardarIdentidad(); if (e.key === 'Escape') setEditIdent(null); }}
                                                            className="min-w-[240px] flex-1 border border-indigo-300 rounded-lg px-2.5 py-1.5 text-sm font-black text-slate-800" />
                                                        <input value={editIdent.codArticulo} maxLength={20} placeholder="Código"
                                                            onChange={e => setEditIdent({ ...editIdent, codArticulo: e.target.value })}
                                                            onKeyDown={e => { if (e.key === 'Enter') guardarIdentidad(); if (e.key === 'Escape') setEditIdent(null); }}
                                                            className="w-32 border border-indigo-300 rounded-lg px-2.5 py-1.5 text-sm font-mono" />
                                                        <button onClick={guardarIdentidad} disabled={guardandoIdent}
                                                            className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50">{guardandoIdent ? '…' : 'Guardar nombre y código'}</button>
                                                        <button onClick={() => setEditIdent(null)} className="text-slate-400 text-xs px-1" title="Cancelar">×</button>
                                                        <span className="w-full text-[10px] text-slate-400">El código solo se puede cambiar si el producto todavía no tiene pedidos. Se aplica al instante.</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="font-black text-slate-800 flex items-center gap-2">
                                                            {form.descripcion}
                                                            <button type="button" onClick={() => setEditIdent({ descripcion: form.descripcion, codArticulo: form.codArticulo })}
                                                                className="rounded p-0.5 text-slate-300 hover:text-brand-cyan" title="Cambiar el nombre o el código del producto" aria-label="Cambiar el nombre o el código">
                                                                <Pencil size={13} />
                                                            </button>
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px] text-slate-400">
                                                            <span className="font-mono text-[11px]">{form.codArticulo}</span>
                                                            <span className="text-slate-300" aria-hidden="true">·</span>
                                                            {/* Con el mismo margen que los desplegables, para que los "·" queden parejos */}
                                                            {form.esCombo ? <span className="px-1.5 text-[12px] font-bold text-slate-600">{form.categoria || 'sin categoría'}</span> : <>
                                                                {metaFamilia()}
                                                                <span className="text-slate-300" aria-hidden="true">›</span>
                                                                {metaEtiqueta()}
                                                                <span className="text-slate-300" aria-hidden="true">·</span>
                                                                {metaOrigen()}
                                                            </>}
                                                            <span className="text-slate-300" aria-hidden="true">·</span>
                                                            {metaPrecio()}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-[11px] font-black ${form.estado === 'PUBLICADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {form.estado === 'PUBLICADO' ? '● PUBLICADO' : '○ BORRADOR'}
                                            </span>
                                            <button type="button" onClick={() => setCopiando(true)}
                                                title={`Crear una copia de este ${form.esCombo ? 'combo' : 'producto'} con otro nombre (sin precio y en borrador)`}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-500 transition-colors hover:border-brand-cyan hover:text-brand-cyan">
                                                <Copy size={15} aria-hidden="true" /> Copiar
                                            </button>
                                            {botonGuardar()}
                                            {copiando && (
                                                <CopiarProductoModal form={form} productos={productos} hayCambios={hayCambios}
                                                    onClose={() => setCopiando(false)}
                                                    onCopiado={async (data) => {
                                                        setCopiando(false);
                                                        toast.success(`✅ Copia creada: "${data.descripcion}" [${data.codArticulo}] — sin precio, en borrador`);
                                                        await loadProductos();
                                                        abrirProducto(data.proIdProducto);
                                                    }} />
                                            )}
                                        </div>

                                        {/* Producto del local (02/10, antes en el paso Origen): solo si sale del local o lo elige el
                                            cliente. De qué producto sale y si se valida el stock. */}
                                        {!form.esCombo && (form.origenTipo === 'LOCAL' || form.origenTipo === 'AMBOS') && (
                                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
                                                {origenSel && !eligiendoLocal ? (
                                                    <div className="flex items-center gap-2.5 border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white">
                                                        <Thumb src={origenSel.Imagen} size={34} />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-[11px] font-bold text-slate-400">Sale del producto del local</div>
                                                            <div className="truncate text-sm">
                                                                <span className="font-bold text-slate-700">{origenSel.Descripcion}</span>
                                                                <span className="text-[11px] text-slate-400 ml-2">{origenSel.variantes.length} variantes{origenSel.ubicacion?.pasillo ? ` · pasillo ${origenSel.ubicacion.pasillo}` : ''}</span>
                                                            </div>
                                                        </div>
                                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded flex-shrink-0 ${origenSel.totalStock == null ? 'bg-slate-100 text-slate-400' : origenSel.totalStock > 5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {origenSel.totalStock == null ? 's/d' : `${origenSel.totalStock} en el local`}
                                                        </span>
                                                        <button type="button" onClick={() => setEligiendoLocal(true)} className="text-xs font-bold text-brand-cyan hover:underline underline-offset-2 flex-shrink-0">Cambiar</button>
                                                    </div>
                                                ) : (
                                                    <div className="border border-slate-200 rounded-xl p-3.5 bg-white">
                                                        <p className="text-[11px] font-bold text-slate-400 mb-2">
                                                            Elegí de qué producto del local sale
                                                            {!stockDisponible && <span className="text-amber-600 ml-2">⚠ stock del local sin conexión — se muestra la lista igual</span>}
                                                        </p>
                                                        <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                                                            {locales.map(l => (
                                                                <div key={l.ProIdProducto} onClick={() => { setF({ origenProIdProducto: l.ProIdProducto }); setEligiendoLocal(false); }}
                                                                    className={`flex items-center gap-2.5 border rounded-lg px-3 py-2 cursor-pointer text-sm ${form.origenProIdProducto === l.ProIdProducto ? 'border-emerald-500 bg-white shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                                                    <Thumb src={l.Imagen} size={34} />
                                                                    <div className="flex-1 min-w-0">
                                                                        <span className="font-bold text-slate-700">{l.Descripcion}</span>
                                                                        <span className="text-[11px] text-slate-400 ml-2">{l.variantes.length} variantes{l.ubicacion?.pasillo ? ` · pasillo ${l.ubicacion.pasillo}` : ''}</span>
                                                                    </div>
                                                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded flex-shrink-0 ${l.totalStock == null ? 'bg-slate-100 text-slate-400' : l.totalStock > 5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                        {l.totalStock == null ? 's/d' : `${l.totalStock} en el local`}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {locales.length === 0 && <div className="text-xs text-slate-400 py-3">No hay productos del local con variantes cargadas.</div>}
                                                        </div>
                                                        {origenSel && (
                                                            <button type="button" onClick={() => setEligiendoLocal(false)} className="mt-2 text-xs font-bold text-slate-400 hover:text-slate-600">Cancelar</button>
                                                        )}
                                                    </div>
                                                )}
                                                {/* Validar stock — solo tiene sentido si el origen toca stock del local */}
                                                <div className="flex items-center gap-3 border border-slate-200 rounded-xl p-3.5 bg-white">
                                                    <Toggle on={form.validarStock} onChange={v => setF({ validarStock: v })} />
                                                    <div>
                                                        <div className="font-bold text-sm text-slate-700">Validar stock del local al pedir</div>
                                                        <div className="text-xs text-slate-400">Apagalo solo como contingencia: si se cae el sistema de stock, la venta sigue funcionando.</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Pasos (02/10): el elegido en brand-cyan, y cada uno con su estado: ✓ si tiene lo suyo, punto
                                            ámbar si le falta algo para guardar o publicar (el motivo en el globito), el número si todavía
                                            no tiene nada. Las reglas están en estadoPasos. Se reparten todo el ancho: el primero pegado al
                                            borde izquierdo, el último al derecho y el espacio parejo entre ellos; si no entran, bajan de renglón. */}
                                        {/* En combos, con solo dos pasos, cada uno ocupa la mitad (pegados a los bordes quedaban muy lejos) */}
                                        <nav aria-label="Pasos del producto" className={`flex flex-wrap gap-1.5 px-5 pt-4 ${form.esCombo ? '' : 'justify-between'}`}>
                                            {pasos.map(s => {
                                                const on = paso === s.id;
                                                const est = estadoPasos[s.id];
                                                const motivo = est?.estado === 'falta' ? `Falta: ${est.motivos.join(' · ')}`
                                                    : s.id === 'resumen' ? (est?.estado === 'ok' ? 'Publicado' : 'Borrador')
                                                    : est?.estado === 'ok' ? 'Completo' : 'Sin cargar';
                                                return (
                                                    <button key={s.id} type="button" onClick={() => setPaso(s.id)} aria-current={on ? 'step' : undefined} title={motivo}
                                                        className={`flex items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${form.esCombo ? 'flex-1 justify-center' : ''} ${on ?'bg-brand-cyan/10 text-brand-cyan ring-1 ring-inset ring-brand-cyan/30' : 'text-slate-500 hover:bg-slate-100'}`}>
                                                        <span className={`relative w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${est?.estado === 'ok' ? 'bg-emerald-100 text-emerald-700' : est?.estado === 'falta' ? 'bg-amber-100 text-amber-700' : on ? 'bg-brand-cyan text-white' : 'bg-slate-200 text-slate-500'}`}>
                                                            {est?.estado === 'ok' ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : s.n}
                                                            {est?.estado === 'falta' && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden="true" />}
                                                        </span>
                                                        {s.label}
                                                        <span className="sr-only"> ({motivo})</span>
                                                    </button>
                                                );
                                            })}
                                        </nav>

                                        {/* Contenido del paso: se anima al cambiar de paso (contenidoPasoRef) */}
                                        <div ref={contenidoPasoRef} className="p-5">
                                            {/* ── PASO PRODUCCIÓN PRINCIPAL (F1) ── */}
                                            {paso === 'principal' && (() => {
                                                const areaSel = areasPrincipales.find(a => a.AreaID === form.tecnicaPrincipal);
                                                const mats = materialesArea[form.tecnicaPrincipal] || [];
                                                const sinMolde = form.molde === 'NO' || (form.molde === 'OPCIONAL' && !form.tizadaProMoldeRef);
                                                const cambiarArea = (areaId) => {
                                                    // La técnica principal va como técnica obligatoria e incluida; la anterior se apaga
                                                    const tecnicas = { ...form.tecnicas };
                                                    AREAS_PRINCIPAL.forEach(a => { if (tecnicas[a] && a !== areaId) tecnicas[a] = { ...tecnicas[a], on: false }; });
                                                    tecnicas[areaId] = { ...(tecnicas[areaId] || { modo: 'LIBRE' }), on: true, obligatorio: true, cobro: 'INCLUIDA' };
                                                    setF({ tecnicaPrincipal: areaId, tecnicas, molde: areaId === 'SB' ? 'OBLIGATORIO' : (form.molde === 'OBLIGATORIO' ? 'OPCIONAL' : form.molde), telas: new Map() });
                                                };
                                                return (
                                                <div className="space-y-4">
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Área que lo produce', 'Es la producción principal: la que imprime la tela o el material. Corte, costura y decoración se suman en "Técnicas".')}
                                                        <div role="radiogroup" aria-label="Área que lo produce" className={claseOpciones}>
                                                            {areasPrincipales.filter(a => AREAS_PRINCIPAL.includes(a.AreaID) || a.AreaID === form.tecnicaPrincipal).map(a => tarjetaOpcion({
                                                                id: a.AreaID, sel: form.tecnicaPrincipal === a.AreaID, onClick: () => cambiarArea(a.AreaID),
                                                                Icono: areaMeta(a.AreaID).Icono || Factory, titulo: capitalizar(a.Nombre), detalle: `área ${a.AreaID} · órdenes ${a.CodOrden}-`,
                                                            }))}
                                                        </div>
                                                        {!areasPrincipales.length && <p className="text-xs text-amber-600 font-bold">No se pudieron leer las áreas (falta docs/migrations/configurador_f1_produccion_principal.sql en esta base o ConfigMapeoERP vacía).</p>}
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Molde de TizadaPro', form.molde !== 'NO' ? 'El molde se vincula en el paso "Molde, telas y apliques".' : 'Sin molde: el cliente manda el archivo a la medida fija.')}
                                                        <div role="radiogroup" aria-label="Molde de TizadaPro" className={claseOpciones}>
                                                            {MOLDE_OPCIONES.map(([v, t, desc]) => tarjetaOpcion({ id: v, sel: form.molde === v, onClick: () => setF({ molde: v }), titulo: t, detalle: desc }))}
                                                        </div>
                                                    </div>

                                                    {form.molde !== 'OBLIGATORIO' && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {/* Lo obligatorio va en ámbar, como el punto de "falta" de los pasos (antes en rojo) */}
                                                            {tituloSeccion('Medida fija del producto', 'El archivo que manda el cliente tiene que medir exactamente esto. Ej.: windflag pluma 2,8 m → 0,70 × 2,80.',
                                                                form.molde === 'OPCIONAL' && form.tizadaProMoldeRef
                                                                    ? <span className="normal-case font-bold text-slate-400"> (con molde vinculado, manda el molde)</span>
                                                                    : <span className="normal-case font-bold text-amber-600"> (obligatoria para publicar sin molde)</span>)}
                                                            <div className="flex flex-wrap items-end gap-3 text-sm">
                                                                <label className={claseEtiquetaCampo}>Ancho (m)<input type="number" step="0.01" min="0" value={form.anchoM} onChange={e => setF({ anchoM: e.target.value })} className={`block w-28 mt-1 ${claseCampo}`} /></label>
                                                                <label className={claseEtiquetaCampo}>Alto (m)<input type="number" step="0.01" min="0" value={form.altoM} onChange={e => setF({ altoM: e.target.value })} className={`block w-28 mt-1 ${claseCampo}`} /></label>
                                                                <label className={claseEtiquetaCampo}>Borde / demasía (cm)<input type="number" step="0.5" min="0" value={form.bordeCm} onChange={e => setF({ bordeCm: e.target.value })} className={`block w-28 mt-1 ${claseCampo}`} placeholder="0" /></label>
                                                                <label className={claseEtiquetaCampo}>Se cuenta por
                                                                    <Selector value={form.um} onChange={e => setF({ um: e.target.value })} claseBoton={claseSel('mt-1 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold text-slate-800 min-w-[170px]')}>
                                                                        <option value="u">unidad</option><option value="m">metro lineal</option><option value="m2">metro cuadrado</option>
                                                                    </Selector>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {sinMolde && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Materiales que se ofrecen', `Materiales de impresión del área ${areaSel ? capitalizar(areaSel.Nombre) : form.tecnicaPrincipal}. Sin ninguno marcado, la solicitud ofrece todos. La estrella marca en cuál se imprime por defecto. El precio es el de la lista de precios: acá no se cambia.`)}
                                                            {mats.length === 0 ? <p className="text-xs text-amber-600 font-bold">El área no tiene materiales visibles en el nomenclador (StockArt del grupo del área, tipo MATERIAL).</p> : (
                                                                <div className="space-y-1.5">
                                                                    {mats.map(m => {
                                                                        const id = m.ProIdProducto;
                                                                        const sel = form.telas.has(id);
                                                                        const v = sel ? form.telas.get(id) : null;
                                                                        return (
                                                                            <div key={id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 ${sel ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'}`}>
                                                                                <Toggle on={sel} onChange={on => { const next = new Map(form.telas); if (on) next.set(id, { codArticulo: m.CodArticulo, material: m.Material, esDefault: next.size === 0 }); else next.delete(id); setF({ telas: next }); }} />
                                                                                <span className="text-sm font-bold flex-1 min-w-[160px] text-slate-700">{m.Material}<span className="block text-[10px] font-normal text-slate-400">{m.Variante}{m.Ancho ? ` · ancho ${Number(m.Ancho).toFixed(2)} m` : ''}{m.Largo ? ` · largo fijo ${Number(m.Largo).toFixed(2)} m` : ''}</span></span>
                                                                                <span className="text-[11px] text-slate-500">{m.PrecioBase != null ? fmtPrecio(m.PrecioBase, m.Moneda) : 'sin precio en la lista'}</span>
                                                                                {sel && <button type="button" onClick={() => { const next = new Map(form.telas); next.forEach((x, k) => next.set(k, { ...x, esDefault: k === id })); setF({ telas: next }); }}
                                                                                    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border ${v.esDefault ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-slate-200 text-slate-400 hover:border-slate-400'}`}>
                                                                                    {v.esDefault ? <><Star size={11} className="fill-current" aria-hidden="true" />por defecto</> : 'hacer por defecto'}
                                                                                </button>}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                );
                                            })()}

                                            {/* ── PASO TÉCNICAS ── */}
                                            {paso === 'tecnicas' && (() => {
                                                const renderTecnicaCard = (a) => {
                                                        const t = form.tecnicas[a.id];
                                                        const opcionesArea = tecnicasCat.filter(o => o.AreaID === a.id && o.Activo);
                                                        return (
                                                            <div key={a.id} className={`border rounded-xl overflow-hidden ${t.on ? 'border-slate-300' : 'border-slate-200 opacity-60'}`}>
                                                                {(() => {
                                                                    const setT = (patch) => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, ...patch } } });
                                                                    const conOpciones = opcionesArea.length > 0;
                                                                    const ejemplo = conOpciones && opcionesArea[0].Precio != null ? `p. ej. ${opcionesArea[0].Nombre}: ${fmtPrecio(opcionesArea[0].Precio, opcionesArea[0].Moneda)}` : '';
                                                                    const eligiendo = t.on && conOpciones && (t.modo === 'RESTRINGIDO' || t.modo === 'FIJA');
                                                                    return (<>
                                                                    {/* Todo en una línea: técnica · obligatoria · incluida · (qué opción) · interruptor */}
                                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 bg-white">
                                                                        <div className="flex items-center gap-2.5 min-w-[190px]">
                                                                            <span className="w-8 h-8 flex items-center justify-center flex-shrink-0"><IconoArea area={a} size={20} /></span>
                                                                            <div className="font-black text-sm text-slate-800" title={a.desc}>{a.label}</div>
                                                                        </div>
                                                                        {t.on && (<>
                                                                            <div className="min-w-[170px]">
                                                                                <CheckUnico on={t.obligatorio} onChange={v => setT({ obligatorio: v })}
                                                                                    si={['Obligatoria', 'el producto siempre la lleva']} no={['Opcional', 'el cliente decide si la agrega']} />
                                                                            </div>
                                                                            <div className="min-w-[230px]">
                                                                                <CheckUnico on={t.cobro === 'INCLUIDA'} onChange={v => setT({ cobro: v ? 'INCLUIDA' : 'APARTE' })}
                                                                                    si={['Incluida en el precio del producto', 'no suma nada al pedido']} no={['Se cobra como servicio independiente', `según lista de precios${ejemplo ? ', ' + ejemplo : ''}`]} />
                                                                            </div>
                                                                            {conOpciones && (
                                                                                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">Opción
                                                                                    <Selector value={t.modo} onChange={e => setT({ modo: e.target.value })} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 bg-white min-w-[185px]')}>
                                                                                        <option value="LIBRE">Cualquiera del catálogo</option>
                                                                                        <option value="RESTRINGIDO">Solo las marcadas</option>
                                                                                        <option value="FIJA">Una fija</option>
                                                                                    </Selector>
                                                                                </label>
                                                                            )}
                                                                        </>)}
                                                                        <div className="ml-auto"><Toggle on={t.on} onChange={v => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, on: v } } })} /></div>
                                                                    </div>
                                                                    {eligiendo && (
                                                                        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                                                                            <div>
                                                                                <p className="text-[11px] font-bold text-slate-400 mb-1.5">
                                                                                    {t.modo === 'FIJA' ? 'Marcá la opción que se aplica siempre (una sola):' : 'Marcá las opciones que puede elegir el cliente:'}
                                                                                </p>
                                                                                <div className="flex flex-wrap gap-2">
                                                                                    {opcionesArea.map(o => {
                                                                                        const on = form.opcionesPermitidas.has(o.TecnicaOpcionID);
                                                                                        return (
                                                                                            <button key={o.TecnicaOpcionID} type="button"
                                                                                                onClick={() => {
                                                                                                    const next = new Set(form.opcionesPermitidas);
                                                                                                    if (t.modo === 'FIJA') {
                                                                                                        opcionesArea.forEach(x => next.delete(x.TecnicaOpcionID));
                                                                                                        if (!on) next.add(o.TecnicaOpcionID);
                                                                                                    } else {
                                                                                                        on ? next.delete(o.TecnicaOpcionID) : next.add(o.TecnicaOpcionID);
                                                                                                    }
                                                                                                    setF({ opcionesPermitidas: next });
                                                                                                }}
                                                                                                className={`relative rounded-xl border-2 px-3 py-2.5 flex flex-col items-center gap-1 w-[118px] transition-all ${on ? 'border-emerald-500 bg-emerald-50/40 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                                                                                {on && <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center">✓</span>}
                                                                                                {o.AnchoCm && o.AltoCm
                                                                                                    ? <SizeBox w={o.AnchoCm} h={o.AltoCm} />
                                                                                                    : <span className="w-8 h-8 flex items-center justify-center"><IconoArea area={a} size={20} /></span>}
                                                                                                <span className="text-[10.5px] font-bold text-slate-600 leading-tight text-center">{o.Nombre}</span>
                                                                                                <span className="text-[10px] font-black text-emerald-600">{o.Precio != null ? fmtPrecio(o.Precio, o.Moneda) : <span className="text-slate-300">sin precio</span>}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                            {(a.id === 'EMB' || a.id === 'TPU') && <p className="text-[10.5px] text-slate-400 mt-2">La matriz se cobra solo la primera vez.</p>}
                                                                        </div>
                                                                    )}
                                                                    </>);
                                                                })()}
                                                            </div>
                                                        );
                                                };
                                                return (
                                                    <div className="space-y-5">
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Construcción</p>
                                                            <div className="space-y-3">{AREAS_CONSTRUCCION.filter(a => !AREAS_PRINCIPAL.includes(a.id) || a.id === (form.tecnicaPrincipal || 'SB')).map(renderTecnicaCard)}</div>
                                                        </div>
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Decoración</p>
                                                            <div className="space-y-3">{AREAS_DECORACION.map(renderTecnicaCard)}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* ── PASO COMPOSICIÓN DEL COMBO (agregar productos + servicios por producto) ── (02/10: mismo estilo
                                                que los pasos de los confeccionados: una sección con el título y la ayuda arriba (la nota en ámbar
                                                pasó a la ayuda), renglones como los accesorios y los servicios elegidos en brand-cyan en vez de un
                                                color por área) */}
                                            {paso === 'combo' && form.esCombo && (
                                                <div className="border border-slate-200 rounded-xl p-4">
                                                    {tituloSeccion('Composición del combo', <>Agregá productos y colgale los servicios a cada uno. 1 paquete = esta composición exacta. Donde dice “el cliente elige”, en el pedido elige el talle/color de ese ítem. Los servicios marcados <b>incluido</b> van dentro del precio del combo; los marcados <b>se cobra</b> se suman al cotizar (la matriz de bordado/TPU se cobra la 1ª vez, como siempre).</>)}
                                                    <div className="space-y-2">
                                                        {form.comboItems.length === 0 && <p className="text-sm text-slate-400 py-1">El combo está vacío: agregá el primer producto.</p>}
                                                        {form.comboItems.map((it, i) => {
                                                            const loc = locales.find(l => l.ProIdProducto === Number(it.itemProIdProducto));
                                                            const setItem = (patch) => { const next = [...form.comboItems]; next[i] = { ...it, ...patch }; setF({ comboItems: next }); };
                                                            return (
                                                                <div key={i} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                                                                        <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                                                        <Thumb src={loc?.Imagen} size={34} />
                                                                        <Selector value={it.itemProIdProducto}
                                                                            onChange={e => {
                                                                                const l2 = locales.find(x => x.ProIdProducto === Number(e.target.value));
                                                                                setItem({ itemProIdProducto: Number(e.target.value), itemNombre: l2?.Descripcion || '', wmsVarianteId: '', varianteNombre: '' });
                                                                            }}
                                                                            claseBoton={claseSel('flex-1 min-w-[180px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800')} anchoLista={320}>
                                                                            {!loc && it.itemProIdProducto && <option value={it.itemProIdProducto}>{it.itemNombre || `#${it.itemProIdProducto}`}</option>}
                                                                            {locales.map(l => <option key={l.ProIdProducto} value={l.ProIdProducto}>{l.Descripcion}</option>)}
                                                                        </Selector>
                                                                        <Selector value={it.wmsVarianteId || ''} title="Variante del WMS"
                                                                            onChange={e => {
                                                                                const v2 = (loc?.variantes || []).find(v => v.wmsVarianteId === Number(e.target.value));
                                                                                setItem({ wmsVarianteId: e.target.value ? Number(e.target.value) : '', varianteNombre: v2?.nombre || '' });
                                                                            }}
                                                                            claseBoton={claseSel('border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs w-[190px]')}>
                                                                            <option value="">El cliente elige talle/color</option>
                                                                            {(loc?.variantes || []).map(v => (
                                                                                <option key={v.wmsVarianteId} value={v.wmsVarianteId}>{v.nombre}{v.stock != null ? ` (${v.stock} u)` : ''}</option>
                                                                            ))}
                                                                        </Selector>
                                                                        <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                                                                            <input type="number" min="1" value={it.cantidad} title="Cantidad en el paquete"
                                                                                onChange={e => setItem({ cantidad: e.target.value })}
                                                                                className="w-14 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200" />
                                                                            en el paquete
                                                                        </label>
                                                                        <button type="button" title="Quitar" onClick={() => setF({ comboItems: form.comboItems.filter((_, j) => j !== i) })}
                                                                            className="ml-auto text-red-400 hover:text-red-600 font-black px-1.5">×</button>
                                                                    </div>
                                                                    {/* Servicios de ESTE producto del combo */}
                                                                    <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 flex flex-wrap items-center gap-1.5">
                                                                        <span className={`mr-1 ${claseEtiquetaCampo}`}>Servicios</span>
                                                                        {AREAS.map(a => {
                                                                            const srv = (it.servicios || []).find(s => s.areaId === a.id);
                                                                            const corto = servicioCorto(a.id);
                                                                            return (
                                                                                <span key={a.id} className="inline-flex items-center gap-1">
                                                                                    <button type="button" aria-pressed={!!srv}
                                                                                        onClick={() => setItem({
                                                                                            servicios: srv
                                                                                                ? (it.servicios || []).filter(s => s.areaId !== a.id)
                                                                                                : [...(it.servicios || []), { areaId: a.id, tecnicaOpcionId: '', incluido: true }]
                                                                                        })}
                                                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${srv ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                                                                                        {srv ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : '+'} {corto}
                                                                                    </button>
                                                                                    {srv && (
                                                                                        <Selector value={srv.tecnicaOpcionId || ''}
                                                                                            onChange={e => setItem({ servicios: it.servicios.map(s => s.areaId === a.id ? { ...s, tecnicaOpcionId: e.target.value ? Number(e.target.value) : '' } : s) })}
                                                                                            claseBoton={claseSel('border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] w-[160px] bg-white')}>
                                                                                            <option value="">opción libre</option>
                                                                                            {tecnicasCat.filter(o => o.AreaID === a.id && o.Activo).map(o => (
                                                                                                <option key={o.TecnicaOpcionID} value={o.TecnicaOpcionID}>{o.Nombre}</option>
                                                                                            ))}
                                                                                        </Selector>
                                                                                    )}
                                                                                    {srv && (
                                                                                        <button type="button" title="¿Va dentro del precio del combo o se cobra aparte?"
                                                                                            onClick={() => setItem({ servicios: it.servicios.map(s => s.areaId === a.id ? { ...s, incluido: !s.incluido } : s) })}
                                                                                            className={`px-2 py-1 rounded-full text-[10px] font-black border ${srv.incluido ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-300 text-slate-500'}`}>
                                                                                            {srv.incluido ? 'incluido' : 'se cobra'}
                                                                                        </button>
                                                                                    )}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        <button type="button"
                                                            onClick={() => setF({ comboItems: [...form.comboItems, { itemProIdProducto: locales[0]?.ProIdProducto || '', itemNombre: locales[0]?.Descripcion || '', wmsVarianteId: '', varianteNombre: '', cantidad: 1, servicios: [] }] })}
                                                            className={claseAgregar}>
                                                            + Agregar producto al combo
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* El paso Precio y cantidades ya no existe (02/10): el precio se edita en el encabezado, al lado
                                                del nombre, y la política de cantidad está en Cantidad y accesorios. */}

                                            {/* ── PASO COMPONENTES Y APLIQUES (confeccionados) ── (02/10: mismo estilo que los otros pasos:
                                                cada sección con el título y la ayuda arriba, lo que falta en ámbar, estrella y checks con íconos
                                                en vez de emojis, y los apliques como los accesorios) */}
                                            {paso === 'molde' && (() => {
                                                const faltaMolde = form.molde === 'OBLIGATORIO' && !form.tizadaProMoldeRef;
                                                return (
                                                <div className="space-y-4">
                                                    {/* Molde de TizadaPro (solo lectura): el molde, sus piezas, talles y modelos viven allá */}
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Molde de TizadaPro',
                                                            `El molde, sus piezas, sus talles y sus modelos se cargan en TizadaPro. Acá solo se elige cuál es el de este producto.${form.molde === 'OPCIONAL' ? ' Para este producto el molde es OPCIONAL: sin molde, el cliente manda el archivo pronto a la medida fija y los materiales son los del paso "Producción principal".' : ''}`,
                                                            faltaMolde ? <span className="normal-case font-bold text-amber-600"> (obligatorio para publicar)</span> : null)}
                                                        {moldesTpError && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-xs font-bold mb-3">No se pudo leer TizadaPro: {moldesTpError}</div>}
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                                            <Selector value={form.tizadaProMoldeRef || ''} disabled={!!moldesTpError}
                                                                onChange={e => setF({ tizadaProMoldeRef: e.target.value, modelos: new Map(), telas: new Map() })}
                                                                claseBoton={claseSel(`min-w-[280px] border rounded-lg px-2.5 py-2 text-sm font-bold text-slate-800 ${faltaMolde ? 'border-amber-300' : 'border-slate-200'}`)} anchoLista={340}>
                                                                <option value="">Sin molde vinculado</option>
                                                                {form.tizadaProMoldeRef && !moldeSel && <option value={form.tizadaProMoldeRef}>{form.tizadaProMoldeRef} (ya no está en TizadaPro)</option>}
                                                                {moldesTp.map(m => <option key={m.ref} value={m.ref}>{m.nombre}{m.completo ? '' : ' (sin piezas o talles)'}</option>)}
                                                            </Selector>
                                                            <button type="button" onClick={loadMoldesTp} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700" title="Volver a leer los moldes de TizadaPro">
                                                                <RefreshCw size={13} aria-hidden="true" />Actualizar
                                                            </button>
                                                            <span className="text-[11px] text-slate-400">Cambiar el molde borra los modelos y las telas elegidos.</span>
                                                            {moldeSel && <span className="text-[10px] font-mono text-slate-300 ml-auto" title="Clave del molde en TizadaPro">{moldeSel.ref}</span>}
                                                        </div>
                                                    </div>

                                                    {moldeSel && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Modelos que se venden', 'Cada modelo es una combinación de piezas armada en TizadaPro (ej. cuello V con costadillo fino). Marcá los que el cliente puede pedir: un clic lo vende, el segundo lo pone primero (la estrella) y el tercero lo quita.')}
                                                            {moldeSel.modelos.length === 0 ? (
                                                                <p className="text-xs text-amber-600 font-bold">Este molde no tiene modelos cargados en TizadaPro: el producto se vende con su única forma.</p>
                                                            ) : (
                                                                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                                                                    {moldeSel.modelos.map(m => {
                                                                        const sel = form.modelos.has(m.clave);
                                                                        const def = form.modelos.get(m.clave)?.esDefault === true;
                                                                        return (
                                                                            <button key={m.clave} type="button" title={m.piezas.join(' · ')} aria-pressed={sel}
                                                                                onClick={() => {
                                                                                    const next = new Map(form.modelos);
                                                                                    if (!sel) next.set(m.clave, { nombre: m.nombre, esDefault: false });
                                                                                    else if (!def) { next.forEach((v, k) => next.set(k, { ...v, esDefault: false })); next.set(m.clave, { nombre: m.nombre, esDefault: true }); }
                                                                                    else next.delete(m.clave);
                                                                                    setF({ modelos: next });
                                                                                }}
                                                                                className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${def ? 'border-amber-400 bg-amber-50/40' : sel ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
                                                                                <span className="min-w-0 flex-1">
                                                                                    <span className="block font-black text-sm text-slate-800">{m.nombre}</span>
                                                                                    <span className="block text-[11px] text-slate-500 mt-0.5">{m.grupo ? `${m.grupo} · ` : ''}{m.piezas.length} piezas</span>
                                                                                </span>
                                                                                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${def ? 'text-amber-500' : sel ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300'}`} aria-hidden="true">
                                                                                    {def ? <Star size={15} className="fill-current" /> : sel ? <Check size={11} strokeWidth={3} /> : null}
                                                                                </span>
                                                                                <span className="sr-only">{def ? ' (se ofrece primero)' : sel ? ' (se vende)' : ''}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {moldeSel && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Piezas y talles', 'Así está cargado el molde en TizadaPro: acá se ve, allá se cambia.')}
                                                            <MoldeResumen molde={moldeSel} modeloVista={modeloVista} setModeloVista={setModeloVista} vendidos={form.modelos} onLeerCarpeta={leerCarpetaMoldes} leyendoCarpeta={leyendoCarpeta} />
                                                        </div>
                                                    )}

                                                    {moldeSel && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Telas que se ofrecen', 'Solo las que el molde admite en TizadaPro. La estrella marca la que se ofrece primero. El precio que se muestra es el de la lista de precios de la tela: acá no se cambia.')}
                                                            {moldeSel.telas.length === 0 ? (
                                                                <p className="text-xs text-amber-600 font-bold">El molde no tiene telas permitidas cargadas en TizadaPro. Cargalas allá y tocá Actualizar.</p>
                                                            ) : (
                                                                <div className="space-y-1.5">
                                                                    {moldeSel.telas.map(t => {
                                                                        const id = t.proIdProducto;
                                                                        const sel = id != null && form.telas.has(id);
                                                                        const v = sel ? form.telas.get(id) : null;
                                                                        return (
                                                                            <div key={t.nombre} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 ${sel ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'}`}>
                                                                                <Toggle on={sel} disabled={id == null} onChange={on => {
                                                                                    const next = new Map(form.telas);
                                                                                    if (on) next.set(id, { codArticulo: t.codArticulo, material: t.nombre, esDefault: next.size === 0 });
                                                                                    else next.delete(id);
                                                                                    setF({ telas: next });
                                                                                }} />
                                                                                <span className={`text-sm font-bold flex-1 min-w-[160px] ${id == null ? 'text-rose-600' : 'text-slate-700'}`} title={t.aviso || ''}>{t.nombre}{t.aviso ? <span className="block text-[10px] font-normal">{t.aviso}</span> : null}</span>
                                                                                {t.anchoCm && <span className="text-[11px] text-slate-400">{t.anchoCm} cm</span>}
                                                                                <span className="text-[11px] text-slate-500" title="Precio base de la tela en la lista de precios. Se cambia desde Precios, no acá.">{t.precioBase != null ? fmtPrecio(t.precioBase, t.moneda) : 'sin precio en la lista'}</span>
                                                                                {sel && (
                                                                                    <button type="button" title="Tela que se ofrece primero"
                                                                                        onClick={() => { const next = new Map(form.telas); next.forEach((x, k) => next.set(k, { ...x, esDefault: k === id })); setF({ telas: next }); }}
                                                                                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border ${v.esDefault ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-slate-200 text-slate-400 hover:border-slate-400'}`}>
                                                                                        {v.esDefault ? <><Star size={11} className="fill-current" aria-hidden="true" />primera</> : 'hacer primera'}
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            {Object.keys(moldeSel.telasPorPieza || {}).length > 0 && (
                                                                <p className="text-[11px] text-slate-500 mt-3">Las telas de arriba son para el cuerpo. {Object.keys(moldeSel.telasPorPieza).join(', ')} van en la tela fija que dice el molde (ver Piezas y talles, más arriba). Eso se cambia en TizadaPro.</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Apliques', `Dónde va cada uno y con qué técnica. Solo con las técnicas de decoración activas en el paso Técnicas${AREAS_DECORACION.some(x => form.tecnicas[x.id].on) ? ` (${AREAS_DECORACION.filter(x => form.tecnicas[x.id].on).map(x => x.label).join(', ')})` : ': hoy ninguna, solo Etiqueta'}. La pieza es de los modelos que se venden${moldeSel && form.modelos.size ? ` (${[...form.modelos.values()].map(m => m.nombre).join(', ')})` : ' (todavía no marcaste ninguno: se listan todas las del molde)'}.`)}
                                                        <div className="space-y-2">
                                                            {form.apliques.map((ap, i) => {
                                                                // Piezas del molde de TizadaPro, con la tela fija si la tienen (ej. "Cuello · Rib New").
                                                                const piezasMolde = piezasParaApliques;
                                                                const opciones = ap.pieza && !piezasMolde.includes(ap.pieza) ? [ap.pieza, ...piezasMolde] : piezasMolde;
                                                                const telaDePieza = (pz) => ((moldeSel?.telasPorPieza || {})[pz] || []).map(x => x.nombre).join(', ');
                                                                const opcionesTecnica = tecnicasCat.filter(o => o.AreaID === ap.areaId && o.Activo);
                                                                const set = (patch) => { const next = [...form.apliques]; next[i] = { ...ap, ...patch }; setF({ apliques: next }); };
                                                                const tecnicaActiva = tecnicasApliqueActivas.some(x => x.id === ap.areaId);
                                                                return (
                                                                    <div key={i} className="border border-slate-200 rounded-xl bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                                                                        <Selector value={ap.areaId} title="Técnica del aplique (solo las que el producto tiene activas en Técnicas)"
                                                                            onChange={e => set({ areaId: e.target.value, tecnicaOpcionId: primeraOpcionDe(e.target.value) })}
                                                                            claseBoton={claseSel(`min-w-[150px] border rounded-lg px-2.5 py-1.5 text-sm font-bold ${tecnicaActiva ? 'border-slate-200 text-slate-800' : 'border-amber-300 text-amber-700'}`)}>
                                                                            {tecnicasApliqueActivas.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                                                                            {!tecnicaActiva && <option value={ap.areaId}>{areaMeta(ap.areaId).label} (técnica apagada)</option>}
                                                                        </Selector>
                                                                        <Selector value={ap.pieza || ''} title="¿En qué pieza de la prenda va? (obligatorio)"
                                                                            onChange={e => set({ pieza: e.target.value })}
                                                                            claseBoton={claseSel(`min-w-[170px] border rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800 ${ap.pieza ? 'border-slate-200' : 'border-amber-300'}`)}>
                                                                            {!ap.pieza && <option value="">{moldeSel ? 'Elegí la pieza (obligatorio)' : 'Elegí primero el molde de TizadaPro'}</option>}
                                                                            {opciones.map(n => <option key={n} value={n}>{n}{telaDePieza(n) ? ` · ${telaDePieza(n)}` : ''}</option>)}
                                                                        </Selector>
                                                                        {ap.areaId !== 'ETIQUETA' && (
                                                                            <Selector value={ap.tecnicaOpcionId} title="Opción del catálogo de esta técnica"
                                                                                onChange={e => set({ tecnicaOpcionId: e.target.value ? Number(e.target.value) : '' })}
                                                                                claseBoton={claseSel('border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs w-[180px]')}>
                                                                                {opcionesTecnica.map(o => <option key={o.TecnicaOpcionID} value={o.TecnicaOpcionID}>{o.Nombre}</option>)}
                                                                                <option value="">Opción libre{opcionesTecnica.length ? '' : ' (sin opciones en el catálogo)'}</option>
                                                                            </Selector>
                                                                        )}
                                                                        <input value={ap.detalle || ''} placeholder="Observaciones (ej. pecho izquierdo)"
                                                                            onChange={e => set({ detalle: e.target.value })}
                                                                            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200" />
                                                                        <div className="min-w-[190px]">
                                                                            <CheckUnico on={ap.incluido} onChange={v => set({ incluido: v })}
                                                                                si={['Incluido en el precio', 'va dentro del precio del producto']} no={['Se cobra aparte', 'a precio de lista']} />
                                                                        </div>
                                                                        <button type="button" title="Quitar este aplique" onClick={() => setF({ apliques: form.apliques.filter((_, j) => j !== i) })}
                                                                            className="text-red-400 hover:text-red-600 font-black px-1.5">×</button>
                                                                    </div>
                                                                );
                                                            })}
                                                            <button type="button"
                                                                onClick={() => { const areaId = tecnicasApliqueActivas[0].id; setF({ apliques: [...form.apliques, { pieza: piezasParaApliques[0] || '', detalle: '', areaId, tecnicaOpcionId: primeraOpcionDe(areaId), cantidad: 1, incluido: true }] }); }}
                                                                className={claseAgregar}>
                                                                + Agregar aplique
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                );
                                            })()}

                                            {/* ── PASO ACCESORIOS Y ESTRUCTURA (artículos de stock que salen con el producto) ── (02/10: mismo
                                                estilo que los pasos anteriores, una sección a todo el ancho con el título y la ayuda arriba; "siempre
                                                va" y el cobro con los mismos checks que Técnicas, en vez de botoncitos con el elegido en negro) */}
                                            {paso === 'accesorios' && (() => {
                                                const lista = form.accesorios || [];
                                                const setLista = (next) => setF({ accesorios: next });
                                                return (
                                                    <div className="space-y-4">
                                                        {/* Política de cantidad (02/10: pasó del paso Precio a este, arriba de los artículos de stock) */}
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Política de cantidad', 'Cuántas unidades puede pedir el cliente.')}
                                                            <div role="radiogroup" aria-label="Política de cantidad" className={claseOpciones}>
                                                                {POLITICAS.map(([v, t, d]) => tarjetaOpcion({ id: v, sel: form.politica === v, onClick: () => setF({ politica: v }), titulo: t, detalle: d }))}
                                                            </div>
                                                            {form.politica === 'MINIMA' && (
                                                                <label className={`block mt-4 ${claseEtiquetaCampo}`}>Mínimo por pedido
                                                                    <input type="number" min="1" value={form.cantidadMinima}
                                                                        onChange={e => setF({ cantidadMinima: e.target.value })}
                                                                        className={`block w-28 mt-1 ${claseCampo}`} />
                                                                </label>
                                                            )}
                                                            {form.politica === 'PAQUETE' && (
                                                                <div className="mt-4 space-y-4">
                                                                    <label className={`block ${claseEtiquetaCampo}`}>Unidades por paquete
                                                                        <input type="number" min="1" value={form.cantidadFija}
                                                                            onChange={e => setF({ cantidadFija: e.target.value })}
                                                                            className={`block w-28 mt-1 ${claseCampo}`} />
                                                                        <span className="block mt-1 font-normal text-slate-400">
                                                                            Unidades de este producto: el pedido queda fijo en {form.cantidadFija || 'esa cantidad'}. Para mezclar productos distintos, creá un combo en Combos y Promos.
                                                                        </span>
                                                                    </label>
                                                                    {origenSel && (
                                                                        <div>
                                                                            <p className={`mb-1.5 ${claseEtiquetaCampo}`}>
                                                                                Surtido del paquete <span className="font-normal text-slate-400">— variantes de “{origenSel.Descripcion}” que entran (ninguna marcada = todas)</span>
                                                                            </p>
                                                                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                                                                {origenSel.variantes.map(v => {
                                                                                    const on = form.surtido.has(v.wmsVarianteId);
                                                                                    const alternar = () => {
                                                                                        const next = new Set(form.surtido);
                                                                                        on ? next.delete(v.wmsVarianteId) : next.add(v.wmsVarianteId);
                                                                                        setF({ surtido: next });
                                                                                    };
                                                                                    return (
                                                                                        <div key={v.wmsVarianteId} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${on ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'}`}>
                                                                                            <Toggle on={on} onChange={alternar} />
                                                                                            <span className="flex-1 text-sm font-bold text-slate-700">{v.nombre}</span>
                                                                                            <span className="text-[11px] text-slate-400">{v.stock == null ? 's/d' : `${v.stock} u`}</span>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {!origenSel && (form.origenTipo === 'LOCAL' || form.origenTipo === 'AMBOS') && (
                                                                        <p className="text-[11px] text-slate-400">Elegí arriba de qué producto del local sale para definir el surtido.</p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Artículos de stock que salen con el producto',
                                                                'Mástil, base, funda… Al cargar un pedido, cada accesorio genera su línea de venta y se descuenta del WMS, del depósito que elijas acá (el de ventas, el Centro de stock general u otro). En producción, antes de pasar a depósito, se controla que la cantidad de accesorios coincida con las unidades del producto. Los artículos tienen que existir en Marketing › Productos y estar vinculados al WMS para aparecer acá.')}
                                                            <div className="space-y-2">
                                                                {lista.length === 0 && <p className="text-sm text-slate-400 py-1">Este producto no lleva accesorios de stock.</p>}
                                                                {lista.map((it, i) => {
                                                                    const loc = stockArts.find(l => l.ProIdProducto === Number(it.itemProIdProducto));
                                                                    const setItem = (patch) => { const next = [...lista]; next[i] = { ...it, ...patch }; setLista(next); };
                                                                    // stock a mostrar: el del depósito elegido (cargado aparte) o el de ventas que ya trae la variante
                                                                    const depSel = Number(it.wmsDepositoId) || 0;
                                                                    const stockDe = (v) => (depSel ? (stockPorDep[depSel] ? stockPorDep[depSel][v.wmsVarianteId] ?? 0 : null) : v.stock);
                                                                    return (
                                                                        <div key={i} className="border border-slate-200 rounded-xl bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                                                                            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                                                            <Thumb src={loc?.Imagen} size={34} icon="fa-box" />
                                                                            <Selector value={it.itemProIdProducto}
                                                                                onChange={e => {
                                                                                    const l2 = stockArts.find(x => x.ProIdProducto === Number(e.target.value));
                                                                                    // una sola variante: queda elegida sola (no hay talle/color que decidir)
                                                                                    const unica = (l2?.variantes || []).length === 1 ? l2.variantes[0] : null;
                                                                                    setItem({ itemProIdProducto: Number(e.target.value), itemNombre: l2?.Descripcion || '', wmsVarianteId: unica ? unica.wmsVarianteId : '', varianteNombre: unica ? unica.nombre : '' });
                                                                                }}
                                                                                claseBoton={claseSel('flex-1 min-w-[180px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800')} anchoLista={320}>
                                                                                <option value="">Elegí el artículo de stock…</option>
                                                                                {!loc && it.itemProIdProducto ? <option value={it.itemProIdProducto}>{it.itemNombre || `#${it.itemProIdProducto}`}</option> : null}
                                                                                {stockArts.map(l => <option key={l.ProIdProducto} value={l.ProIdProducto}>{l.Descripcion}</option>)}
                                                                            </Selector>
                                                                            <Selector value={it.wmsDepositoId || ''} title="De qué depósito del WMS se retira este accesorio"
                                                                                onChange={e => { const d = e.target.value ? Number(e.target.value) : ''; setItem({ wmsDepositoId: d }); if (d) cargarStockDep(d); }}
                                                                                claseBoton={claseSel('border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs w-[210px]')}>
                                                                                <option value="">Depósito de ventas</option>
                                                                                {depositosWms.filter(d => !d.PorDefecto).map(d => <option key={d.DepId} value={d.DepId}>{d.Nombre}</option>)}
                                                                            </Selector>
                                                                            {(loc?.variantes || []).length > 1 && <Selector value={it.wmsVarianteId || ''}
                                                                                onChange={e => {
                                                                                    const v2 = (loc?.variantes || []).find(v => v.wmsVarianteId === Number(e.target.value));
                                                                                    setItem({ wmsVarianteId: e.target.value ? Number(e.target.value) : '', varianteNombre: v2?.nombre || '' });
                                                                                }}
                                                                                claseBoton={claseSel('border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs w-[190px]')} title="Variante del WMS">
                                                                                <option value="">Se elige al cargar el pedido</option>
                                                                                {(loc?.variantes || []).map(v => {
                                                                                    const st = stockDe(v);
                                                                                    return <option key={v.wmsVarianteId} value={v.wmsVarianteId}>{v.nombre}{st != null ? ` (${st} u)` : ''}</option>;
                                                                                })}
                                                                            </Selector>}
                                                                            {(loc?.variantes || []).length === 1 && (() => { const st = stockDe(loc.variantes[0]); return st != null ? <span className="text-[11px] text-slate-400">stock: {st} u</span> : null; })()}
                                                                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                                                                                <input type="number" min="1" value={it.cantidad} title="Cantidad del accesorio por cada unidad del producto"
                                                                                    onChange={e => setItem({ cantidad: e.target.value })}
                                                                                    className="w-14 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200" />
                                                                                por unidad
                                                                            </label>
                                                                            <div className="min-w-[170px]">
                                                                                <CheckUnico on={it.obligatorio} onChange={v => setItem({ obligatorio: v })}
                                                                                    si={['Siempre va', 'sale siempre con el producto']} no={['Opcional', 'lo decide quien carga el pedido']} />
                                                                            </div>
                                                                            <div className="min-w-[190px]">
                                                                                <CheckUnico on={it.cobro !== 'APARTE'} onChange={v => setItem({ cobro: v ? 'INCLUIDO' : 'APARTE' })}
                                                                                    si={['Incluido en el precio', 'va dentro del precio del producto']} no={['Se cobra aparte', 'a precio de lista']} />
                                                                            </div>
                                                                            <button type="button" onClick={() => setLista(lista.filter((_, j) => j !== i))}
                                                                                className="ml-auto text-red-400 hover:text-red-600 font-black px-1.5" title="Quitar">×</button>
                                                                        </div>
                                                                    );
                                                                })}
                                                                <button type="button" disabled={!stockArts.length}
                                                                    onClick={() => setLista([...lista, { itemProIdProducto: '', itemNombre: '', wmsVarianteId: '', varianteNombre: '', cantidad: 1, obligatorio: true, cobro: 'INCLUIDO', wmsDepositoId: '' }])}
                                                                    className={claseAgregar}>
                                                                    + Agregar accesorio de stock
                                                                </button>
                                                                {!stockArts.length && (
                                                                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                                        No hay artículos vinculados al WMS para elegir. Creá el artículo (ej. mástil) en Marketing › Productos y vinculalo al WMS.
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* ── PASO FICHA DE DISEÑO ── (02/10: mismo estilo que los otros pasos: secciones a todo el ancho con
                                                el título y la ayuda arriba, campos y renglones como en los otros pasos, íconos en vez de emojis y
                                                "+ Agregar…" a todo el ancho) */}
                                            {paso === 'ficha' && (
                                                <div className="space-y-4">
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Encabezado de la ficha', null)}
                                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                                            <label className={claseEtiquetaCampo}>Referencia (REF)
                                                                <input value={form.fichaDiseno.ref} placeholder={form.codArticulo}
                                                                    onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, ref: e.target.value } })}
                                                                    className={`block w-full mt-1 ${claseCampo}`} />
                                                            </label>
                                                            <label className={claseEtiquetaCampo}>Marca
                                                                <input value={form.fichaDiseno.marca}
                                                                    onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, marca: e.target.value } })}
                                                                    className={`block w-full mt-1 ${claseCampo}`} />
                                                            </label>
                                                            {/* Modelo de la ficha impresa: el mismo que se mira en "Piezas y talles". Por ahora los pasos y
                                                                avíos son los mismos para todos los modelos; el modelo sale en el encabezado. */}
                                                            {(moldeSel?.modelos || []).length > 0 && (
                                                                <div className={`lg:col-span-2 ${claseEtiquetaCampo}`}>
                                                                    Modelo (sale en la ficha impresa)
                                                                    <Selector value={modeloVista} onChange={e => setModeloVista(e.target.value)} anchoLista={280}
                                                                        claseBoton={claseSel(`mt-1 w-full ${claseCampo}`)}>
                                                                        <option value="" descripcion="La ficha no nombra ningún modelo">Sin modelo</option>
                                                                        {moldeSel.modelos.map(m => <option key={m.clave} value={m.clave} descripcion={form.modelos.has(m.clave) ? 'Se vende' : 'No se vende en este producto'}>{m.nombre}</option>)}
                                                                    </Selector>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Dibujo del producto', <>Es el dibujo de la ficha técnica. Si el producto no tiene <b>Foto del producto</b> (la de arriba, al lado del nombre), este dibujo queda también como su foto en tienda, portal, solicitud y artículo.</>)}
                                                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                                                            <label className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer ${subiendoDibujo ? 'opacity-50 pointer-events-none' : ''}`}>
                                                                <Upload size={14} className="text-brand-cyan" aria-hidden="true" />
                                                                {subiendoDibujo ? 'Subiendo…' : (form.fichaDiseno.dibujoUrl ? 'Cambiar dibujo' : 'Subir dibujo o imagen')}
                                                                <input type="file" accept="image/*" className="hidden"
                                                                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) subirDibujoFicha(f); }} />
                                                            </label>
                                                            <span className="text-[11px] text-slate-400">o hacé clic sobre el dibujo para agregar una anotación con flecha</span>
                                                        </div>
                                                        {/* El recuadro del dibujo va a todo el ancho (02/10), pero el lienzo de adentro, donde se hace clic y
                                                            van las flechas, conserva su ancho de siempre (732 px, el que tenía dentro de max-w-3xl) y va
                                                            centrado. Las anotaciones se guardan en % del lienzo con la imagen en object-contain: con otro
                                                            ancho, las flechas ya cargadas se correrían de lugar sobre el dibujo. */}
                                                        {form.fichaDiseno.dibujoUrl ? (
                                                            <div className="w-full bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                                                                <div className="relative mx-auto w-full max-w-[732px] cursor-crosshair select-none"
                                                                    style={{ minHeight: 278 }}
                                                                    onClick={e => {
                                                                        if (e.target !== e.currentTarget && !e.target.classList.contains('dz-fd-img-bg')) return;
                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                        const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
                                                                        const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
                                                                        setF({ fichaDisenoAnotaciones: [...form.fichaDisenoAnotaciones, { x, y, texto: 'Detalle' }] });
                                                                    }}>
                                                                    <img src={form.fichaDiseno.dibujoUrl} className="dz-fd-img-bg w-full h-full object-contain pointer-events-none" alt="" style={{ maxHeight: 420 }} />
                                                                    {form.fichaDisenoAnotaciones.map((a, i) => (
                                                                        <div key={i} onMouseDown={arrastrarAnotacion(i)}
                                                                            className="absolute flex items-center gap-1 cursor-move" style={{ left: `${a.x}%`, top: `${a.y}%`, transform: 'translate(-50%,-50%)' }}>
                                                                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 border-2 border-white shadow flex-shrink-0"></span>
                                                                            <span className="bg-slate-900/85 text-white text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">{a.texto}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="border-2 border-dashed border-slate-200 rounded-lg py-10 text-center text-xs text-slate-400">
                                                                Subí un dibujo y hacé clic sobre él para agregar anotaciones con flecha
                                                            </div>
                                                        )}
                                                        <div className="mt-3 space-y-2">
                                                            {form.fichaDisenoAnotaciones.map((a, i) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <input value={a.texto} aria-label={`Anotación ${i + 1}`}
                                                                        onChange={e => setF({ fichaDisenoAnotaciones: form.fichaDisenoAnotaciones.map((x, j) => j === i ? { ...x, texto: e.target.value } : x) })}
                                                                        className={`flex-1 ${claseCampoFila}`} />
                                                                    <button type="button" title="Quitar" onClick={() => setF({ fichaDisenoAnotaciones: form.fichaDisenoAnotaciones.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1.5">×</button>
                                                                </div>
                                                            ))}
                                                            <button type="button"
                                                                onClick={() => setF({ fichaDisenoAnotaciones: [...form.fichaDisenoAnotaciones, { x: 50, y: 30, texto: 'Nuevo detalle' }] })}
                                                                className={claseAgregar}>
                                                                + Agregar anotación
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Datos de la prenda', 'Material y tallas salen del molde de TizadaPro y de los materiales que se ofrecen (sin molde, de los del área). Se pueden pisar; "Automático" vuelve a lo calculado.')}
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                            {[['material', 'Material', autoFicha.material], ['tallas', 'Tallas', autoFicha.tallas], ['marcacion', 'Marcación', null]].map(([k, label, auto]) => (
                                                                <div key={k}>
                                                                    <label htmlFor={`ficha-${k}`} className={`flex items-center justify-between ${claseEtiquetaCampo}`}>{label}
                                                                        {auto != null && form.fichaDiseno[k] !== auto && auto && (
                                                                            <button type="button" onClick={() => setF({ fichaDiseno: { ...form.fichaDiseno, [k]: auto } })}
                                                                                className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-cyan hover:underline">
                                                                                <RotateCcw size={11} aria-hidden="true" />Automático
                                                                            </button>
                                                                        )}
                                                                    </label>
                                                                    <input id={`ficha-${k}`} value={form.fichaDiseno[k]} placeholder={auto || (k === 'marcacion' ? 'Cómo se marca el talle (etiqueta, estampa…)' : '')}
                                                                        onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, [k]: e.target.value } })}
                                                                        className={`block w-full mt-1 ${claseCampo} ${auto != null && form.fichaDiseno[k] && form.fichaDiseno[k] === auto ? 'bg-slate-50 text-slate-600' : ''}`} />
                                                                    {auto != null && !form.fichaDiseno[k] && !auto && <p className="text-[10px] text-amber-600 mt-1">{k === 'material' ? (form.molde === 'OBLIGATORIO' || form.tizadaProMoldeRef ? 'Marcá las telas que se ofrecen en "Molde, telas y apliques".' : 'Marcá los materiales que se ofrecen en "Producción principal".') : (form.molde === 'NO' ? 'Sin molde no hay talles: el producto va por unidad a medida fija.' : 'Vinculá el molde de TizadaPro para tomar los talles.')}</p>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Notas sueltas', 'Lo que no entra arriba ni en Avíos, como etiqueta y valor. Salen al pie de la ficha impresa.')}
                                                        <div className="space-y-2">
                                                            {form.fichaDisenoExtra.map((c, i) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <input value={c.label} placeholder="Nombre del campo"
                                                                        onChange={e => setF({ fichaDisenoExtra: form.fichaDisenoExtra.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                                                                        className={`w-48 ${claseCampoFila}`} />
                                                                    <input value={c.valor} placeholder="Valor"
                                                                        onChange={e => setF({ fichaDisenoExtra: form.fichaDisenoExtra.map((x, j) => j === i ? { ...x, valor: e.target.value } : x) })}
                                                                        className={`flex-1 ${claseCampoFila}`} />
                                                                    <button type="button" title="Quitar" onClick={() => setF({ fichaDisenoExtra: form.fichaDisenoExtra.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1.5">×</button>
                                                                </div>
                                                            ))}
                                                            <button type="button" onClick={() => setF({ fichaDisenoExtra: [...form.fichaDisenoExtra, { label: '', valor: '' }] })}
                                                                className={claseAgregar}>
                                                                + Agregar campo
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {tituloSeccion('Avíos', 'Todo lo que lleva la prenda y no es tela. Se eligen del "Catálogo de avíos". Si la medida o la cantidad cambian según el talle, marcá "Varía por talle" y cargá cada talle del molde.')}
                                                        {!form.aviosPorTalleOk && (
                                                            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                                                <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                                                                <span>Falta correr <b>docs/migrations/configurador_ficha_avios_talle.sql</b> en esta base. Hasta entonces la medida va como texto y los pasos de costura no guardan el avío que usan.</span>
                                                            </div>
                                                        )}
                                                        <div className="space-y-2">
                                                            {form.avios.map((av, i) => {
                                                                const set = (patch) => { const next = [...form.avios]; next[i] = { ...av, ...patch }; setF({ avios: next }); };
                                                                // Por talle: solo con la base al día y si el molde tiene talles (o el avío ya traía valores por talle)
                                                                const puedePorTalle = form.aviosPorTalleOk && (gruposTalles.length > 0 || av.porTalle);
                                                                const cantidadPorTalle = av.porTalle && !esMedida(av.unidad);
                                                                return (
                                                                    <div key={i} className="border border-slate-200 rounded-xl bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                                                                        <Selector value={av.avioId || ''} title="Avío del catálogo"
                                                                            onChange={e => { const c = aviosCat.find(x => String(x.AvioID) === e.target.value); set(c ? { avioId: c.AvioID, nombre: c.Nombre, unidad: c.Unidad || 'u' } : { avioId: '' }); }}
                                                                            claseBoton={claseSel(`min-w-[200px] border rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800 ${av.avioId ? 'border-slate-200' : 'border-amber-300'}`)} anchoLista={280}>
                                                                            <option value="">{aviosCat.filter(x => x.Activo).length ? 'Elegí el avío…' : 'Cargá avíos en "Catálogo de avíos"'}</option>
                                                                            {aviosCat.filter(x => x.Activo || x.AvioID === av.avioId).map(x => <option key={x.AvioID} value={x.AvioID}>{x.Nombre}{x.Activo ? '' : ' (inactivo)'}</option>)}
                                                                        </Selector>
                                                                        {cantidadPorTalle ? (
                                                                            <span className="text-xs text-slate-500">Cantidad según el talle ({av.unidad || 'u'})</span>
                                                                        ) : (
                                                                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                                                                                <input type="number" min="0.01" step="0.01" value={av.cantidad} title="Cantidad por prenda" onChange={e => set({ cantidad: e.target.value })}
                                                                                    className={`w-20 text-center font-bold ${claseCampoFila}`} />
                                                                                {av.unidad || 'u'} por prenda
                                                                            </label>
                                                                        )}
                                                                        {!av.porTalle && (
                                                                            <input value={av.medida} placeholder={puedePorTalle ? 'Medida (si es la misma en todos los talles)' : 'Medida por talle (ej. S–M 55 cm · L–XXL 60 cm)'} onChange={e => set({ medida: e.target.value })}
                                                                                className={`min-w-[220px] flex-1 ${claseCampoFila}`} />
                                                                        )}
                                                                        <input value={av.nota} placeholder="Nota" onChange={e => set({ nota: e.target.value })}
                                                                            className={`min-w-[120px] ${av.porTalle ? 'flex-1' : ''} ${claseCampoFila}`} />
                                                                        {puedePorTalle && (
                                                                            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-600" title="La medida o la cantidad cambian según el talle">
                                                                                <input type="checkbox" checked={!!av.porTalle} onChange={e => set({ porTalle: e.target.checked })}
                                                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                                                                                Varía por talle
                                                                            </label>
                                                                        )}
                                                                        <button type="button" title="Quitar" onClick={() => setF({ avios: form.avios.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-600 font-black px-1.5">×</button>
                                                                        {av.porTalle && form.aviosPorTalleOk && (
                                                                            <GrillaAvioTalles av={av} grupos={gruposTalles} aviosCat={aviosCat} onChange={set} />
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                            {form.aviosPorTalleOk && gruposTalles.length === 0 && form.avios.length > 0 && (
                                                                <p className="text-[11px] text-slate-400">Para cargar avíos por talle, vinculá el molde en "Molde, telas y apliques": los talles salen de ahí.</p>
                                                            )}
                                                            <button type="button" onClick={() => { const c = aviosCat.find(x => x.Activo); setF({ avios: [...form.avios, { avioId: c ? c.AvioID : '', nombre: c ? c.Nombre : '', cantidad: 1, unidad: c ? (c.Unidad || 'u') : 'u', medida: '', nota: '', porTalle: false, talles: [], articuloPorTalle: false }] }); }}
                                                                className={claseAgregar}>
                                                                + Agregar avío
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        {/* [PASO A PASO] la secuencia de costura de la prenda, de la preparación al planchado */}
                                                        {tituloSeccion('Costura paso a paso', 'Cómo se cose la prenda, en orden: en cada paso, qué operación es, qué costura lleva (ISO 4915), en qué máquina, qué piezas une, cuánto tarda y qué cuidar. La imagen sale del catálogo de costuras, o subí una foto del paso.')}
                                                        <PasosCosturaEditor pasos={form.fichaDisenoCosturas} onChange={pasos => setF({ fichaDisenoCosturas: pasos })}
                                                            costurasIso={costurasIsoCat} maquinas={maquinasCosturaCat} pasoAPaso={costurasPasoAPaso}
                                                            piezas={piezasParaApliques} conAvio={form.aviosPorTalleOk && costurasPasoAPaso}
                                                            avios={[...new Map(form.avios.filter(a => a.avioId).map(a => [String(a.avioId), { avioId: a.avioId, nombre: a.nombre }])).values()]} />
                                                    </div>

                                                    <div className="flex items-center gap-3">
                                                        <button type="button" onClick={() => setFichaPreview(true)}
                                                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                                                            <Printer size={16} className="text-brand-cyan" aria-hidden="true" />Ver ficha técnica
                                                        </button>
                                                        <span className="text-[11px] text-slate-400">Genera la vista imprimible con dibujo, campos y costuras.</span>
                                                    </div>

                                                    {/* Vista imprimible: en z-[6000] para tapar la navbar (z-[5010]) y la barra lateral; antes en z-50
                                                        quedaba debajo. En celular, a pantalla completa. */}
                                                    {fichaPreview && (
                                                        <div className="fixed inset-0 z-[6000] bg-black/50 flex items-center justify-center sm:p-4">
                                                            <style>{`
                                                                @media print {
                                                                    body * { visibility: hidden; }
                                                                    .fdp-print-root, .fdp-print-root * { visibility: visible; }
                                                                    .fdp-print-root { position: fixed; inset: 0; padding: 12mm; box-shadow: none !important; max-height: none !important; border-radius: 0 !important; }
                                                                    .fdp-noprint { display: none !important; }
                                                                }
                                                            `}</style>
                                                            <div className="fdp-print-root bg-white shadow-xl w-full h-full overflow-auto p-6 sm:h-auto sm:max-w-2xl sm:max-h-[90vh] sm:rounded-2xl">
                                                                <div className="fdp-noprint flex items-center justify-between mb-4">
                                                                    <span className="font-black text-slate-800">Vista de ficha técnica</span>
                                                                    <button type="button" onClick={() => setFichaPreview(false)} className="rounded p-1 text-slate-400 hover:text-slate-700" title="Cerrar" aria-label="Cerrar"><X size={18} /></button>
                                                                </div>

                                                                <div className="border-2 border-slate-800 rounded-lg p-4">
                                                                    <div className="flex items-center justify-between border-b-2 border-slate-800 pb-2 mb-2">
                                                                        <span className="font-black text-lg">FICHA TÉCNICA DE DISEÑO</span>
                                                                        <span className="text-sm font-bold">MARCA: {form.fichaDiseno.marca || ''}</span>
                                                                    </div>
                                                                    <div className="text-sm font-bold mb-3">
                                                                        REF. {form.fichaDiseno.ref || form.codArticulo} — {form.descripcion}
                                                                        {(() => { const m = (moldeSel?.modelos || []).find(x => x.clave === modeloVista); return m ? <span className="font-normal"> · Modelo: <b>{m.nombre}</b></span> : null; })()}
                                                                    </div>

                                                                    {form.fichaDiseno.dibujoUrl ? (
                                                                        <div className="relative bg-slate-50 border border-slate-200 rounded-lg mb-3" style={{ minHeight: 220 }}>
                                                                            <img src={form.fichaDiseno.dibujoUrl} className="w-full object-contain" style={{ maxHeight: 300 }} alt="" />
                                                                            {form.fichaDisenoAnotaciones.map((a, i) => (
                                                                                <div key={i} className="absolute flex items-center gap-1" style={{ left: `${a.x}%`, top: `${a.y}%`, transform: 'translate(-50%,-50%)' }}>
                                                                                    <span className="w-2 h-2 rounded-full bg-red-600 border border-white flex-shrink-0"></span>
                                                                                    <span className="bg-white border border-slate-300 text-[10px] font-bold px-1 rounded whitespace-nowrap">{a.texto}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-center text-xs text-slate-400 py-8 border border-dashed border-slate-200 rounded-lg mb-3">Sin dibujo</div>
                                                                    )}

                                                                    {form.fichaDisenoCosturas.length > 0 && (
                                                                        <>
                                                                            <div className="text-xs font-black uppercase mb-1">Costura paso a paso</div>
                                                                            <TablaPasosCostura pasos={form.fichaDisenoCosturas} costurasIso={costurasIsoCat} maquinas={maquinasCosturaCat} avios={aviosCat} />
                                                                        </>
                                                                    )}

                                                                    {form.fichaDisenoExtra.length > 0 && (
                                                                        <table className="w-full text-xs mb-3">
                                                                            <tbody>
                                                                                {form.fichaDisenoExtra.map((c, i) => (
                                                                                    <tr key={i} className="border-b border-slate-100">
                                                                                        <td className="font-bold py-1 pr-2 w-32">{c.label}</td><td className="py-1">{c.valor}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    )}

                                                                    <table className="w-full text-xs border-t-2 border-slate-800 pt-2">
                                                                        <tbody>
                                                                            <tr>
                                                                                <td className="font-bold py-1 pr-2 w-20">Material</td><td className="py-1" colSpan={3}>{form.fichaDiseno.material}</td>
                                                                            </tr>
                                                                            <tr>
                                                                                <td className="font-bold py-1 pr-2">Tallas</td><td className="py-1" colSpan={3}>{form.fichaDiseno.tallas}</td>
                                                                            </tr>
                                                                            <tr>
                                                                                <td className="font-bold py-1 pr-2">Marcación</td><td className="py-1" colSpan={3}>{form.fichaDiseno.marcacion}</td>
                                                                            </tr>
                                                                        </tbody>
                                                                    </table>
                                                                    {form.avios.filter(a => a.nombre.trim()).length > 0 && (
                                                                        <table className="w-full text-xs mt-3">
                                                                            <thead><tr className="border-b-2 border-slate-800 text-left"><th className="py-1 pr-2">Avío</th><th className="py-1 pr-2">Cant./prenda</th><th className="py-1 pr-2">Medida por talle</th><th className="py-1">Nota</th></tr></thead>
                                                                            <tbody>
                                                                                {form.avios.filter(a => a.nombre.trim()).map((a, i) => {
                                                                                    const resumen = a.porTalle ? resumenPorTalle(a, aviosCat) : '';
                                                                                    return (
                                                                                        <tr key={i} className="border-b border-slate-100">
                                                                                            <td className="py-1 pr-2 font-bold">{a.nombre}</td>
                                                                                            <td className="py-1 pr-2">{resumen && !esMedida(a.unidad) ? 'según talle' : `${a.cantidad} ${a.unidad}`}</td>
                                                                                            <td className="py-1 pr-2">{resumen || a.medida}</td><td className="py-1">{a.nota}</td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    )}
                                                                    <TablaAviosTalle avios={form.avios} aviosCat={aviosCat} />
                                                                </div>

                                                                <div className="fdp-noprint flex items-center gap-2 mt-4">
                                                                    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-brand-cyan bg-brand-cyan px-4 py-2 text-xs font-bold text-white hover:bg-brand-cyan/90">
                                                                        <Printer size={14} aria-hidden="true" />Imprimir / PDF
                                                                    </button>
                                                                    <button type="button" onClick={() => setFichaPreview(false)} className="border border-slate-200 rounded-lg px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Cerrar</button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* ── PASO RESUMEN / PUBLICAR ── (02/10: mismo estilo que los otros pasos: secciones con el título
                                                arriba, a todo el ancho y en dos columnas en pantallas anchas: a la izquierda cómo lo ve el cliente
                                                y el resumen; a la derecha dónde se ve y el estado) */}
                                            {paso === 'resumen' && (() => {
                                                const sinPrecio = form.precio === '' || form.precio == null;
                                                const faltaMolde = !form.esCombo && form.origenTipo === 'CONFECCIONADO' && form.molde === 'OBLIGATORIO' && !form.tizadaProMoldeRef;
                                                // Combos (02/10): los productos que tiene; la producción principal y el molde no van (son de los confeccionados)
                                                const itemsCombo = form.esCombo ? form.comboItems.filter(it => it.itemProIdProducto) : [];
                                                // Un renglón del resumen; lo que falta, en ámbar con el ícono (como el punto ámbar de los pasos)
                                                const fila = (titulo, valor, falta = false) => (
                                                    <div className="flex justify-between gap-4 py-2.5 text-sm">
                                                        <span className="shrink-0 font-bold text-slate-400">{titulo}</span>
                                                        <span className={`font-bold text-right ${falta ? 'text-amber-600' : 'text-slate-700'}`}>
                                                            {falta && <TriangleAlert size={13} className="inline -mt-0.5 mr-1" aria-hidden="true" />}{valor}
                                                        </span>
                                                    </div>
                                                );
                                                return (
                                                <div className="grid gap-4 items-start 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                                                    <div className="space-y-4">
                                                        {/* Vista previa: la tarjeta como la va a ver el cliente en el pedido web */}
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Así lo ve el cliente en el pedido web', null)}
                                                            {/* Tarjeta de vista previa (02/10): marco en brand-cyan (antes índigo) y todas las etiquetas
                                                                iguales, en gris con el ícono del área en brand-cyan (antes un color por área y ámbar para
                                                                el paquete). Sin precio, lo dice (antes "— /u · servicios aparte"). */}
                                                            <div className="border-2 border-brand-cyan/25 rounded-2xl bg-white p-4 flex gap-3 max-w-md shadow-sm">
                                                                <Thumb src={form.imagen || origenSel?.Imagen} size={56} rounded="rounded-xl" icon={form.politica === 'PAQUETE' ? 'fa-boxes-stacked' : 'fa-shirt'} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="font-black text-slate-800 leading-tight">{form.descripcion}</div>
                                                                    <div className="text-sm font-bold text-slate-600 mt-0.5">
                                                                        {sinPrecio ? <span className="font-normal text-slate-400">Sin precio</span> : <>
                                                                            {fmtPrecio(form.precio, form.moneda)}
                                                                            <span className="text-slate-400 font-normal">{form.politica === 'PAQUETE' ? ' el paquete' : ' /u · servicios aparte'}</span>
                                                                        </>}
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                                        {AREAS.filter(a => form.tecnicas[a.id].on).map(a => {
                                                                            const t = form.tecnicas[a.id];
                                                                            const opts = tecnicasCat.filter(o => o.AreaID === a.id && form.opcionesPermitidas.has(o.TecnicaOpcionID));
                                                                            const corto = servicioCorto(a.id);
                                                                            const det = (t.modo !== 'LIBRE' && opts.length)
                                                                                ? ' ' + opts.map(o => o.Nombre.replace(/^Parche hasta\s*/i, '').replace(/^Bordado sobre prenda\s*/i, '')).join(' / ')
                                                                                : '';
                                                                            return (
                                                                                <span key={a.id} className={claseChipPrevia}>
                                                                                    <a.Icono size={11} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                                                                    {t.obligatorio ? '' : '+ '}{corto}{det}{t.cobro === 'INCLUIDA' ? ' · incluido' : ''}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                        {form.politica === 'PAQUETE' && form.comboItems.length > 0 && form.comboItems.map((it, i) => (
                                                                            <span key={`ci-${i}`} className={claseChipPrevia}>
                                                                                <Package size={11} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                                                                {it.cantidad}× {it.itemNombre || `#${it.itemProIdProducto}`}{it.wmsVarianteId ? ` — ${it.varianteNombre || 'variante fija'}` : ''}
                                                                                {(it.servicios || []).length > 0 && ` +${it.servicios.map(s => servicioCorto(s.areaId) + (s.incluido ? '' : '($)')).join('+')}`}
                                                                            </span>
                                                                        ))}
                                                                        {form.politica === 'PAQUETE' && form.comboItems.length === 0 && form.cantidadFija && (
                                                                            <span className={claseChipPrevia}><Package size={11} className="shrink-0 text-brand-cyan" aria-hidden="true" />cantidad fija: {form.cantidadFija}</span>
                                                                        )}
                                                                        {form.politica === 'MINIMA' && form.cantidadMinima && (
                                                                            <span className={claseChipPrevia}>mín. {form.cantidadMinima} u</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="border border-slate-200 rounded-xl px-4 pt-4 pb-1.5">
                                                            {tituloSeccion('Resumen', null)}
                                                            <div className="divide-y divide-slate-100">
                                                                {!form.esCombo && fila('Familia', form.categoria !== 'Prendas' ? form.categoria : 'Sin clasificar', form.categoria === 'Prendas')}
                                                                {fila('Origen', form.esCombo
                                                                    ? (itemsCombo.length ? `Combo de ${itemsCombo.length} producto${itemsCombo.length === 1 ? '' : 's'} del local` : 'Combo sin productos todavía')
                                                                    : `${ORIGENES.find(o => o.id === form.origenTipo)?.t}${origenSel ? ` — ${origenSel.Descripcion}` : ''}`)}
                                                                {fila('Técnicas', form.esCombo ? 'por producto (ver composición)' : (AREAS.filter(a => form.tecnicas[a.id].on).map(a => { const conOpc = tecnicasCat.some(o => o.AreaID === a.id && o.Activo); const det = [conOpc ? form.tecnicas[a.id].modo.toLowerCase() : null, form.tecnicas[a.id].cobro === 'INCLUIDA' ? 'incluida' : null].filter(Boolean).join(', '); return det ? `${a.label} (${det})` : a.label; }).join(' · ') || 'ninguna'))}
                                                                {fila('Precio', sinPrecio ? 'Sin precio' : `${fmtPrecio(form.precio, form.moneda)}${form.politica === 'PAQUETE' ? ' el paquete' : ' /u sin servicios'}`)}
                                                                {fila('Cantidad', form.esCombo
                                                                    ? (itemsCombo.length ? `paquete armado: ${itemsCombo.map(it => `${it.cantidad}× ${it.itemNombre || `#${it.itemProIdProducto}`}${it.wmsVarianteId ? ` (${it.varianteNombre})` : ''}`).join(' + ')}` : 'sin productos en el combo')
                                                                    : form.politica === 'LIBRE' ? 'libre'
                                                                    : form.politica === 'MINIMA' ? `mínimo ${form.cantidadMinima || '—'} u`
                                                                    : `paquete fijo de ${form.cantidadFija || '—'} u${form.surtido.size ? ` · surtido: ${form.surtido.size} variantes` : ' · surtido: todas'}`,
                                                                    form.esCombo && !itemsCombo.length)}
                                                                {!form.esCombo && form.origenTipo === 'CONFECCIONADO' && fila('Producción principal',
                                                                    `${(() => { const a = areasPrincipales.find(x => x.AreaID === form.tecnicaPrincipal); return a ? capitalizar(a.Nombre) : form.tecnicaPrincipal; })()}${form.molde !== 'OBLIGATORIO' && form.anchoM && form.altoM ? ` · medida fija ${Number(form.anchoM).toFixed(2)} × ${Number(form.altoM).toFixed(2)} m` : ''} · por ${form.um === 'm2' ? 'm²' : form.um === 'm' ? 'metro' : 'unidad'}`)}
                                                                {!form.esCombo && form.origenTipo === 'CONFECCIONADO' && fila('Molde (TizadaPro)',
                                                                    form.tizadaProMoldeRef ? `${moldeSel?.nombre || form.tizadaProMoldeRef} · ${form.modelos.size} modelos · ${form.telas.size} telas · ${form.apliques.length} apliques`
                                                                        : form.molde === 'NO' ? `no lleva · ${form.telas.size} materiales ofrecidos`
                                                                        : form.molde === 'OPCIONAL' ? `opcional, sin vincular · ${form.telas.size} materiales ofrecidos`
                                                                        : 'sin molde vinculado', faltaMolde)}
                                                                {fila('Validar stock', form.validarStock ? 'Sí' : 'No (contingencia)')}
                                                                {!form.esCombo && fila('Accesorios de stock', (form.accesorios || []).filter(a => a.itemProIdProducto).length
                                                                    ? (form.accesorios || []).filter(a => a.itemProIdProducto).map(a => `${a.cantidad}× ${a.itemNombre || `#${a.itemProIdProducto}`}${a.varianteNombre && (stockArts.find(l => l.ProIdProducto === Number(a.itemProIdProducto))?.variantes || []).length > 1 ? ` (${a.varianteNombre})` : ''} · ${a.obligatorio ? 'siempre' : 'opcional'} · ${a.cobro === 'APARTE' ? 'aparte' : 'incluido'}${Number(a.wmsDepositoId) ? ` · sale de ${depositosWms.find(d => d.DepId === Number(a.wmsDepositoId))?.Nombre || `depósito ${a.wmsDepositoId}`}` : ''}`).join(' · ')
                                                                    : 'No lleva')}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-4">
                                                        {/* F1: canales. Hoy se guardan; cada canal pasa a leerlos cuando le toque (interno → tienda → portal). */}
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            {tituloSeccion('Dónde se ve (cuando está publicado)', null)}
                                                            <div className="flex flex-wrap gap-4">
                                                                {[['visibleInterno', 'Interno', 'Fabricar a medida, combos, solicitudes de vendedor'], ['visibleTienda', 'Tienda', 'e-commerce del portal (hoy también prende "Publicado" en la tienda)'], ['visiblePortal', 'Portal', 'forms por servicio del cliente (todavía no lo lee: se prepara el terreno)']].map(([k, t, d]) => (
                                                                    <label key={k} className="flex items-start gap-2 min-w-[200px]"><Toggle on={!!form[k]} onChange={v => setF({ [k]: v })} /><span><span className="block font-bold text-sm text-slate-700">{t}</span><span className="block text-[11px] text-slate-400">{d}</span></span></label>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className={`flex flex-wrap items-center gap-3 border-2 rounded-xl p-4 ${form.estado === 'PUBLICADO' ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200'}`}>
                                                            <Toggle on={form.estado === 'PUBLICADO'} onChange={v => setF({ estado: v ? 'PUBLICADO' : 'BORRADOR' })} />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-bold text-sm text-slate-700">{form.estado === 'PUBLICADO' ? 'Publicado' : 'Borrador'}</div>
                                                                <div className="text-xs text-slate-400">{form.estado === 'PUBLICADO' ? 'Se ve en los canales marcados' : 'No se ve en ningún canal'}</div>
                                                            </div>
                                                            {botonGuardar('ml-auto')}
                                                        </div>
                                                    </div>
                                                </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── CATÁLOGO DE TÉCNICAS ── */}
                    {vista === 'tecnicas' && (
                        <CatalogoTecnicas tecnicas={tecnicasCat} onReload={loadCatalogos} />
                    )}
                    {vista === 'avios' && <CatalogoAvios avios={aviosCat} onReload={loadCatalogos} />}
                    {vista === 'costuras' && <CatalogoCosturas costuras={costurasIsoCat} maquinas={maquinasCosturaCat} pasoAPaso={costurasPasoAPaso} onReload={loadCatalogos} />}

                </div>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════
//  Catálogo de técnicas (TecnicaOpciones) — general, compartido por productos
// ═════════════════════════════════════════════════════════════════════════
function CatalogoTecnicas({ tecnicas, onReload }) {
    const [edits, setEdits] = useState({});
    const [savingId, setSavingId] = useState(null);
    const [nueva, setNueva] = useState({ areaId: 'EMB', nombre: '', codArticulo: '' });
    const [creando, setCreando] = useState(false);

    const val = (t, k, orig) => edits[t.TecnicaOpcionID]?.[k] ?? (orig ?? '');
    const setVal = (id, k, v) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }));

    const guardarFila = async (t) => {
        const e = edits[t.TecnicaOpcionID];
        if (!e) return;
        setSavingId(t.TecnicaOpcionID);
        try {
            // Si se editó el precio, mantener la moneda actual del artículo (no pisarla a UYU)
            const payload = e.precio !== undefined ? { ...e, moneda: (t.Moneda || 'UYU').trim() } : e;
            await api.put(`${API}/tecnicas/${t.TecnicaOpcionID}`, payload);
            toast.success('✅ Opción guardada');
            setEdits(prev => { const n = { ...prev }; delete n[t.TecnicaOpcionID]; return n; });
            onReload();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setSavingId(null); }
    };

    const toggleActivo = async (t) => {
        try {
            await api.put(`${API}/tecnicas/${t.TecnicaOpcionID}`, { activo: !t.Activo });
            onReload();
        } catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); }
    };

    const crear = async () => {
        if (!nueva.nombre.trim()) return toast.error('Poné el nombre de la opción.');
        setCreando(true);
        try {
            await api.post(`${API}/tecnicas`, nueva);
            toast.success('✅ Opción creada');
            setNueva({ areaId: nueva.areaId, nombre: '', codArticulo: '' });
            onReload();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setCreando(false); }
    };

    return (
        <div className="space-y-5">
            <p className="text-xs text-slate-400 max-w-3xl">
                Especificaciones generales de cada técnica (medida + artículo que cotiza). Se definen una sola vez:
                cambiar el precio de “Parche hasta 4x4” lo cambia para todos los productos que lo usan. El precio se
                guarda directo en PreciosBase del artículo vinculado.
            </p>
            {AREAS.map(a => (
                <div key={a.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                        <IconoArea area={a} size={20} />
                        <span className="font-black text-slate-800 text-sm">{a.label}</span>
                        <span className="text-[11px] text-slate-400">{tecnicas.filter(t => t.AreaID === a.id).length} opciones</span>
                    </div>
                    <div className="divide-y divide-slate-50">
                        <div className="hidden md:grid grid-cols-[52px_1fr_90px_90px_110px_120px_90px_90px] gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                            <span></span><span>Nombre</span><span>Ancho cm</span><span>Alto cm</span><span>Artículo</span><span>Precio</span><span></span><span></span>
                        </div>
                        {tecnicas.filter(t => t.AreaID === a.id).map(t => (
                            <div key={t.TecnicaOpcionID} className={`grid md:grid-cols-[52px_1fr_90px_90px_110px_120px_90px_90px] gap-2 px-4 py-2 items-center ${!t.Activo ? 'opacity-50' : ''}`}>
                                <span className="flex justify-center">
                                    {t.AnchoCm && t.AltoCm
                                        ? <SizeBox w={t.AnchoCm} h={t.AltoCm} />
                                        : <span className="w-7 h-7 flex items-center justify-center"><IconoArea area={a} size={18} /></span>}
                                </span>
                                <input value={val(t, 'nombre', t.Nombre)} onChange={e => setVal(t.TecnicaOpcionID, 'nombre', e.target.value)}
                                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold" />
                                <input type="number" step="0.5" value={val(t, 'anchoCm', t.AnchoCm)} onChange={e => setVal(t.TecnicaOpcionID, 'anchoCm', e.target.value)}
                                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center" placeholder="—" />
                                <input type="number" step="0.5" value={val(t, 'altoCm', t.AltoCm)} onChange={e => setVal(t.TecnicaOpcionID, 'altoCm', e.target.value)}
                                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center" placeholder="—" />
                                <input value={val(t, 'codArticulo', t.CodArticulo)} onChange={e => setVal(t.TecnicaOpcionID, 'codArticulo', e.target.value)}
                                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono text-center" placeholder="cod. art." />
                                <div className="flex items-center gap-1">
                                    <input type="number" step="0.1" value={val(t, 'precio', t.Precio)} onChange={e => setVal(t.TecnicaOpcionID, 'precio', e.target.value)}
                                        className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right" placeholder="$" />
                                    <span className="text-[10px] text-slate-400 font-bold">{(t.Moneda || 'UYU').trim()}</span>
                                </div>
                                <button onClick={() => toggleActivo(t)} title={t.Activo ? 'Desactivar' : 'Activar'}
                                    className="text-xs font-bold text-slate-400 hover:text-slate-600">
                                    <i className={`fa-solid ${t.Activo ? 'fa-eye' : 'fa-eye-slash'} mr-1`}></i>{t.Activo ? 'activa' : 'inactiva'}
                                </button>
                                {edits[t.TecnicaOpcionID] ? (
                                    <button onClick={() => guardarFila(t)} disabled={savingId === t.TecnicaOpcionID}
                                        className="bg-slate-800 text-white rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50">
                                        {savingId === t.TecnicaOpcionID ? '…' : 'Guardar'}
                                    </button>
                                ) : <span></span>}
                            </div>
                        ))}
                    </div>
                    {nueva.areaId === a.id ? (
                        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                            <input value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })}
                                onKeyDown={e => e.key === 'Enter' && crear()}
                                placeholder={`Nueva opción de ${a.label} (ej. Parche hasta 6x3)`}
                                className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                            <input value={nueva.codArticulo} onChange={e => setNueva({ ...nueva, codArticulo: e.target.value })}
                                placeholder="cod. artículo (opcional)" className="w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
                            <button onClick={crear} disabled={creando}
                                className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">
                                {creando ? '…' : '+ Agregar'}
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => setNueva({ areaId: a.id, nombre: '', codArticulo: '' })}
                            className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 border-t border-slate-100">
                            + Agregar opción de {a.label}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════
//  Catálogo de avíos: cierres, botones, elásticos, etiquetas… (dbo.CatalogoAvios)
// ═════════════════════════════════════════════════════════════════════════
function CatalogoAvios({ avios, onReload }) {
    const [edits, setEdits] = useState({});
    const [savingId, setSavingId] = useState(null);
    const [nuevo, setNuevo] = useState({ nombre: '', unidad: 'u' });
    const [creando, setCreando] = useState(false);
    const val = (a, k, orig) => edits[a.AvioID]?.[k] ?? (orig ?? '');
    const setVal = (id, k, v) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
    const guardar = async (a) => {
        const e = edits[a.AvioID]; if (!e) return;
        setSavingId(a.AvioID);
        try { await api.put(`${API}/avios/${a.AvioID}`, e); toast.success('✅ Avío guardado'); setEdits(prev => { const n = { ...prev }; delete n[a.AvioID]; return n; }); onReload(); }
        catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); }
        finally { setSavingId(null); }
    };
    const toggle = async (a) => { try { await api.put(`${API}/avios/${a.AvioID}`, { activo: !a.Activo }); onReload(); } catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); } };
    const crear = async () => {
        if (!nuevo.nombre.trim()) return toast.error('Poné el nombre del avío.');
        setCreando(true);
        try { await api.post(`${API}/avios`, nuevo); toast.success('✅ Avío creado'); setNuevo({ nombre: '', unidad: 'u' }); onReload(); }
        catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); }
        finally { setCreando(false); }
    };
    return (
        // A todo el ancho, como el catálogo de técnicas (05/10): el nombre ocupa el lugar libre y las demás
        // columnas quedan fijas a la derecha. Antes, max-w-4xl dejaba media pantalla vacía.
        <div className="space-y-4">
            <p className="text-xs text-slate-400 max-w-3xl">Todo lo que lleva una prenda y no es tela: cierres, botones, elásticos, etiquetas, cordones. Se cargan una vez acá y cada producto elige cuáles lleva y en qué cantidad. Un avío inactivo no se ofrece más, pero los productos que ya lo tienen lo conservan.</p>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-2">Avío</th><th className="px-3 py-2 w-24">Unidad</th><th className="px-3 py-2 w-24 text-center">En uso</th><th className="px-3 py-2 w-20 text-center">Activo</th><th className="px-3 py-2 w-28"></th>
                    </tr></thead>
                    <tbody>
                        {avios.map(a => (
                            <tr key={a.AvioID} className={`border-b border-slate-50 ${a.Activo ? '' : 'opacity-50'}`}>
                                <td className="px-4 py-1.5"><input value={val(a, 'nombre', a.Nombre)} onChange={e => setVal(a.AvioID, 'nombre', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm font-bold capitalize" /></td>
                                <td className="px-3 py-1.5"><Selector value={val(a, 'unidad', a.Unidad || 'u')} onChange={e => setVal(a.AvioID, 'unidad', e.target.value)} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1 text-xs w-[72px]')} anchoLista={100}>{['u', 'par', 'm', 'cm'].map(u => <option key={u} value={u}>{u}</option>)}</Selector></td>
                                <td className="px-3 py-1.5 text-center text-xs text-slate-500">{a.Usos ? `${a.Usos} producto${a.Usos === 1 ? '' : 's'}` : '—'}</td>
                                <td className="px-3 py-1.5 text-center"><Toggle on={!!a.Activo} onChange={() => toggle(a)} /></td>
                                <td className="px-3 py-1.5 text-right">{edits[a.AvioID] && <button onClick={() => guardar(a)} disabled={savingId === a.AvioID} className="bg-indigo-600 text-white rounded-lg px-3 py-1 text-xs font-bold disabled:opacity-50">{savingId === a.AvioID ? '…' : 'Guardar'}</button>}</td>
                            </tr>
                        ))}
                        {avios.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">Todavía no hay avíos. Cargá el primero abajo.</td></tr>}
                    </tbody>
                </table>
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                    <input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} onKeyDown={e => e.key === 'Enter' && crear()} placeholder="Nuevo avío (ej. Cierre frontal nylon)" className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                    <Selector value={nuevo.unidad} onChange={e => setNuevo({ ...nuevo, unidad: e.target.value })} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-2 text-xs w-[72px]')} anchoLista={100}>{['u', 'par', 'm', 'cm'].map(u => <option key={u} value={u}>{u}</option>)}</Selector>
                    <button onClick={crear} disabled={creando} className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">{creando ? '…' : '+ Agregar avío'}</button>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════
//  Catálogo de costuras (dbo.CosturasISO): código ISO 4915 + nombre
// ═════════════════════════════════════════════════════════════════════════
function CatalogoCosturas({ costuras, maquinas = [], pasoAPaso = false, onReload }) {
    const [edits, setEdits] = useState({});
    const [savingId, setSavingId] = useState(null);
    const [nueva, setNueva] = useState({ codigoISO: '', nombre: '' });
    const [creando, setCreando] = useState(false);
    const [subiendoImg, setSubiendoImg] = useState(null);   // [PASO A PASO] CosturaISOID que está subiendo imagen
    // [PASO A PASO] la imagen se sube al toque y reemplaza el esquema de la costura en todas las fichas que la usan
    const subirImagen = async (c, file) => {
        if (!file) return;
        setSubiendoImg(c.CosturaISOID);
        try {
            const fd = new FormData(); fd.append('imagen', file);
            await api.post(`${API}/costuras-iso/${c.CosturaISOID}/imagen`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast.success(`✅ Imagen de ${c.CodigoISO} reemplazada. Se ve en todos los pasos que usan esta costura (salvo los que tienen foto propia).`);
            onReload();
        } catch (err) { toast.error('Error subiendo la imagen: ' + (err.response?.data?.error || err.message)); }
        finally { setSubiendoImg(null); }
    };
    const val = (c, k, orig) => edits[c.CosturaISOID]?.[k] ?? (orig ?? '');
    const setVal = (id, k, v) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
    const guardar = async (c) => {
        const e = edits[c.CosturaISOID]; if (!e) return;
        setSavingId(c.CosturaISOID);
        try { await api.put(`${API}/costuras-iso/${c.CosturaISOID}`, e); toast.success('✅ Costura guardada'); setEdits(prev => { const n = { ...prev }; delete n[c.CosturaISOID]; return n; }); onReload(); }
        catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); }
        finally { setSavingId(null); }
    };
    const toggle = async (c) => { try { await api.put(`${API}/costuras-iso/${c.CosturaISOID}`, { activo: !c.Activo }); onReload(); } catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); } };
    const crear = async () => {
        if (!nueva.codigoISO.trim() || !nueva.nombre.trim()) return toast.error('Poné el código (ej. ISO 504) y el nombre.');
        setCreando(true);
        try { await api.post(`${API}/costuras-iso`, nueva); toast.success('✅ Costura creada'); setNueva({ codigoISO: '', nombre: '' }); onReload(); }
        catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); }
        finally { setCreando(false); }
    };
    return (
        // A todo el ancho, como el catálogo de técnicas (05/10)
        <div className="space-y-4">
            <p className="text-xs text-slate-400 max-w-3xl">Tipos de costura con su código ISO 4915 (pespunte, overlock, recubridora…). En la ficha de diseño de cada producto, cada paso de costura usa una de estas: de acá salen su imagen y la máquina que se propone. Una costura inactiva no se ofrece más, pero las fichas que ya la usan la conservan.</p>
            {!pasoAPaso && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-3xl">Falta correr <b>docs/migrations/configurador_costuras_paso_a_paso.sql</b>: hasta entonces no hay imagen, descripción ni máquina por costura, ni catálogo de máquinas.</p>
            )}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        {pasoAPaso && <th className="px-4 py-2 w-40">Imagen</th>}
                        <th className="px-4 py-2 w-32">Código</th><th className="px-3 py-2">Nombre{pasoAPaso ? ' · para qué se usa' : ''}</th>
                        {pasoAPaso && <th className="px-3 py-2 w-56">Máquina típica</th>}
                        <th className="px-3 py-2 w-20 text-center">Activa</th><th className="px-3 py-2 w-28"></th>
                    </tr></thead>
                    <tbody>
                        {costuras.map(c => (
                            <tr key={c.CosturaISOID} className={`border-b border-slate-50 align-top ${c.Activo === false ? 'opacity-50' : ''}`}>
                                {pasoAPaso && (
                                    <td className="px-4 py-1.5">
                                        {c.ImagenUrl
                                            ? <a href={c.ImagenUrl} target="_blank" rel="noreferrer" title="Ver la imagen grande"><img src={c.ImagenUrl} alt={c.CodigoISO} className="h-16 w-32 object-contain rounded border border-slate-100 bg-white" /></a>
                                            : <div className="h-16 w-32 rounded border border-dashed border-slate-200 text-[10px] text-slate-400 flex items-center justify-center">Sin imagen</div>}
                                        <label className={`mt-1 inline-flex cursor-pointer items-center gap-1 text-[10px] font-bold text-indigo-600 hover:underline ${subiendoImg === c.CosturaISOID ? 'pointer-events-none opacity-50' : ''}`}
                                            title="Reemplaza la imagen de esta costura en todas las fichas (no toca los pasos con foto propia)">
                                            <Upload size={11} aria-hidden="true" />{subiendoImg === c.CosturaISOID ? 'Subiendo…' : 'Reemplazar imagen'}
                                            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; subirImagen(c, f); }} />
                                        </label>
                                    </td>
                                )}
                                <td className="px-4 py-1.5"><input value={val(c, 'codigoISO', c.CodigoISO)} onChange={e => setVal(c.CosturaISOID, 'codigoISO', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm font-mono font-bold" /></td>
                                <td className="px-3 py-1.5">
                                    <input value={val(c, 'nombre', c.Nombre)} onChange={e => setVal(c.CosturaISOID, 'nombre', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm" />
                                    {pasoAPaso && <textarea rows={2} value={val(c, 'descripcion', c.Descripcion)} placeholder="Para qué se usa (ej. ruedos de remera, bocamangas)" onChange={e => setVal(c.CosturaISOID, 'descripcion', e.target.value)} className="mt-1 w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-xs text-slate-500 resize-none" />}
                                </td>
                                {pasoAPaso && (
                                    <td className="px-3 py-1.5">
                                        <Selector value={String(val(c, 'maquinaId', c.MaquinaCosturaID) || '')} onChange={e => setVal(c.CosturaISOID, 'maquinaId', e.target.value)} title="Se propone sola al elegir esta costura en un paso"
                                            claseBoton={claseSel('w-full border border-slate-200 rounded-lg px-2.5 py-1 text-sm')} anchoLista={260}>
                                            <option value="">Sin máquina</option>
                                            {maquinas.filter(m => m.Activo !== false || m.MaquinaCosturaID === c.MaquinaCosturaID).map(m => <option key={m.MaquinaCosturaID} value={String(m.MaquinaCosturaID)}>{m.Nombre}</option>)}
                                        </Selector>
                                    </td>
                                )}
                                <td className="px-3 py-1.5 text-center"><Toggle on={c.Activo !== false} onChange={() => toggle(c)} /></td>
                                <td className="px-3 py-1.5 text-right">{edits[c.CosturaISOID] && <button onClick={() => guardar(c)} disabled={savingId === c.CosturaISOID} className="bg-indigo-600 text-white rounded-lg px-3 py-1 text-xs font-bold disabled:opacity-50">{savingId === c.CosturaISOID ? '…' : 'Guardar'}</button>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                    <input value={nueva.codigoISO} onChange={e => setNueva({ ...nueva, codigoISO: e.target.value })} placeholder="ISO 401" className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
                    <input value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} onKeyDown={e => e.key === 'Enter' && crear()} placeholder="Nombre (ej. Cadeneta 2 hilos)" className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                    <button onClick={crear} disabled={creando} className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">{creando ? '…' : '+ Agregar costura'}</button>
                </div>
            </div>
            {pasoAPaso && <CatalogoMaquinasCostura maquinas={maquinas} onReload={onReload} />}
        </div>
    );
}

// [PASO A PASO] Catálogo de máquinas de costura (dbo.MaquinasCostura): tipos de máquina del taller
function CatalogoMaquinasCostura({ maquinas, onReload }) {
    const [edits, setEdits] = useState({});
    const [savingId, setSavingId] = useState(null);
    const [nueva, setNueva] = useState({ nombre: '', descripcion: '' });
    const [creando, setCreando] = useState(false);
    const val = (m, k, orig) => edits[m.MaquinaCosturaID]?.[k] ?? (orig ?? '');
    const setVal = (id, k, v) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
    const err = (e) => toast.error('Error: ' + (e.response?.data?.error || e.message));
    const guardar = async (m) => {
        const e = edits[m.MaquinaCosturaID]; if (!e) return;
        setSavingId(m.MaquinaCosturaID);
        try { await api.put(`${API}/maquinas-costura/${m.MaquinaCosturaID}`, e); toast.success('✅ Máquina guardada'); setEdits(prev => { const n = { ...prev }; delete n[m.MaquinaCosturaID]; return n; }); onReload(); }
        catch (e2) { err(e2); } finally { setSavingId(null); }
    };
    const toggle = async (m) => { try { await api.put(`${API}/maquinas-costura/${m.MaquinaCosturaID}`, { activo: !m.Activo }); onReload(); } catch (e) { err(e); } };
    const crear = async () => {
        if (!nueva.nombre.trim()) return toast.error('Poné el nombre de la máquina (ej. Overlock 4 hilos).');
        setCreando(true);
        try { await api.post(`${API}/maquinas-costura`, nueva); toast.success('✅ Máquina creada'); setNueva({ nombre: '', descripcion: '' }); onReload(); }
        catch (e) { err(e); } finally { setCreando(false); }
    };
    return (
        <div className="space-y-2 pt-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Máquinas de costura</p>
            <p className="text-xs text-slate-400 max-w-3xl">Tipos de máquina del taller (recta, overlock, recubridora…) para indicar en qué máquina se hace cada paso. Son tipos, no cada máquina física. Una máquina inactiva no se ofrece más, pero los pasos que ya la usan la conservan.</p>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-2 w-64">Máquina</th><th className="px-3 py-2">Para qué se usa</th><th className="px-3 py-2 w-20 text-center">Activa</th><th className="px-3 py-2 w-28"></th>
                    </tr></thead>
                    <tbody>
                        {maquinas.map(m => (
                            <tr key={m.MaquinaCosturaID} className={`border-b border-slate-50 ${m.Activo === false ? 'opacity-50' : ''}`}>
                                <td className="px-4 py-1.5"><input value={val(m, 'nombre', m.Nombre)} onChange={e => setVal(m.MaquinaCosturaID, 'nombre', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm font-bold" /></td>
                                <td className="px-3 py-1.5"><input value={val(m, 'descripcion', m.Descripcion)} onChange={e => setVal(m.MaquinaCosturaID, 'descripcion', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm text-slate-600" /></td>
                                <td className="px-3 py-1.5 text-center"><Toggle on={m.Activo !== false} onChange={() => toggle(m)} /></td>
                                <td className="px-3 py-1.5 text-right">{edits[m.MaquinaCosturaID] && <button onClick={() => guardar(m)} disabled={savingId === m.MaquinaCosturaID} className="bg-indigo-600 text-white rounded-lg px-3 py-1 text-xs font-bold disabled:opacity-50">{savingId === m.MaquinaCosturaID ? '…' : 'Guardar'}</button>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                    <input value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Nombre (ej. Pretinadora)" className="w-64 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                    <input value={nueva.descripcion} onChange={e => setNueva({ ...nueva, descripcion: e.target.value })} onKeyDown={e => e.key === 'Enter' && crear()} placeholder="Para qué se usa" className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                    <button onClick={crear} disabled={creando} className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">{creando ? '…' : '+ Agregar máquina'}</button>
                </div>
            </div>
        </div>
    );
}
