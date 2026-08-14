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
const AREA_APLIQUE_EXTRA = { id: 'ETIQUETA', label: 'Etiqueta (grifa)', chip: 'bg-slate-100 text-slate-600' };
const areaMeta = (id) => AREAS.find(a => a.id === id) || AREA_APLIQUE_EXTRA;

const ORIGENES = [
    { id: 'LOCAL', t: 'Producto del local', d: 'Sale del stock del local, con talle/color y stock en vivo.', icon: 'fa-store' },
    { id: 'CLIENTE', t: 'Prenda del cliente', d: 'El cliente la trae; se recibe por remito PRE.', icon: 'fa-handshake' },
    { id: 'CONFECCIONADO', t: 'Confeccionado por USER', d: 'Se corta y confecciona: habilita componentes y apliques.', icon: 'fa-scissors' },
    { id: 'AMBOS', t: 'Local o del cliente', d: 'El cliente elige el origen al pedir.', icon: 'fa-shuffle' },
];

const TIPOS_COMP = [
    { id: 'CUELLO', label: 'Cuello' }, { id: 'MANGA', label: 'Manga' },
    { id: 'PUNO', label: 'Puño' }, { id: 'COSTADO', label: 'Costado' },
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

// ── Dibujos de componentes (portados de la maqueta USER Studio) ──────────
const IS = '#1f2937';
const COMP_SVGS = {
    'cuello-redondo': <><path d="M14 14H46V20C46 26 38 30 30 30C22 30 14 26 14 20Z" fill="#eef2ff" stroke={IS} strokeWidth="2" /></>,
    'cuello-v': <><path d="M14 14H46V18L30 36L14 18Z" fill="#eef2ff" stroke={IS} strokeWidth="2" /><path d="M14 18L30 36L46 18" fill="none" stroke={IS} strokeWidth="2" /></>,
    'cuello-polo': <><path d="M14 14H46V20H14Z" fill="#eef2ff" stroke={IS} strokeWidth="2" /><path d="M26 20L30 40L34 20" fill="#fff" stroke={IS} strokeWidth="2" /><circle cx="30" cy="27" r="1.6" /><circle cx="30" cy="33" r="1.6" /></>,
    'cuello-camisa': <><path d="M14 16H46V21L38 29L30 24L22 29L14 21Z" fill="#eef2ff" stroke={IS} strokeWidth="2" strokeLinejoin="round" /><path d="M30 24V16" stroke={IS} strokeWidth="1.2" strokeDasharray="2 2" /></>,
    'cuello-mao': <><rect x="14" y="16" width="32" height="9" rx="4.5" fill="#eef2ff" stroke={IS} strokeWidth="2" /><path d="M30 16V25" stroke={IS} strokeWidth="1.2" strokeDasharray="2 2" /></>,
    'manga-pegada': <><path d="M22 14H38L46 24L40 30L38 24V46H22V24L20 30L14 24Z" fill="#eef2ff" stroke={IS} strokeWidth="2" strokeLinejoin="round" /></>,
    'manga-raglan': <><path d="M22 14H38L48 40L40 44L34 24V46H26V24L20 44L12 40Z" fill="#eef2ff" stroke={IS} strokeWidth="2" strokeLinejoin="round" /><path d="M22 14L34 24M38 14L26 24" stroke={IS} strokeWidth="1.5" /></>,
    'puno-dobladillo': <><rect x="18" y="18" width="24" height="24" rx="2" fill="#eef2ff" stroke={IS} strokeWidth="2" /><line x1="18" y1="36" x2="42" y2="36" stroke={IS} strokeWidth="1.5" /></>,
    'puno-vivo': <><rect x="18" y="18" width="24" height="24" rx="2" fill="#eef2ff" stroke={IS} strokeWidth="2" /><rect x="18" y="36" width="24" height="6" fill={IS} opacity=".35" /></>,
    'puno-vivo-ancho': <><rect x="18" y="18" width="24" height="24" rx="2" fill="#eef2ff" stroke={IS} strokeWidth="2" /><rect x="18" y="33" width="24" height="9" fill={IS} opacity=".35" /></>,
    'costado-simple': <><path d="M22 14H38V46H22Z" fill="#eef2ff" stroke={IS} strokeWidth="2" /></>,
    'costado-fino': <><path d="M22 14H38V46H22Z" fill="#eef2ff" stroke={IS} strokeWidth="2" /><rect x="22" y="14" width="3" height="32" fill={IS} opacity=".4" /><rect x="35" y="14" width="3" height="32" fill={IS} opacity=".4" /></>,
    'costado-ancho': <><path d="M22 14H38V46H22Z" fill="#eef2ff" stroke={IS} strokeWidth="2" /><rect x="22" y="14" width="6" height="32" fill={IS} opacity=".4" /><rect x="32" y="14" width="6" height="32" fill={IS} opacity=".4" /></>,
};
const compIconKey = (codigo) => {
    const c = (codigo || '').toUpperCase();
    if (c.startsWith('CR-')) return 'cuello-redondo';
    if (c.startsWith('CV-')) return 'cuello-v';
    if (c.startsWith('CP-')) return 'cuello-polo';
    if (c.startsWith('CS-')) return 'cuello-camisa';
    if (c.startsWith('CM-')) return 'cuello-mao';
    if (c === 'MG-01') return 'manga-pegada';
    if (c.startsWith('MG-')) return 'manga-raglan';
    if (c === 'TM-01') return 'puno-dobladillo';
    if (c === 'TM-03') return 'puno-vivo-ancho';
    if (c.startsWith('TM-')) return 'puno-vivo';
    if (c === 'CT-02') return 'costado-fino';
    if (c === 'CT-03') return 'costado-ancho';
    if (c.startsWith('CT-')) return 'costado-simple';
    return null;
};
const CompIcon = ({ codigo, size = 42 }) => {
    const key = compIconKey(codigo);
    return (
        <svg viewBox="0 0 60 60" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
            {key ? COMP_SVGS[key] : <rect x="16" y="16" width="28" height="28" rx="3" fill="#f1f5f9" stroke={IS} strokeWidth="2" />}
        </svg>
    );
};

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
    codigoCorto: d.config?.CodigoCorto || '',
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
            : { on: false, obligatorio: true, modo: 'LIBRE', cobro: 'APARTE' }];
    })),
    opcionesPermitidas: new Set((d.opcionesPermitidas || []).map(o => o.TecnicaOpcionID)),
    surtido: new Set((d.surtido || []).map(s => s.WmsVarianteId)),
    componentes: new Map((d.componentes || []).map(c => [c.OpcionID, !!c.EsDefault])),
    apliques: (d.apliques || []).map(a => ({
        posicion: a.Posicion, areaId: a.AreaID, tecnicaOpcionId: a.TecnicaOpcionID || '',
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
    costurasSugeridas: d.costurasSugeridas || [],
});

const formToPayload = (f) => ({
    ...(f.esCombo ? {} : { codigoCorto: f.codigoCorto || null }),
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
    componentes: [...f.componentes.entries()].map(([opcionId, esDefault]) => ({ opcionId, esDefault })),
    apliques: f.apliques.filter(a => (a.posicion || '').trim()).map(a => ({
        posicion: a.posicion.trim(), areaId: a.areaId,
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
    }),
});

// ═════════════════════════════════════════════════════════════════════════
export default function ConfigurarProductosPage() {
    const [familia, setFamilia] = useState('prendas');       // 'prendas' | 'ecouv'
    const [vista, setVista] = useState('confeccionados');     // 'confeccionados' | 'combos' | 'tecnicas' | 'componentes'

    // Datos compartidos
    const [productos, setProductos] = useState([]);
    const [tecnicasCat, setTecnicasCat] = useState([]);       // TecnicaOpciones (all)
    const [componentesCat, setComponentesCat] = useState([]); // ComponenteOpciones (all)
    const [costurasIsoCat, setCosturasIsoCat] = useState([]); // CosturasISO (catálogo chico, ficha de diseño)
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

    // Variantes (paso 5 del confeccionado — motor cartesiano de Componentes)
    const [variantes, setVariantes] = useState([]);
    const [variantesLoading, setVariantesLoading] = useState(false);
    const [generandoVariantes, setGenerandoVariantes] = useState(false);
    const [variantesObsoletas, setVariantesObsoletas] = useState(0);

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
            const [t, c, iso] = await Promise.all([
                api.get(`${API}/tecnicas?all=1`),
                api.get(`${API}/componentes?all=1`),
                api.get(`${API}/costuras-iso`),
            ]);
            setTecnicasCat(t.data?.data || []);
            setComponentesCat(c.data?.data || []);
            setCosturasIsoCat(iso.data?.data || []);
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

    useEffect(() => { loadProductos(); loadCatalogos(); loadLocales(); loadFamilias(); }, [loadProductos, loadCatalogos, loadLocales, loadFamilias]);

    const loadVariantes = useCallback(async (proId) => {
        if (!proId) return;
        setVariantesLoading(true);
        try {
            const { data } = await api.get(`${API}/productos/${proId}/variantes`);
            setVariantes(data.data || []);
        } catch (e) {
            toast.error('Error cargando variantes: ' + (e.response?.data?.error || e.message));
        } finally { setVariantesLoading(false); }
    }, []);

    // Al entrar al paso Variantes, traer lo que ya esté generado para este producto
    useEffect(() => {
        if (paso === 'variantes' && form?.proId) loadVariantes(form.proId);
    }, [paso, form?.proId, loadVariantes]);

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

    const generarVariantes = async () => {
        if (!form?.proId) return;
        setGenerandoVariantes(true);
        try {
            const { data } = await api.post(`${API}/productos/${form.proId}/variantes/generar`);
            setVariantesObsoletas(data.obsoletas || 0);
            toast.success(`✅ ${data.creadas} nueva(s) · ${data.actualizadas} actualizada(s)${data.obsoletas ? ` — ⚠ ${data.obsoletas} obsoleta(s)` : ''}`);
            await loadVariantes(form.proId);
        } catch (e) {
            toast.error('Error generando variantes: ' + (e.response?.data?.error || e.message));
        } finally { setGenerandoVariantes(false); }
    };

    const toggleVarianteActiva = async (v) => {
        const next = !v.Activa;
        setVariantes(prev => prev.map(x => x.VarianteID === v.VarianteID ? { ...x, Activa: next } : x));
        try {
            await api.put(`${API}/variantes/${v.VarianteID}`, { activa: next });
        } catch (e) {
            setVariantes(prev => prev.map(x => x.VarianteID === v.VarianteID ? { ...x, Activa: !next } : x));
            toast.error('Error: ' + (e.response?.data?.error || e.message));
        }
    };

    const guardarPrecioManualVariante = async (v, valorStr) => {
        const valor = valorStr === '' ? null : Number(valorStr);
        if (valorStr !== '' && !Number.isFinite(valor)) return;
        try {
            await api.put(`${API}/variantes/${v.VarianteID}`, { precioManual: valor });
            setVariantes(prev => prev.map(x => x.VarianteID === v.VarianteID ? { ...x, PrecioManual: valor } : x));
        } catch (e) {
            toast.error('Error: ' + (e.response?.data?.error || e.message));
        }
    };

    // El dibujo se sube al toque (como el resto de las imágenes de la app) — no
    // espera al "Guardar cambios" del producto, así el usuario ve el resultado ya.
    const subirDibujoFicha = async (file) => {
        if (!form?.proId || !file) return;
        setSubiendoDibujo(true);
        try {
            const fd = new FormData();
            fd.append('dibujo', file);
            const { data } = await api.post(`${API}/productos/${form.proId}/ficha-diseno/dibujo`, fd);
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
        if (busca && !(`${p.Descripcion} ${p.CodArticulo}`.toLowerCase().includes(busca.toLowerCase()))) return false;
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
        return orden.filter(f => g[f]?.length).map(f => ({ nombre: f, items: g[f] }));
    }, [confeccionadosFiltrados, familiasCat]);
    const toggleGrupo = (nombre) => setGruposCerrados(prev => {
        const next = new Set(prev);
        next.has(nombre) ? next.delete(nombre) : next.add(nombre);
        return next;
    });

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
            ...(form.origenTipo === 'CONFECCIONADO' ? [{ id: 'confeccion', n: 4, label: 'Componentes y apliques' }] : []),
            ...(form.origenTipo === 'CONFECCIONADO' ? [{ id: 'variantes', n: 5, label: 'Variantes' }] : []),
            ...(form.origenTipo === 'CONFECCIONADO' ? [{ id: 'ficha', n: 6, label: 'Ficha de diseño' }] : []),
            { id: 'resumen', n: form.origenTipo === 'CONFECCIONADO' ? 7 : 4, label: 'Revisar y publicar' },
        ];
    }, [form]);

    const setF = (patch) => setForm(prev => ({ ...prev, ...patch }));

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
                            ['componentes', 'Componentes (confección)', null],
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
                                                        {g.items.map(p => (
                                                            <button key={p.ProIdProducto} onClick={() => abrirProducto(p.ProIdProducto)}
                                                                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors flex items-center gap-2.5 ${form?.proId === p.ProIdProducto ? 'bg-indigo-50/60 border-l-4 border-indigo-500' : 'border-l-4 border-transparent'}`}>
                                                                <Thumb src={p.Imagen} size={36} icon="fa-shirt" />
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
                                                        ))}
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
                                            <div className="flex-1 min-w-[220px]">
                                                <div className="font-black text-slate-800">{form.descripcion}</div>
                                                <div className="text-[11px] text-slate-400 font-mono">
                                                    {form.codArticulo} · {form.categoria || 'sin categoría'} · {fmtPrecio(form.precio === '' ? null : form.precio, form.moneda)}
                                                </div>
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
                                                                <div className="flex items-center gap-3 px-4 py-3 bg-white">
                                                                    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${a.grad} text-white flex items-center justify-center`}>
                                                                        <i className={`fa-solid ${a.icon} text-sm`}></i>
                                                                    </div>
                                                                    <div className="flex-1">
                                                                        <div className="font-black text-sm text-slate-800">{a.label}</div>
                                                                        <div className="text-[11px] text-slate-400">{a.desc}</div>
                                                                    </div>
                                                                    <Toggle on={t.on} onChange={v => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, on: v } } })} />
                                                                </div>
                                                                {t.on && (
                                                                    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-3">
                                                                        <div className="flex flex-wrap gap-1.5">
                                                                            {MODOS.map(m => (
                                                                                <Pill key={m.id} on={t.modo === m.id} title={m.hint}
                                                                                    onClick={() => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, modo: m.id } } })}>
                                                                                    {m.label}
                                                                                </Pill>
                                                                            ))}
                                                                        </div>
                                                                        {(t.modo === 'RESTRINGIDO' || t.modo === 'FIJA') && (
                                                                            <div>
                                                                                <p className="text-[11px] font-bold text-slate-400 mb-1.5">
                                                                                    {t.modo === 'FIJA' ? 'La opción que se aplica siempre (una sola):' : 'Especificaciones permitidas para este producto:'}
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
                                                                                    {opcionesArea.length === 0 && <span className="text-xs text-slate-400">Sin opciones en el catálogo — cargalas en “Catálogo de técnicas”.</span>}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex flex-wrap gap-6">
                                                                            <div>
                                                                                <p className="text-[11px] font-bold text-slate-400 mb-1.5">💲 ¿Cómo se cobra?</p>
                                                                                <div className="flex gap-1.5 flex-wrap">
                                                                                    <Pill on={t.cobro === 'APARTE'} onClick={() => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, cobro: 'APARTE' } } })}>Se cobra aparte (según catálogo)</Pill>
                                                                                    <Pill on={t.cobro === 'INCLUIDA'} onClick={() => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, cobro: 'INCLUIDA' } } })}>Incluida en el precio del producto</Pill>
                                                                                </div>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-[11px] font-bold text-slate-400 mb-1.5">En el pedido, esta técnica es…</p>
                                                                                <div className="flex gap-1.5 flex-wrap">
                                                                                    <Pill on={t.obligatorio} onClick={() => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, obligatorio: true } } })}>Obligatoria — el producto siempre la lleva</Pill>
                                                                                    <Pill on={!t.obligatorio} onClick={() => setF({ tecnicas: { ...form.tecnicas, [a.id]: { ...t, obligatorio: false } } })}>Opcional — el cliente decide si la agrega</Pill>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        {/* Resumen en criollo del efecto de esta combinación */}
                                                                        <p className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                                                                            {t.obligatorio ? 'El producto siempre lleva ' : 'El cliente elige si agrega '}
                                                                            {a.label.toLowerCase()}
                                                                            {t.cobro === 'INCLUIDA'
                                                                                ? ' y ya está incluido en el precio: no genera línea de cobro aparte.'
                                                                                : '; al cotizar se suma como línea propia, con el precio del catálogo, además del precio del producto.'}
                                                                            {(a.id === 'EMB' || a.id === 'TPU') && ` La matriz ${a.id === 'EMB' ? 'de bordado' : 'TPU'} se cobra la primera vez (trabajo nuevo); el reuso no.`}
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                };
                                                return (
                                                    <div className="space-y-5">
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">🔧 Construcción — arma la prenda, casi siempre obligatoria</p>
                                                            <div className="space-y-3">{AREAS_CONSTRUCCION.map(renderTecnicaCard)}</div>
                                                        </div>
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">🎨 Decoración — el cliente elige si la agrega</p>
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
                                                                        const corto = a.id === 'EMB' ? 'Bordado' : a.id === 'TPU' ? 'TPU' : 'DTF';
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
                                            {paso === 'confeccion' && (
                                                <div className="space-y-4">
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">
                                                            Componentes — qué opciones ofrece este producto <span className="normal-case font-bold">(⭐ = default)</span>
                                                        </p>
                                                        {TIPOS_COMP.map(tc => {
                                                            const ops = componentesCat.filter(c => c.Tipo === tc.id && c.Activo);
                                                            if (!ops.length) return null;
                                                            return (
                                                                <div key={tc.id} className="mb-4">
                                                                    <p className="text-xs font-bold text-slate-500 mb-1.5">{tc.label}</p>
                                                                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(106px, 1fr))' }}>
                                                                        {ops.map(o => {
                                                                            const sel = form.componentes.has(o.OpcionID);
                                                                            const def = form.componentes.get(o.OpcionID) === true;
                                                                            return (
                                                                                <button key={o.OpcionID} type="button"
                                                                                    title={`${o.NotaMolde || ''}${o.NotaTallesFemeninos ? ` · Fem: ${o.NotaTallesFemeninos}` : ''}`}
                                                                                    onClick={() => {
                                                                                        const next = new Map(form.componentes);
                                                                                        if (!sel) next.set(o.OpcionID, false);
                                                                                        else if (!def) {
                                                                                            // 2º clic = marcar default (único por tipo)
                                                                                            ops.forEach(x => { if (next.has(x.OpcionID)) next.set(x.OpcionID, false); });
                                                                                            next.set(o.OpcionID, true);
                                                                                        } else next.delete(o.OpcionID);
                                                                                        setF({ componentes: next });
                                                                                    }}
                                                                                    className={`relative rounded-xl border-2 p-2 pb-1.5 flex flex-col items-center gap-0.5 bg-white transition-all ${def ? 'border-amber-400 bg-amber-50/40 shadow-sm' : sel ? 'border-emerald-500 bg-emerald-50/30 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                                                                    {def && <span className="absolute top-1 right-1 text-[11px]">⭐</span>}
                                                                                    {sel && !def && <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center">✓</span>}
                                                                                    <CompIcon codigo={o.Codigo} />
                                                                                    <span className="font-mono text-[9px] font-black text-slate-400 bg-slate-100 rounded px-1">{o.Codigo}</span>
                                                                                    <span className="text-[10.5px] font-bold text-slate-600 leading-tight text-center">{o.Nombre}</span>
                                                                                    <span className="text-[9px] font-black h-3">
                                                                                        {def && <span className="text-amber-600">DEFAULT </span>}
                                                                                        {o.PrecioExtra != null && <span className="text-emerald-600">+${Number(o.PrecioExtra).toLocaleString('es-UY')}</span>}
                                                                                    </span>
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        <p className="text-[11px] text-slate-400">Clic = ofrecer · segundo clic = marcar default ⭐ · tercer clic = quitar.</p>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">Apliques — posición · técnica · cantidad</p>
                                                        <div className="space-y-2">
                                                            {form.apliques.map((ap, i) => (
                                                                <div key={i} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
                                                                    <input value={ap.posicion} placeholder="Posición (ej. Escudo — pecho izq.)"
                                                                        onChange={e => { const next = [...form.apliques]; next[i] = { ...ap, posicion: e.target.value }; setF({ apliques: next }); }}
                                                                        className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                    <select value={ap.areaId}
                                                                        onChange={e => { const next = [...form.apliques]; next[i] = { ...ap, areaId: e.target.value, tecnicaOpcionId: '' }; setF({ apliques: next }); }}
                                                                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold">
                                                                        {[...AREAS, AREA_APLIQUE_EXTRA].map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                                                                    </select>
                                                                    {ap.areaId !== 'ETIQUETA' && (
                                                                        <select value={ap.tecnicaOpcionId}
                                                                            onChange={e => { const next = [...form.apliques]; next[i] = { ...ap, tecnicaOpcionId: e.target.value ? Number(e.target.value) : '' }; setF({ apliques: next }); }}
                                                                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
                                                                            <option value="">Opción libre</option>
                                                                            {tecnicasCat.filter(o => o.AreaID === ap.areaId && o.Activo).map(o => (
                                                                                <option key={o.TecnicaOpcionID} value={o.TecnicaOpcionID}>{o.Nombre}</option>
                                                                            ))}
                                                                        </select>
                                                                    )}
                                                                    <input type="number" min="1" value={ap.cantidad} title="Cantidad"
                                                                        onChange={e => { const next = [...form.apliques]; next[i] = { ...ap, cantidad: e.target.value }; setF({ apliques: next }); }}
                                                                        className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center" />
                                                                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                                                                        <Toggle on={ap.incluido} onChange={v => { const next = [...form.apliques]; next[i] = { ...ap, incluido: v }; setF({ apliques: next }); }} />
                                                                        {ap.incluido ? 'incluido' : 'se cobra'}
                                                                    </label>
                                                                    <button type="button" onClick={() => setF({ apliques: form.apliques.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <button type="button"
                                                            onClick={() => setF({ apliques: [...form.apliques, { posicion: '', areaId: 'EMB', tecnicaOpcionId: '', cantidad: 1, incluido: true }] })}
                                                            className="mt-2 border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar aplique
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* ── PASO VARIANTES ── */}
                                            {paso === 'variantes' && (
                                                <div className="space-y-4 max-w-3xl">
                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Código corto — prefijo de las variantes</p>
                                                        <p className="text-xs text-slate-500 mb-2">
                                                            Cada variante se arma como <span className="font-mono font-bold">PREFIJO + número</span>, ej. <span className="font-mono font-bold text-indigo-600">{(form.codigoCorto || String(form.proId)).toUpperCase().slice(0, 3)}000001</span>.
                                                        </p>
                                                        <input value={form.codigoCorto} maxLength={3}
                                                            onChange={e => setF({ codigoCorto: e.target.value.toUpperCase().slice(0, 3) })}
                                                            placeholder={String(form.proId)}
                                                            className="w-24 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono font-bold uppercase text-center" />
                                                        <span className="text-[11px] text-slate-400 ml-2">Se guarda con "Guardar cambios", abajo.</span>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                                                            <div>
                                                                <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Variantes generadas</p>
                                                                <p className="text-xs text-slate-500">Una fila por cada combinación de las opciones marcadas en "Componentes y apliques".</p>
                                                            </div>
                                                            <button type="button" onClick={generarVariantes} disabled={generandoVariantes}
                                                                className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">
                                                                {generandoVariantes ? 'Generando…' : (variantes.length ? '🔄 Actualizar variantes' : '⚙️ Generar variantes')}
                                                            </button>
                                                        </div>

                                                        {variantesObsoletas > 0 && (
                                                            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] font-bold text-amber-700">
                                                                ⚠ {variantesObsoletas} variante(s) vieja(s) quedaron con una combinación que ya no es alcanzable (se sacó o agregó un componente). No se borran solas — revisalas antes de publicar.
                                                            </div>
                                                        )}

                                                        {variantesLoading ? (
                                                            <div className="text-xs text-slate-400 py-6 text-center">Cargando variantes…</div>
                                                        ) : variantes.length === 0 ? (
                                                            <div className="text-xs text-slate-400 py-6 text-center">
                                                                Todavía no hay variantes generadas. Elegí los Componentes en el paso anterior y tocá "Generar variantes".
                                                            </div>
                                                        ) : (
                                                            <div className="overflow-x-auto -mx-1">
                                                                <table className="w-full text-xs">
                                                                    <thead>
                                                                        <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                                                                            <th className="px-1 py-2">Código</th>
                                                                            <th className="px-1 py-2">Combinación</th>
                                                                            <th className="px-1 py-2">Precio calculado</th>
                                                                            <th className="px-1 py-2">Precio manual (override)</th>
                                                                            <th className="px-1 py-2 text-center">Activa</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {variantes.map(v => (
                                                                            <tr key={v.VarianteID} className={`border-b border-slate-50 ${v.Activa ? '' : 'opacity-40'}`}>
                                                                                <td className="px-1 py-2 font-mono font-bold text-slate-700">{v.Codigo}</td>
                                                                                <td className="px-1 py-2 text-slate-500">{v.CodigoLegible}</td>
                                                                                <td className="px-1 py-2 text-slate-600">{fmtPrecio(v.PrecioCalculado, form.moneda)}</td>
                                                                                <td className="px-1 py-2">
                                                                                    <input type="number" defaultValue={v.PrecioManual ?? ''} placeholder="—"
                                                                                        onBlur={e => { if (e.target.value !== String(v.PrecioManual ?? '')) guardarPrecioManualVariante(v, e.target.value); }}
                                                                                        className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-xs" />
                                                                                </td>
                                                                                <td className="px-1 py-2 text-center">
                                                                                    <Toggle on={v.Activa} onChange={() => toggleVarianteActiva(v)} />
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                                <p className="text-[11px] text-slate-400 mt-2">{variantes.length} variante(s) · {variantes.filter(v => v.Activa).length} activa(s)</p>
                                                            </div>
                                                        )}
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
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">Campos del pie</p>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                            {[['material', 'Material'], ['tallas', 'Tallas'], ['marcacion', 'Marcación'], ['colores', 'Colores'], ['proveedor', 'Proveedor']].map(([k, label]) => (
                                                                <div key={k}>
                                                                    <label className="text-[11px] font-bold text-slate-500 block mb-1">{label}</label>
                                                                    <input value={form.fichaDiseno[k]}
                                                                        onChange={e => setF({ fichaDiseno: { ...form.fichaDiseno, [k]: e.target.value } })}
                                                                        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="border border-slate-200 rounded-xl p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-3">Campos extra</p>
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
                                                                        {costurasIsoCat.map(o => <option key={o.CosturaISOID} value={o.CodigoISO}>{o.CodigoISO} — {o.Nombre}</option>)}
                                                                    </select>
                                                                    <button type="button" onClick={() => setF({ fichaDisenoCosturas: form.fichaDisenoCosturas.filter((_, j) => j !== i) })}
                                                                        className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <button type="button"
                                                            onClick={() => setF({ fichaDisenoCosturas: [...form.fichaDisenoCosturas, { union: '', iso: costurasIsoCat[0]?.CodigoISO || '' }] })}
                                                            className="border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                                                            + Agregar costura
                                                        </button>

                                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mt-4 mb-2">Costuras del despiece <span className="normal-case font-bold">(automáticas)</span></p>
                                                        {form.costurasSugeridas.length === 0 ? (
                                                            <p className="text-xs text-slate-400">Marcá una opción ⭐ default en "Componentes y apliques" con piezas cargadas para ver costuras sugeridas acá.</p>
                                                        ) : (
                                                            <div className="space-y-1.5">
                                                                {form.costurasSugeridas.map((s, i) => (
                                                                    <div key={i} className="flex items-center gap-2 text-xs">
                                                                        <span className="font-bold text-slate-600 w-32 truncate">{s.pieza}</span>
                                                                        <span className="font-mono text-slate-500">{s.iso}</span>
                                                                        <span className="text-slate-400 flex-1">{s.nombre}</span>
                                                                        <button type="button"
                                                                            onClick={() => setF({ fichaDisenoCosturas: [...form.fichaDisenoCosturas, { union: s.pieza, iso: s.iso }] })}
                                                                            className="text-indigo-600 hover:text-indigo-800 font-bold">+ usar</button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
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
                                                                                <td className="font-bold py-1 pr-2 w-20">Material</td><td className="py-1">{form.fichaDiseno.material}</td>
                                                                                <td className="font-bold py-1 pr-2 pl-4 w-20">Colores</td><td className="py-1">{form.fichaDiseno.colores}</td>
                                                                            </tr>
                                                                            <tr>
                                                                                <td className="font-bold py-1 pr-2">Tallas</td><td className="py-1">{form.fichaDiseno.tallas}</td>
                                                                                <td className="font-bold py-1 pr-2 pl-4">Proveedor</td><td className="py-1">{form.fichaDiseno.proveedor}</td>
                                                                            </tr>
                                                                            <tr>
                                                                                <td className="font-bold py-1 pr-2">Marcación</td><td className="py-1" colSpan={3}>{form.fichaDiseno.marcacion}</td>
                                                                            </tr>
                                                                        </tbody>
                                                                    </table>
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
                                                                        const corto = a.id === 'EMB' ? 'Bordado' : a.id === 'TPU' ? 'TPU' : 'DTF';
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
                                                                            {(it.servicios || []).length > 0 && ` +${it.servicios.map(s => (s.areaId === 'EMB' ? 'Bordado' : s.areaId === 'TPU' ? 'TPU' : 'DTF') + (s.incluido ? '' : '($)')).join('+')}`}
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
                                                        <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Técnicas</span><span className="font-bold text-slate-700">{form.esCombo ? 'por producto (ver composición)' : (AREAS.filter(a => form.tecnicas[a.id].on).map(a => `${a.label} (${form.tecnicas[a.id].modo.toLowerCase()}${form.tecnicas[a.id].cobro === 'INCLUIDA' ? ', incluida' : ''})`).join(' · ') || 'ninguna')}</span></div>
                                                        <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Precio</span><span className="font-bold text-slate-700">{fmtPrecio(form.precio === '' ? null : form.precio, form.moneda)}{form.politica === 'PAQUETE' ? ' el paquete' : ' /u sin servicios'}</span></div>
                                                        <div className="flex justify-between px-4 py-2.5 gap-4"><span className="text-slate-400 font-bold">Cantidad</span><span className="font-bold text-slate-700 text-right">{form.politica === 'LIBRE' ? 'libre'
                                                            : form.politica === 'MINIMA' ? `mínimo ${form.cantidadMinima || '—'} u`
                                                            : form.comboItems.length > 0 ? `paquete armado: ${form.comboItems.map(it => `${it.cantidad}× ${it.itemNombre || `#${it.itemProIdProducto}`}${it.wmsVarianteId ? ` (${it.varianteNombre})` : ''}`).join(' + ')}`
                                                            : `paquete fijo de ${form.cantidadFija || '—'} u${form.surtido.size ? ` · surtido: ${form.surtido.size} variantes` : ' · surtido: todas'}`}</span></div>
                                                        {form.origenTipo === 'CONFECCIONADO' && (() => {
                                                            const extraDefault = [...form.componentes.entries()]
                                                                .filter(([, esDefault]) => esDefault)
                                                                .reduce((sum, [opcionId]) => sum + (Number(componentesCat.find(c => c.OpcionID === opcionId)?.PrecioExtra) || 0), 0);
                                                            const base = form.precio === '' ? 0 : Number(form.precio) || 0;
                                                            return (<>
                                                                <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Confección</span><span className="font-bold text-slate-700">{form.componentes.size} opciones de componente · {form.apliques.length} apliques</span></div>
                                                                {extraDefault > 0 && (
                                                                    <div className="flex justify-between px-4 py-2.5"><span className="text-slate-400 font-bold">Precio con componentes por default</span><span className="font-bold text-slate-700">{fmtPrecio(base, form.moneda)} + {fmtPrecio(extraDefault, form.moneda)} = <b className="text-emerald-700">{fmtPrecio(base + extraDefault, form.moneda)}</b></span></div>
                                                                )}
                                                            </>);
                                                        })()}
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

                    {/* ── CATÁLOGO DE COMPONENTES ── */}
                    {vista === 'componentes' && (
                        <CatalogoComponentes componentes={componentesCat} onReload={loadCatalogos} />
                    )}
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
//  Catálogo de componentes (nomenclador CR/CV/CP/CS/CM · MG · TM · CT)
// ═════════════════════════════════════════════════════════════════════════
function CatalogoComponentes({ componentes, onReload }) {
    const [editId, setEditId] = useState(null);
    const [draft, setDraft] = useState({});
    const [saving, setSaving] = useState(false);
    const [nuevo, setNuevo] = useState(null); // { tipo, subTipo, codigo, nombre }
    const [creando, setCreando] = useState(false);

    const SUBTIPOS_CUELLO = ['REDONDO', 'EN V', 'POLO', 'CAMISA', 'MAO'];

    const [piezas, setPiezas] = useState([]); // piezas de la opción en edición (despiece)
    const abrirEdicion = (c) => {
        setEditId(c.OpcionID);
        setDraft({
            nombre: c.Nombre || '', notaMolde: c.NotaMolde || '',
            notaTallesFemeninos: c.NotaTallesFemeninos || '', anchoRefMm: c.AnchoRefMm ?? '',
            precioExtra: c.PrecioExtra ?? '',
        });
        setPiezas((c.piezas || []).map(p => ({ nombrePieza: p.NombrePieza, cantidad: p.Cantidad, zona: p.Zona || '', forma: p.Forma || '' })));
    };

    const guardarEdicion = async (c) => {
        if (!draft.nombre.trim()) return toast.error('El nombre es obligatorio.');
        setSaving(true);
        try {
            await Promise.all([
                api.put(`${API}/componentes/${c.OpcionID}`, draft),
                api.put(`${API}/componentes/${c.OpcionID}/piezas`, { piezas: piezas.filter(p => p.nombrePieza.trim()) }),
            ]);
            toast.success(`✅ ${c.Codigo} guardado`);
            setEditId(null);
            onReload();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setSaving(false); }
    };

    const toggleActivo = async (c) => {
        try {
            await api.put(`${API}/componentes/${c.OpcionID}`, { activo: !c.Activo });
            toast.success(c.Activo ? `${c.Codigo} desactivado` : `${c.Codigo} activado`);
            onReload();
        } catch (err) { toast.error('Error: ' + (err.response?.data?.error || err.message)); }
    };

    const crear = async () => {
        if (!nuevo?.codigo?.trim() || !nuevo?.nombre?.trim()) return toast.error('Código y nombre son obligatorios.');
        setCreando(true);
        try {
            await api.post(`${API}/componentes`, nuevo);
            toast.success('✅ Componente creado');
            setNuevo(null);
            onReload();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setCreando(false); }
    };

    // Tarjeta visual de un componente (mismo lenguaje que el editor de producto)
    const Card = (c) => (
        <button key={c.OpcionID} type="button" onClick={() => (editId === c.OpcionID ? setEditId(null) : abrirEdicion(c))}
            className={`relative rounded-xl border-2 p-2.5 pb-2 flex flex-col items-center gap-1 bg-white transition-all text-center
                ${editId === c.OpcionID ? 'border-indigo-500 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}
                ${!c.Activo ? 'opacity-45' : ''}`}>
            {!c.Activo && <span className="absolute top-1.5 left-1.5 text-[9px] font-black text-slate-400"><i className="fa-solid fa-eye-slash"></i></span>}
            <i className="fa-solid fa-pen absolute top-1.5 right-1.5 text-[9px] text-slate-300"></i>
            <CompIcon codigo={c.Codigo} size={54} />
            <span className="font-mono text-[9.5px] font-black text-slate-500 bg-slate-100 rounded px-1.5">{c.Codigo}</span>
            <span className="text-[11px] font-bold text-slate-700 leading-tight">{c.Nombre}</span>
            {(c.NotaMolde || c.NotaTallesFemeninos || c.AnchoRefMm) && (
                <span className="text-[9px] text-slate-400 leading-tight">
                    {[c.NotaMolde, c.NotaTallesFemeninos ? `Fem: ${c.NotaTallesFemeninos.toLowerCase()}` : null, c.AnchoRefMm ? `${c.AnchoRefMm} mm` : null]
                        .filter(Boolean).join(' · ')}
                </span>
            )}
            <span className="flex gap-1">
                {c.PrecioExtra != null && <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 rounded px-1">+${Number(c.PrecioExtra).toLocaleString('es-UY')}</span>}
                {c.piezas?.length > 0 && <span className="text-[9px] font-black bg-slate-100 text-slate-500 rounded px-1">{c.piezas.length} pza{c.piezas.length > 1 ? 's' : ''}</span>}
            </span>
        </button>
    );

    // Panel de edición con campos etiquetados (aparece bajo el grupo al tocar una tarjeta)
    const EditPanel = (c) => (
        <div key={`edit-${c.OpcionID}`} className="mt-3 border-2 border-indigo-300 rounded-xl bg-indigo-50/40 p-4">
            <div className="flex items-center gap-3 mb-3">
                <CompIcon codigo={c.Codigo} size={40} />
                <span className="font-mono text-xs font-black text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5">{c.Codigo}</span>
                <span className="font-black text-sm text-slate-800">{c.Nombre}</span>
                <button onClick={() => toggleActivo(c)}
                    className={`ml-auto text-xs font-bold px-3 py-1.5 rounded-lg border ${c.Activo ? 'text-slate-500 border-slate-200 bg-white' : 'text-amber-700 border-amber-300 bg-amber-50'}`}>
                    <i className={`fa-solid ${c.Activo ? 'fa-eye' : 'fa-eye-slash'} mr-1.5`}></i>
                    {c.Activo ? 'Activo — clic para ocultar' : 'Inactivo — clic para activar'}
                </button>
                <button onClick={() => setEditId(null)} className="text-slate-400 hover:text-slate-600 font-black px-1">×</button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
                <label className="text-[11px] font-bold text-slate-500">Nombre
                    <input value={draft.nombre} onChange={e => setDraft({ ...draft, nombre: e.target.value })}
                        className="block w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold bg-white" />
                </label>
                <label className="text-[11px] font-bold text-slate-500">Ancho de referencia (mm) <span className="font-normal text-slate-400">— vivos y fajas</span>
                    <input type="number" step="0.5" value={draft.anchoRefMm} onChange={e => setDraft({ ...draft, anchoRefMm: e.target.value })}
                        placeholder="—" className="block w-32 mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                </label>
                <label className="text-[11px] font-bold text-slate-500">Nota de molde <span className="font-normal text-slate-400">— propio / compartido / sobre boceto</span>
                    <input value={draft.notaMolde} onChange={e => setDraft({ ...draft, notaMolde: e.target.value })}
                        placeholder="Ej. Mismo molde de frente que CV-01" className="block w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                </label>
                <label className="text-[11px] font-bold text-slate-500">Talles femeninos <span className="font-normal text-slate-400">— qué cambia</span>
                    <input value={draft.notaTallesFemeninos} onChange={e => setDraft({ ...draft, notaTallesFemeninos: e.target.value })}
                        placeholder="Ej. Cruce invertido" className="block w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                </label>
                <label className="text-[11px] font-bold text-slate-500">Precio extra <span className="font-normal text-slate-400">— constructiva por ahora, se guarda para cuando se cotice</span>
                    <div className="flex items-center gap-1.5 mt-1">
                        <input type="number" step="0.01" value={draft.precioExtra} onChange={e => setDraft({ ...draft, precioExtra: e.target.value })}
                            placeholder="0.00 (sin extra)" className="block w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                    </div>
                </label>
            </div>

            {/* Piezas del despiece que aporta esta opción */}
            <div className="mt-4 pt-3 border-t border-indigo-200">
                <p className="text-[11px] font-bold text-slate-500 mb-2">Piezas que aporta al despiece</p>
                <div className="space-y-1.5">
                    {piezas.map((p, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                            <input value={p.nombrePieza} placeholder="Nombre de la pieza (ej. Cuello redondo)"
                                onChange={e => { const next = [...piezas]; next[i] = { ...p, nombrePieza: e.target.value }; setPiezas(next); }}
                                className="flex-1 min-w-[140px] border border-slate-200 rounded px-2 py-1 text-xs" />
                            <input type="number" min="1" value={p.cantidad} title="Cantidad"
                                onChange={e => { const next = [...piezas]; next[i] = { ...p, cantidad: e.target.value }; setPiezas(next); }}
                                className="w-14 border border-slate-200 rounded px-2 py-1 text-xs text-center" />
                            <select value={p.zona} onChange={e => { const next = [...piezas]; next[i] = { ...p, zona: e.target.value }; setPiezas(next); }}
                                className="border border-slate-200 rounded px-1.5 py-1 text-xs">
                                <option value="">zona…</option>
                                <option value="base">base</option>
                                <option value="contraste">contraste</option>
                            </select>
                            <input value={p.forma} placeholder="forma (hoja de corte)"
                                onChange={e => { const next = [...piezas]; next[i] = { ...p, forma: e.target.value }; setPiezas(next); }}
                                className="w-28 border border-slate-200 rounded px-2 py-1 text-xs" />
                            <button type="button" onClick={() => setPiezas(piezas.filter((_, j) => j !== i))}
                                className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                        </div>
                    ))}
                    {piezas.length === 0 && <p className="text-[11px] text-slate-400">Sin piezas — puede ser correcto (ej. costadillo "sin", cartera "sin").</p>}
                </div>
                <button type="button" onClick={() => setPiezas([...piezas, { nombrePieza: '', cantidad: 1, zona: '', forma: '' }])}
                    className="mt-2 border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400">
                    + Agregar pieza
                </button>
            </div>

            <div className="flex justify-end mt-3">
                <button onClick={() => guardarEdicion(c)} disabled={saving}
                    className="bg-slate-800 text-white rounded-lg px-5 py-2 text-sm font-bold hover:bg-slate-700 disabled:opacity-50">
                    {saving ? 'Guardando…' : '💾 Guardar'}
                </button>
            </div>
        </div>
    );

    const grupoGrid = (lista) => (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
            {lista.map(Card)}
        </div>
    );

    return (
        <div className="space-y-5">
            <p className="text-xs text-slate-400 max-w-3xl">
                El nomenclador de opciones constructivas, como en la lámina de cuellos: tocá una tarjeta para editar su
                nombre y sus notas. Son constructivas — no cotizan (el precio queda previsto para más adelante).
            </p>
            {TIPOS_COMP.map(tc => {
                const delTipo = componentes.filter(c => c.Tipo === tc.id);
                const enEdicion = delTipo.find(c => c.OpcionID === editId);
                return (
                    <div key={tc.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="font-black text-slate-800 uppercase tracking-tight">{tc.label}</span>
                            <span className="text-[11px] text-slate-400 font-bold">{delTipo.length} opciones</span>
                            <button onClick={() => setNuevo({ tipo: tc.id, subTipo: '', codigo: '', nombre: '' })}
                                className="ml-auto text-xs font-bold text-indigo-500 hover:text-indigo-700">+ Agregar</button>
                        </div>

                        {nuevo?.tipo === tc.id && (
                            <div className="border-2 border-dashed border-indigo-300 rounded-xl bg-indigo-50/40 p-3.5 mb-3 flex flex-wrap gap-2 items-end">
                                <label className="text-[11px] font-bold text-slate-500">Código
                                    <input value={nuevo.codigo} onChange={e => setNuevo({ ...nuevo, codigo: e.target.value.toUpperCase() })}
                                        placeholder="CR-04" className="block w-24 mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-white" autoFocus />
                                </label>
                                <label className="flex-1 min-w-[180px] text-[11px] font-bold text-slate-500">Nombre
                                    <input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
                                        onKeyDown={e => e.key === 'Enter' && crear()}
                                        placeholder="Ej. Cuello redondo con tapeta" className="block w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                                </label>
                                {tc.id === 'CUELLO' && (
                                    <label className="text-[11px] font-bold text-slate-500">Familia
                                        <select value={nuevo.subTipo} onChange={e => setNuevo({ ...nuevo, subTipo: e.target.value })}
                                            className="block mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
                                            <option value="">—</option>
                                            {SUBTIPOS_CUELLO.map(s => <option key={s}>{s}</option>)}
                                        </select>
                                    </label>
                                )}
                                <button onClick={crear} disabled={creando}
                                    className="bg-slate-800 text-white rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">{creando ? '…' : 'Crear'}</button>
                                <button onClick={() => setNuevo(null)} className="text-xs font-bold text-slate-400 px-2 py-2">Cancelar</button>
                            </div>
                        )}

                        {tc.id === 'CUELLO' ? (
                            // Agrupado por familia, como la lámina del PDF
                            [...SUBTIPOS_CUELLO, ''].map(st => {
                                const grupo = delTipo.filter(c => (c.SubTipo || '') === st);
                                if (!grupo.length) return null;
                                return (
                                    <div key={st || 'otros'} className="mb-3 last:mb-0">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{st || 'Otros'}</p>
                                        {grupoGrid(grupo)}
                                    </div>
                                );
                            })
                        ) : grupoGrid(delTipo)}

                        {enEdicion && EditPanel(enEdicion)}
                    </div>
                );
            })}
        </div>
    );
}
