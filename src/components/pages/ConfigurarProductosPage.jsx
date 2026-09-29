import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import StockArtEditModal from '../modals/config/StockArtEditModal';
import TerminacionesEcouvModal from '../modals/config/TerminacionesEcouvModal';
import NuevoProductoTerminadoModal from '../modals/config/NuevoProductoTerminadoModal';

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
const AREAS_CONSTRUCCION = [
    { id: 'SB', label: 'Sublimación', desc: 'Estampado full print de la tela · área SB', grad: 'from-amber-500 to-orange-600', chip: 'bg-amber-100 text-amber-700', icon: 'fa-fill-drip' },
    { id: 'TWC', label: 'Corte', desc: 'Corte láser y tizada · área TWC', grad: 'from-slate-500 to-slate-700', chip: 'bg-slate-100 text-slate-700', icon: 'fa-scissors' },
    { id: 'TWT', label: 'Costura', desc: 'Confección de la prenda · área TWT', grad: 'from-teal-500 to-emerald-600', chip: 'bg-teal-100 text-teal-700', icon: 'fa-shirt' },
];
const AREAS_DECORACION = [
    { id: 'EMB', label: 'Bordado', desc: 'Hilado sobre la prenda · área EMB', grad: 'from-violet-500 to-purple-600', chip: 'bg-violet-100 text-violet-700', icon: 'fa-compact-disc' },
    { id: 'TPU', label: 'Estampado TPU', desc: 'Aplique termoadhesivo en relieve · área TPU', grad: 'from-sky-500 to-blue-600', chip: 'bg-sky-100 text-sky-700', icon: 'fa-square' },
    { id: 'DF', label: 'Estampado DTF', desc: 'Transfer film full color · área DTF', grad: 'from-pink-500 to-rose-600', chip: 'bg-pink-100 text-pink-700', icon: 'fa-palette' },
];
const AREAS = [...AREAS_CONSTRUCCION, ...AREAS_DECORACION];
// Nombre corto de cada servicio para chips/resúmenes. OJO: antes había un ternario
// EMB/TPU/else→'DTF' que etiquetaba "DTF" a Sublimación, Corte y Costura — en el armado
// del combo se veían 4 chips "DTF" que en realidad eran áreas distintas.
const servicioCorto = (areaId) => ({
    SB: 'Sublimación', TWC: 'Corte', TWT: 'Costura',
    EMB: 'Bordado', TPU: 'TPU', DF: 'DTF',
}[areaId] || areaId);
const AREA_APLIQUE_EXTRA = { id: 'ETIQUETA', label: 'Etiqueta (grifa)', chip: 'bg-slate-100 text-slate-600' };
const areaMeta = (id) => AREAS.find(a => a.id === id) || AREA_APLIQUE_EXTRA;

const ORIGENES = [
    { id: 'LOCAL', t: 'Producto del local', d: 'Sale del stock del local, con talle/color y stock en vivo.', icon: 'fa-store' },
    { id: 'CLIENTE', t: 'Prenda del cliente', d: 'El cliente la trae; se recibe por remito PRE.', icon: 'fa-handshake' },
    { id: 'CONFECCIONADO', t: 'Confeccionado por USER', d: 'Se corta y confecciona: habilita componentes y apliques.', icon: 'fa-scissors' },
    { id: 'AMBOS', t: 'Local o del cliente', d: 'El cliente elige el origen al pedir.', icon: 'fa-shuffle' },
];

const MODOS = [
    { id: 'LIBRE', label: 'Libre elección', hint: 'todas las opciones activas del catálogo' },
    { id: 'RESTRINGIDO', label: 'Solo las marcadas', hint: 'el cliente elige entre las tildadas' },
    { id: 'FIJA', label: 'Fija', hint: 'se aplica siempre la marcada, sin elección' },
];

const fmtPrecio = (p, m) => (p == null ? '—' : `$ ${Number(p).toLocaleString('es-UY', { maximumFractionDigits: 2 })} ${(m || '').trim() || ''}`.trim());

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
const Pill = ({ on, children, onClick, className = '', disabled = false }) => (
    <button type="button" onClick={onClick} disabled={disabled}
        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all disabled:opacity-50 ${on ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'} ${className}`}>
        {children}
    </button>
);

const Toggle = ({ on, onChange, disabled }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
        className={`w-10 h-[22px] rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-slate-300'} ${disabled ? 'opacity-50' : ''}`}>
        <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'right-[3px]' : 'left-[3px]'}`}></span>
    </button>
);

// Miniatura de producto: foto del catálogo si hay; si no, placeholder con ícono
const Thumb = ({ src, size = 40, icon = 'fa-shirt', rounded = 'rounded-lg' }) => (
    <div className={`${rounded} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0 relative`}
        style={{ width: size, height: size }}>
        <i className={`fa-solid ${icon} text-slate-400`} style={{ fontSize: Math.round(size * 0.4) }}></i>
        {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => e.currentTarget.remove()} />}
    </div>
);

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
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Piezas {modelo ? 'del modelo' : 'del molde'}</span>
                    <span className="text-[11px] text-slate-400">{modelo ? `${piezas.length} de ${detalle.length} piezas del molde` : `${piezas.length} piezas`} · {fijas} con tela fija</span>
                </div>
                {(molde.modelos || []).length > 0 && setModeloVista && (
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-[11px]">
                        <span className="font-bold text-slate-500">Ver las piezas de</span>
                        <select value={modeloVista} onChange={e => setModeloVista(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold bg-white">
                            <option value="">Todo el molde ({detalle.length} piezas)</option>
                            {(molde.modelos || []).map(m => <option key={m.clave} value={m.clave}>{m.nombre}{vendidos?.has(m.clave) ? (vendidos.get(m.clave)?.esDefault ? ' ⭐' : ' ✓') : ''}</option>)}
                        </select>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 text-[11px]">
                    {onLeerCarpeta && conSilueta === 0 && (
                        <button type="button" onClick={onLeerCarpeta} disabled={leyendoCarpeta} className="ml-auto order-last rounded-lg border border-slate-300 px-2.5 py-1 font-bold text-slate-600 hover:border-slate-400 disabled:opacity-50"
                            title="Busca en la carpeta de PDFs de moldes del servidor y arma las siluetas de los moldes que aún no las tienen">
                            <i className="fa-solid fa-folder-open mr-1"></i>{leyendoCarpeta ? 'Leyendo la carpeta…' : 'Leer PDFs de la carpeta de moldes'}
                        </button>
                    )}
                    {conSilueta > 0
                        ? <span className="text-emerald-700 font-bold"><i className="fa-solid fa-circle-check mr-1"></i>Siluetas reales: {conSilueta} de {piezas.length} piezas</span>
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
                                            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 font-bold whitespace-nowrap" title="Tela fija del molde en TizadaPro"><i className="fa-solid fa-lock text-[9px]"></i>{tela}</span>
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

const ToolCard = ({ icon, iconBg, title, subtitle, onClick, footer }) => (
    <button onClick={onClick}
        className="group bg-white rounded-2xl border border-slate-200 hover:border-cyan-400 hover:shadow-xl hover:shadow-cyan-500/10 transition-all p-6 text-left flex flex-col gap-3 relative overflow-hidden">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg bg-gradient-to-br ${iconBg} shadow-sm`}>
            <i className={`fa-solid ${icon}`}></i>
        </div>
        <div>
            <h3 className="font-black text-slate-800 group-hover:text-cyan-700 transition-colors">{title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-snug">{subtitle}</p>
        </div>
        {footer && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-auto">{footer}</span>}
        <i className="fa-solid fa-chevron-right absolute right-5 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all"></i>
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
    fichaDisenoCosturas: (d.fichaDisenoCosturas || []).map(c => ({ union: c.UnionNombre, iso: c.CodigoISO })),
    avios: (d.avios || []).map(a => ({ avioId: a.AvioID || '', nombre: a.Nombre || '', cantidad: a.Cantidad ?? 1, unidad: a.Unidad || 'u', medida: a.Medida || '', nota: a.Nota || '' })),
});

const formToPayload = (f) => ({
    ...(f.esCombo ? {} : { tizadaProMoldeRef: f.tizadaProMoldeRef || null }),
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
        fichaDisenoCosturas: f.fichaDisenoCosturas.filter(c => c.union && c.iso).map(c => ({ union: c.union, iso: c.iso })),
        avios: f.avios.filter(a => (a.nombre || '').trim()).map(a => ({ avioId: a.avioId || null, nombre: a.nombre.trim(), cantidad: Number(a.cantidad) || 1, unidad: a.unidad || null, medida: a.medida || null, nota: a.nota || null })),
    }),
});

// ═════════════════════════════════════════════════════════════════════════
export default function ConfigurarProductosPage() {
    const [familia, setFamilia] = useState('prendas');       // 'prendas' | 'ecouv'
    const [vista, setVista] = useState('confeccionados');     // 'confeccionados' | 'combos' | 'tecnicas'

    // Datos compartidos
    const [productos, setProductos] = useState([]);
    const [tecnicasCat, setTecnicasCat] = useState([]);       // TecnicaOpciones (all)
    const [moldesTp, setMoldesTp] = useState([]);             // moldes de TizadaPro (solo lectura): modelos, piezas, talles, telas
    const [moldesTpError, setMoldesTpError] = useState(null);  // TizadaPro no se puede leer (base o permiso)
    const [costurasIsoCat, setCosturasIsoCat] = useState([]); // CosturasISO (catálogo, ficha de diseño; incluye inactivas)
    const [aviosCat, setAviosCat] = useState([]);             // CatalogoAvios (incluye inactivos)
    const [locales, setLocales] = useState([]);               // productos del local
    const [stockDisponible, setStockDisponible] = useState(true);
    const [familiasCat, setFamiliasCat] = useState([]);        // variantes StockArt del grupo 2.1 (familias reales)
    const [loading, setLoading] = useState(false);

    // Editor
    const [form, setForm] = useState(null);
    const [paso, setPaso] = useState('origen');
    const [origenAbierto, setOrigenAbierto] = useState(false); // false = origen fijo, muestra barra compacta con "Cambiar"
    const [saving, setSaving] = useState(false);
    const [fichaLoading, setFichaLoading] = useState(false);

    // Lista
    const [busca, setBusca] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('');
    const [nuevoNombre, setNuevoNombre] = useState('');
    const [creando, setCreando] = useState(false);
    const [showNuevo, setShowNuevo] = useState(false);
    const [moviendoFamilia, setMoviendoFamilia] = useState(false);
    const [showNuevaFamilia, setShowNuevaFamilia] = useState(false);
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
            const [t, iso, av] = await Promise.all([
                api.get(`${API}/tecnicas?all=1`),
                api.get(`${API}/costuras-iso?all=1`),
                api.get(`${API}/avios?all=1`),
            ]);
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
    useEffect(() => { if (familia === 'ecouv' && !ecouvStats) loadEcouvStats(); }, [familia, ecouvStats, loadEcouvStats]);

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

    const abrirProducto = async (proId) => {
        setFichaLoading(true);
        try {
            const { data } = await api.get(`${API}/productos/${proId}`);
            const f = fichaToForm(data.data);
            setForm(f);
            setPaso(f.esCombo ? 'combo' : 'origen');
            setOrigenAbierto(false); // cada producto arranca mostrando el origen fijo, no las 4 tarjetas
        } catch (e) {
            toast.error('Error abriendo la ficha: ' + (e.response?.data?.error || e.message));
        } finally { setFichaLoading(false); }
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
            toast.success('✅ Dibujo cargado');
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
        if (!form.esCombo && form.apliques.some(ap => !ap.pieza))
            return toast.error('Cada aplique necesita una pieza del molde. Elegila en "Molde, telas y apliques".');
        if (!form.esCombo && form.estado === 'PUBLICADO' && form.origenTipo === 'CONFECCIONADO') {
            if (!form.tizadaProMoldeRef) return toast.error('Para publicar, primero vinculá el molde de TizadaPro (paso "Molde, telas y apliques").');
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

    // Resumen de chips del header
    const chips = useMemo(() => {
        const conConfig = productos.filter(p => p.Estado);
        return {
            publicados: conConfig.filter(p => p.Estado === 'PUBLICADO').length,
            borradores: conConfig.filter(p => p.Estado === 'BORRADOR').length,
            paquetes: productos.filter(esCombo).length,
            sinConfig: productos.length - conConfig.length,
        };
    }, [productos]);

    const productosFiltrados = useMemo(() => productos.filter(p => {
        if (busca && !(`${p.Descripcion} ${p.CodArticulo} ${p.Etiqueta || ''}`.toLowerCase().includes(busca.toLowerCase()))) return false;
        if (filtroEstado === 'PUBLICADO' || filtroEstado === 'BORRADOR') return p.Estado === filtroEstado;
        if (filtroEstado === 'SIN') return !p.Estado;
        return true;
    }), [productos, busca, filtroEstado]);

    // Dos pestañas separadas: confeccionados (agrupados por familia) y combos (lista simple)
    const confeccionadosFiltrados = useMemo(() => productosFiltrados.filter(p => !esCombo(p)), [productosFiltrados]);
    const combosFiltrados = useMemo(() => productosFiltrados.filter(esCombo), [productosFiltrados]);

    // Lista agrupada por tipo de prenda; los grupos se pueden plegar (la búsqueda los ignora)
    const [gruposCerrados, setGruposCerrados] = useState(() => new Set());
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
    const toggleGrupo = (nombre) => setGruposCerrados(prev => {
        const next = new Set(prev);
        next.has(nombre) ? next.delete(nombre) : next.add(nombre);
        return next;
    });
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
    useEffect(() => { setShowNuevaEtiqueta(false); setNuevaEtiquetaNombre(''); setRenombreEtiqueta(null); }, [form?.proId]);
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

    // Fila de un producto en la lista (suelto o dentro de su etiqueta). Siempre con su nombre completo.
    const filaProducto = (p, anidado = false) => (
        <button key={p.ProIdProducto} onClick={() => abrirProducto(p.ProIdProducto)}
            className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors flex items-center gap-2.5 ${form?.proId === p.ProIdProducto ? 'bg-indigo-50/60 border-l-4 border-indigo-500' : 'border-l-4 border-transparent'}`}>
            <Thumb src={p.Imagen} size={anidado ? 32 : 36} icon="fa-shirt" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[13px] text-slate-700 truncate">{p.Descripcion}</span>
                    {p.Estado === 'PUBLICADO' && <span className="text-[10px] font-black text-emerald-600 flex-shrink-0">● PUB</span>}
                    {p.Estado === 'BORRADOR' && <span className="text-[10px] font-black text-slate-400 flex-shrink-0">○ BORR</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                    <span className="font-mono">{p.CodArticulo}</span>
                    <span>{fmtPrecio(p.Precio, p.Moneda)}</span>
                    {p.CantidadMinima && <span>mín. {p.CantidadMinima}</span>}
                    {p.Tecnicas && <span className="truncate">{p.Tecnicas}</span>}
                </div>
            </div>
        </button>
    );

    const origenSel = useMemo(() => locales.find(l => l.ProIdProducto === form?.origenProIdProducto) || null, [locales, form?.origenProIdProducto]);

    const pasos = useMemo(() => {
        if (!form) return [];
        if (form.esCombo) return [
            { id: 'combo', n: 1, label: 'Composición del combo' },
            { id: 'precio', n: 2, label: 'Precio del paquete' },
            { id: 'resumen', n: 3, label: 'Revisar y publicar' },
        ];
        return [
            { id: 'origen', n: 1, label: 'Origen' },
            { id: 'tecnicas', n: 2, label: 'Técnicas' },
            { id: 'precio', n: 3, label: 'Precio y cantidades' },
            ...(form.origenTipo === 'CONFECCIONADO' ? [{ id: 'molde', n: 4, label: 'Molde, telas y apliques' }] : []),
            ...(form.origenTipo === 'CONFECCIONADO' ? [{ id: 'ficha', n: 5, label: 'Ficha de diseño' }] : []),
            { id: 'resumen', n: form.origenTipo === 'CONFECCIONADO' ? 6 : 4, label: 'Revisar y publicar' },
        ];
    }, [form]);

    const setF = (patch) => setForm(prev => ({ ...prev, ...patch }));
    // Primera opción activa del catálogo de una técnica (default de un aplique nuevo); '' = opción libre
    const primeraOpcionDe = (areaId) => tecnicasCat.find(o => o.AreaID === areaId && o.Activo)?.TecnicaOpcionID ?? '';
    const moldeSel = useMemo(() => (form?.tizadaProMoldeRef ? moldesTp.find(m => m.ref === form.tizadaProMoldeRef) || null : null), [moldesTp, form?.tizadaProMoldeRef]);
    // Material y Tallas de la ficha salen del molde de TizadaPro y de las telas ofrecidas.
    // Se rellenan solos cuando están vacíos; el usuario puede pisarlos o volver al automático.
    const autoFicha = useMemo(() => {
        if (!moldeSel) return { material: '', tallas: '' };
        const telas = [...(form?.telas || new Map()).values()];
        const primera = telas.find(t => t.esDefault) || telas[0];
        const material = telas.length ? (telas.length === 1 ? primera.material : `${primera.material} (o ${telas.filter(t => t !== primera).map(t => t.material).join(', ')})`) : '';
        const tallas = agruparTalles(moldeSel.talles).map(([g, l]) => `${g} ${l[0].replace(/fem$/i, '')}–${l[l.length - 1].replace(/fem$/i, '')}`).join(' · ');
        return { material, tallas };
    }, [moldeSel, form?.telas]);
    useEffect(() => {
        if (!form || form.esCombo || !moldeSel) return;
        const patch = {};
        if (!form.fichaDiseno.material && autoFicha.material) patch.material = autoFicha.material;
        if (!form.fichaDiseno.tallas && autoFicha.tallas) patch.tallas = autoFicha.tallas;
        if (Object.keys(patch).length) setForm(prev => ({ ...prev, fichaDiseno: { ...prev.fichaDiseno, ...patch } }));
    }, [autoFicha, form?.proId]);

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
    // Técnicas que admiten aplique: las de decoración activas en el paso Técnicas, más Etiqueta (siempre)
    const tecnicasApliqueActivas = useMemo(() => [...AREAS_DECORACION.filter(x => form?.tecnicas?.[x.id]?.on), AREA_APLIQUE_EXTRA], [form?.tecnicas]);

    // ── render ───────────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                    <i className="fa-solid fa-sliders text-xl"></i>
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Configurar Productos</h1>
                    <p className="text-sm text-slate-400">Especificaciones, terminaciones y precios de todo lo que se vende armado</p>
                </div>
            </div>

            {/* Chips resumen */}
            <div className="flex flex-wrap gap-3 my-5">
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full text-xs font-bold">{chips.publicados} publicados</span>
                <span className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-bold">{chips.borradores} borradores</span>
                <span className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full text-xs font-bold">{chips.paquetes} paquetes promo</span>
                <span className="bg-slate-50 text-slate-400 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-bold">{chips.sinConfig} sin configurar</span>
            </div>

            {/* Familias */}
            <div className="flex gap-2 mb-5">
                <Pill on={familia === 'prendas'} onClick={() => setFamilia('prendas')}>👕 Prendas y Combos</Pill>
                <Pill on={familia === 'ecouv'} onClick={() => setFamilia('ecouv')}>🖨 EcoUV</Pill>
            </div>

            {/* ══════════ FAMILIA ECOUV (embebida, mismos modales) ══════════ */}
            {familia === 'ecouv' && (
                <div>
                    {ecouvStats && (
                        <div className="flex flex-wrap gap-3 mb-5">
                            <span className="bg-cyan-50 text-cyan-700 border border-cyan-200 px-3 py-1.5 rounded-full text-xs font-bold">{ecouvStats.variantes} variantes visibles</span>
                            <span className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-bold">{ecouvStats.articulos} artículos</span>
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full text-xs font-bold">{ecouvStats.terminaciones} terminaciones activas</span>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <ToolCard icon="fa-boxes-stacked" iconBg="from-purple-500 to-fuchsia-600" title="Variantes y Artículos"
                            subtitle="Lonas, Canvas, Vinilos, Cuadros, Pasacalles... Crear variantes, cambiar el tipo, ocultar del portal y mover artículos."
                            footer="Editor StockArt · grupo 1.3" onClick={() => setEcouvModal('variantes')} />
                        <ToolCard icon="fa-scissors" iconBg="from-amber-500 to-orange-600" title="Terminaciones"
                            subtitle="Catálogo con manera de aplicación, precio directo y en qué materiales se ofrece cada una."
                            footer="Única puerta de la matriz material ↔ terminación" onClick={() => setEcouvModal('terminaciones')} />
                        <ToolCard icon="fa-cube" iconBg="from-violet-500 to-purple-700" title="Nuevo Producto Terminado"
                            subtitle="Alta completa en un paso: datos, ficha de producción, terminaciones incluidas y precio cerrado."
                            footer="Artículo + ficha + precio juntos" onClick={() => setEcouvModal('nuevo-pt')} />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-6">
                        <i className="fa-solid fa-circle-info mr-1.5"></i>
                        Es la misma Configuración ECOUV de siempre — la página del sector (/area/ecouv/config) sigue funcionando igual.
                    </p>
                    {ecouvModal === 'variantes' && <StockArtEditModal isOpen={true} initialGrupo={GRUPO_ECOUV} onClose={() => { setEcouvModal(null); loadEcouvStats(); }} />}
                    {ecouvModal === 'terminaciones' && <TerminacionesEcouvModal isOpen={true} onClose={() => { setEcouvModal(null); loadEcouvStats(); }} />}
                    {ecouvModal === 'nuevo-pt' && <NuevoProductoTerminadoModal isOpen={true} onClose={() => setEcouvModal(null)} onCreated={loadEcouvStats} />}
                </div>
            )}

            {/* ══════════ FAMILIA PRENDAS Y COMBOS ══════════ */}
            {familia === 'prendas' && (
                <div>
                    {/* Sub-vistas */}
                    <div className="flex gap-2 mb-4 border-b border-slate-200 pb-3 flex-wrap">
                        {[
                            ['confeccionados', '👕 Productos Confeccionados', confeccionadosFiltrados.length],
                            ['combos', '📦 Combos y Promos', combosFiltrados.length],
                            ['tecnicas', 'Catálogo de técnicas', null],
                            ['avios', 'Catálogo de avíos', null],
                            ['costuras', 'Catálogo de costuras', null],
                        ].map(([id, label, count]) => (
                            <button key={id} onClick={() => setVista(id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${vista === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                                {label}
                                {count != null && <span className={`text-[10px] font-black rounded-full px-1.5 ${vista === id ? 'bg-white/20' : 'bg-slate-200 text-slate-500'}`}>{count}</span>}
                            </button>
                        ))}
                    </div>

                    {(vista === 'confeccionados' || vista === 'combos') && (
                        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
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
                                    <div className="flex gap-1.5 flex-wrap">
                                        {[['', 'Todos'], ['PUBLICADO', 'Publicados'], ['BORRADOR', 'Borradores'], ['SIN', 'Sin configurar']].map(([v, l]) => (
                                            <button key={v} onClick={() => setFiltroEstado(v)}
                                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${filtroEstado === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                                                {l}
                                            </button>
                                        ))}
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
                                            const cerrado = !busca && gruposCerrados.has(g.nombre);
                                            const publicados = g.items.filter(p => p.Estado === 'PUBLICADO').length;
                                            return (
                                                <div key={g.nombre}>
                                                    <button onClick={() => toggleGrupo(g.nombre)}
                                                        className={`w-full sticky top-0 z-10 flex items-center gap-2 px-3.5 py-2 backdrop-blur border-y text-left ${g.nombre === 'Sin clasificar' ? 'bg-amber-50/95 border-amber-100' : 'bg-slate-50/95 border-slate-100'}`}>
                                                        <i className={`fa-solid fa-chevron-${cerrado ? 'right' : 'down'} text-[9px] ${g.nombre === 'Sin clasificar' ? 'text-amber-500' : 'text-slate-400'}`}></i>
                                                        {g.nombre === 'Sin clasificar' && <i className="fa-solid fa-triangle-exclamation text-[9px] text-amber-500"></i>}
                                                        <span className={`text-[11px] font-black uppercase tracking-wider ${g.nombre === 'Sin clasificar' ? 'text-amber-700' : 'text-slate-500'}`}>{g.nombre}</span>
                                                        <span className="text-[10px] font-bold text-slate-400">{g.items.length}</span>
                                                        {publicados > 0 && <span className="ml-auto text-[9px] font-black text-emerald-600">{publicados} pub.</span>}
                                                    </button>
                                                    {!cerrado && <div className="divide-y divide-slate-50">
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
                                                                        <i className={`fa-solid fa-chevron-${abierta ? 'down' : 'right'} text-[9px] text-slate-400 w-3 text-center`}></i>
                                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[12px] font-black">
                                                                            <i className="fa-solid fa-tag text-[10px]"></i>{n.nombre}
                                                                        </span>
                                                                        <span className="text-[11px] text-slate-400">{n.items.length} producto{n.items.length === 1 ? '' : 's'}</span>
                                                                        {pubEt > 0 && <span className="ml-auto text-[9px] font-black text-emerald-600">{pubEt} pub.</span>}
                                                                    </button>
                                                                    {abierta && (
                                                                        <div className="ml-5 border-l-2 border-indigo-100 divide-y divide-slate-50">
                                                                            {n.items.map(p => filaProducto(p, true))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>}
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
                                            {combosFiltrados.map(p => (
                                                <button key={p.ProIdProducto} onClick={() => abrirProducto(p.ProIdProducto)}
                                                    className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors flex items-center gap-2.5 ${form?.proId === p.ProIdProducto ? 'bg-indigo-50/60 border-l-4 border-indigo-500' : 'border-l-4 border-transparent'}`}>
                                                    <Thumb src={p.Imagen} size={36} icon="fa-boxes-stacked" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="font-bold text-[13px] text-slate-700 truncate">{p.Descripcion}</span>
                                                            {p.Estado === 'PUBLICADO' && <span className="text-[10px] font-black text-emerald-600 flex-shrink-0">● PUB</span>}
                                                            {p.Estado === 'BORRADOR' && <span className="text-[10px] font-black text-slate-400 flex-shrink-0">○ BORR</span>}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                                                            <span className="font-mono">{p.CodArticulo}</span>
                                                            <span>{fmtPrecio(p.Precio, p.Moneda)}</span>
                                                            {p.CantidadFija && <span className="text-amber-600 font-bold">📦 ×{p.CantidadFija}</span>}
                                                            {p.ComboItems > 0 && <span className="text-amber-600 font-bold">📦 {p.ComboItems} productos</span>}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
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
                                        {/* Header del editor */}
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
                                                                className="text-slate-300 hover:text-indigo-600 text-xs" title="Cambiar el nombre o el código del producto"><i className="fa-solid fa-pen"></i></button>
                                                        </div>
                                                        <div className="text-[11px] text-slate-400 font-mono">
                                                            {form.codArticulo} · {form.categoria || 'sin categoría'} · {fmtPrecio(form.precio === '' ? null : form.precio, form.moneda)}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-[11px] font-black ${form.estado === 'PUBLICADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {form.estado === 'PUBLICADO' ? '● PUBLICADO' : '○ BORRADOR'}
                                            </span>
                                            <button onClick={guardar} disabled={saving}
                                                className="bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-slate-700 disabled:opacity-50">
                                                {saving ? 'Guardando…' : '💾 Guardar'}
                                            </button>
                                        </div>

                                        {/* Familia = variante de StockArt (Grupo 2.1) — mover acá mueve el artículo de verdad */}
                                        {!form.esCombo && (
                                            <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-slate-100 bg-slate-50/50 flex-wrap">
                                                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Familia</span>
                                                <div className="flex gap-1.5 flex-wrap">
                                                    {familiasCat.map(fam => (
                                                        <Pill key={fam.CodStock} on={form.codStock === fam.CodStock} disabled={moviendoFamilia}
                                                            onClick={() => fam.CodStock !== form.codStock && moverAFamilia(fam.CodStock)}>
                                                            {fam.Articulo}
                                                        </Pill>
                                                    ))}
                                                    {!showNuevaFamilia ? (
                                                        <button type="button" onClick={() => setShowNuevaFamilia(true)}
                                                            className="px-3 py-1.5 rounded-full text-xs font-bold border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600">
                                                            + Nueva familia
                                                        </button>
                                                    ) : (
                                                        <span className="inline-flex gap-1.5 items-center">
                                                            <input value={nuevaFamiliaNombre} onChange={e => setNuevaFamiliaNombre(e.target.value)}
                                                                onKeyDown={e => e.key === 'Enter' && crearFamiliaNueva()}
                                                                placeholder="Ej. Medias" autoFocus
                                                                className="border border-indigo-300 rounded-full px-3 py-1.5 text-xs w-32" />
                                                            <button onClick={crearFamiliaNueva} disabled={creandoFamilia}
                                                                className="bg-indigo-600 text-white rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50">
                                                                {creandoFamilia ? '…' : 'Crear'}
                                                            </button>
                                                            <button onClick={() => { setShowNuevaFamilia(false); setNuevaFamiliaNombre(''); }} className="text-slate-400 text-xs px-1">×</button>
                                                        </span>
                                                    )}
                                                </div>
                                                {form.categoria === 'Prendas' && <span className="text-[11px] font-bold text-amber-600 ml-1">⚠ sin clasificar — elegí una</span>}
                                            </div>
                                        )}

                                        {/* Etiqueta = para qué es el producto (Básquet, Fútbol…). Es el nivel del
                                            árbol entre la familia y el producto. Se aplica al instante, como la familia. */}
                                        {!form.esCombo && (() => {
                                            const actual = productos.find(p => p.ProIdProducto === form.proId);
                                            const etqId = actual?.EtiquetaID || null;
                                            const etqNombre = actual?.Etiqueta || '';
                                            return (
                                                <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-slate-100 bg-slate-50/50 flex-wrap">
                                                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Etiqueta</span>
                                                    <div className="flex gap-1.5 flex-wrap items-center">
                                                        <Pill on={!etqId} disabled={guardandoEtiqueta} onClick={() => etqId && asignarEtiqueta(null)}>Sin etiqueta</Pill>
                                                        {etiquetasCat.map(e => (
                                                            <Pill key={e.EtiquetaID} on={etqId === e.EtiquetaID} disabled={guardandoEtiqueta}
                                                                onClick={() => e.EtiquetaID !== etqId && asignarEtiqueta(e.EtiquetaID)}>
                                                                <i className="fa-solid fa-tag text-[9px] mr-1 opacity-60"></i>{e.Nombre}
                                                            </Pill>
                                                        ))}
                                                        {!showNuevaEtiqueta ? (
                                                            <button type="button" onClick={() => { setShowNuevaEtiqueta(true); setRenombreEtiqueta(null); }}
                                                                className="px-3 py-1.5 rounded-full text-xs font-bold border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600">
                                                                + Nueva etiqueta
                                                            </button>
                                                        ) : (
                                                            <span className="inline-flex gap-1.5 items-center">
                                                                <input value={nuevaEtiquetaNombre} onChange={e => setNuevaEtiquetaNombre(e.target.value)}
                                                                    onKeyDown={e => e.key === 'Enter' && crearYAsignarEtiqueta()}
                                                                    placeholder="Ej. Hándbol" autoFocus
                                                                    className="border border-indigo-300 rounded-full px-3 py-1.5 text-xs w-32" />
                                                                <button onClick={crearYAsignarEtiqueta} disabled={guardandoEtiqueta}
                                                                    className="bg-indigo-600 text-white rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50">
                                                                    {guardandoEtiqueta ? '…' : 'Crear y asignar'}
                                                                </button>
                                                                <button onClick={() => { setShowNuevaEtiqueta(false); setNuevaEtiquetaNombre(''); }} className="text-slate-400 text-xs px-1" title="Cancelar">×</button>
                                                            </span>
                                                        )}
                                                        {etqId && (renombreEtiqueta === null ? (
                                                            <button type="button" onClick={() => { setRenombreEtiqueta(etqNombre); setShowNuevaEtiqueta(false); }}
                                                                className="px-2 py-1.5 text-xs font-bold text-slate-400 hover:text-slate-600" title="Cambia el nombre de la etiqueta en todos los productos que la tienen">
                                                                ✎ Renombrar etiqueta
                                                            </button>
                                                        ) : (
                                                            <span className="inline-flex gap-1.5 items-center">
                                                                <input value={renombreEtiqueta} onChange={e => setRenombreEtiqueta(e.target.value)}
                                                                    onKeyDown={e => e.key === 'Enter' && renombrarEtiqueta(etqId)}
                                                                    autoFocus className="border border-indigo-300 rounded-full px-3 py-1.5 text-xs w-36" />
                                                                <button onClick={() => renombrarEtiqueta(etqId)} disabled={guardandoEtiqueta}
                                                                    className="bg-indigo-600 text-white rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50">
                                                                    {guardandoEtiqueta ? '…' : 'Guardar nombre'}
                                                                </button>
                                                                <button onClick={() => setRenombreEtiqueta(null)} className="text-slate-400 text-xs px-1" title="Cancelar">×</button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <span className="text-[11px] text-slate-400 w-full">Para qué es el producto. Agrupa la lista: Camisetas › Básquet › …</span>
                                                </div>
                                            );
                                        })()}

                                        {/* Pasos */}
                                        <div className="flex gap-1.5 px-5 pt-4 flex-wrap">
                                            {pasos.map(s => (
                                                <button key={s.id} onClick={() => setPaso(s.id)}
                                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${paso === s.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${paso === s.id ? 'bg-white text-slate-800' : 'bg-slate-200 text-slate-500'}`}>{s.n}</span>
                                                    {s.label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="p-5">
                                            {/* ── PASO ORIGEN ── */}
                                            {paso === 'origen' && (() => {
                                                const actual = ORIGENES.find(o => o.id === form.origenTipo) || ORIGENES[0];
                                                return (
                                                <div className="space-y-3">
                                                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">¿De dónde sale la prenda?</p>

                                                    {!origenAbierto ? (
                                                        /* Origen fijo: la mayoría de los productos no admite otra opción — se
                                                           muestra como dato, no como pregunta. "Cambiar" revela las 4 tarjetas
                                                           para los casos puntuales que sí necesitan otro origen. */
                                                        <div className="flex items-center gap-3 border-2 border-emerald-500 bg-emerald-50/40 rounded-xl p-3.5">
                                                            <i className={`fa-solid ${actual.icon} text-emerald-600`}></i>
                                                            <div className="flex-1">
                                                                <div className="font-bold text-sm text-slate-700">{actual.t}</div>
                                                                <div className="text-xs text-slate-400">{actual.d}</div>
                                                            </div>
                                                            <button type="button" onClick={() => setOrigenAbierto(true)}
                                                                className="text-xs font-bold text-emerald-700 hover:text-emerald-800 underline underline-offset-2 flex-shrink-0">
                                                                Cambiar
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {ORIGENES.map(o => (
                                                                <div key={o.id}
                                                                    className={`border-2 rounded-xl p-3.5 cursor-pointer transition-all ${form.origenTipo === o.id ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'}`}
                                                                    onClick={() => { setF({ origenTipo: o.id }); setOrigenAbierto(false); }}>
                                                                    <div className="flex items-center gap-3">
                                                                        <i className={`fa-solid ${o.icon} ${form.origenTipo === o.id ? 'text-emerald-600' : 'text-slate-400'}`}></i>
                                                                        <div className="flex-1">
                                                                            <div className="font-bold text-sm text-slate-700">{o.t}</div>
                                                                            <div className="text-xs text-slate-400">{o.d}</div>
                                                                        </div>
                                                                        <span className={`w-4 h-4 rounded-full border-2 ${form.origenTipo === o.id ? 'border-emerald-500 bg-emerald-500 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300'}`}></span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            <button type="button" onClick={() => setOrigenAbierto(false)}
                                                                className="text-xs font-bold text-slate-400 hover:text-slate-600">
                                                                Cancelar
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Sub-selector de producto del local — siempre visible si el origen lo
                                                        necesita, esté la barra de arriba abierta o cerrada */}
                                                    {(form.origenTipo === 'LOCAL' || form.origenTipo === 'AMBOS') && (
                                                        <div className="border border-slate-200 rounded-xl p-3.5">
                                                            <p className="text-[11px] font-bold text-slate-400 mb-2">
                                                                Elegí de qué producto del local sale
                                                                {!stockDisponible && <span className="text-amber-600 ml-2">⚠ stock del local sin conexión — se muestra la lista igual</span>}
                                                            </p>
                                                            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                                                                {locales.map(l => (
                                                                    <div key={l.ProIdProducto} onClick={() => setF({ origenProIdProducto: l.ProIdProducto })}
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
                                                        </div>
                                                    )}

                                                    {/* Validar stock — solo tiene sentido si el origen toca stock del local */}
                                                    {(form.origenTipo === 'LOCAL' || form.origenTipo === 'AMBOS') && (
                                                        <div className="flex items-center gap-3 border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                                                            <Toggle on={form.validarStock} onChange={v => setF({ validarStock: v })} />
                                                            <div>
                                                                <div className="font-bold text-sm text-slate-700">Validar stock del local al pedir</div>
                                                                <div className="text-xs text-slate-400">Apagalo solo como contingencia: si se cae el sistema de stock, la venta sigue funcionando.</div>
                                                            </div>
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
                                                                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${a.grad} text-white flex items-center justify-center flex-shrink-0`}>
                                                                                <i className={`fa-solid ${a.icon} text-xs`}></i>
                                                                            </div>
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
                                                                                    <select value={t.modo} onChange={e => setT({ modo: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 bg-white">
                                                                                        <option value="LIBRE">Cualquiera del catálogo</option>
                                                                                        <option value="RESTRINGIDO">Solo las marcadas</option>
                                                                                        <option value="FIJA">Una fija</option>
                                                                                    </select>
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
                                                                                                    : <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${a.grad} text-white flex items-center justify-center`}><i className={`fa-solid ${a.icon} text-xs`}></i></span>}
                                                                                                <span className="text-[10.5px] font-bold text-slate-600 leading-tight text-center">{o.Nombre}</span>
                                                                                                <span className="text-[10px] font-black text-emerald-600">{o.Precio != null ? fmtPrecio(o.Precio, o.Moneda) : <span className="text-slate-300">sin precio</span>}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        )}
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
                                                            <div className="space-y-3">{AREAS_CONSTRUCCION.map(renderTecnicaCard)}</div>
                                                        </div>
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Decoración</p>
                                                            <div className="space-y-3">{AREAS_DECORACION.map(renderTecnicaCard)}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* ── PASO COMPOSICIÓN DEL COMBO (agregar productos + servicios por producto) ── */}
                                            {paso === 'combo' && form.esCombo && (
                                                <div className="space-y-3">
                                                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                                                        Armá el combo: agregá productos y colgale los servicios a cada uno
                                                    </p>
                                                    {form.comboItems.length === 0 && (
                                                        <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400">
                                                            El combo está vacío — agregá el primer producto.
                                                        </div>
                                                    )}
                                                    {form.comboItems.map((it, i) => {
                                                        const loc = locales.find(l => l.ProIdProducto === Number(it.itemProIdProducto));
                                                        const setItem = (patch) => { const next = [...form.comboItems]; next[i] = { ...it, ...patch }; setF({ comboItems: next }); };
                                                        return (
                                                            <div key={i} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                                                                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                                                                    <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                                                    <Thumb src={loc?.Imagen} size={34} />
                                                                    <select value={it.itemProIdProducto}
                                                                        onChange={e => {
                                                                            const l2 = locales.find(x => x.ProIdProducto === Number(e.target.value));
                                                                            setItem({ itemProIdProducto: Number(e.target.value), itemNombre: l2?.Descripcion || '', wmsVarianteId: '', varianteNombre: '' });
                                                                        }}
                                                                        className="flex-1 min-w-[150px] border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold">
                                                                        {!loc && it.itemProIdProducto && <option value={it.itemProIdProducto}>{it.itemNombre || `#${it.itemProIdProducto}`}</option>}
                                                                        {locales.map(l => <option key={l.ProIdProducto} value={l.ProIdProducto}>{l.Descripcion}</option>)}
                                                                    </select>
                                                                    <select value={it.wmsVarianteId || ''}
                                                                        onChange={e => {
                                                                            const v2 = (loc?.variantes || []).find(v => v.wmsVarianteId === Number(e.target.value));
                                                                            setItem({ wmsVarianteId: e.target.value ? Number(e.target.value) : '', varianteNombre: v2?.nombre || '' });
                                                                        }}
                                                                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs max-w-[190px]">
                                                                        <option value="">El cliente elige talle/color</option>
                                                                        {(loc?.variantes || []).map(v => (
                                                                            <option key={v.wmsVarianteId} value={v.wmsVarianteId}>{v.nombre}{v.stock != null ? ` (${v.stock} u)` : ''}</option>
                                                                        ))}
                                                                    </select>
                                                                    <input type="number" min="1" value={it.cantidad} title="Cantidad en el paquete"
                                                                        onChange={e => setItem({ cantidad: e.target.value })}
                                                                        className="w-14 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold" />
                                                                    <button type="button" onClick={() => setF({ comboItems: form.comboItems.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1.5">×</button>
                                                                </div>
                                                                {/* Servicios de ESTE producto del combo */}
                                                                <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 flex flex-wrap items-center gap-1.5">
                                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">Servicios:</span>
                                                                    {AREAS.map(a => {
                                                                        const srv = (it.servicios || []).find(s => s.areaId === a.id);
                                                                        const corto = servicioCorto(a.id);
                                                                        return (
                                                                            <span key={a.id} className="inline-flex items-center gap-1">
                                                                                <button type="button"
                                                                                    onClick={() => setItem({
                                                                                        servicios: srv
                                                                                            ? (it.servicios || []).filter(s => s.areaId !== a.id)
                                                                                            : [...(it.servicios || []), { areaId: a.id, tecnicaOpcionId: '', incluido: true }]
                                                                                    })}
                                                                                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${srv ? `${a.chip} border-transparent` : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                                                                                    {srv ? '✓ ' : '+ '}{corto}
                                                                                </button>
                                                                                {srv && (
                                                                                    <select value={srv.tecnicaOpcionId || ''}
                                                                                        onChange={e => setItem({ servicios: it.servicios.map(s => s.areaId === a.id ? { ...s, tecnicaOpcionId: e.target.value ? Number(e.target.value) : '' } : s) })}
                                                                                        className="border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] max-w-[160px] bg-white">
                                                                                        <option value="">opción libre</option>
                                                                                        {tecnicasCat.filter(o => o.AreaID === a.id && o.Activo).map(o => (
                                                                                            <option key={o.TecnicaOpcionID} value={o.TecnicaOpcionID}>{o.Nombre}</option>
                                                                                        ))}
                                                                                    </select>
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
                                                        className="border border-dashed border-slate-300 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:border-slate-400 w-full">
                                                        + Agregar producto al combo
                                                    </button>
                                                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                        1 paquete = esta composición exacta. Donde dice “el cliente elige”, en el pedido elige el talle/color de ese ítem.
                                                        Los servicios marcados <b>incluido</b> van dentro del precio del combo; los marcados <b>se cobra</b> se suman al cotizar
                                                        (la matriz de bordado/TPU se cobra la 1ª vez, como siempre).
                                                    </p>
                                                </div>
                                            )}

                                            {/* ── PASO PRECIO Y CANTIDADES ── */}
                                            {paso === 'precio' && (
                                                <div className="grid md:grid-cols-2 gap-4 items-start">
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">{form.esCombo ? 'Precio del paquete' : 'Precio del producto'}</p>
                                                        <div className="flex gap-2 items-center">
                                                            <input type="number" step="0.01" min="0" value={form.precio}
                                                                onChange={e => setF({ precio: e.target.value })}
                                                                placeholder="0.00"
                                                                className="w-36 border border-slate-200 rounded-lg px-3 py-2 text-lg font-black focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                            <select value={form.moneda} onChange={e => setF({ moneda: e.target.value })}
                                                                className="border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold">
                                                                <option>UYU</option><option>USD</option>
                                                            </select>
                                                        </div>
                                                        <p className="text-xs text-slate-400 mt-3">
                                                            {form.esCombo
                                                                ? 'Precio cerrado del paquete completo: incluye todo lo marcado “incluido” en la composición.'
                                                                : form.politica === 'PAQUETE'
                                                                    ? 'Es el precio cerrado DEL PAQUETE completo (las técnicas incluidas no generan línea aparte).'
                                                                    : 'Precio base sin servicios: bordado, TPU y DTF se suman al cotizar según el catálogo.'}
                                                        </p>
                                                    </div>
                                                    {form.esCombo ? (
                                                        <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-4">
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-amber-700 mb-2">Cantidad</p>
                                                            <p className="text-xs text-slate-600 leading-relaxed">
                                                                El cliente pide <b>paquetes enteros</b>: 1 paquete = la composición del paso anterior, tal cual.
                                                                Lo marcado <b>“se cobra”</b> en la composición se suma aparte al cotizar; el resto va dentro de este precio.
                                                            </p>
                                                        </div>
                                                    ) : (
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">Política de cantidad</p>
                                                        <div className="flex gap-1.5 flex-wrap mb-3">
                                                            {[['LIBRE', 'Libre'], ['MINIMA', 'Cantidad mínima'], ['PAQUETE', 'Paquete fijo']].map(([v, l]) => (
                                                                <Pill key={v} on={form.politica === v} onClick={() => setF({ politica: v })}>{l}</Pill>
                                                            ))}
                                                        </div>
                                                        {form.politica === 'MINIMA' && (
                                                            <label className="block text-xs font-bold text-slate-500">
                                                                Mínimo por pedido
                                                                <input type="number" min="1" value={form.cantidadMinima}
                                                                    onChange={e => setF({ cantidadMinima: e.target.value })}
                                                                    className="block w-28 mt-1 border border-slate-200 rounded-lg px-3 py-2 text-base font-black" />
                                                            </label>
                                                        )}
                                                        {form.politica === 'PAQUETE' && (
                                                            <div className="space-y-3">
                                                                <label className="block text-xs font-bold text-slate-500">
                                                                    Cantidad fija del paquete <span className="font-normal text-slate-400">(unidades de este producto — para mezclar productos distintos creá un Combo con “+”)</span>
                                                                    <input type="number" min="1" value={form.cantidadFija}
                                                                        onChange={e => setF({ cantidadFija: e.target.value })}
                                                                        className="block w-28 mt-1 border border-slate-200 rounded-lg px-3 py-2 text-base font-black" />
                                                                </label>
                                                                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                                    El cliente no puede pedir más ni menos: la cantidad va bloqueada en {form.cantidadFija || 'N'}.
                                                                </p>
                                                                {origenSel && (
                                                                    <div>
                                                                        <p className="text-[11px] font-bold text-slate-400 mb-1.5">
                                                                            Surtido del paquete — variantes admitidas de “{origenSel.Descripcion}” (ninguna tildada = todas):
                                                                        </p>
                                                                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                                                                            {origenSel.variantes.map(v => {
                                                                                const on = form.surtido.has(v.wmsVarianteId);
                                                                                return (
                                                                                    <label key={v.wmsVarianteId} className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 cursor-pointer">
                                                                                        <input type="checkbox" checked={on} onChange={() => {
                                                                                            const next = new Set(form.surtido);
                                                                                            on ? next.delete(v.wmsVarianteId) : next.add(v.wmsVarianteId);
                                                                                            setF({ surtido: next });
                                                                                        }} />
                                                                                        <span className="flex-1">{v.nombre}</span>
                                                                                        <span className="text-slate-400 font-normal">{v.stock == null ? 's/d' : `${v.stock} u`}</span>
                                                                                    </label>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {!origenSel && (form.origenTipo === 'LOCAL' || form.origenTipo === 'AMBOS') && (
                                                                    <p className="text-[11px] text-slate-400">Elegí el producto del local en el paso Origen para definir el surtido.</p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* ── PASO COMPONENTES Y APLIQUES (confeccionados) ── */}
                                            {paso === 'molde' && (
                                                <div className="space-y-4">
                                                    {/* Molde de TizadaPro (solo lectura): el molde, sus piezas, talles y modelos viven allá */}
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Molde de TizadaPro</p>
                                                        <p className="text-[11px] text-slate-400 mb-3">El molde, sus piezas, sus talles y sus modelos se cargan en TizadaPro. Acá solo se elige cuál es el de este producto.</p>
                                                        {moldesTpError && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-xs font-bold mb-3">No se pudo leer TizadaPro: {moldesTpError}</div>}
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <select value={form.tizadaProMoldeRef || ''} disabled={!!moldesTpError}
                                                                onChange={e => setF({ tizadaProMoldeRef: e.target.value, modelos: new Map(), telas: new Map() })}
                                                                className="min-w-[280px] border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold">
                                                                <option value="">Sin molde vinculado</option>
                                                                {form.tizadaProMoldeRef && !moldeSel && <option value={form.tizadaProMoldeRef}>{form.tizadaProMoldeRef} (ya no está en TizadaPro)</option>}
                                                                {moldesTp.map(m => <option key={m.ref} value={m.ref}>{m.nombre}{m.completo ? '' : ' (sin piezas o talles)'}</option>)}
                                                            </select>
                                                            <button type="button" onClick={loadMoldesTp} className="text-xs font-bold text-slate-500 hover:text-slate-700" title="Volver a leer los moldes de TizadaPro">↻ Actualizar</button>
                                                            <span className="text-[11px] text-slate-400">Cambiar el molde borra los modelos y las telas elegidos.</span>
                                                            {moldeSel && <span className="text-[10px] font-mono text-slate-300 ml-auto" title="Clave del molde en TizadaPro">{moldeSel.ref}</span>}
                                                        </div>
                                                    </div>

                                                    {moldeSel && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Modelos que se venden <span className="normal-case font-bold">(⭐ = el que se ofrece primero)</span></p>
                                                            <p className="text-[11px] text-slate-400 mb-3">Cada modelo es una combinación de piezas armada en TizadaPro (ej. cuello V con costadillo fino). Marcá los que el cliente puede pedir.</p>
                                                            {moldeSel.modelos.length === 0 ? (
                                                                <p className="text-xs text-amber-600 font-bold">Este molde no tiene modelos cargados en TizadaPro: el producto se vende con su única forma.</p>
                                                            ) : (
                                                                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                                                                    {moldeSel.modelos.map(m => {
                                                                        const sel = form.modelos.has(m.clave);
                                                                        const def = form.modelos.get(m.clave)?.esDefault === true;
                                                                        return (
                                                                            <button key={m.clave} type="button" title={m.piezas.join(' · ')}
                                                                                onClick={() => {
                                                                                    const next = new Map(form.modelos);
                                                                                    if (!sel) next.set(m.clave, { nombre: m.nombre, esDefault: false });
                                                                                    else if (!def) { next.forEach((v, k) => next.set(k, { ...v, esDefault: false })); next.set(m.clave, { nombre: m.nombre, esDefault: true }); }
                                                                                    else next.delete(m.clave);
                                                                                    setF({ modelos: next });
                                                                                }}
                                                                                className={`relative rounded-xl border-2 p-3 text-left bg-white transition-all ${def ? 'border-amber-400 bg-amber-50/40 shadow-sm' : sel ? 'border-emerald-500 bg-emerald-50/30 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                                                                {def && <span className="absolute top-1.5 right-2 text-[11px]">⭐</span>}
                                                                                {sel && !def && <span className="absolute top-1.5 right-2 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center">✓</span>}
                                                                                <div className="text-[12px] font-bold text-slate-700 pr-5">{m.nombre}</div>
                                                                                {m.grupo && <div className="text-[10px] text-slate-400">{m.grupo}</div>}
                                                                                <div className="text-[10px] text-slate-400 mt-1">{m.piezas.length} piezas</div>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            <p className="text-[11px] text-slate-400 mt-2">Clic = se vende · segundo clic = ⭐ primero · tercer clic = quitar.</p>
                                                        </div>
                                                    )}

                                                    {moldeSel && <MoldeResumen molde={moldeSel} modeloVista={modeloVista} setModeloVista={setModeloVista} vendidos={form.modelos} onLeerCarpeta={leerCarpetaMoldes} leyendoCarpeta={leyendoCarpeta} />}

                                                    {moldeSel && (
                                                        <div className="border border-slate-200 rounded-xl p-4">
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Telas que se ofrecen</p>
                                                            <p className="text-[11px] text-slate-400 mb-3">Solo las que el molde admite en TizadaPro. El precio que se muestra es el de la lista de precios de la tela: acá no se cambia.</p>
                                                            {moldeSel.telas.length === 0 ? (
                                                                <p className="text-xs text-amber-600 font-bold">El molde no tiene telas permitidas cargadas en TizadaPro. Cargalas allá y tocá ↻ Actualizar.</p>
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
                                                                                {sel && <>
                                                                                    <button type="button" title="Tela que se ofrece primero"
                                                                                        onClick={() => { const next = new Map(form.telas); next.forEach((x, k) => next.set(k, { ...x, esDefault: k === id })); setF({ telas: next }); }}
                                                                                        className={`text-[11px] font-bold px-2 py-1 rounded-full border ${v.esDefault ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-slate-200 text-slate-400 hover:border-slate-400'}`}>{v.esDefault ? '⭐ primera' : 'hacer primera'}</button>
                                                                                </>}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            {Object.keys(moldeSel.telasPorPieza || {}).length > 0 && (
                                                                <p className="text-[11px] text-slate-500 mt-3">Las telas de arriba son para el cuerpo. {Object.keys(moldeSel.telasPorPieza).join(', ')} van en la tela fija que dice el molde (ver la lista de piezas, más arriba). Eso se cambia en TizadaPro.</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Apliques — posición · técnica · cantidad</p>
                                                        <p className="text-[11px] text-slate-400 mb-3">Solo con las técnicas de decoración activas en el paso Técnicas{AREAS_DECORACION.some(x => form.tecnicas[x.id].on) ? ` (${AREAS_DECORACION.filter(x => form.tecnicas[x.id].on).map(x => x.label).join(', ')})` : ': hoy ninguna, solo Etiqueta'}. La pieza es de los modelos que se venden{moldeSel && form.modelos.size ? ` (${[...form.modelos.values()].map(m => m.nombre).join(', ')})` : ' (todavía no marcaste ninguno: se listan todas las del molde)'}.</p>
                                                        <div className="space-y-2">
                                                            {form.apliques.map((ap, i) => {
                                                                // Piezas del molde de TizadaPro, con la tela fija si la tienen (ej. "Cuello · Rib New").
                                                                const piezasMolde = piezasParaApliques;
                                                                const opciones = ap.pieza && !piezasMolde.includes(ap.pieza) ? [ap.pieza, ...piezasMolde] : piezasMolde;
                                                                const telaDePieza = (pz) => ((moldeSel?.telasPorPieza || {})[pz] || []).map(x => x.nombre).join(', ');
                                                                const opcionesTecnica = tecnicasCat.filter(o => o.AreaID === ap.areaId && o.Activo);
                                                                const set = (patch) => { const next = [...form.apliques]; next[i] = { ...ap, ...patch }; setF({ apliques: next }); };
                                                                return (
                                                                    <div key={i} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
                                                                        <select value={ap.areaId} title="Técnica del aplique (solo las que el producto tiene activas en Técnicas)"
                                                                            onChange={e => set({ areaId: e.target.value, tecnicaOpcionId: primeraOpcionDe(e.target.value) })}
                                                                            className={`border rounded-lg px-2 py-1.5 text-sm font-bold ${tecnicasApliqueActivas.some(x => x.id === ap.areaId) ? 'border-slate-200' : 'border-rose-400 text-rose-700'}`}>
                                                                            {tecnicasApliqueActivas.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                                                                            {!tecnicasApliqueActivas.some(x => x.id === ap.areaId) && <option value={ap.areaId}>{areaMeta(ap.areaId).label} (técnica apagada)</option>}
                                                                        </select>
                                                                        <select value={ap.pieza || ''} title="¿En qué pieza de la prenda va? (obligatorio)"
                                                                            onChange={e => set({ pieza: e.target.value })}
                                                                            className={`min-w-[170px] border rounded-lg px-2 py-1.5 text-sm font-bold ${ap.pieza ? 'border-slate-200' : 'border-rose-400'}`}>
                                                                            {!ap.pieza && <option value="">{moldeSel ? 'Elegí la pieza (obligatorio)' : 'Elegí primero el molde de TizadaPro'}</option>}
                                                                            {opciones.map(n => <option key={n} value={n}>{n}{telaDePieza(n) ? ` · ${telaDePieza(n)}` : ''}</option>)}
                                                                        </select>
                                                                        {ap.areaId !== 'ETIQUETA' && (
                                                                            <select value={ap.tecnicaOpcionId} title="Opción del catálogo de esta técnica"
                                                                                onChange={e => set({ tecnicaOpcionId: e.target.value ? Number(e.target.value) : '' })}
                                                                                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
                                                                                {opcionesTecnica.map(o => <option key={o.TecnicaOpcionID} value={o.TecnicaOpcionID}>{o.Nombre}</option>)}
                                                                                <option value="">Opción libre{opcionesTecnica.length ? '' : ' (sin opciones en el catálogo)'}</option>
                                                                            </select>
                                                                        )}
                                                                        <input value={ap.detalle || ''} placeholder="Observaciones (ej. pecho izquierdo)"
                                                                            onChange={e => set({ detalle: e.target.value })}
                                                                            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 whitespace-nowrap">
                                                                            <Toggle on={ap.incluido} onChange={v => set({ incluido: v })} />
                                                                            {ap.incluido ? 'incluido' : 'se cobra'}
                                                                        </label>
                                                                        <button type="button" title="Quitar este aplique" onClick={() => setF({ apliques: form.apliques.filter((_, j) => j !== i) })}
                                                                            className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <button type="button"
                                                            onClick={() => { const areaId = tecnicasApliqueActivas[0].id; setF({ apliques: [...form.apliques, { pieza: piezasParaApliques[0] || '', detalle: '', areaId, tecnicaOpcionId: primeraOpcionDe(areaId), cantidad: 1, incluido: true }] }); }}
                                                            className="mt-2 border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar aplique
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* ── PASO FICHA DE DISEÑO ── */}
                                            {paso === 'ficha' && (
                                                <div className="space-y-4 max-w-3xl">
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">Encabezado de la ficha</p>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="text-[11px] font-bold text-slate-500 block mb-1">Referencia (REF)</label>
                                                                <input value={form.fichaDiseno.ref} placeholder={form.codArticulo}
                                                                    onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, ref: e.target.value } })}
                                                                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-[11px] font-bold text-slate-500 block mb-1">Marca</label>
                                                                <input value={form.fichaDiseno.marca}
                                                                    onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, marca: e.target.value } })}
                                                                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">Dibujo del producto</p>
                                                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                                                            <label className={`px-3 py-1.5 rounded-full text-xs font-bold border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 cursor-pointer ${subiendoDibujo ? 'opacity-50 pointer-events-none' : ''}`}>
                                                                {subiendoDibujo ? 'Subiendo…' : (form.fichaDiseno.dibujoUrl ? '🔄 Cambiar dibujo' : '📤 Subir dibujo/imagen')}
                                                                <input type="file" accept="image/*" className="hidden"
                                                                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) subirDibujoFicha(f); }} />
                                                            </label>
                                                            <span className="text-[11px] text-slate-400">o hacé clic sobre el dibujo para agregar una anotación con flecha</span>
                                                        </div>
                                                        {form.fichaDiseno.dibujoUrl ? (
                                                            <div className="relative w-full bg-slate-50 border border-slate-200 rounded-lg overflow-hidden cursor-crosshair select-none"
                                                                style={{ minHeight: 280 }}
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
                                                        ) : (
                                                            <div className="border-2 border-dashed border-slate-200 rounded-lg py-10 text-center text-xs text-slate-400">
                                                                Subí un dibujo y hacé clic sobre él para agregar anotaciones con flecha
                                                            </div>
                                                        )}
                                                        <div className="mt-3 space-y-1.5">
                                                            {form.fichaDisenoAnotaciones.map((a, i) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <input value={a.texto}
                                                                        onChange={e => setF({ fichaDisenoAnotaciones: form.fichaDisenoAnotaciones.map((x, j) => j === i ? { ...x, texto: e.target.value } : x) })}
                                                                        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                    <button type="button" onClick={() => setF({ fichaDisenoAnotaciones: form.fichaDisenoAnotaciones.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <button type="button"
                                                            onClick={() => setF({ fichaDisenoAnotaciones: [...form.fichaDisenoAnotaciones, { x: 50, y: 30, texto: 'Nuevo detalle' }] })}
                                                            className="mt-2 border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar anotación
                                                        </button>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Datos de la prenda</p>
                                                        <p className="text-[11px] text-slate-400 mb-3">Material y tallas salen del molde de TizadaPro y de las telas que se ofrecen. Se pueden pisar; "↻ automático" vuelve a lo del molde.</p>
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                            {[['material', 'Material', autoFicha.material], ['tallas', 'Tallas', autoFicha.tallas], ['marcacion', 'Marcación', null]].map(([k, label, auto]) => (
                                                                <div key={k}>
                                                                    <label className="text-[11px] font-bold text-slate-500 flex items-center justify-between mb-1">{label}
                                                                        {auto != null && form.fichaDiseno[k] !== auto && auto && (
                                                                            <button type="button" onClick={() => setF({ fichaDiseno: { ...form.fichaDiseno, [k]: auto } })} className="text-[10px] font-bold text-indigo-600 hover:underline">↻ automático</button>
                                                                        )}
                                                                    </label>
                                                                    <input value={form.fichaDiseno[k]} placeholder={auto || (k === 'marcacion' ? 'Cómo se marca el talle (etiqueta, estampa…)' : '')}
                                                                        onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, [k]: e.target.value } })}
                                                                        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm ${auto != null && form.fichaDiseno[k] && form.fichaDiseno[k] === auto ? 'border-slate-200 text-slate-600 bg-slate-50' : 'border-slate-200'}`} />
                                                                    {auto != null && !form.fichaDiseno[k] && !auto && <p className="text-[10px] text-amber-600 mt-1">{k === 'material' ? 'Marcá las telas que se ofrecen en "Molde, telas y apliques".' : 'Vinculá el molde de TizadaPro para tomar los talles.'}</p>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Notas sueltas</p>
                                                        <p className="text-[11px] text-slate-400 mb-3">Lo que no entra arriba ni en Avíos, como etiqueta y valor. Salen al pie de la ficha impresa.</p>
                                                        <div className="space-y-2">
                                                            {form.fichaDisenoExtra.map((c, i) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <input value={c.label} placeholder="Nombre del campo"
                                                                        onChange={e => setF({ fichaDisenoExtra: form.fichaDisenoExtra.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                                                                        className="w-40 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                    <input value={c.valor} placeholder="Valor"
                                                                        onChange={e => setF({ fichaDisenoExtra: form.fichaDisenoExtra.map((x, j) => j === i ? { ...x, valor: e.target.value } : x) })}
                                                                        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                    <button type="button" onClick={() => setF({ fichaDisenoExtra: form.fichaDisenoExtra.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <button type="button" onClick={() => setF({ fichaDisenoExtra: [...form.fichaDisenoExtra, { label: '', valor: '' }] })}
                                                            className="mt-2 border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar campo
                                                        </button>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Avíos</p>
                                                        <p className="text-[11px] text-slate-400 mb-3">Todo lo que lleva la prenda y no es tela. Se eligen del "Catálogo de avíos"; acá va la cantidad por prenda y la medida, que puede variar por talle.</p>
                                                        <div className="space-y-2">
                                                            {form.avios.map((av, i) => {
                                                                const set = (patch) => { const next = [...form.avios]; next[i] = { ...av, ...patch }; setF({ avios: next }); };
                                                                return (
                                                                    <div key={i} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
                                                                        <select value={av.avioId || ''} title="Avío del catálogo"
                                                                            onChange={e => { const c = aviosCat.find(x => String(x.AvioID) === e.target.value); set(c ? { avioId: c.AvioID, nombre: c.Nombre, unidad: c.Unidad || 'u' } : { avioId: '' }); }}
                                                                            className={`min-w-[200px] border rounded-lg px-2.5 py-1.5 text-sm font-bold ${av.avioId ? 'border-slate-200' : 'border-rose-400'}`}>
                                                                            <option value="">{aviosCat.filter(x => x.Activo).length ? 'Elegí el avío…' : 'Cargá avíos en "Catálogo de avíos"'}</option>
                                                                            {aviosCat.filter(x => x.Activo || x.AvioID === av.avioId).map(x => <option key={x.AvioID} value={x.AvioID}>{x.Nombre}{x.Activo ? '' : ' (inactivo)'}</option>)}
                                                                        </select>
                                                                        <input type="number" min="0.01" step="0.01" value={av.cantidad} title="Cantidad por prenda" onChange={e => set({ cantidad: e.target.value })}
                                                                            className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center" />
                                                                        <span className="text-xs text-slate-500 w-8">{av.unidad || 'u'}</span>
                                                                        <input value={av.medida} placeholder="Medida por talle (ej. S–M 55 cm · L–XXL 60 cm)" onChange={e => set({ medida: e.target.value })}
                                                                            className="min-w-[220px] flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                        <input value={av.nota} placeholder="Nota" onChange={e => set({ nota: e.target.value })}
                                                                            className="min-w-[120px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                        <button type="button" title="Quitar" onClick={() => setF({ avios: form.avios.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <button type="button" onClick={() => { const c = aviosCat.find(x => x.Activo); setF({ avios: [...form.avios, { avioId: c ? c.AvioID : '', nombre: c ? c.Nombre : '', cantidad: 1, unidad: c ? (c.Unidad || 'u') : 'u', medida: '', nota: '' }] }); }}
                                                            className="mt-2 border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar avío
                                                        </button>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Costuras (ISO)</p>
                                                        <p className="text-xs text-slate-500 mb-3">Elegí las costuras de la lista ISO 4915. Abajo, las que sugiere el despiece de la combinación ⭐ default.</p>
                                                        <div className="space-y-2 mb-2">
                                                            {form.fichaDisenoCosturas.map((c, i) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <input value={c.union} placeholder="Unión (ej. Hombros)"
                                                                        onChange={e => setF({ fichaDisenoCosturas: form.fichaDisenoCosturas.map((x, j) => j === i ? { ...x, union: e.target.value } : x) })}
                                                                        className="w-40 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                    <select value={c.iso}
                                                                        onChange={e => setF({ fichaDisenoCosturas: form.fichaDisenoCosturas.map((x, j) => j === i ? { ...x, iso: e.target.value } : x) })}
                                                                        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm">
                                                                        {costurasIsoCat.filter(o => o.Activo !== false || o.CodigoISO === c.iso).map(o => <option key={o.CosturaISOID} value={o.CodigoISO}>{o.CodigoISO} — {o.Nombre}</option>)}
                                                                    </select>
                                                                    <button type="button" onClick={() => setF({ fichaDisenoCosturas: form.fichaDisenoCosturas.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <button type="button"
                                                            onClick={() => setF({ fichaDisenoCosturas: [...form.fichaDisenoCosturas, { union: '', iso: costurasIsoCat.find(o => o.Activo !== false)?.CodigoISO || '' }] })}
                                                            className="border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar costura
                                                        </button>

                                                    </div>

                                                    <div className="flex items-center gap-3">
                                                        <button type="button" onClick={() => setFichaPreview(true)}
                                                            className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold">
                                                            🖨 Ver ficha técnica
                                                        </button>
                                                        <span className="text-[11px] text-slate-400">Genera la vista imprimible con dibujo, campos y costuras.</span>
                                                    </div>

                                                    {fichaPreview && (
                                                        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                                                            <style>{`
                                                                @media print {
                                                                    body * { visibility: hidden; }
                                                                    .fdp-print-root, .fdp-print-root * { visibility: visible; }
                                                                    .fdp-print-root { position: fixed; inset: 0; padding: 12mm; box-shadow: none !important; max-height: none !important; border-radius: 0 !important; }
                                                                    .fdp-noprint { display: none !important; }
                                                                }
                                                            `}</style>
                                                            <div className="fdp-print-root bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6">
                                                                <div className="fdp-noprint flex items-center justify-between mb-4">
                                                                    <span className="font-black text-slate-800">Vista de ficha técnica</span>
                                                                    <button onClick={() => setFichaPreview(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
                                                                </div>

                                                                <div className="border-2 border-slate-800 rounded-lg p-4">
                                                                    <div className="flex items-center justify-between border-b-2 border-slate-800 pb-2 mb-2">
                                                                        <span className="font-black text-lg">FICHA TÉCNICA DE DISEÑO</span>
                                                                        <span className="text-sm font-bold">MARCA: {form.fichaDiseno.marca || ''}</span>
                                                                    </div>
                                                                    <div className="text-sm font-bold mb-3">REF. {form.fichaDiseno.ref || form.codArticulo} — {form.descripcion}</div>

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
                                                                        <div className="text-xs mb-3"><b>Costuras:</b> {form.fichaDisenoCosturas.map((c, i) => (
                                                                            <span key={i} className="mr-2">{c.union}: <b>{c.iso}</b></span>
                                                                        ))}</div>
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
                                                                                {form.avios.filter(a => a.nombre.trim()).map((a, i) => (
                                                                                    <tr key={i} className="border-b border-slate-100">
                                                                                        <td className="py-1 pr-2 font-bold">{a.nombre}</td><td className="py-1 pr-2">{a.cantidad} {a.unidad}</td><td className="py-1 pr-2">{a.medida}</td><td className="py-1">{a.nota}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    )}
                                                                </div>

                                                                <div className="fdp-noprint flex items-center gap-2 mt-4">
                                                                    <button onClick={() => window.print()} className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold">⎙ Imprimir / PDF</button>
                                                                    <button onClick={() => setFichaPreview(false)} className="border border-slate-200 rounded-lg px-4 py-2 text-xs font-bold text-slate-600">Cerrar</button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* ── PASO RESUMEN / PUBLICAR ── */}
                                            {paso === 'resumen' && (
                                                <div className="space-y-4 max-w-2xl">
                                                    {/* Vista previa: la tarjeta como la va a ver el cliente en el pedido web */}
                                                    <div>
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Así lo ve el cliente en el pedido web</p>
                                                        <div className="border-2 border-indigo-200 rounded-2xl bg-white p-4 flex gap-3 max-w-md shadow-sm">
                                                            <Thumb src={form.imagen || origenSel?.Imagen} size={56} rounded="rounded-xl" icon={form.politica === 'PAQUETE' ? 'fa-boxes-stacked' : 'fa-shirt'} />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-black text-slate-800 leading-tight">{form.descripcion}</div>
                                                                <div className="text-sm font-bold text-slate-600 mt-0.5">
                                                                    {fmtPrecio(form.precio === '' ? null : form.precio, form.moneda)}
                                                                    <span className="text-slate-400 font-normal">{form.politica === 'PAQUETE' ? ' el paquete' : ' /u · servicios aparte'}</span>
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
                                                                            <span key={a.id} className={`${a.chip} px-2 py-0.5 rounded-md text-[10px] font-bold`}>
                                                                                {t.obligatorio ? '' : '+ '}{corto}{det}{t.cobro === 'INCLUIDA' ? ' · incluido' : ''}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                    {form.politica === 'PAQUETE' && form.comboItems.length > 0 && form.comboItems.map((it, i) => (
                                                                        <span key={`ci-${i}`} className="bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                                                            {it.cantidad}× {it.itemNombre || `#${it.itemProIdProducto}`}{it.wmsVarianteId ? ` — ${it.varianteNombre || 'variante fija'}` : ''}
                                                                            {(it.servicios || []).length > 0 && ` +${it.servicios.map(s => servicioCorto(s.areaId) + (s.incluido ? '' : '($)')).join('+')}`}
                                                                        </span>
                                                                    ))}
                                                                    {form.politica === 'PAQUETE' && form.comboItems.length === 0 && form.cantidadFija && (
                                                                        <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md text-[10px] font-black">📦 cantidad fija: {form.cantidadFija}</span>
                                                                    )}
                                                                    {form.politica === 'MINIMA' && form.cantidadMinima && (
                                                                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-bold">mín. {form.cantidadMinima} u</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-sm">
                                                        {!form.esCombo && (
                                                            <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Familia</span><span className={`font-bold ${form.categoria !== 'Prendas' ? 'text-slate-700' : 'text-amber-600'}`}>{form.categoria !== 'Prendas' ? form.categoria : '⚠ sin clasificar'}</span></div>
                                                        )}
                                                        <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Origen</span><span className="font-bold text-slate-700">{form.esCombo ? `Combo de ${form.comboItems.length} productos del local` : `${ORIGENES.find(o => o.id === form.origenTipo)?.t}${origenSel ? ` — ${origenSel.Descripcion}` : ''}`}</span></div>
                                                        <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Técnicas</span><span className="font-bold text-slate-700">{form.esCombo ? 'por producto (ver composición)' : (AREAS.filter(a => form.tecnicas[a.id].on).map(a => { const conOpc = tecnicasCat.some(o => o.AreaID === a.id && o.Activo); const det = [conOpc ? form.tecnicas[a.id].modo.toLowerCase() : null, form.tecnicas[a.id].cobro === 'INCLUIDA' ? 'incluida' : null].filter(Boolean).join(', '); return det ? `${a.label} (${det})` : a.label; }).join(' · ') || 'ninguna')}</span></div>
                                                        <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Precio</span><span className="font-bold text-slate-700">{fmtPrecio(form.precio === '' ? null : form.precio, form.moneda)}{form.politica === 'PAQUETE' ? ' el paquete' : ' /u sin servicios'}</span></div>
                                                        <div className="flex justify-between px-4 py-2.5 gap-4"><span className="text-slate-400 font-bold">Cantidad</span><span className="font-bold text-slate-700 text-right">{form.politica === 'LIBRE' ? 'libre'
                                                            : form.politica === 'MINIMA' ? `mínimo ${form.cantidadMinima || '—'} u`
                                                            : form.comboItems.length > 0 ? `paquete armado: ${form.comboItems.map(it => `${it.cantidad}× ${it.itemNombre || `#${it.itemProIdProducto}`}${it.wmsVarianteId ? ` (${it.varianteNombre})` : ''}`).join(' + ')}`
                                                            : `paquete fijo de ${form.cantidadFija || '—'} u${form.surtido.size ? ` · surtido: ${form.surtido.size} variantes` : ' · surtido: todas'}`}</span></div>
                                                        {form.origenTipo === 'CONFECCIONADO' && (
                                                            <div className="flex justify-between px-4 py-2.5 gap-4"><span className="text-slate-400 font-bold">Molde (TizadaPro)</span><span className={`font-bold text-right ${form.tizadaProMoldeRef ? 'text-slate-700' : 'text-amber-600'}`}>{form.tizadaProMoldeRef ? `${moldeSel?.nombre || form.tizadaProMoldeRef} · ${form.modelos.size} modelos · ${form.telas.size} telas · ${form.apliques.length} apliques` : '⚠ sin molde vinculado'}</span></div>
                                                        )}
                                                        <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Validar stock</span><span className="font-bold text-slate-700">{form.validarStock ? 'Sí' : 'No (contingencia)'}</span></div>
                                                    </div>
                                                    <div className={`flex items-center gap-3 border-2 rounded-xl p-4 ${form.estado === 'PUBLICADO' ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200'}`}>
                                                        <Toggle on={form.estado === 'PUBLICADO'} onChange={v => setF({ estado: v ? 'PUBLICADO' : 'BORRADOR' })} />
                                                        <div>
                                                            <div className="font-bold text-sm text-slate-700">{form.estado === 'PUBLICADO' ? 'Publicado — visible en el pedido web' : 'Borrador — NO se ve en el pedido web'}</div>
                                                            <div className="text-xs text-slate-400">El cambio rige al Guardar.</div>
                                                        </div>
                                                        <button onClick={guardar} disabled={saving}
                                                            className="ml-auto bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-slate-700 disabled:opacity-50">
                                                            {saving ? 'Guardando…' : '💾 Guardar'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
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
                    {vista === 'costuras' && <CatalogoCosturas costuras={costurasIsoCat} onReload={loadCatalogos} />}

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
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${a.grad} text-white flex items-center justify-center text-xs`}>
                            <i className={`fa-solid ${a.icon}`}></i>
                        </div>
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
                                        : <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${a.grad} text-white flex items-center justify-center`}><i className={`fa-solid ${a.icon} text-[10px]`}></i></span>}
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
                                    <input type="number" step="0.01" value={val(t, 'precio', t.Precio)} onChange={e => setVal(t.TecnicaOpcionID, 'precio', e.target.value)}
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
        <div className="space-y-4 max-w-4xl">
            <p className="text-xs text-slate-400">Todo lo que lleva una prenda y no es tela: cierres, botones, elásticos, etiquetas, cordones. Se cargan una vez acá y cada producto elige cuáles lleva y en qué cantidad. Un avío inactivo no se ofrece más, pero los productos que ya lo tienen lo conservan.</p>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-2">Avío</th><th className="px-3 py-2 w-24">Unidad</th><th className="px-3 py-2 w-24 text-center">En uso</th><th className="px-3 py-2 w-20 text-center">Activo</th><th className="px-3 py-2 w-28"></th>
                    </tr></thead>
                    <tbody>
                        {avios.map(a => (
                            <tr key={a.AvioID} className={`border-b border-slate-50 ${a.Activo ? '' : 'opacity-50'}`}>
                                <td className="px-4 py-1.5"><input value={val(a, 'nombre', a.Nombre)} onChange={e => setVal(a.AvioID, 'nombre', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm font-bold" /></td>
                                <td className="px-3 py-1.5"><select value={val(a, 'unidad', a.Unidad || 'u')} onChange={e => setVal(a.AvioID, 'unidad', e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs">{['u', 'par', 'm', 'cm'].map(u => <option key={u} value={u}>{u}</option>)}</select></td>
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
                    <select value={nuevo.unidad} onChange={e => setNuevo({ ...nuevo, unidad: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-2 text-xs">{['u', 'par', 'm', 'cm'].map(u => <option key={u} value={u}>{u}</option>)}</select>
                    <button onClick={crear} disabled={creando} className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">{creando ? '…' : '+ Agregar avío'}</button>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════
//  Catálogo de costuras (dbo.CosturasISO): código ISO 4915 + nombre
// ═════════════════════════════════════════════════════════════════════════
function CatalogoCosturas({ costuras, onReload }) {
    const [edits, setEdits] = useState({});
    const [savingId, setSavingId] = useState(null);
    const [nueva, setNueva] = useState({ codigoISO: '', nombre: '' });
    const [creando, setCreando] = useState(false);
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
        <div className="space-y-4 max-w-4xl">
            <p className="text-xs text-slate-400">Tipos de costura con su código ISO 4915 (pespunte, overlock, recubridora…). En la ficha de diseño de cada producto se indica qué costura lleva cada unión. Una costura inactiva no se ofrece más, pero las fichas que ya la usan la conservan.</p>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-2 w-32">Código</th><th className="px-3 py-2">Nombre</th><th className="px-3 py-2 w-20 text-center">Activa</th><th className="px-3 py-2 w-28"></th>
                    </tr></thead>
                    <tbody>
                        {costuras.map(c => (
                            <tr key={c.CosturaISOID} className={`border-b border-slate-50 ${c.Activo === false ? 'opacity-50' : ''}`}>
                                <td className="px-4 py-1.5"><input value={val(c, 'codigoISO', c.CodigoISO)} onChange={e => setVal(c.CosturaISOID, 'codigoISO', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm font-mono font-bold" /></td>
                                <td className="px-3 py-1.5"><input value={val(c, 'nombre', c.Nombre)} onChange={e => setVal(c.CosturaISOID, 'nombre', e.target.value)} className="w-full border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-lg px-2 py-1 text-sm" /></td>
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
        </div>
    );
}
