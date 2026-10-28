import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    BadgeDollarSign, Tags, ListChecks, UserCog, Calculator, Microscope, Ban, Layers, Plus, X, Search, Trash2, Pencil,
    Check, CheckCheck, SquareMinus, WandSparkles, FileSpreadsheet, ArrowRight, ArrowLeft, Save, Gavel, List, Table2,
    Globe, FolderOpen, Folder, Earth, Lock, IdCard, Loader2, Phone, Mail, Tag, AlertTriangle, MousePointerClick,
    CirclePlus, Info, Asterisk, PackageOpen, Zap, SquareCheck, Percent, Monitor, Sigma, SearchX, ShieldOff, HelpCircle
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import PriceCalculatorTest from './PriceCalculatorTest';
import PriceReports from './PriceReports';
import BasePrices from './BasePrices';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (28/10/2026): encabezado con ícono, pestañas en pastillas (Selector en el celular), todo claro (zinc +
// brand-cyan), Font Awesome → Lucide, Selector propio en vez de los <select>, ventanas en z-[6000] sin blur y
// confirmaciones / pedidos de valores del sistema (antes window.confirm y prompt). En el celular: lista o detalle (uno
// por vez), excepciones y variantes en tarjetas, la matriz de precios con scroll dentro de su tarjeta. La lógica de
// perfiles, reglas, escalas, asignaciones y precios por variante no cambió.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
// El mismo, con la altura de los campos (py-2.5) para ir en la misma fila que un Selector o un buscador
const BTN_SECUNDARIO_ALTO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_BORRAR_SEC = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-500 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors disabled:opacity-50';
const BTN_ICONO_BORRAR = 'w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors';
const BTN_CERRAR = 'text-zinc-400 hover:text-brand-magenta w-8 h-8 shrink-0 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_CHICO = 'w-full min-w-0 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400';
const ROTULO = 'text-[11px] font-black uppercase tracking-widest text-zinc-400';
const TH_BASE = 'px-3 py-3 text-[10px] font-black uppercase tracking-wide whitespace-nowrap';
const TH = `${TH_BASE} text-zinc-400`;
const CHIP_MINI = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap';
const CHIP_CIAN = 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20';
const CHIP_OK = 'bg-emerald-50 text-emerald-700 border-emerald-200';
const CHIP_NO = 'bg-zinc-50 text-zinc-400 border-zinc-200 border-dashed';
// Campos de números (precios, cantidades): sin color de texto, para poder ponerle el que corresponda
const INPUT_NUM = 'border border-zinc-200 bg-white rounded-xl outline-none transition-colors font-mono font-bold tabular-nums hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
// Selector chico del tipo de regla en la matriz: en cian si no es «Precio Fijo»
const SELECTOR_CHICO = 'flex items-center gap-1 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 pl-2 pr-1.5 py-1 text-[11px] font-bold text-brand-cyan text-left outline-none transition-colors hover:border-brand-cyan/50 focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15';
const SELECTOR_CHICO_NEUTRO = 'flex items-center gap-1 rounded-lg border border-zinc-200 bg-white pl-2 pr-1.5 py-1 text-[11px] font-bold text-zinc-500 text-left outline-none transition-colors hover:border-zinc-300 focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15';
// Ventanas: arriba de la barra de arriba, fondo sin blur
const OVERLAY = 'fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-3 sm:p-4';
const VENTANA = 'bg-white rounded-2xl border border-zinc-200 shadow-xl w-full flex flex-col overflow-hidden';
const claseSegmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`;
const claseChipArea = (activo) => `inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${activo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'}`;
// En pantalla: «US$» y montos con formato uruguayo (las cuentas siguen igual)
const enPantalla = (t) => String(t).replace('U$S', 'US$');
const simboloMoneda = (m) => (m === 'USD' || m === 'U$S' ? 'US$' : '$');
const monto = (n) => parseFloat(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Las familias del catálogo llegan como «📁 FAMILIA: …»: en pantalla, sin el emoji y con un ícono de carpeta
const sinEmoji = (d) => String(d ?? '').replace(/📁\s*/gu, '');
const textoDescripcion = (d) => String(d ?? '').startsWith('📁')
    ? <span className="inline-flex items-center gap-1 min-w-0 max-w-full"><Folder size={12} className="text-brand-cyan shrink-0" /><span className="truncate">{sinEmoji(d)}</span></span>
    : sinEmoji(d);

const PESTANAS = [
    { id: 'base', label: 'Precios Estándar', Icono: Tags },
    { id: 'profiles', label: 'Gestión de Perfiles', Icono: ListChecks },
    { id: 'assignments', label: 'Asignación a Clientes', Icono: UserCog },
    { id: 'simulator', label: 'Simulador de Precios', Icono: Calculator },
    { id: 'reports', label: 'Inteligencia de Precios', Icono: Microscope },
    { id: 'urgencia-excepciones', label: 'Excepciones Urgencia', Icono: Ban },
    { id: 'variante-precios', label: 'Precios x Variante', Icono: Layers },
];

// En el celular, tarjetas en vez de tablas (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 1024px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

// En el celular la lista y el detalle van uno por vez: al elegir algo, la pantalla sube al detalle
function useSubirAlDetalle(elegido, ref) {
    useEffect(() => {
        if (elegido && !window.matchMedia(MQ_TABLA).matches) ref.current?.scrollIntoView({ block: 'start' });
    }, [elegido]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Listas largas de a 50 (patrón useDeAPoco): la de clientes trae miles y se dibujaban todas de una. Al acercarse al
// final se agregan 50 más; vuelve a 50 cuando cambia la lista (`reinicio`). El margen se mide contra el contenedor que
// scrollea. El aviso del final se engancha con `ref={setCentinela}`.
const DE_A = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(total, ...reinicio) {
    const [cuantos, setCuantos] = useState(DE_A);
    const [centinela, setCentinela] = useState(null);
    useEffect(() => { setCuantos(DE_A); }, reinicio); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!centinela || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        }, { root: contenedorConScroll(centinela), rootMargin: '0px 0px 600px 0px' });
        obs.observe(centinela);
        return () => obs.disconnect();
    }, [cuantos, total, centinela]);
    return [Math.min(cuantos, total), setCentinela];
}

// En vez de window.prompt (la ventana gris del navegador): misma respuesta que prompt, el texto escrito o null si se
// cancela. Uso: const [pedir, ventanaPedir] = usePedirValor(); const v = await pedir({ titulo, texto, valor }); y
// {ventanaPedir} en el JSX. Enter acepta y Escape cancela. Va en portal y en z-[6100], como useConfirmar.
function usePedirValor() {
    const [pedido, setPedido] = useState(null); // { id, titulo, texto, valor, aceptar, resolver }

    const pedir = useCallback((opciones = {}) => new Promise((resolver) => {
        setPedido({ valor: '', aceptar: 'Aceptar', ...opciones, id: Date.now() + Math.random(), resolver });
    }), []);

    const responder = useCallback((valor) => {
        setPedido((p) => { p?.resolver(valor); return null; });
    }, []);

    const ventana = pedido ? createPortal(
        <div className="fixed inset-0 z-[6100] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="pedir-valor-titulo"
            onClick={() => responder(null)}>
            <div key={pedido.id} className="w-full max-w-sm bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden font-sans" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 pt-5 pb-4 flex items-start gap-3">
                    <HelpCircle size={22} className="shrink-0 text-brand-cyan mt-0.5" />
                    <div className="min-w-0 flex-1">
                        <h3 id="pedir-valor-titulo" className="text-base font-black text-zinc-800 leading-snug">{pedido.titulo}</h3>
                        {pedido.texto && <p className="text-sm text-zinc-500 mt-1">{pedido.texto}</p>}
                        <input
                            autoFocus
                            inputMode="decimal"
                            value={pedido.valor}
                            onChange={(e) => { const v = e.target.value; setPedido((p) => (p ? { ...p, valor: v } : p)); }}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); responder(pedido.valor); }
                                else if (e.key === 'Escape') { e.preventDefault(); responder(null); }
                            }}
                            className="mt-3 w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold font-mono tabular-nums text-zinc-800 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                            aria-label={pedido.titulo}
                        />
                    </div>
                </div>
                <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
                    <button type="button" onClick={() => responder(null)} className={BTN_SECUNDARIO}>Cancelar</button>
                    <button type="button" onClick={() => responder(pedido.valor)} className={BTN_PRINCIPAL}>{pedido.aceptar}</button>
                </div>
            </div>
        </div>,
        document.body,
    ) : null;

    return [pedir, ventana];
}

// --- COMPONENTES AUXILIARES ---

const ProductSearchInput = ({ value, onChange, catalog = [] }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const handleSearch = (text) => {
        onChange(text);
        if (!text || text.length < 1) {
            setSuggestions([]);
            return;
        }

        const upperText = text.toUpperCase();
        const matches = catalog.filter(p =>
            p.CodArticulo.toUpperCase().includes(upperText) ||
            (p.Descripcion && p.Descripcion.toUpperCase().includes(upperText))
        ).slice(0, 10);

        setSuggestions(matches);
        setShowSuggestions(matches.length > 0);
    };

    const selectedProduct = catalog.find(p => p.CodArticulo === value);

    return (
        <div className="relative">
            <input
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl font-mono text-sm text-zinc-800 uppercase focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                value={value}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Busca un producto..."
                title="Escribe 'TOTAL' o busca por nombre/código."
                onFocus={() => { if (value === '' || suggestions.length === 0) { setSuggestions(catalog.slice(0, 10)); setShowSuggestions(true); } }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            />
            {selectedProduct && (
                <div className="mt-1 ml-1 leading-tight">
                    <div className="text-[10px] text-zinc-500 truncate" title={sinEmoji(selectedProduct.Descripcion)}>{textoDescripcion(selectedProduct.Descripcion)}</div>
                    {(selectedProduct.GrupoNombre || selectedProduct.Grupo) && <div className={`${CHIP_MINI} bg-zinc-50 text-zinc-500 border-zinc-200 mt-0.5`}>{selectedProduct.GrupoNombre || selectedProduct.Grupo}</div>}
                </div>
            )}
            {showSuggestions && (
                <div className="absolute top-full left-0 w-full mt-1 bg-white border border-zinc-200 shadow-lg rounded-xl z-50 max-h-60 overflow-y-auto">
                    {suggestions.map(s => (
                        <div
                            key={s.CodArticulo}
                            className="px-3 py-2 hover:bg-zinc-50 cursor-pointer text-xs border-b border-zinc-100 last:border-0 flex justify-between items-center"
                            onClick={() => { onChange(s.CodArticulo); setShowSuggestions(false); }}
                        >
                            <div className="flex flex-col overflow-hidden">
                                <span className="font-bold font-mono text-brand-cyan">{s.CodArticulo}</span>
                                {(s.GrupoNombre || s.Grupo) && <span className="text-[9px] text-zinc-400">{s.GrupoNombre || s.Grupo}</span>}
                            </div>
                            <span className="text-zinc-500 truncate max-w-[120px] text-right ml-2" title={sinEmoji(s.Descripcion)}>{sinEmoji(s.Descripcion)}</span>
                        </div>
                    ))}
                    {catalog.length === 0 && <div className="p-2 text-xs text-zinc-400">Cargando catálogo...</div>}
                </div>
            )}
        </div>
    );
};

/* --- COMPONENTE BULK ADD MODAL --- */
const BulkAddModal = ({ onAdd, onCancel, profileName }) => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('');
    const [selection, setSelection] = useState([]);

    // Escalas: array de { qty: 1, val: 0, type: 'fixed_price' }
    const [scales, setScales] = useState([{ qty: 1, val: 0, type: 'fixed_price' }]);

    useEffect(() => {
        api.get('/prices/base')
            .then(res => {
                const uniqueGroups = [];
                const seenGroups = new Set();
                res.data.forEach(p => {
                    const g = p.Grupo;
                    if (g && !seenGroups.has(g)) {
                        seenGroups.add(g);
                        uniqueGroups.push({
                            CodArticulo: `GRUPO: ${g}`,
                            ProIdProducto: null,
                            Descripcion: `📁 FAMILIA: ${p.GrupoNombre ? `${g} (${p.GrupoNombre})` : g}`,
                            Precio: 0,
                            Grupo: 'Familias / Grupos'
                        });
                    }
                });

                const prods = [
                    { CodArticulo: 'TOTAL', ProIdProducto: 0, Descripcion: 'Aplica a todo el resto', Precio: 0, Grupo: 'General' },
                    ...uniqueGroups,
                    ...res.data
                ];
                setProducts(prods);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const groups = React.useMemo(() => [...new Set(products.map(p => p.GrupoNombre || p.Grupo).filter(g => g && g !== 'General'))].sort(), [products]);

    const filtered = products.filter(p => {
        const matchesText = p.CodArticulo.toLowerCase().includes(filter.toLowerCase()) || (p.Descripcion || '').toLowerCase().includes(filter.toLowerCase());
        const gName = p.GrupoNombre || p.Grupo;
        const matchesGroup = !selectedGroup || gName === selectedGroup || (selectedGroup === 'General' && p.CodArticulo === 'TOTAL');
        return matchesText && matchesGroup;
    });

    const toggleSelect = (cod) => {
        if (selection.includes(cod)) setSelection(selection.filter(c => c !== cod));
        else setSelection([...selection, cod]);
    };

    const toggleSelectAll = () => {
        const filteredIds = filtered.map(p => p.CodArticulo);
        const allSelected = filteredIds.length > 0 && filteredIds.every(id => selection.includes(id));

        if (allSelected) {
            setSelection(selection.filter(id => !filteredIds.includes(id)));
        } else {
            setSelection([...new Set([...selection, ...filteredIds])]);
        }
    };

    // Check para UI
    const areAllSelected = filtered.length > 0 && filtered.every(p => selection.includes(p.CodArticulo));

    const addScale = () => {
        setScales([...scales, { qty: '', val: '', type: 'fixed_price' }]);
    };

    const removeScale = (idx) => {
        if (scales.length <= 1) return toast.error("Debe haber al menos una escala base");
        setScales(scales.filter((_, i) => i !== idx));
    };

    const updateScale = (idx, field, val) => {
        const newScales = [...scales];
        newScales[idx][field] = val;
        setScales(newScales);
    };

    const handleConfirm = () => {
        if (selection.length === 0) return toast.error("Selecciona al menos un producto");

        // Validar escalas
        const validScales = scales.filter(s => s.qty && s.val !== '');
        if (validScales.length === 0) return toast.error("Define al menos una regla de precio");

        const newRules = [];

        selection.forEach(cod => {
            const product = products.find(p => p.CodArticulo === cod);
            validScales.forEach(scale => {
                newRules.push({
                    CodArticulo: cod,
                    ProIdProducto: product ? product.ProIdProducto : undefined,
                    TipoRegla: scale.type || 'fixed_price',
                    Valor: scale.val,
                    CantidadMinima: scale.qty,
                    _tempId: Date.now() + Math.random() // Temp ID único
                });
            });
        });

        onAdd(newRules);
    };

    return (
        <div className={`${OVERLAY} animate-fade-in`}>
            <div className={`${VENTANA} max-w-5xl h-[92dvh] sm:h-[85vh]`}>
                <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-start gap-3 shrink-0">
                    <div className="min-w-0">
                        <h3 className="text-base font-black text-zinc-900 flex items-center gap-2"><Layers size={18} className="text-brand-cyan shrink-0" /> Edición Masiva de Reglas</h3>
                        <p className="text-sm text-zinc-500 mt-0.5 truncate">Perfil: <span className="font-bold text-brand-cyan">{profileName || 'Sin Nombre'}</span></p>
                    </div>
                    <button onClick={onCancel} className={BTN_CERRAR} aria-label="Cerrar"><X size={18} /></button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
                    {/* IZQUIERDA: Selector Productos */}
                    <div className="lg:w-2/3 lg:border-r border-zinc-100 flex flex-col gap-2 p-4 h-[58dvh] lg:h-auto shrink-0 lg:shrink min-h-0">
                        <div className="flex flex-wrap sm:flex-nowrap gap-2">
                            <Selector className="sm:w-48" value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} aria-label="Grupo" anchoLista={300}>
                                <option value="">Todos los Grupos</option>
                                {groups.map(g => <option key={g} value={g}>{g}</option>)}
                            </Selector>
                            <div className="relative flex-1 min-w-0">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                <input
                                    className={CAMPO}
                                    placeholder="Buscar..."
                                    value={filter}
                                    onChange={e => setFilter(e.target.value)}
                                />
                            </div>
                            <button onClick={toggleSelectAll} className={`${BTN_SECUNDARIO_ALTO} whitespace-nowrap`} title={areAllSelected ? "Deseleccionar visibles" : "Seleccionar visibles"}>
                                {areAllSelected ? <SquareMinus size={15} className="text-brand-magenta" /> : <CheckCheck size={15} className="text-brand-cyan" />} {areAllSelected ? 'Ninguno' : 'Todos'}
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-zinc-200 divide-y divide-zinc-100">
                            {loading ? <div className="p-6 flex items-center justify-center gap-2 text-sm text-zinc-400"><Loader2 size={16} className="animate-spin text-brand-cyan" /> Cargando...</div> : filtered.map(p => (
                                <label key={p.CodArticulo} className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selection.includes(p.CodArticulo)}
                                        onChange={() => toggleSelect(p.CodArticulo)}
                                        className="w-4 h-4 accent-[#006E97] shrink-0"
                                    />
                                    <div className="overflow-hidden flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5 min-w-0">
                                            <span className="font-bold font-mono text-xs text-zinc-800 truncate">{p.CodArticulo}</span>
                                            {(p.GrupoNombre || p.Grupo) && <span className={`${CHIP_MINI} ${CHIP_CIAN} max-w-[150px] truncate block`} title={p.GrupoNombre || p.Grupo}>{p.GrupoNombre || p.Grupo}</span>}
                                        </div>
                                        <div className="text-xs text-zinc-500 truncate" title={sinEmoji(p.Descripcion)}>{textoDescripcion(p.Descripcion)}</div>
                                    </div>
                                    {p.CodArticulo !== 'TOTAL' && <div className="ml-auto font-mono text-xs text-zinc-400 tabular-nums shrink-0">${p.Precio}</div>}
                                </label>
                            ))}
                        </div>
                        <div className="text-xs text-zinc-500 font-bold tabular-nums">
                            {selection.length} productos seleccionados
                        </div>
                    </div>

                    {/* DERECHA: Configuración Reglas Escalonadas */}
                    <div className="lg:w-1/3 p-4 sm:p-5 bg-zinc-50 border-t lg:border-t-0 border-zinc-100 flex flex-col lg:min-h-0">
                        <div className="mb-4">
                            <h4 className="font-black text-zinc-800 flex items-center gap-2">
                                <WandSparkles size={16} className="text-brand-cyan" /> Reglas a Aplicar
                            </h4>
                            <p className="text-xs text-zinc-500 mt-1">Se crearán las siguientes reglas para cada uno de los <b>{selection.length}</b> productos seleccionados.</p>
                        </div>

                        <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1 lg:-mr-1 pt-2">
                            <div className="flex flex-col gap-3">
                                {scales.map((s, idx) => (
                                    <div key={idx} className="bg-white p-3 rounded-xl border border-zinc-200 relative group">
                                        <div className="grid grid-cols-2 gap-3 mb-2.5">
                                            <div>
                                                <label className={`${ETIQUETA} mb-1`}>Cant. Mínima</label>
                                                <input
                                                    type="number" min="1"
                                                    className={`w-full px-2.5 py-2 text-sm text-zinc-800 ${INPUT_NUM}`}
                                                    value={s.qty}
                                                    onChange={e => updateScale(idx, 'qty', e.target.value)}
                                                    placeholder="1"
                                                />
                                            </div>
                                            <div>
                                                <label className={`${ETIQUETA} mb-1`}>Valor</label>
                                                <input
                                                    type="number" step="0.01"
                                                    className={`w-full px-2.5 py-2 text-sm text-right text-brand-cyan ${INPUT_NUM}`}
                                                    value={s.val}
                                                    onChange={e => updateScale(idx, 'val', e.target.value)}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                        <Selector
                                            className="w-full"
                                            value={s.type}
                                            onChange={e => updateScale(idx, 'type', e.target.value)}
                                            aria-label="Tipo de regla"
                                        >
                                            <option value="fixed_price">Precio Fijo Exacto ($)</option>
                                            <option value="percentage_discount">Descuento Porcentual (%)</option>
                                            <option value="amount_discount">Descuento por Importe ($)</option>
                                            <option value="percentage_surcharge">Recargo Porcentual (%)</option>
                                            <option value="amount_surcharge">Recargo por Importe ($)</option>
                                        </Selector>

                                        {scales.length > 1 && (
                                            <button
                                                onClick={() => removeScale(idx)}
                                                className="absolute -top-2 -right-2 bg-white text-zinc-400 hover:text-brand-magenta hover:border-brand-magenta/30 rounded-full w-6 h-6 border border-zinc-200 flex items-center justify-center lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                                                title="Quitar este rango"
                                                aria-label="Quitar este rango"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <button onClick={addScale} className="w-full py-2.5 mt-3 border-2 border-dashed border-brand-cyan/30 text-brand-cyan rounded-xl font-bold text-xs hover:bg-brand-cyan/5 hover:border-brand-cyan/50 transition-colors flex items-center justify-center gap-2">
                                <Plus size={14} /> Agregar Otro Rango
                            </button>
                        </div>

                        <button
                            onClick={handleConfirm}
                            className={`${BTN_PRINCIPAL} w-full py-3 mt-4 shrink-0`}
                        >
                            <Check size={16} />
                            Aplicar Reglas ({selection.length * scales.length})
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Helper para IDs únicos
const getNextTempId = (items) => {
    const max = items.reduce((acc, i) => Math.max(acc, typeof i._tempId === 'number' ? i._tempId : 0), 0);
    return Date.now() + Math.random();
};

const TieredWizard = ({ existingScales, onSave, onCancel, productName }) => {
    // Detect initial type
    const initialType = (existingScales && existingScales.length > 0 &&
        (existingScales[0].TipoRegla === 'percentage' || existingScales[0].TipoRegla === 'percentage_discount'))
        ? 'percentage' : 'fixed';

    const [type, setType] = useState(initialType);

    const [scales, setScales] = useState(() => {
        if (existingScales && existingScales.length > 0) {
            return existingScales.map(s => ({ qty: s.CantidadMinima || 1, val: s.Valor })).sort((a, b) => a.qty - b.qty);
        }
        return [{ qty: 1, val: 0 }];
    });
    // Estética nueva (28/10/2026): confirmación del sistema (antes confirm nativo)
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const addScale = () => {
        setScales([...scales, { qty: '', val: '' }]);
    };

    const removeScale = (idx) => {
        if (scales.length <= 1) return toast.error("Debe haber al menos una escala base");
        setScales(scales.filter((_, i) => i !== idx));
    };

    const updateScale = (idx, field, val) => {
        const newScales = [...scales];
        newScales[idx][field] = val;
        setScales(newScales);
    };

    const handleSave = async () => {
        // Validar
        const validScales = scales.filter(s => s.qty && s.val !== '');
        if (validScales.length === 0) return toast.error("Define al menos una escala válida");

        // Ordenar por cantidad
        validScales.sort((a, b) => parseInt(a.qty) - parseInt(b.qty));

        // Validation for base qty 1
        if (parseFloat(validScales[0].qty) !== 1) {
            if (!(await confirmar({ titulo: 'La primera escala no empieza en 1', texto: `La primera escala comienza en cantidad ${validScales[0].qty}. ¿Deseas guardar así?`, confirmar: 'Guardar así' }))) {
                return;
            }
        }

        onSave(validScales, type);
    };

    return (
        <div className={`${OVERLAY} animate-fade-in`}>
            {ventanaConfirmar}
            <div className={`${VENTANA} max-w-lg max-h-[92dvh]`}>
                <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center gap-3 shrink-0">
                    <h3 className="text-base font-black text-zinc-900 flex items-center gap-2 min-w-0">
                        <WandSparkles size={18} className="text-brand-cyan shrink-0" /> <span className="truncate" title={sinEmoji(productName)}>{sinEmoji(productName)}</span>
                    </h3>
                    <button onClick={onCancel} className={BTN_CERRAR} aria-label="Cerrar"><X size={18} /></button>
                </div>
                <div className="p-5 overflow-y-auto">
                    <p className="text-sm text-zinc-500 mb-4">Configura precios escalonados (por volumen). Elige si definir precios fijos o descuentos porcentuales sobre el precio de lista.</p>

                    {/* TYPE SELECTOR */}
                    <div className="flex rounded-xl border border-zinc-200 bg-white p-1 gap-1 mb-5" role="radiogroup" aria-label="Tipo de escala">
                        <button
                            role="radio"
                            aria-checked={type === 'fixed'}
                            onClick={() => setType('fixed')}
                            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-colors ${type === 'fixed' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
                        >
                            <Tag size={13} className={type === 'fixed' ? 'text-white' : 'text-brand-cyan'} /> Precio Fijo ($)
                        </button>
                        <button
                            role="radio"
                            aria-checked={type === 'percentage'}
                            onClick={() => setType('percentage')}
                            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-colors ${type === 'percentage' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
                        >
                            <Percent size={13} className={type === 'percentage' ? 'text-white' : 'text-brand-cyan'} /> Descuento (%)
                        </button>
                    </div>

                    <div className="flex flex-col gap-2 mb-3">
                        <div className="flex gap-2 px-1">
                            <div className={`w-1/2 ${ETIQUETA}`}>Cant. Mínima</div>
                            <div className={`w-1/2 ${ETIQUETA}`}>{type === 'fixed' ? 'Precio Unitario ($)' : 'Descuento (%)'}</div>
                            <div className="w-8 shrink-0"></div>
                        </div>
                        {scales.map((s, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                                <div className="w-1/2 relative">
                                    <input
                                        type="number" min="1"
                                        className={`w-full pl-3 pr-12 py-2.5 text-sm text-zinc-800 ${INPUT_NUM}`}
                                        value={s.qty}
                                        onChange={e => updateScale(idx, 'qty', e.target.value)}
                                        placeholder="Ej: 1"
                                    />
                                    <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-bold pointer-events-none">u.</span>
                                </div>
                                <div className="w-1/2 relative">
                                    {type === 'fixed' ? (
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold pointer-events-none">$</span>
                                    ) : (
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold pointer-events-none">Desc.</span>
                                    )}

                                    <input
                                        type="number" step={type === 'fixed' ? "0.01" : "1"}
                                        className={`w-full py-2.5 text-sm text-right ${INPUT_NUM} ${type === 'percentage' ? 'text-emerald-700 pl-12 pr-7' : 'text-zinc-800 pl-7 pr-3'}`}
                                        value={s.val}
                                        onChange={e => updateScale(idx, 'val', e.target.value)}
                                        placeholder="0"
                                    />
                                    {type === 'percentage' && (
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold pointer-events-none">%</span>
                                    )}
                                </div>
                                <button onClick={() => removeScale(idx)} className={BTN_ICONO_BORRAR} title="Quitar escala" aria-label="Quitar escala">
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button onClick={addScale} className="text-xs text-brand-cyan font-bold hover:underline inline-flex items-center gap-1">
                        <CirclePlus size={14} /> Agregar Escala
                    </button>
                </div>
                <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2 shrink-0">
                    <button onClick={onCancel} className={BTN_SECUNDARIO}>Cancelar</button>
                    <button onClick={handleSave} className={BTN_PRINCIPAL}><Save size={15} /> Guardar Escalas</button>
                </div>
            </div>
        </div>
    );
};

const RowProductSelector = ({ catalog, defaultTerm, onSelect }) => {
    const [value, setValue] = useState(defaultTerm || '');
    const [active, setActive] = useState(false);

    // filtered catalog
    const suggestions = React.useMemo(() => {
        if (!value || value.length < 2) return [];
        const upper = value.toUpperCase();
        return catalog.filter(c =>
            c.CodArticulo.toUpperCase().includes(upper) ||
            (c.Descripcion && c.Descripcion.toUpperCase().includes(upper))
        ).slice(0, 30);
    }, [value, catalog]);

    return (
        <div className="relative group w-full">
            <div className="relative flex items-center">
                <Search size={13} className="absolute left-2.5 text-brand-magenta/60 pointer-events-none" />
                <input
                    className="w-full border border-brand-magenta/30 rounded-lg px-2 py-1.5 pl-8 text-xs font-mono text-brand-magenta bg-brand-magenta/5 placeholder:text-brand-magenta/50 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 focus:bg-white focus:text-zinc-800"
                    value={value}
                    onChange={e => { setValue(e.target.value); setActive(true); }}
                    onFocus={() => setActive(true)}
                    onBlur={() => setTimeout(() => setActive(false), 200)}
                    placeholder="Buscar producto..."
                    autoFocus
                />
            </div>
            {active && suggestions.length > 0 && (
                <div className="absolute top-full left-0 w-[min(400px,80vw)] bg-white border border-zinc-200 shadow-xl rounded-xl z-[80] max-h-60 overflow-y-auto mt-1 divide-y divide-zinc-100">
                    <div className="px-3 py-1.5 bg-zinc-50 text-[10px] font-black text-zinc-400 uppercase tracking-wider sticky top-0 border-b border-zinc-100">Resultados ({suggestions.length})</div>
                    {suggestions.map(p => (
                        <div
                            key={p.CodArticulo}
                            className="px-3 py-2 hover:bg-zinc-50 cursor-pointer transition-colors"
                            onMouseDown={() => onSelect(p)}
                        >
                            <div className="flex justify-between items-baseline gap-2">
                                <span className="font-bold font-mono text-brand-cyan text-xs">{p.CodArticulo}</span>
                                <span className="text-[10px] text-zinc-400 ml-2 truncate">{p.GrupoNombre || p.Grupo}</span>
                            </div>
                            <div className="text-[11px] text-zinc-600 truncate">{sinEmoji(p.Descripcion)}</div>
                        </div>
                    ))}
                </div>
            )}
            {active && value.length >= 2 && suggestions.length === 0 && (
                <div className="absolute top-full left-0 w-64 mt-1 bg-white border border-zinc-200 p-3 shadow-xl rounded-xl z-[80] text-xs text-zinc-400 text-center">
                    No hay coincidencias
                </div>
            )}
        </div>
    );
};

const ExcelImportModal = ({ onImport, onCancel, catalog }) => {
    const [text, setText] = useState('');
    const [step, setStep] = useState(1); // 1: Paste, 2: Map/Preview
    const [parsedData, setParsedData] = useState([]); // { product, values: [v1, v2...] }
    const [headers, setHeaders] = useState([]);
    const [colMappings, setColMappings] = useState({}); // { colIndex: qty }

    const processText = () => {
        if (!text.trim()) return;

        const lines = text.trim().split('\n');
        if (lines.length < 2) return toast.error("Pega al menos una cabecera y una fila de datos");

        // Detect separator (Tab or huge spaces?)
        // Excel copy usually puts Tabs (\t)
        // If user copied from typical table, it's \t. 
        // Fallback: simple split by multiple spaces regex if tabs fail?
        // Let's stick to tabs first as it's standard excel copy.

        let separator = '\t';
        // Simple heuristic: check first line
        if (!lines[0].includes('\t')) {
            // Maybe CSV? or spaces?
            // Let's assume user followed instructions
        }

        const rows = lines.map(line => line.split(separator));
        const rawHeaders = rows[0];
        const dataRows = rows.slice(1);

        // Auto-detect quantities in headers
        const mappings = {};
        rawHeaders.forEach((h, idx) => {
            if (idx === 0) return; // Prod col
            // Extract number "POR 15" -> 15
            const match = h.match(/(\d+)/);
            if (match) {
                mappings[idx] = parseInt(match[1]);
            }
        });

        // Resolve Products
        const processed = dataRows.map(row => {
            const rowTerm = (row[0] || '').trim().replace(/^"|"$/g, ''); // Remove quotes if CSV copy
            if (!rowTerm) return null;

            // Normalize term
            const upperTerm = rowTerm.toUpperCase();

            // Match Catalog
            // 1. Exact Code
            let prod = catalog.find(c => c.CodArticulo.toUpperCase() === upperTerm);
            // 2. Exact Desc
            if (!prod) prod = catalog.find(c => (c.Descripcion || '').toUpperCase() === upperTerm);

            // 3. Fuzzy? Contains?
            // Careful with fuzzy match on huge catalogs

            return {
                term: rowTerm,
                prod,
                values: row.slice(1)
            };
        }).filter(r => r);

        setHeaders(rawHeaders);
        setParsedData(processed);
        setColMappings(mappings);
        setStep(2);
    };

    const updateRowProduct = (index, product) => {
        setParsedData(prev => {
            const next = [...prev];
            next[index] = { ...next[index], prod: product };
            return next;
        });
    };

    const handleImport = () => {
        // Validation: Check if we have any quantities mapped
        const hasQuantities = Object.values(colMappings).some(q => q && !isNaN(q) && q > 0);
        if (!hasQuantities) {
            return toast.error("Debes definir la Cantidad Mínima para al menos una columna (encabezados).");
        }

        // Build rules
        const newRules = [];
        let rowsProcessed = 0;
        let rowsSkippedNoProduct = 0;
        let cellsSkippedInvalid = 0;

        parsedData.forEach(row => {
            if (!row.prod) {
                rowsSkippedNoProduct++;
                return;
            }

            rowsProcessed++;

            headers.slice(1).forEach((_, i) => {
                const colIdx = i + 1;
                const qty = colMappings[colIdx]; // user defined quantity for this column
                const rawVal = row.values[i];

                if (qty && rawVal !== undefined && rawVal !== null && rawVal.trim() !== '') {
                    // Logic to parse price safely
                    // Support "1.500,00" (thousands dot, decimal comma) vs "1,500.00" vs simple "10.5"
                    let str = rawVal.toString().trim();

                    // Remove $ and spaces
                    str = str.replace(/[$\s]/g, '');

                    // Specific fix for user case: "3,5" -> 3.5
                    // If proper number format standard is uncertain, we assume:
                    // If contains comma, and it's not a thousand separator (e.g. 1,000 is ambiguous but 1,5 usually means 1.5)
                    // Let's use a standard heuristic for local inputs (Latin America/Europe often uses comma for decimals)

                    // safe method: replace comma with dot, remove other non-numeric-dot chars?
                    // But "1.000,50" -> remove dot -> "1000,50" -> replace comma -> "1000.50". Correct.
                    // "1,5" -> "1.5". Correct.
                    // "1000" -> "1000". Correct.

                    // Danger: "1.500" (meaning 1500) -> "1500". "1.5" (meaning 1.5) -> "15" ??
                    // If text contains "," we assume it is the decimal separator?

                    let val = 0;
                    if (str.includes(',') && str.includes('.')) {
                        // Mixed: presume dot is thousands, comma is decimal
                        str = str.replace(/\./g, '').replace(',', '.');
                    } else if (str.includes(',')) {
                        // Comma only: assume decimal
                        str = str.replace(',', '.');
                    }
                    // else (dots only or numbers only): parse as js float. 
                    // JS float uses dot. "1.500" in JS is 1.5. 
                    // If user meant 1500, they shouldn't use dot for thousands in simple input, OR we have context.
                    // Given the user example "2,5" and "3,5", comma is decimal.
                    // "80" -> 80.

                    val = parseFloat(str);

                    if (!isNaN(val)) {
                        newRules.push({
                            CodArticulo: row.prod.CodArticulo,
                            ProIdProducto: row.prod.ProIdProducto,
                            TipoRegla: 'fixed_price',
                            Valor: val,
                            CantidadMinima: qty,
                            _tempId: Date.now() + Math.random() + newRules.length
                        });
                    } else {
                        cellsSkippedInvalid++;
                    }
                }
            });
        });

        if (newRules.length === 0) {
            if (rowsSkippedNoProduct > 0 && rowsProcessed === 0) {
                return toast.error(`No se encontraron productos válidos. Revisa las coincidencias o asigna manualmente.`);
            }
            return toast.error("No se generaron reglas. Verifica que las celdas tengan precios numéricos válidos.");
        }

        onImport(newRules);
    };

    return (
        <div className={`${OVERLAY} animate-fade-in`}>
            <div className={`${VENTANA} max-w-6xl h-[92dvh] sm:h-[90vh]`}>
                <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center gap-3 shrink-0">
                    <h3 className="text-base font-black text-zinc-900 flex items-center gap-2"><FileSpreadsheet size={18} className="text-brand-cyan shrink-0" /> Importar desde Excel</h3>
                    <button onClick={onCancel} className={BTN_CERRAR} aria-label="Cerrar"><X size={18} /></button>
                </div>

                {step === 1 ? (
                    <div className="flex-1 min-h-0 p-4 sm:p-5 flex flex-col gap-3">
                        <div className="text-sm text-zinc-600">
                            Copia tus celdas de Excel (incluyendo la cabecera) y pégalas aquí.
                            <span className="block text-xs text-zinc-400 mt-0.5">Formato: Primera columna = Producto (Nombre o Código). Resto columnas = Precios por cantidad.</span>
                        </div>
                        <textarea
                            className="flex-1 min-h-0 w-full border border-zinc-200 rounded-xl p-4 font-mono text-xs text-zinc-700 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 resize-none"
                            placeholder={"Producto\tMin 15\tMin 30\tMin 100\nTPU XYZ\t3,5\t3,0\t2,5\n..."}
                            value={text}
                            onChange={e => setText(e.target.value)}
                        />
                        <div className="flex justify-end">
                            <button onClick={processText} className={`${BTN_PRINCIPAL} w-full sm:w-auto px-6`}>Analizar Datos <ArrowRight size={15} /></button>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                        {/* Configuration */}
                        <div className="px-4 sm:px-5 py-3 bg-zinc-50 border-b border-zinc-100 flex gap-5 overflow-x-auto items-center shrink-0">
                            <div className={`${ETIQUETA} whitespace-nowrap`}>Mapeo de Columnas</div>
                            {headers.slice(1).map((h, i) => {
                                const colIdx = i + 1;
                                return (
                                    <div key={i} className="flex flex-col gap-1 min-w-[120px]">
                                        <div className="text-[10px] uppercase font-black text-zinc-500 truncate" title={h}>{h}</div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-zinc-400">Cant:</span>
                                            <input
                                                type="number"
                                                className={`w-20 px-2 py-1.5 text-sm text-center text-zinc-800 ${INPUT_NUM}`}
                                                value={colMappings[colIdx] || ''}
                                                onChange={e => setColMappings({ ...colMappings, [colIdx]: parseInt(e.target.value) })}
                                                placeholder="-"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Preview */}
                        <div className="flex-1 min-h-0 overflow-auto">
                            <table className="w-full text-xs text-left border-collapse">
                                <thead className="bg-zinc-50 sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7]">
                                    <tr>
                                        <th className={`${TH} text-left`}>Dato Original</th>
                                        <th className={`${TH} text-left w-80`}>Producto Detectado</th>
                                        {headers.slice(1).map((h, i) => (
                                            <th key={i} className={`${TH_BASE} text-center ${colMappings[i + 1] ? 'bg-emerald-50 text-emerald-700' : 'text-zinc-300'}`}>
                                                {colMappings[i + 1] ? `Min ${colMappings[i + 1]}` : '(Ignorar)'}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {parsedData.map((row, rIdx) => (
                                        <tr key={rIdx} className="hover:bg-zinc-50">
                                            <td className="px-3 py-2 font-mono text-zinc-500 truncate max-w-[150px]" title={row.term}>{row.term}</td>
                                            <td className="px-3 py-2 relative min-w-[220px]">
                                                {row.prod ? (
                                                    <div className="flex items-center gap-2 group justify-between">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <Check size={14} className="text-emerald-600 shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="font-bold font-mono text-zinc-800 truncate">{row.prod.CodArticulo}</div>
                                                                <div className="text-[10px] text-zinc-400 truncate w-40">{sinEmoji(row.prod.Descripcion)}</div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => updateRowProduct(rIdx, null)}
                                                            className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/10 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                                                            title="Cambiar producto"
                                                            aria-label="Cambiar producto"
                                                        >
                                                            <Pencil size={13} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <RowProductSelector
                                                        catalog={catalog}
                                                        defaultTerm={row.term}
                                                        onSelect={(p) => updateRowProduct(rIdx, p)}
                                                    />
                                                )}
                                            </td>
                                            {row.values.map((v, cIdx) => (
                                                <td key={cIdx} className="px-3 py-2 text-right font-mono tabular-nums text-zinc-700">
                                                    {v}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-4 sm:px-5 py-3.5 border-t border-zinc-100 bg-zinc-50 flex flex-wrap justify-between items-center gap-3 shrink-0">
                            <button onClick={() => setStep(1)} className={BTN_SECUNDARIO}><ArrowLeft size={15} /> Volver a pegar</button>
                            <div className="text-xs text-zinc-400 order-last sm:order-none w-full sm:w-auto sm:flex-1 sm:text-center">
                                Se importarán reglas solo para los productos confirmados (Check verde).
                            </div>
                            <button onClick={handleImport} className={BTN_PRINCIPAL}>
                                Importar Datos Confirmados
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const ProductAdderInput = ({ onAdd, catalog = [], placeholder = "Buscar producto para agregar..." }) => {
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        // Click outside to close
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const handleSearch = (text) => {
        setQuery(text);
        if (!text || text.length < 1) {
            setSuggestions([]);
            return;
        }

        const upperText = text.toUpperCase();
        const matches = catalog.filter(p =>
            p.CodArticulo.toUpperCase().includes(upperText) ||
            (p.Descripcion && p.Descripcion.toUpperCase().includes(upperText))
        ).slice(0, 50); // Show more results

        setSuggestions(matches);
        setShowSuggestions(true);
    };

    const handleSelect = (cod) => {
        onAdd(cod);
        setQuery('');
        setSuggestions([]);
        setShowSuggestions(false);
    };

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div className="relative flex items-center w-full">
                <Search size={15} className="absolute left-3 text-zinc-400 pointer-events-none" />
                <input
                    className="w-full pl-9 pr-10 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 placeholder:normal-case placeholder:font-sans focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors uppercase font-mono"
                    value={query}
                    onChange={e => handleSearch(e.target.value)}
                    onFocus={() => { if (query) setShowSuggestions(true); }}
                    placeholder={placeholder}
                />
                {query && (
                    <button
                        onClick={() => { setQuery(''); setSuggestions([]); }}
                        className="absolute right-2 w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                        aria-label="Limpiar búsqueda"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* El buscador ya no va dentro de la tabla (con pocas filas le recortaba la lista): abre hacia abajo y, si
                abajo no hay lugar (queda al pie de la pantalla), hacia arriba */}
            {showSuggestions && (() => {
                const r = wrapperRef.current?.getBoundingClientRect();
                const arriba = !!r && window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom;
                return (
                <div className={`absolute ${arriba ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 w-full bg-white border border-zinc-200 shadow-xl rounded-xl z-[100] max-h-80 overflow-y-auto`}>
                    {suggestions.length > 0 ? (
                        <table className="w-full text-left text-xs">
                            <thead className="bg-zinc-50 sticky top-0 shadow-[0_1px_0_0_#e4e4e7]">
                                <tr>
                                    <th className={`${TH} text-left`}>Código</th>
                                    <th className={`${TH} text-left`}>Descripción</th>
                                    <th className={`${TH} text-right hidden sm:table-cell`}>Grupo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {suggestions.map(s => (
                                    <tr
                                        key={s.CodArticulo}
                                        onClick={() => handleSelect(s.CodArticulo)}
                                        className="hover:bg-zinc-50 cursor-pointer transition-colors"
                                    >
                                        <td className="px-3 py-2 font-bold font-mono text-brand-cyan whitespace-nowrap">{s.CodArticulo}</td>
                                        <td className="px-3 py-2 text-zinc-600">{textoDescripcion(s.Descripcion)}</td>
                                        <td className="px-3 py-2 text-right text-zinc-400 text-[10px] hidden sm:table-cell">{s.GrupoNombre || s.Grupo || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="p-4 text-center text-zinc-400 text-sm">
                            No se encontraron productos que coincidan.
                        </div>
                    )}
                </div>
                );
            })()}
        </div>
    );
};

const TieredPriceTable = ({ items, onUpdate, catalog }) => {
    // Estética nueva (28/10/2026): confirmación y pedido de cantidad del sistema (antes window.confirm / prompt) y, en
    // el celular, una tarjeta por producto en vez de la tabla
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const [pedir, ventanaPedir] = usePedirValor();
    const conTabla = useConTabla();
    // Agrupar items por CodArticulo
    const groupedItems = React.useMemo(() => {
        const groups = {};
        items.forEach(item => {
            if (!groups[item.CodArticulo]) groups[item.CodArticulo] = [];
            groups[item.CodArticulo].push(item);
        });
        return groups;
    }, [items]);

    // Obtener rangos únicos de cantidades (excluyendo 1 que es base) y ordenarlos
    const quantityColumns = React.useMemo(() => {
        const quantities = new Set();
        items.forEach(item => {
            if (item.CantidadMinima > 1) quantities.add(parseInt(item.CantidadMinima));
        });
        return Array.from(quantities).sort((a, b) => a - b);
    }, [items]);

    const handlePriceChange = (cod, minQty, val, specificType = null) => {
        let newItems = [...items];

        // Find existing rules for this product to determine default type
        const productRules = newItems.filter(i => i.CodArticulo === cod);
        // Determine type to use: specificType > existing rule type > default 'fixed_price'
        const typeToUse = specificType || (productRules.length > 0 ? productRules[0].TipoRegla : 'fixed_price');

        const existingIdx = newItems.findIndex(i => i.CodArticulo === cod && parseInt(i.CantidadMinima || 1) === minQty);

        if (existingIdx >= 0) {
            // Actualizar
            if (val === '' || val === null) {
                if (minQty > 1) {
                    newItems.splice(existingIdx, 1);
                } else {
                    newItems[existingIdx].Valor = 0;
                    // If specific type was passed (though unlikely here), update it
                    if (specificType) newItems[existingIdx].TipoRegla = specificType;
                }
            } else {
                newItems[existingIdx].Valor = val;
                // If we are updating a value, ensure type consistency if needed, but usually we rely on handleTypeChange
            }
        } else {
            // Crear nueva — buscar ProIdProducto y CodGrupo del catálogo
            if (val !== '' && val !== null) {
                const catalogEntry = catalog ? catalog.find(p => p.CodArticulo === cod) : null;
                newItems.push({
                    CodArticulo: cod,
                    ProIdProducto: catalogEntry ? catalogEntry.ProIdProducto : undefined,
                    CodGrupo: catalogEntry ? catalogEntry.CodGrupo : undefined,
                    TipoRegla: typeToUse,
                    Valor: val,
                    CantidadMinima: minQty,
                    _tempId: Date.now() + Math.random()
                });
            }
        }
        onUpdate(newItems);
    };

    const handleTypeChange = (cod, newType) => {
        // Update ALL rules for this product to the new type
        const newItems = items.map(i => {
            if (i.CodArticulo === cod) {
                return { ...i, TipoRegla: newType };
            }
            return i;
        });
        onUpdate(newItems);
    };

    const handleCurrencyChange = (cod, newCurrency) => {
        // Update ALL rules for this product to the new currency
        const newItems = items.map(i => {
            if (i.CodArticulo === cod) {
                return { ...i, Moneda: newCurrency };
            }
            return i;
        });
        onUpdate(newItems);
    };

    const addProductRow = (cod) => {
        if (!cod) return;
        // Agregar row inicial (qty 1)
        onUpdate([...items, { CodArticulo: cod, TipoRegla: 'fixed_price', Valor: 0, CantidadMinima: 1, Moneda: 'UYU', _tempId: Date.now() }]);
    };

    const addQuantityColumn = async () => {
        const qty = await pedir({ titulo: 'Agregar rango de cantidad', texto: "Ingrese la cantidad mínima para la nueva columna (ej: 15):" });
        if (qty && !isNaN(qty) && qty > 1) {
            toast.info("Columna visual agregada. Ingrese precios para guardar.");
            const firstProd = Object.keys(groupedItems)[0];
            if (firstProd) handlePriceChange(firstProd, parseInt(qty), 0);
        }
    };

    // Estética nueva (28/10/2026): el botón de quitar un rango (encabezado de la tabla o barra de rangos del celular) y
    // un producto como fila de la tabla o, en el celular, como tarjeta. Las cuentas y los handlers son los de la fila
    // de antes, sin cambios.
    const botonQuitarRango = (q, clase) => (
        <button
            type="button"
            className={clase}
            title="Quitar este Rango"
            aria-label={`Quitar el rango Min ${q}`}
            onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (await confirmar({ titulo: `Quitar el rango Min ${q}`, texto: `¿Quitar rango Min ${q}? Se borrarán los precios de esta columna en todos los productos de este perfil.`, confirmar: 'Quitar', peligro: true })) {
                    onUpdate(items.filter(i => parseInt(i.CantidadMinima) !== q));
                }
            }}
        ><Trash2 size={12} /></button>
    );

    const filaProducto = (cod) => {
        const prod = catalog.find(c => c.CodArticulo === cod);
        const rules = groupedItems[cod];
        const baseRule = rules.find(i => parseInt(i.CantidadMinima || 1) === 1);
        const basePrice = baseRule ? baseRule.Valor : 0;

        // Detect common type
        const currentType = (rules[0] && rules[0].TipoRegla) || 'fixed_price';
        const currentCurrency = (rules[0] && rules[0].Moneda) || 'UYU';
        // Solo las reglas "percentage_*" son en %; amount_discount / amount_surcharge van en moneda
        const isPercentage = currentType.includes('percentage');
        const symbol = isPercentage ? '%' : (currentCurrency === 'USD' ? 'U$S' : '$');

        const claseNum = `${INPUT_NUM} ${isPercentage ? 'text-left pl-3 pr-7' : `text-right pr-3 ${symbol === 'U$S' ? 'pl-11' : 'pl-7'}`}`;
        const simbolo = (tenue) => (
            <span className={`absolute ${isPercentage ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 ${tenue ? 'text-zinc-300' : 'text-zinc-400'} text-xs font-bold pointer-events-none`}>{enPantalla(symbol)}</span>
        );
        const selectorTipo = (
            <span className="inline-block" onClick={(e) => e.stopPropagation()}>
                <Selector
                    value={currentType}
                    onChange={(e) => handleTypeChange(cod, e.target.value)}
                    claseBoton={currentType !== 'fixed_price' ? SELECTOR_CHICO : SELECTOR_CHICO_NEUTRO}
                    className="w-[140px]"
                    aria-label={`Tipo de regla de ${cod}`}
                >
                    <option value="fixed_price">Precio Fijo</option>
                    <option value="percentage_discount">Descuento (%)</option>
                    <option value="amount_discount">Descuento ($)</option>
                    <option value="percentage_surcharge">Recargo (%)</option>
                    <option value="amount_surcharge">Recargo ($)</option>
                </Selector>
            </span>
        );
        const selectorMoneda = !isPercentage ? (
            <span className="inline-block" onClick={(e) => e.stopPropagation()}>
                <Selector
                    filtro resaltar={false} className="w-[84px]"
                    value={currentCurrency}
                    onChange={(e) => handleCurrencyChange(cod, e.target.value)}
                    aria-label={`Moneda de ${cod}`}
                >
                    <option value="UYU">$</option>
                    <option value="USD">US$</option>
                </Selector>
            </span>
        ) : (
            <span className="text-sm font-bold text-zinc-400" title="Las reglas en % no llevan moneda">%</span>
        );
        const campoBase = (
            <div className="relative min-w-[110px]">
                {simbolo(false)}
                <input
                    type="number"
                    className={`w-full py-2 text-sm text-zinc-800 ${claseNum}`}
                    value={basePrice}
                    onChange={e => handlePriceChange(cod, 1, e.target.value)}
                    aria-label={`Precio base de ${cod}`}
                />
            </div>
        );
        const campoRango = (q) => {
            const rule = groupedItems[cod].find(i => parseInt(i.CantidadMinima) === q);
            return (
                <div className="relative min-w-[110px]">
                    {simbolo(true)}
                    <input
                        type="number"
                        className={`w-full py-2 text-sm text-zinc-600 focus:text-brand-cyan placeholder:text-zinc-300 ${claseNum}`}
                        value={rule ? rule.Valor : ''}
                        placeholder="-"
                        onChange={e => handlePriceChange(cod, q, e.target.value)}
                        aria-label={`Precio Min ${q} de ${cod}`}
                    />
                </div>
            );
        };
        const botonQuitar = (
            <button
                onClick={() => onUpdate(items.filter(i => i.CodArticulo !== cod))}
                className={`${BTN_ICONO_BORRAR} mx-auto`}
                title="Quitar producto"
                aria-label={`Quitar ${cod}`}
            >
                <Trash2 size={15} />
            </button>
        );

        if (conTabla) return (
            <tr key={cod} className="hover:bg-zinc-50/60 group">
                <td className="px-3 py-2.5">
                    <div className="font-bold font-mono text-zinc-800">{cod}</div>
                    <div className="text-xs text-zinc-500 truncate max-w-[260px] mb-1.5">{prod ? textoDescripcion(prod.Descripcion) : 'Producto desconocido'}</div>
                    {/* Type Selector */}
                    {selectorTipo}
                </td>
                <td className="px-2 py-2.5 text-center">{selectorMoneda}</td>
                <td className="px-2 py-2.5">{campoBase}</td>
                {quantityColumns.map(q => (
                    <td key={q} className="px-2 py-2.5">{campoRango(q)}</td>
                ))}
                <td className="px-2 py-2.5 text-center">{botonQuitar}</td>
            </tr>
        );
        return (
            <div key={cod} className="p-3.5 flex flex-col gap-3">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="font-bold font-mono text-zinc-800">{cod}</div>
                        <div className="text-xs text-zinc-500 break-words">{prod ? textoDescripcion(prod.Descripcion) : 'Producto desconocido'}</div>
                    </div>
                    {botonQuitar}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {selectorTipo}
                    {!isPercentage && selectorMoneda}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <span className={`${ETIQUETA} mb-1`}>Base (Min 1)</span>
                        {campoBase}
                    </div>
                    {quantityColumns.map(q => (
                        <div key={q}>
                            <span className={`${ETIQUETA} mb-1`}>Min {q}</span>
                            {campoRango(q)}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div>
            {ventanaConfirmar}
            {ventanaPedir}
            {conTabla ? (
                <div className="overflow-x-auto rounded-t-xl">
                    <table className="min-w-full text-sm border-collapse">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th className={`${TH} text-left min-w-[230px]`}>Producto</th>
                                <th className={`${TH} text-center w-28`}>Moneda</th>
                                <th className={`${TH} text-center w-36`}>Base (Min 1)</th>
                                {quantityColumns.map(q => (
                                    <th key={q} className={`${TH} text-center w-36 group`}>
                                        <span className="inline-flex items-center gap-1">
                                            Min {q}
                                            {botonQuitarRango(q, 'w-5 h-5 rounded-md flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-colors')}
                                        </span>
                                    </th>
                                ))}
                                <th className={`${TH} w-12 text-center`}>
                                    <button onClick={addQuantityColumn} className="w-7 h-7 mx-auto rounded-full flex items-center justify-center bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20 transition-colors" title="Agregar Rango de Cantidad" aria-label="Agregar Rango de Cantidad"><Plus size={14} /></button>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {Object.keys(groupedItems).map(cod => filaProducto(cod))}
                            {Object.keys(groupedItems).length === 0 && (
                                <tr>
                                    <td colSpan={quantityColumns.length + 4} className="px-4 py-10 text-center">
                                        <span className="block text-sm font-bold text-zinc-700">Este perfil no tiene reglas todavía.</span>
                                        <span className="block text-xs text-zinc-400 mt-1">Buscá un producto abajo para agregarlo, o usá Carga Masiva / Importar Excel.</span>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            ) : (
                <>
                    {/* Celular: los rangos de cantidad arriba (se agregan y se quitan acá) y una tarjeta por producto */}
                    <div className="p-3 border-b border-zinc-100 flex flex-col gap-2">
                        <span className={ETIQUETA}>Rangos de cantidad</span>
                        <div className="flex flex-wrap gap-1.5">
                            <span className="inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-bold text-zinc-500">Base (Min 1)</span>
                            {quantityColumns.map(q => (
                                <span key={q} className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white pl-2.5 pr-1 py-1 text-xs font-bold text-zinc-700">
                                    Min {q}
                                    {botonQuitarRango(q, 'w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 transition-colors')}
                                </span>
                            ))}
                            <button onClick={addQuantityColumn} className="inline-flex items-center gap-1 rounded-xl border border-dashed border-brand-cyan/40 px-2.5 py-1.5 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 transition-colors" title="Agregar Rango de Cantidad" aria-label="Agregar Rango de Cantidad">
                                <Plus size={13} /> Agregar rango
                            </button>
                        </div>
                    </div>
                    <div className="divide-y divide-zinc-100">
                        {Object.keys(groupedItems).map(cod => filaProducto(cod))}
                        {Object.keys(groupedItems).length === 0 && (
                            <div className="px-4 py-10 text-center">
                                <span className="block text-sm font-bold text-zinc-700">Este perfil no tiene reglas todavía.</span>
                                <span className="block text-xs text-zinc-400 mt-1">Buscá un producto abajo para agregarlo, o usá Carga Masiva / Importar Excel.</span>
                            </div>
                        )}
                    </div>
                </>
            )}
            <div className="p-3 border-t border-zinc-100 bg-zinc-50/60 rounded-b-xl">
                <ProductAdderInput
                    onAdd={addProductRow}
                    catalog={catalog.filter(c => !groupedItems[c.CodArticulo])}
                />
            </div>
        </div>
    );
};

const ProfileEditor = ({ profile, onSave, onBack }) => {
    const [name, setName] = useState(profile?.Nombre || '');
    const [desc, setDesc] = useState(profile?.Descripcion || '');
    // Texto que ve el CLIENTE en la factura cuando este perfil aplica (vacío = nombre del perfil)
    const [etiqueta, setEtiqueta] = useState(profile?.EtiquetaFactura || '');
    const [categoria, setCategoria] = useState(profile?.Categoria || 'Todos');
    const [esGlobal, setEsGlobal] = useState(profile?.EsGlobal || false);
    const [showBulk, setShowBulk] = useState(false);
    const [allAreas, setAllAreas] = useState([]);
    const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }

    // Catalogo para lookup
    const [catalog, setCatalog] = useState([]);
    const [viewMode, setViewMode] = useState('matrix'); // 'list' | 'matrix'
    // Estética nueva (28/10/2026): confirmación y pedido de valores del sistema (antes confirm / prompt nativos) y, en
    // el celular, la vista Lista en tarjetas
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const [pedir, ventanaPedir] = usePedirValor();
    const conTabla = useConTabla();

    useEffect(() => {
        api.get('/profiles/urgencia-excepciones/areas?all=1')
            .then(r => setAllAreas(r.data?.data || []))
            .catch(() => {});
    }, []);

    // Helpers para categoria como array
    // selectedCats usa AreaNombre como valor (legible y consistente con el sidebar)
    const selectedCats = categoria === 'Todos' || !categoria
        ? []
        : categoria.split(',').map(c => c.trim()).filter(Boolean);

    const saveCategoriaDB = async (newCat) => {
        if (!profile?.ID) return;
        try {
            await api.patch(`/profiles/${profile.ID}/categoria`, { categoria: newCat });
            toast.success('Categorías actualizadas.');
        } catch {
            toast.error('Error al guardar categorías.');
        }
    };

    const askConfirm = (message, onConfirm) => setConfirmDialog({ message, onConfirm });

    const toggleArea = (area) => {
        const nombre = area.AreaNombre || area.CodArea;
        const cod = area.CodArea; // siempre guardamos CodArea para matching infalible en el motor
        const isActive = selectedCats.some(c =>
            c.toUpperCase() === cod.toUpperCase() || c.toUpperCase() === (area.AreaNombre || '').toUpperCase()
        );
        if (isActive) {
            askConfirm(
                `¿Desactivar urgencia en "${nombre}"? Los pedidos urgentes de este servicio ya NO tendrán recargo.`,
                () => {
                    const remaining = selectedCats.filter(c =>
                        c.toUpperCase() !== cod.toUpperCase() && c.toUpperCase() !== (area.AreaNombre || '').toUpperCase()
                    );
                    const next = remaining.length ? remaining.join(', ') : 'Todos';
                    setCategoria(next);
                    saveCategoriaDB(next);
                }
            );
        } else {
            askConfirm(
                `¿Activar urgencia en "${nombre}"? Los pedidos urgentes de este servicio tendrán recargo.`,
                () => {
                    const next = [...selectedCats, cod].join(', ');
                    setCategoria(next);
                    saveCategoriaDB(next);
                }
            );
        }
    };

    const toggleTodos = () => {
        const msg = selectedCats.length > 0
            ? '¿Aplicar urgencia a TODOS los servicios? Se quitarán las restricciones por área.'
            : '¿Confirmar: urgencia aplica a todos los servicios?';
        askConfirm(msg, () => {
            setCategoria('Todos');
            saveCategoriaDB('Todos');
        });
    };

    useEffect(() => {
        api.get('/prices/base')
            .then(res => {
                const uniqueGroups = [];
                const seenGroups = new Set();
                res.data.forEach(p => {
                    const g = p.Grupo;
                    if (g && !seenGroups.has(g)) {
                        seenGroups.add(g);
                        uniqueGroups.push({
                            CodArticulo: `GRUPO: ${g}`,
                            ProIdProducto: null,
                            Descripcion: `📁 FAMILIA: ${p.GrupoNombre ? `${g} (${p.GrupoNombre})` : g}`,
                            Grupo: 'Familias / Grupos'
                        });
                    }
                });
                
                setCatalog([
                    { CodArticulo: 'TOTAL', Descripcion: 'Aplica a TODOS los productos' },
                    ...uniqueGroups,
                    ...res.data
                ]);
            })
            .catch(console.error);
    }, []);

    // Synchronize state with profile prop when it changes
    useEffect(() => {
        setName(profile?.Nombre || '');
        setDesc(profile?.Descripcion || '');
        setEtiqueta(profile?.EtiquetaFactura || '');
        setCategoria(profile?.Categoria || 'Todos');
        setEsGlobal(profile?.EsGlobal || false);
        setItems((profile?.items || []).map((i, idx) => ({ ...i, _tempId: idx })));
        setShowBulk(false);
    }, [profile]);

    const handleBulkAdd = (newRules) => {
        let currentItems = [...items];
        let countNew = 0;
        let countUpdated = 0;

        newRules.forEach(r => {
            const idx = currentItems.findIndex(i => i.CodArticulo === r.CodArticulo);
            if (idx >= 0) {
                // Actualizar existente
                currentItems[idx] = { ...currentItems[idx], ...r, _tempId: currentItems[idx]._tempId };
                countUpdated++;
            } else {
                // Nuevo
                currentItems.push({ ...r, _tempId: Date.now() + Math.random() });
                countNew++;
            }
        });

        setItems(currentItems);
        setShowBulk(false);
        toast.success(`${countNew} reglas nuevas, ${countUpdated} actualizadas`);
    };

    // Lista de Reglas local antes de guardar
    // Estructura: { CodArticulo, TipoRegla, Valor, _tempId }
    const [items, setItems] = useState(
        (profile?.items || []).map((i, idx) => ({ ...i, _tempId: idx }))
    );

    const handleAddItem = () => {
        setItems([...items, { CodArticulo: 'TOTAL', ProIdProducto: 0, TipoRegla: 'percentage', Valor: 0, _tempId: Date.now() }]);
    };

    const handleRemoveItem = (id) => {
        setItems(items.filter(i => i._tempId !== id));
    };

    const handleChangeItem = (id, field, val) => {
        setItems(items.map(i => i._tempId === id ? { ...i, [field]: val } : i));
    };

    const [wizardConfig, setWizardConfig] = useState(null);

    const handleWizardSave = (scales, type = 'fixed') => {
        if (!wizardConfig) return;
        const { cod } = wizardConfig;

        // Remove existing items for this cod
        const filtered = items.filter(i => i.CodArticulo !== cod);

        // Define rule type based on wizard selection
        const ruleType = type === 'percentage' ? 'percentage_discount' : 'fixed_price';

        // Create new items
        const product = catalog.find(p => p.CodArticulo === cod);
        const newItems = scales.map(s => ({
            CodArticulo: cod,
            ProIdProducto: product ? product.ProIdProducto : undefined,
            TipoRegla: ruleType,
            Valor: s.val,
            CantidadMinima: s.qty,
            _tempId: Date.now() + Math.random()
        }));

        setItems([...filtered, ...newItems]);
        setWizardConfig(null);
        toast.success(type === 'percentage' ? "Escalas de descuento (%) guardadas" : "Escalas de precio fijo ($) guardadas");
    };

    // Agrupar items para visualización simplificada en lista
    const groupedList = React.useMemo(() => {
        const groups = {};
        items.forEach(i => {
            const c = i.CodArticulo;
            if (!groups[c]) groups[c] = [];
            groups[c].push(i);
        });
        return groups;
    }, [items]);

    const [showExcel, setShowExcel] = useState(false);

    const handleExcelImport = (newRules) => {
        let currentItems = [...items];
        let countNew = 0;
        let countUpdated = 0;

        newRules.forEach(r => {
            // Find if there is an existing rule for this Product AND this Qty
            // But wait, the list might have base rules.
            // Tiered logic: we add new rules. If there is a rule for Qty=X, we update it.

            const existingIdx = currentItems.findIndex(i => i.CodArticulo === r.CodArticulo && parseInt(i.CantidadMinima || 1) === parseInt(r.CantidadMinima));

            if (existingIdx >= 0) {
                currentItems[existingIdx] = { ...currentItems[existingIdx], Valor: r.Valor };
                countUpdated++;
            } else {
                currentItems.push(r);
                countNew++;
            }
        });

        setItems(currentItems);
        setShowExcel(false);
        toast.success(`Importación completada: ${countNew} nuevas reglas, ${countUpdated} precios actualizados`);
    };

    // Estética nueva (28/10/2026): una regla de la vista Lista como fila de la tabla o, en el celular, como tarjeta.
    // Las cuentas y los handlers son los de la fila de antes (el cambio de tipo, con la ventana del sistema en vez de
    // confirm / prompt nativos).
    const filaRegla = (cod) => {
        const rules = groupedList[cod];
        // Es escalonado si hay más de 1 regla o si la única regla tiene min > 1
        const isTiered = rules.length > 1 || rules.some(r => r.CantidadMinima > 1);
        const baseRule = rules.find(r => !r.CantidadMinima || r.CantidadMinima == 1) || rules[0];
        const prod = catalog.find(c => c.CodArticulo === cod);

        const selectorTipo = (
            <Selector
                className="w-full"
                value={isTiered ? 'tiered_wizard' : baseRule.TipoRegla}
                onChange={async e => {
                    if (e.target.value === 'tiered_wizard') {
                        setWizardConfig({ cod, rules });
                    } else if (e.target.value === 'formula_wizard') {
                        // Open a simple prompt to generate the formula string
                        const base = (await pedir({ titulo: 'Fórmula por bloques (1 de 4)', texto: "1. Ingrese el Precio Base (Ej: 50):", valor: "50" })) || "50";
                        const minLimit = (await pedir({ titulo: 'Fórmula por bloques (2 de 4)', texto: `2. Ingrese hasta qué cantidad aplica el Base de $${base} (Ej: 5000):`, valor: "5000" })) || "5000";
                        const stepQty = (await pedir({ titulo: 'Fórmula por bloques (3 de 4)', texto: "3. Ingrese el tamaño de los bloques adicionales (Ej: 1000):", valor: "1000" })) || "1000";
                        const stepPrice = (await pedir({ titulo: 'Fórmula por bloques (4 de 4)', texto: `4. Ingrese cuánto cobrar por cada ${stepQty} extra (Ej: 10):`, valor: "10" })) || "10";

                        const formulaStr = `formula_${base}_${minLimit}_${stepPrice}_${stepQty}`;
                        const newRule = { ...baseRule, TipoRegla: formulaStr, CantidadMinima: 1 };
                        const others = items.filter(i => i.CodArticulo !== cod);
                        setItems([...others, newRule]);
                        toast.success(`Fórmula configurada correctamente: Base $${base}, +$${stepPrice} cada ${stepQty}`);
                    } else {
                        // Si estaba en wizard y vuelve a simple, se mantiene la base rule pero se borran las otras?
                        // O simplemente actualizamos el tipo de la base rule.
                        // Para simplificar: cambio directo en propiedad
                        if (isTiered && !(await confirmar({ titulo: 'Cambiar a regla simple', texto: "Al cambiar a regla simple se perderán las escalas. ¿Continuar?", confirmar: 'Continuar', peligro: true }))) return;

                        // Reemplazar todas las reglas de este producto por una sola simple
                        const newRule = { ...baseRule, TipoRegla: e.target.value, CantidadMinima: 1 };
                        // Filtrar otras
                        const others = items.filter(i => i.CodArticulo !== cod);
                        setItems([...others, newRule]);
                    }
                }}
                aria-label={`Tipo de regla de ${cod}`}
            >
                <option value="fixed_price">Precio Fijo Exacto ($)</option>
                <option value="tiered_wizard">Precios Escalonados (Wizard)</option>
                <option value="percentage_discount">Descuento Porcentual (%)</option>
                <option value="percentage_surcharge">Recargo Porcentual (%)</option>
                <option value="fixed_discount">Descuento Monto ($)</option>
                <option value="fixed_surcharge">Recargo Monto ($)</option>
                <option value="formula_wizard">Fórmula por Bloques (Ej: Puntadas)</option>
            </Selector>
        );
        // Escalonado: botón para editar las escalas; fórmula: el aviso; si no, cantidad (fija en 1) y valor
        const especial = isTiered ? (
            <button
                onClick={() => setWizardConfig({ cod, rules })}
                className={`${BTN_SECUNDARIO} w-full text-xs`}
            >
                <Layers size={14} className="text-brand-cyan" /> {rules.length} Escalas Definidas - Editar
            </button>
        ) : baseRule.TipoRegla.startsWith('formula_') ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-brand-cyan font-bold"><Sigma size={14} /> Cálculo Dinámico Activado (Matemático)</span>
        ) : null;
        const campoCantidad = (
            <input
                type="number" min="1" disabled={true}
                className="w-full min-w-[64px] px-2 py-2 text-center font-mono text-sm rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-400"
                value={1}
                title="Cantidad Base"
            />
        );
        const campoValor = (
            <input
                type="number" step="0.01"
                className={`w-full min-w-[100px] px-2.5 py-2 text-right text-sm text-zinc-800 ${INPUT_NUM}`}
                value={baseRule.Valor}
                onChange={e => handleChangeItem(baseRule._tempId, 'Valor', e.target.value)}
                aria-label={`Valor de ${cod}`}
            />
        );
        const botonQuitar = (
            <button
                onClick={() => setItems(items.filter(i => i.CodArticulo !== cod))}
                className={`${BTN_ICONO_BORRAR} mx-auto`}
                title="Quitar producto"
                aria-label={`Quitar ${cod}`}
            >
                <Trash2 size={15} />
            </button>
        );

        if (conTabla) return (
            <tr key={cod} className="hover:bg-zinc-50/60 group">
                <td className="px-3 py-2.5 min-w-[200px]">
                    <div className="font-bold font-mono text-zinc-800">{cod}</div>
                    <div className="text-xs text-zinc-500">{prod ? textoDescripcion(prod.Descripcion) : 'Desconocido'}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[240px]">{selectorTipo}</td>
                {especial ? (
                    <td colSpan="2" className="px-3 py-2.5 text-center">{especial}</td>
                ) : (
                    <>
                        <td className="px-3 py-2.5 text-center">{campoCantidad}</td>
                        <td className="px-3 py-2.5 text-right">{campoValor}</td>
                    </>
                )}
                <td className="px-3 py-2.5 text-center">{botonQuitar}</td>
            </tr>
        );
        return (
            <div key={cod} className="p-3.5 flex flex-col gap-2.5">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="font-bold font-mono text-zinc-800">{cod}</div>
                        <div className="text-xs text-zinc-500 break-words">{prod ? textoDescripcion(prod.Descripcion) : 'Desconocido'}</div>
                    </div>
                    {botonQuitar}
                </div>
                {selectorTipo}
                {especial || (
                    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                        <div>
                            <span className={`${ETIQUETA} mb-1`}>Cant. Mín</span>
                            {campoCantidad}
                        </div>
                        <div>
                            <span className={`${ETIQUETA} mb-1`}>Valor</span>
                            {campoValor}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-5 p-4 sm:p-5 relative">
            {ventanaConfirmar}
            {ventanaPedir}

            {/* Modal de confirmación inline */}
            {confirmDialog && (
                <div className="fixed inset-0 z-[6100] flex items-center justify-center p-4 bg-black/40" role="alertdialog" aria-modal="true">
                    <div className="w-full max-w-sm bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden">
                        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
                            <AlertTriangle size={22} className="shrink-0 text-amber-500 mt-0.5" />
                            <p className="text-sm text-zinc-700 leading-relaxed">{confirmDialog.message}</p>
                        </div>
                        <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmDialog(null)}
                                className={BTN_SECUNDARIO}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                                className={BTN_PRINCIPAL}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-zinc-100">
                <button onClick={onBack} className="w-9 h-9 shrink-0 rounded-xl border border-zinc-200 bg-white flex items-center justify-center text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-colors" title="Volver" aria-label="Volver">
                    <ArrowLeft size={17} />
                </button>
                <h2 className="text-lg font-black text-zinc-800 leading-tight min-w-0 flex-1">{profile?.ID ? 'Editar Perfil' : 'Nuevo Perfil'}</h2>
                <button
                    onClick={() => onSave({ id: profile?.ID, nombre: name, descripcion: desc, etiquetaFactura: etiqueta, items, esGlobal, categoria })}
                    className={`${BTN_PRINCIPAL} w-full sm:w-auto`}
                >
                    <Save size={15} /> Guardar Perfil
                </button>
            </div>

            {/* Formulario Datos Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="flex flex-col gap-4">
                    <div>
                        <label className={`${ETIQUETA} mb-1.5`}>Nombre del Perfil</label>
                        <input
                            className={`${CAMPO_CHICO} font-bold`}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Ej: Mayorista A"
                        />
                    </div>
                    <div>
                        <label className={`${ETIQUETA} mb-1.5`}>Descripción</label>
                        <input
                            className={CAMPO_CHICO}
                            value={desc}
                            onChange={e => setDesc(e.target.value)}
                            placeholder="Ej: 20% descuento en toda la tienda"
                        />
                    </div>
                    <div>
                        <label className={`${ETIQUETA} mb-1.5`} title="Texto que ve el cliente en la factura y en la cotización cuando este perfil descuenta o recarga. Vacío = se usa el nombre del perfil. Un guion (-) = sin texto, queda solo el % o el importe.">
                            Etiqueta en la factura
                        </label>
                        <input
                            className={CAMPO_CHICO}
                            value={etiqueta}
                            maxLength={60}
                            onChange={e => setEtiqueta(e.target.value)}
                            placeholder="Ej: Urgencia · Tinta UV · Descuento por volumen · - (sin texto)"
                        />
                        <p className="text-xs text-zinc-400 mt-1.5">Vacío: se imprime el nombre del perfil. Un guion (-): no se imprime texto, solo el % o el importe. Aplica a lo que se cotice de acá en más.</p>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <div>
                        <label className={`${ETIQUETA} mb-1.5`}>Categoría(s)</label>
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 min-h-[46px] flex flex-wrap gap-1.5">
                            {/* Chip Todos */}
                            <button
                                type="button"
                                onClick={toggleTodos}
                                className={claseChipArea(selectedCats.length === 0)}
                            >
                                {selectedCats.length === 0 && <Check size={12} />}
                                Todos
                            </button>
                            {allAreas.map(a => {
                                const nombre = a.AreaNombre || a.CodArea;
                                // Compatibilidad: la DB puede tener CodArea ("DF") o AreaNombre ("DTF")
                                const active = selectedCats.some(c =>
                                    c.toUpperCase() === nombre.toUpperCase() ||
                                    c.toUpperCase() === a.CodArea.toUpperCase()
                                );
                                return (
                                    <button
                                        key={a.CodArea}
                                        type="button"
                                        onClick={() => toggleArea(a)}
                                        title={active ? 'Clic para quitar urgencia en esta área' : 'Clic para activar urgencia en esta área'}
                                        className={claseChipArea(active)}
                                    >
                                        {active && <Check size={12} />}
                                        {a.AreaNombre || a.CodArea}
                                    </button>
                                );
                            })}
                        </div>
                        {/* El texto decía "Urgencia activa solo en" para CUALQUIER perfil (se
                            escribió para el perfil de urgencia). Y hay algo más importante: el
                            motor de precios (pricingService) solo filtra por categoría a los
                            perfiles GLOBALES. Un perfil asignado a clientes se aplica igual a
                            todo, tenga las categorías que tenga — hay que decirlo, no sugerir un
                            límite que no existe. */}
                        {selectedCats.length > 0 && (() => {
                            const nombres = selectedCats.map(cat => {
                                const found = allAreas.find(a =>
                                    a.CodArea.toUpperCase() === cat.toUpperCase() ||
                                    (a.AreaNombre || '').toUpperCase() === cat.toUpperCase()
                                );
                                return found ? (found.AreaNombre || found.CodArea) : cat;
                            }).join(', ');
                            return esGlobal ? (
                                <p className="text-xs text-brand-cyan mt-1.5 flex items-center gap-1.5">
                                    <Info size={13} className="shrink-0" />
                                    <span>Este perfil se aplica solo en: <strong>{nombres}</strong></span>
                                </p>
                            ) : (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-1.5 flex items-start gap-1.5">
                                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                    <span>
                                        Marcaste <strong>{nombres}</strong>, pero este perfil no es global: a los clientes
                                        que lo tienen asignado se les aplica en <strong>todas</strong> las áreas igual.
                                        Hoy las categorías solo limitan a los perfiles globales.
                                    </span>
                                </p>
                            );
                        })()}
                    </div>
                    <label className="flex items-center gap-3 p-3.5 rounded-xl border border-zinc-200 bg-white cursor-pointer hover:border-zinc-300 transition-colors w-full">
                        <input
                            type="checkbox"
                            checked={esGlobal}
                            onChange={e => setEsGlobal(e.target.checked)}
                            className="w-4 h-4 accent-[#006E97] shrink-0"
                        />
                        <div>
                            <span className="block font-bold text-zinc-800 text-sm">Perfil Global</span>
                            <span className="block text-xs text-zinc-500">Aplica por defecto a TODOS.</span>
                        </div>
                    </label>
                </div>
            </div>

            {/* Editor de Reglas */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap justify-between items-center gap-3">
                    <h3 className="font-black text-zinc-800 flex items-center gap-2">
                        <Gavel size={17} className="text-brand-cyan" /> Reglas de Precios
                    </h3>
                    <div className="flex flex-wrap gap-2 items-center">
                        <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                            <button
                                onClick={() => setViewMode('list')}
                                className={claseSegmento(viewMode === 'list')}
                            >
                                <List size={14} className={viewMode === 'list' ? 'text-white' : 'text-brand-cyan'} /> Lista
                            </button>
                            <button
                                onClick={() => setViewMode('matrix')}
                                className={claseSegmento(viewMode === 'matrix')}
                            >
                                <Table2 size={14} className={viewMode === 'matrix' ? 'text-white' : 'text-brand-cyan'} /> Matriz
                            </button>
                        </div>
                        <button onClick={() => setShowExcel(true)} className={BTN_SECUNDARIO}>
                            <FileSpreadsheet size={15} className="text-brand-cyan" /> Importar Excel
                        </button>
                        <button onClick={() => setShowBulk(true)} className={BTN_SECUNDARIO}>
                            <ListChecks size={15} className="text-brand-cyan" /> Carga Masiva
                        </button>
                        {viewMode === 'list' && (
                            <button onClick={handleAddItem} className={BTN_SECUNDARIO}>
                                <Plus size={15} className="text-brand-cyan" /> Manual
                            </button>
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white">
                    {viewMode === 'matrix' ? (
                        <TieredPriceTable items={items} onUpdate={setItems} catalog={catalog} />
                    ) : (
                        <div>
                            {conTabla ? (
                                <div className="overflow-x-auto rounded-t-xl">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-zinc-50 border-b border-zinc-200">
                                            <tr>
                                                <th className={`${TH} w-64`}>Aplica A (Código)</th>
                                                <th className={TH}>Tipo de Regla</th>
                                                <th className={`${TH} w-24 text-center`}>Cant. Mín</th>
                                                <th className={`${TH} w-36 text-right`}>Valor</th>
                                                <th className={`${TH} w-16 text-center`}></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100">
                                            {Object.keys(groupedList).length === 0 ? (
                                                <tr><td colSpan="5" className="px-4 py-10 text-center">
                                                    <span className="block text-sm font-bold text-zinc-700">Este perfil no tiene reglas definidas.</span>
                                                    <span className="block text-xs text-zinc-400 mt-1">Buscá un producto abajo para agregarlo, o usá Carga Masiva / Importar Excel.</span>
                                                </td></tr>
                                            ) : (
                                                Object.keys(groupedList).map(cod => filaRegla(cod))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                /* Celular: una tarjeta por producto */
                                <div className="divide-y divide-zinc-100">
                                    {Object.keys(groupedList).length === 0 ? (
                                        <div className="px-4 py-10 text-center">
                                            <span className="block text-sm font-bold text-zinc-700">Este perfil no tiene reglas definidas.</span>
                                            <span className="block text-xs text-zinc-400 mt-1">Buscá un producto abajo para agregarlo, o usá Carga Masiva / Importar Excel.</span>
                                        </div>
                                    ) : (
                                        Object.keys(groupedList).map(cod => filaRegla(cod))
                                    )}
                                </div>
                            )}
                            <div className="p-3 border-t border-zinc-100 bg-zinc-50/60 rounded-b-xl">
                                <ProductAdderInput
                                    onAdd={(cod) => {
                                        // Check if exists
                                        if (groupedList[cod]) {
                                            toast.info("Este producto ya está en la lista.");
                                            return;
                                        }
                                        setItems([...items, { CodArticulo: cod, TipoRegla: 'fixed_price', Valor: 0, CantidadMinima: 1, _tempId: Date.now() }]);
                                    }}
                                    catalog={catalog}
                                    placeholder="Agregar otro producto a la lista..."
                                />
                            </div>
                        </div>
                    )}
                </div>
                <div className="text-xs text-zinc-400">
                    {viewMode === 'matrix'
                        ? "* Tip: Usa el botón '+' en la cabecera para agregar nuevas columnas de cantidad (rangos)."
                        : "* Tip: La regla 'TOTAL' aplica a todo lo que no tenga una regla específica definida aquí."}
                </div>
            </div>
            {showBulk && <BulkAddModal onAdd={handleBulkAdd} onCancel={() => setShowBulk(false)} profileName={name} />}
            {showExcel && <ExcelImportModal onImport={handleExcelImport} onCancel={() => setShowExcel(false)} catalog={catalog} />}
            {wizardConfig && (
                <TieredWizard
                    existingScales={wizardConfig.rules}
                    productName={wizardConfig.cod + ' - ' + (catalog.find(c => c.CodArticulo === wizardConfig.cod)?.Descripcion || '')}
                    onSave={handleWizardSave}
                    onCancel={() => setWizardConfig(null)}
                />
            )}
        </div>
    );
};


// --- PANTALLA PRINCIPAL ---

// Estética nueva (28/10/2026): encabezado con ícono, pestañas en pastillas (Selector en el celular), todo claro, lista a
// la izquierda y detalle a la derecha (en el celular, uno por vez), excepciones en tarjetas en el celular y
// confirmaciones del sistema (antes window.confirm). Las cargas al cambiar de pestaña y todos los handlers no cambiaron.
const PriceProfiles = () => {
    const navigate = useNavigate();

    // VIEW STATE
    const [activeTab, setActiveTab] = useState('base'); // 'base', 'profiles', 'assignments', 'simulator', 'reports', 'urgencia-excepciones'
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(false);

    // Excepciones Urgencia
    const [urgExc, setUrgExc] = useState([]);
    const [urgExcLoading, setUrgExcLoading] = useState(false);
    const [urgExcCliSearch, setUrgExcCliSearch] = useState('');
    const [urgExcCliResults, setUrgExcCliResults] = useState([]);
    const [urgExcSelectedCli, setUrgExcSelectedCli] = useState(null);
    const [urgExcProdSearch, setUrgExcProdSearch] = useState('');
    const [urgExcProdResults, setUrgExcProdResults] = useState([]);
    const [urgExcSelectedProd, setUrgExcSelectedProd] = useState(null); // null = cliente completo
    const [urgExcCliDropOpen, setUrgExcCliDropOpen] = useState(false);
    const [urgExcProdDropOpen, setUrgExcProdDropOpen] = useState(false);

    // Asignaciones
    const [customers, setCustomers] = useState([]); // Lista filtrada desde el servidor
    const [assignments, setAssignments] = useState({}); // Map ClienteID -> PerfilID
    const [filterCust, setFilterCust] = useState('');
    const [debouncedFilter, setDebouncedFilter] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // all, profile, exceptions, standard

    const [selectedProfile, setSelectedProfile] = useState(null);
    const [openDropdown, setOpenDropdown] = useState(null);

    // Estética nueva (28/10/2026): confirmación del sistema (antes window.confirm), tabla o tarjetas según el ancho y,
    // en el celular, subir al detalle al elegir un perfil o un cliente
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const conTabla = useConTabla();
    const refDetallePerfil = useRef(null);
    const refDetalleCliente = useRef(null);
    useSubirAlDetalle(selectedProfile, refDetallePerfil);
    useSubirAlDetalle(openDropdown, refDetalleCliente);

    // Debounce filter text
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedFilter(filterCust), 500);
        return () => clearTimeout(timer);
    }, [filterCust]);

    // Load Data
    useEffect(() => {
        loadProfiles();
        if (activeTab === 'assignments' || activeTab === 'simulator') {
            loadAssignments();
            searchCustomers(debouncedFilter);
        }
        if (activeTab === 'urgencia-excepciones') {
            loadUrgExc();
        }
    }, [activeTab, debouncedFilter]);

    const loadProfiles = () => {
        api.get('/profiles').then(res => setProfiles(res.data)).catch(console.error);
    };

    // --- Excepciones Urgencia ---
    const loadUrgExc = async () => {
        setUrgExcLoading(true);
        try {
            const res = await api.get('/profiles/urgencia-excepciones');
            setUrgExc(res.data.data || []);
        } catch (e) {
            toast.error('Error cargando excepciones de urgencia');
        } finally {
            setUrgExcLoading(false);
        }
    };

    useEffect(() => {
        if (!urgExcCliSearch.trim()) { setUrgExcCliResults([]); setUrgExcCliDropOpen(false); return; }
        const t = setTimeout(async () => {
            try {
                const res = await api.get('/clients/search', { params: { q: urgExcCliSearch, limit: 15 } });
                setUrgExcCliResults(res.data?.data || res.data || []);
                setUrgExcCliDropOpen(true);
            } catch { setUrgExcCliResults([]); }
        }, 300);
        return () => clearTimeout(t);
    }, [urgExcCliSearch]);

    useEffect(() => {
        if (!urgExcProdSearch.trim()) { setUrgExcProdResults([]); setUrgExcProdDropOpen(false); return; }
        const t = setTimeout(async () => {
            try {
                const res = await api.get('/quotation/search-products', { params: { q: urgExcProdSearch } });
                setUrgExcProdResults(res.data || []);
                setUrgExcProdDropOpen(true);
            } catch { setUrgExcProdResults([]); }
        }, 300);
        return () => clearTimeout(t);
    }, [urgExcProdSearch]);

    const handleAddUrgExc = async () => {
        if (!urgExcSelectedCli) return toast.error('Seleccioná un cliente.');
        try {
            await api.post('/profiles/urgencia-excepciones', {
                CliIdCliente:  urgExcSelectedCli.CliIdCliente,
                ProIdProducto: urgExcSelectedProd?.ProIdProducto ?? null,
            });
            toast.success('Excepción guardada.');
            setUrgExcSelectedCli(null);
            setUrgExcSelectedProd(null);
            setUrgExcCliSearch('');
            setUrgExcProdSearch('');
            loadUrgExc();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Error al guardar excepción.');
        }
    };

    const handleDeleteUrgExc = async (id) => {
        if (!(await confirmar({ titulo: '¿Eliminar esta excepción?', confirmar: 'Eliminar', peligro: true }))) return;
        try {
            await api.delete(`/profiles/urgencia-excepciones/${id}`);
            toast.success('Excepción eliminada.');
            loadUrgExc();
        } catch (e) {
            toast.error('Error al eliminar.');
        }
    };

    const handleSelectProfile = async (p) => {
        if (p && p.ID) {
            try {
                // Cargar items del perfil
                const res = await api.get(`/profiles/${p.ID}`);
                setSelectedProfile({ ...res.data.profile, items: res.data.items });
            } catch (e) {
                toast.error("Error al cargar detalles del perfil");
            }
        } else {
            // Nuevo perfil limpio
            setSelectedProfile({ items: [] });
        }
    };

    const handleSaveProfile = async (profileData) => {
        if (!profileData.nombre) return toast.error("El nombre es obligatorio");

        try {
            await api.post('/profiles', profileData);
            toast.success("Perfil guardado exitosamente");
            setSelectedProfile(null);
            loadProfiles();
        } catch (e) {
            toast.error("Error al guardar perfil: " + e.message);
        }
    };

    const handleDeleteProfile = async (id, e) => {
        e.stopPropagation();
        if (!(await confirmar({ titulo: '¿Seguro que deseas eliminar este perfil?', confirmar: 'Eliminar', peligro: true }))) return;

        try {
            await api.delete(`/profiles/${id}`);
            toast.success("Perfil eliminado");
            if (selectedProfile?.ID === id) setSelectedProfile(null);
            loadProfiles();
        } catch (e) {
            toast.error("No se puede eliminar: " + (e.response?.data?.error || e.message));
        }
    };

    const loadAssignments = async () => {
        try {
            const res = await api.get('/profiles/assignments');
            const assignMap = {};
            res.data.forEach(a => {
                let pids = [];
                if (a.PerfilesIDs) {
                    pids = String(a.PerfilesIDs).split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
                } else if (a.PerfilID) {
                    pids = [parseInt(a.PerfilID)];
                }
                assignMap[a.ClienteID] = { pid: pids, rules: a.CantReglas || 0 };
            });
            setAssignments(assignMap);
        } catch (e) {
            console.error("Error loading assignments:", e);
        }
    };

    const searchCustomers = async (term) => {
        setLoading(true);
        try {
            const res = await api.get('/clients', { params: { q: term } });
            setCustomers(res.data || []);
        } catch (e) {
            console.error("Error searching customers:", e);
            toast.error("Error buscando clientes");
        } finally {
            setLoading(false);
        }
    };

    const handleAssign = (clienteId, perfilId) => {
        // Buscar cliente usando la llave principal (CliIdCliente)
        const cliente = customers.find(c => c.CliIdCliente === clienteId);
        const pidVal = Array.isArray(perfilId) ? perfilId : (parseInt(perfilId) || null);

        api.post('/profiles/assign', {
            clienteId,
            nombreCliente: cliente?.Nombre || cliente?.NombreFantasia || `Cliente ${clienteId}`,
            perfilId: pidVal
        })
            .then(() => {
                setAssignments(prev => ({
                    ...prev,
                    [clienteId]: { ...prev[clienteId], pid: pidVal }
                }));
                toast.success("Perfil actualizado");
            })
            .catch(e => toast.error("Error asignando perfil"));
    };

    // Filtrado Clientes
    // Filtrado Clientes (Solo Estado, texto ya fue por server)
    const filteredCustomers = customers.filter(c => {
        const cId = c.CliIdCliente;
        const data = assignments[cId] || {};
        const hasProfile = !!data.pid;
        const hasExceptions = (data.rules || 0) > 0;

        // Filtro Estado
        if (filterStatus === 'profile' && !hasProfile) return false;
        if (filterStatus === 'exceptions' && !hasExceptions) return false;
        if (filterStatus === 'standard' && (hasProfile || hasExceptions)) return false;

        return true;
    });

    // Estética nueva (28/10/2026): la lista de clientes de a 50 (trae miles) y la celda del servicio de una excepción,
    // para la tabla y para la tarjeta del celular
    const [cuantosCli, setCentinelaCli] = useDeAPoco(filteredCustomers.length, customers, filterStatus);
    const servicioExcepcion = (ex) => ex.CodArea ? (
        <span className="flex items-center gap-1.5 text-zinc-700">
            <span className="font-mono font-bold text-[11px] bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 px-1.5 py-0.5 rounded-md">{ex.CodArea}</span>
            {ex.AreaNombre || ex.CodArea}
        </span>
    ) : ex.ProIdProducto ? (
        <span className="text-zinc-700">{ex.ArticuloNombre || ex.CodArticulo}</span>
    ) : (
        <span className={`${CHIP_MINI} ${CHIP_CIAN}`}>
            <Asterisk size={11} /> Todos los servicios
        </span>
    );

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            {ventanaConfirmar}

            {/* ENCABEZADO */}
            <div className="flex flex-wrap items-center gap-3">
                <BadgeDollarSign size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Precios y perfiles</h1>
                    <p className="text-sm text-zinc-500 mt-1">Precios estándar, perfiles de descuento o recargo, asignación a clientes y excepciones</p>
                </div>
            </div>

            {/* TABS HEADER: pastillas en escritorio, Selector en el celular */}
            <div className="hidden md:flex flex-wrap self-start max-w-full rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                {PESTANAS.map(({ id, label, Icono }) => (
                    <button
                        key={id}
                        onClick={() => setActiveTab(id)}
                        className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${activeTab === id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
                    >
                        <Icono size={15} className={activeTab === id ? 'text-white' : 'text-brand-cyan'} /> {label}
                    </button>
                ))}
            </div>
            <div className="md:hidden">
                <Selector className="w-full" value={activeTab} onChange={e => setActiveTab(e.target.value)} aria-label="Sección">
                    {PESTANAS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </Selector>
            </div>

            {/* CONTENIDO */}
            {activeTab === 'base' && (
                // BasePrices trae su propio margen: se le saca el de esta pantalla para que no se sumen. Embebido: sin su
                // título (ya está el de Precios y perfiles)
                <div className="-mx-3 sm:-mx-6 -mt-5 -mb-5 min-w-0">
                    <BasePrices embebido />
                </div>
            )}

            {activeTab === 'profiles' && (
                <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                    {/* LISTA PERFILES */}
                    <div className={`${CARD} lg:w-80 xl:w-96 shrink-0 flex-col overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] ${selectedProfile ? 'hidden lg:flex' : 'flex'}`}>
                        <div className="px-4 py-3 border-b border-zinc-100 flex justify-between items-center gap-2 shrink-0">
                            <h3 className={ROTULO}>Perfiles Definidos</h3>
                            <button
                                onClick={() => handleSelectProfile(null)}
                                className={`${BTN_PRINCIPAL} px-3 py-1.5`}
                            >
                                <Plus size={15} /> Nuevo
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
                            {(() => {
                                if (profiles.length === 0) return (
                                    <div className="px-4 py-10 flex flex-col items-center text-center">
                                        <IdCard size={40} className="mb-3 text-brand-cyan" />
                                        <span className="text-sm font-bold text-zinc-700">No hay perfiles definidos.</span>
                                    </div>
                                );

                                // 1. Build grouped map
                                const groups = { "TODOS / GENERAL": [] };
                                profiles.forEach(p => {
                                    const rawCats = p.Categoria ? p.Categoria.split(',').map(c => c.trim()).filter(c => c) : ['Todos'];
                                    if (rawCats.length === 0 || rawCats.includes('Todos') || rawCats.includes('TODOS')) {
                                        groups["TODOS / GENERAL"].push(p);
                                    } else {
                                        rawCats.forEach(cat => {
                                            const cleanCat = cat.charAt(0).toUpperCase() + cat.slice(1);
                                            if (!groups[cleanCat]) groups[cleanCat] = [];
                                            groups[cleanCat].push(p);
                                        });
                                    }
                                });

                                // Sort group keys (TODOS first, then alphabetical)
                                const sortedKeys = Object.keys(groups).sort((a, b) => {
                                    if (a === "TODOS / GENERAL") return -1;
                                    if (b === "TODOS / GENERAL") return 1;
                                    return a.localeCompare(b);
                                });

                                return sortedKeys.map(groupName => {
                                    const items = groups[groupName];
                                    if (items.length === 0) return null;

                                    // Is this folder active (does it contain the selected profile?)
                                    const isFolderActive = selectedProfile && items.some(i => i.ID === selectedProfile.ID);

                                    return (
                                        <div key={groupName} className="rounded-xl border border-zinc-200 overflow-hidden shrink-0">
                                            <div className="px-3 py-2 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-wide text-zinc-500">
                                                <span className="flex items-center gap-2 min-w-0">
                                                    {groupName === 'TODOS / GENERAL'
                                                        ? <Globe size={14} className="text-brand-cyan shrink-0" />
                                                        : <FolderOpen size={14} className="text-brand-cyan shrink-0" />}
                                                    <span className="truncate">{groupName}</span>
                                                </span>
                                                <span className="shrink-0 bg-zinc-200/70 text-zinc-500 px-2 py-0.5 rounded-full text-[10px] tabular-nums">{items.length}</span>
                                            </div>
                                            <div className="flex flex-col divide-y divide-zinc-100 bg-white">
                                                {items.map(p => (
                                                    <div
                                                        key={p.ID}
                                                        onClick={e => { e.stopPropagation(); handleSelectProfile(p); }}
                                                        className={`pl-2.5 pr-2 py-2.5 cursor-pointer group transition-colors flex justify-between items-center gap-2 border-l-[3px] ${selectedProfile?.ID === p.ID ? 'bg-brand-cyan/5 border-brand-cyan' : 'hover:bg-zinc-50 border-transparent'}`}
                                                    >
                                                        <div className="min-w-0">
                                                            <div className={`font-bold text-sm truncate ${selectedProfile?.ID === p.ID ? 'text-brand-cyan' : 'text-zinc-800'}`}>{p.Nombre}</div>
                                                            <div className="text-xs text-zinc-500 line-clamp-1">{p.Descripcion}</div>
                                                            {p.EsGlobal && (
                                                                <span className={`${CHIP_MINI} ${CHIP_CIAN} mt-1`}>
                                                                    <Earth size={11} /> Global (Default)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={(e) => handleDeleteProfile(p.ID, e)}
                                                            className={`${BTN_ICONO_BORRAR} lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100`}
                                                            title="Eliminar Perfil"
                                                            aria-label={`Eliminar el perfil ${p.Nombre}`}
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>

                    {/* EDITOR */}
                    <div ref={refDetallePerfil} className={`${CARD} flex-1 min-w-0 relative scroll-mt-4 ${selectedProfile ? 'block' : 'hidden lg:block'}`}>
                        {selectedProfile ? (
                            <ProfileEditor
                                profile={selectedProfile}
                                onSave={handleSaveProfile}
                                onBack={() => setSelectedProfile(null)}
                            />
                        ) : (
                            <div className="min-h-[420px] flex flex-col items-center justify-center text-center gap-2 p-8">
                                <IdCard size={40} className="text-brand-cyan" />
                                <p className="text-sm font-bold text-zinc-700">Selecciona un perfil existente o crea uno nuevo.</p>
                                <p className="text-xs text-zinc-400 max-w-xs">Elegilo en la lista de la izquierda o tocá «Nuevo».</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'assignments' && (
                <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                    {/* 1. LISTA DE CLIENTES (SIDEBAR) */}
                    <div className={`${CARD} lg:w-96 shrink-0 flex-col overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] ${openDropdown ? 'hidden lg:flex' : 'flex'}`}>
                        <div className="p-3 border-b border-zinc-100 flex flex-col gap-2 shrink-0">
                            <h3 className={`${ROTULO} px-1`}>Seleccionar Cliente</h3>
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                <input
                                    className={CAMPO}
                                    placeholder="Buscar por nombre o ID..."
                                    value={filterCust}
                                    onChange={e => setFilterCust(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            {/* Filtros rápidos */}
                            <div className="flex rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                                {['all', 'profile', 'exceptions', 'standard'].map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setFilterStatus(f)}
                                        className={`flex-1 min-w-0 px-1 text-xs font-bold py-1.5 rounded-lg transition-colors whitespace-nowrap ${filterStatus === f ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
                                    >
                                        {f === 'all' ? 'Todos' : f === 'profile' ? 'Con Perfil' : f === 'exceptions' ? 'Manuales' : 'Estándar'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto">
                            {loading ? (
                                <div className="p-8 flex items-center justify-center gap-2 text-zinc-400 text-sm">
                                    <Loader2 size={16} className="animate-spin text-brand-cyan" /> Cargando clientes...
                                </div>
                            ) : filteredCustomers.length === 0 ? (
                                <div className="px-4 py-10 flex flex-col items-center text-center">
                                    <SearchX size={40} className="mb-3 text-brand-cyan" />
                                    <span className="text-sm font-bold text-zinc-700">No se encontraron clientes.</span>
                                    <span className="text-xs text-zinc-400 mt-1">Probá con otra búsqueda u otro filtro.</span>
                                </div>
                            ) : (
                                <div className="p-2 flex flex-col gap-2">
                                    {filteredCustomers.slice(0, cuantosCli).map(c => {
                                        const cId = c.CliIdCliente;
                                        const cName = c.Nombre || c.NombreFantasia || `Cliente ${cId}`;
                                        const data = assignments[cId] || {};
                                        const pid = data.pid;
                                        const hasProfiles = pid && (Array.isArray(pid) ? pid.length > 0 : true);
                                        const hasManual = (data.rules || 0) > 0;

                                        // Extract initials
                                        const words = cName.split(' ').filter(Boolean);
                                        let initials = '?';
                                        if (words.length > 1) {
                                            initials = (words[0][0] + words[1][0]).toUpperCase();
                                        } else if (words.length === 1) {
                                            initials = words[0].substring(0, 2).toUpperCase();
                                        }

                                        return (
                                            <div
                                                key={cId}
                                                onClick={() => setOpenDropdown(cId)}
                                                className={`rounded-xl p-3 cursor-pointer transition-colors border ${openDropdown === cId ? 'bg-brand-cyan/5 border-brand-cyan ring-2 ring-brand-cyan/15' : 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/60'}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* AVATAR */}
                                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-zinc-100 text-zinc-600 font-black text-sm shrink-0">
                                                        {initials}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-zinc-900 text-sm truncate">{cName}</div>
                                                        <div className="text-xs text-zinc-400 font-medium">
                                                            {c.IDCliente || c.IDReact || `Cód: ${cId}`}
                                                        </div>

                                                        {/* INFO BODY */}
                                                        {(c.TelefonoTrabajo || c.Email || c.TipoClienteNombre) && (
                                                            <div className="flex flex-col gap-1 text-xs text-zinc-600 mt-2">
                                                                {c.TelefonoTrabajo && (
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <Phone size={12} className="text-brand-cyan shrink-0" />
                                                                        <span className="truncate">{c.TelefonoTrabajo}</span>
                                                                    </div>
                                                                )}
                                                                {c.Email && (
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <Mail size={12} className="text-brand-cyan shrink-0" />
                                                                        <span className="truncate">{c.Email}</span>
                                                                    </div>
                                                                )}
                                                                {c.TipoClienteNombre && (
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <Tag size={12} className="text-brand-cyan shrink-0" />
                                                                        <span className="truncate">{c.TipoClienteNombre}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* ICONS MANUAL/PERFIL */}
                                                    <div className="flex flex-col gap-2 items-end pt-0.5 shrink-0">
                                                        {hasManual && <span title="Reglas manuales"><AlertTriangle size={15} className="text-amber-500" /></span>}
                                                        {hasProfiles && <span className="w-2.5 h-2.5 rounded-full bg-brand-cyan" title="Perfiles asignados"></span>}
                                                    </div>
                                                </div>

                                                {/* FOOTER */}
                                                <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        <span className={`${CHIP_MINI} ${c.IDReact ? CHIP_OK : CHIP_NO}`}>
                                                            <FileSpreadsheet size={11} /> Planilla
                                                        </span>
                                                        <span className={`${CHIP_MINI} ${c.CodReferencia ? CHIP_OK : CHIP_NO}`}>
                                                            <Monitor size={11} /> Macrosoft
                                                        </span>
                                                    </div>
                                                    <span className="text-xs text-zinc-300 font-bold tabular-nums">#{cId}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {cuantosCli < filteredCustomers.length && (
                                        <div ref={setCentinelaCli} className="py-3 text-center text-xs text-zinc-400">
                                            Mostrando {cuantosCli.toLocaleString('es-UY')} de {filteredCustomers.length.toLocaleString('es-UY')}: bajá para ver más
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 text-xs text-zinc-400 text-center shrink-0 tabular-nums">
                            {filteredCustomers.length.toLocaleString('es-UY')} clientes encontrados
                        </div>
                    </div>

                    {/* 2. PANEL DE DETALLE (MAIN) */}
                    <div ref={refDetalleCliente} className={`${CARD} flex-1 min-w-0 flex-col overflow-hidden relative scroll-mt-4 ${openDropdown ? 'flex' : 'hidden lg:flex'}`}>
                        {openDropdown && (
                            <div className="lg:hidden px-4 pt-4">
                                <button onClick={() => setOpenDropdown(null)} className={BTN_SECUNDARIO}>
                                    <ArrowLeft size={15} /> Volver a la lista
                                </button>
                            </div>
                        )}
                        {openDropdown ? (
                            (() => {
                                const cId = openDropdown;
                                const customer = customers.find(c => c.CliIdCliente === cId);
                                if (!customer) return null;

                                const cName = customer.Nombre || customer.NombreFantasia || `Cliente ${cId}`;
                                const data = assignments[cId] || {};
                                const pid = data.pid;
                                const currentIds = Array.isArray(pid) ? pid : (pid ? [pid] : []);
                                const hasManualRules = (data.rules || 0) > 0;

                                const toggleProfile = (pId) => {
                                    let newIds = [...currentIds];
                                    if (newIds.includes(pId)) {
                                        newIds = newIds.filter(id => id !== pId);
                                    } else {
                                        newIds.push(pId);
                                    }
                                    handleAssign(cId, newIds);
                                };

                                return (
                                    <div className="flex flex-col">
                                        {/* Header Cliente */}
                                        <div className="p-4 sm:p-5 border-b border-zinc-100 flex flex-wrap justify-between items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                <span className={`${CHIP_MINI} bg-zinc-50 text-zinc-500 border-zinc-200 font-mono`}>
                                                    ID: {cId}
                                                </span>
                                                <h2 className="text-xl font-black text-zinc-900 mt-2 break-words">{cName}</h2>
                                                {customer.CioRuc && <div className="text-zinc-400 text-sm tabular-nums">RUT: {customer.CioRuc}</div>}
                                            </div>
                                            {hasManualRules && (
                                                <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-start gap-3 w-full sm:w-auto sm:max-w-sm">
                                                    <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                                    <div>
                                                        <div className="font-bold text-sm">Configuración Manual Detectada</div>
                                                        <div className="text-xs opacity-80">Este cliente tiene {data.rules} reglas de precio específicas definidas fuera de los perfiles.</div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="p-4 sm:p-5 flex flex-col gap-6">

                                            {/* Sección Perfiles Globales */}
                                            <div>
                                                <h3 className={`${ROTULO} mb-2.5 flex items-center gap-2`}>
                                                    <Earth size={14} className="text-brand-cyan" /> Perfiles Globales (Activos)
                                                </h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {profiles.filter(p => p.EsGlobal).map(p => (
                                                        <div key={p.ID} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 flex items-center gap-2.5 min-w-0">
                                                            <Lock size={14} className="text-brand-cyan shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="font-bold text-sm text-zinc-800">{p.Nombre}</div>
                                                                <div className="text-[11px] text-zinc-400">{p.Descripcion}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {!profiles.some(p => p.EsGlobal) && (
                                                        <div className="text-sm text-zinc-400">No hay perfiles globales configurados.</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Sección Asignación Manual */}
                                            <div>
                                                <h3 className={`${ROTULO} mb-2.5 flex items-center gap-2`}>
                                                    <Tags size={14} className="text-brand-cyan" /> Asignación de Perfiles
                                                </h3>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                                    {profiles.filter(p => !p.EsGlobal).map(p => {
                                                        const isAssigned = currentIds.includes(p.ID);
                                                        return (
                                                            <div
                                                                key={p.ID}
                                                                onClick={() => toggleProfile(p.ID)}
                                                                role="checkbox"
                                                                aria-checked={isAssigned}
                                                                className={`relative cursor-pointer rounded-xl border p-3.5 transition-colors select-none ${isAssigned ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan' : 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/60'}`}
                                                            >
                                                                <div className="flex justify-between items-start mb-2">
                                                                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${isAssigned ? 'bg-brand-cyan border-brand-cyan text-white' : 'border-zinc-300 bg-white'}`}>
                                                                        {isAssigned && <Check size={13} strokeWidth={3} />}
                                                                    </span>
                                                                    {isAssigned && <span className={`${CHIP_MINI} ${CHIP_CIAN}`}>Asignado</span>}
                                                                </div>
                                                                <div className={`font-bold text-sm mb-0.5 ${isAssigned ? 'text-brand-cyan' : 'text-zinc-800'}`}>{p.Nombre}</div>
                                                                <div className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{p.Descripcion || 'Sin descripción'}</div>
                                                            </div>
                                                        );
                                                    })}
                                                    {profiles.length === 0 && (
                                                        <div className="col-span-full text-center p-8 border-2 border-dashed border-zinc-200 rounded-xl text-sm text-zinc-400">
                                                            No hay perfiles disponibles.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                        </div>
                                    </div>
                                );
                            })()
                        ) : (
                            <div className="min-h-[420px] flex flex-col items-center justify-center p-8 text-center gap-2">
                                <MousePointerClick size={40} className="text-brand-cyan" />
                                <h3 className="text-sm font-bold text-zinc-700">Selecciona un cliente</h3>
                                <p className="max-w-xs text-xs text-zinc-400">Elige un cliente del listado de la izquierda para gestionar sus perfiles de precios y descuentos.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'simulator' && (
                <div className="min-w-0">
                    <PriceCalculatorTest
                        customers={customers}
                        assignments={assignments}
                        onSearch={searchCustomers}
                    />
                </div>
            )}

            {activeTab === 'reports' && (
                <div className="min-w-0">
                    <PriceReports customers={customers} onSearch={searchCustomers} />
                </div>
            )}

            {activeTab === 'urgencia-excepciones' && (
                <div className="flex flex-col gap-4">

                    {/* Formulario nueva excepción */}
                    <div className={`${CARD} p-4 sm:p-5`}>
                        <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                            <CirclePlus size={18} className="text-brand-cyan" />
                            Nueva excepción
                        </h3>
                        <p className="text-sm text-zinc-400 mt-0.5 mb-4">
                            Si dejás el servicio vacío, el cliente queda exento de urgencia en <strong className="text-zinc-600">todos</strong> los servicios.
                        </p>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                            {/* Búsqueda cliente */}
                            <div className="relative">
                                <label className={`${ETIQUETA} mb-1.5`}>Cliente <span className="text-brand-magenta">*</span></label>
                                {urgExcSelectedCli ? (
                                    <div className="flex items-center gap-2 bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl pl-3 pr-1.5 py-1.5 text-sm min-h-[42px]">
                                        <span className="flex-1 font-bold text-zinc-800 truncate">{urgExcSelectedCli.Nombre}</span>
                                        <button onClick={() => { setUrgExcSelectedCli(null); setUrgExcCliSearch(''); }} className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors" aria-label="Quitar el cliente">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                            <input
                                                type="text"
                                                placeholder="Buscar cliente..."
                                                value={urgExcCliSearch}
                                                onChange={e => setUrgExcCliSearch(e.target.value)}
                                                onFocus={() => urgExcCliResults.length > 0 && setUrgExcCliDropOpen(true)}
                                                className={CAMPO}
                                            />
                                        </div>
                                        {urgExcCliDropOpen && urgExcCliResults.length > 0 && (
                                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                                                {urgExcCliResults.map(c => (
                                                    <button key={c.CliIdCliente} onClick={() => { setUrgExcSelectedCli(c); setUrgExcCliSearch(''); setUrgExcCliDropOpen(false); }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 border-b border-zinc-100 last:border-0">
                                                        <span className="font-medium text-zinc-800">{c.Nombre}</span>
                                                        <span className="text-zinc-400 ml-2 text-xs tabular-nums">#{c.CliIdCliente}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Búsqueda servicio/material (opcional) */}
                            <div className="relative">
                                <label className={`${ETIQUETA} mb-1.5`}>Servicio / Material <span className="normal-case tracking-normal font-bold text-zinc-300">(opcional)</span></label>
                                {urgExcSelectedProd ? (
                                    <div className="flex items-center gap-2 bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl pl-3 pr-1.5 py-1.5 text-sm min-h-[42px]">
                                        <span className="flex-1 font-bold text-zinc-800 truncate">{urgExcSelectedProd.Descripcion}</span>
                                        <button onClick={() => { setUrgExcSelectedProd(null); setUrgExcProdSearch(''); }} className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors" aria-label="Quitar el servicio">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                            <input
                                                type="text"
                                                placeholder="Buscar servicio... (vacío = todos)"
                                                value={urgExcProdSearch}
                                                onChange={e => setUrgExcProdSearch(e.target.value)}
                                                onFocus={() => urgExcProdResults.length > 0 && setUrgExcProdDropOpen(true)}
                                                className={CAMPO}
                                            />
                                        </div>
                                        {urgExcProdDropOpen && urgExcProdResults.length > 0 && (
                                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                                                {urgExcProdResults.slice(0, 30).map(p => (
                                                    <button key={p.ProIdProducto} onClick={() => { setUrgExcSelectedProd(p); setUrgExcProdSearch(''); setUrgExcProdDropOpen(false); }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 border-b border-zinc-100 last:border-0">
                                                        <span className="font-medium text-zinc-800">{p.Descripcion}</span>
                                                        <span className="text-zinc-400 ml-2 text-xs font-mono">{p.CodArticulo}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <button onClick={handleAddUrgExc}
                                className={`${BTN_PRINCIPAL} py-2.5`}>
                                <Plus size={15} /> Agregar excepción
                            </button>
                        </div>
                    </div>

                    {/* Tabla de excepciones */}
                    <div className={`${CARD} overflow-hidden`}>
                        <div className="px-4 py-3 border-b border-zinc-100 flex justify-between items-center gap-3">
                            <h3 className={`${ROTULO} flex items-center gap-2`}>
                                <List size={14} className="text-brand-cyan" />
                                Excepciones activas
                            </h3>
                            <span className="text-xs text-zinc-400 tabular-nums">{urgExc.length} registro(s)</span>
                        </div>

                        {urgExcLoading ? (
                            <div className="px-4 py-12 flex items-center justify-center gap-2 text-sm text-zinc-400">
                                <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando...
                            </div>
                        ) : urgExc.length === 0 ? (
                            <div className="px-4 py-12 flex flex-col items-center text-center">
                                <ShieldOff size={40} className="mb-3 text-brand-cyan" />
                                <span className="text-sm font-bold text-zinc-700">No hay excepciones configuradas.</span>
                                <span className="text-xs text-zinc-400 mt-1">Agregá una con el formulario de arriba.</span>
                            </div>
                        ) : conTabla ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-zinc-50 border-b border-zinc-200">
                                        <tr>
                                            <th className={`${TH} text-left`}>Cliente</th>
                                            <th className={`${TH} text-left`}>Servicio / Material</th>
                                            <th className={`${TH} text-left`}>Desde</th>
                                            <th className={TH}></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {urgExc.map(ex => (
                                            <tr key={ex.ID} className="hover:bg-zinc-50">
                                                <td className="px-3 py-2.5">
                                                    <span className="font-bold text-zinc-800">{ex.ClienteNombre}</span>
                                                    <span className="text-zinc-400 text-xs ml-1.5 tabular-nums">#{ex.CliIdCliente}</span>
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    {servicioExcepcion(ex)}
                                                </td>
                                                <td className="px-3 py-2.5 text-zinc-500 text-xs tabular-nums">
                                                    {new Date(ex.FechaAlta).toLocaleDateString('es-UY')}
                                                </td>
                                                <td className="px-3 py-2.5 text-right">
                                                    <button onClick={() => handleDeleteUrgExc(ex.ID)}
                                                        className={`${BTN_ICONO_BORRAR} ml-auto`} title="Eliminar excepción" aria-label="Eliminar excepción">
                                                        <Trash2 size={15} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-100">
                                {urgExc.map(ex => (
                                    <div key={ex.ID} className="p-3.5 flex items-start gap-3">
                                        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                                            <div className="min-w-0">
                                                <span className="font-bold text-zinc-800">{ex.ClienteNombre}</span>
                                                <span className="text-zinc-400 text-xs ml-1.5 tabular-nums">#{ex.CliIdCliente}</span>
                                            </div>
                                            <div className="text-sm">{servicioExcepcion(ex)}</div>
                                            <div className="text-xs text-zinc-400 tabular-nums">Desde {new Date(ex.FechaAlta).toLocaleDateString('es-UY')}</div>
                                        </div>
                                        <button onClick={() => handleDeleteUrgExc(ex.ID)}
                                            className={BTN_ICONO_BORRAR} title="Eliminar excepción" aria-label="Eliminar excepción">
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            )}

            {activeTab === 'variante-precios' && (
                <VariantePreciosTab />
            )}
        </div>
    );
};

// ─── Pestaña Precios por Variante ───────────────────────────────────────────────
const VariantePreciosTab = () => {
    const [articles, setArticles]         = React.useState([]);
    const [search, setSearch]             = React.useState('');
    const [varSearch, setVarSearch]       = React.useState('');
    const [selected, setSelected]         = React.useState(null);
    const [variants, setVariants]         = React.useState([]);
    const [loadingVars, setLoadingVars]   = React.useState(false);
    const [saving, setSaving]             = React.useState({});
    const [savingAll, setSavingAll]       = React.useState(false);
    const [edits, setEdits]               = React.useState({});
    const [checkedIds, setCheckedIds]     = React.useState(new Set());
    const [bulkPrecio, setBulkPrecio]     = React.useState('');
    const [bulkMoneda, setBulkMoneda]     = React.useState('UYU');
    const [applyingBulk, setApplyingBulk] = React.useState(false);
    // Estética nueva (28/10/2026): tabla o tarjetas según el ancho y, en el celular, subir al detalle al elegir un producto
    const conTabla = useConTabla();
    const refDetalle = useRef(null);
    useSubirAlDetalle(selected, refDetalle);

    React.useEffect(() => {
        api.get('/products-integration/local')
            .then(res => {
                // Todos los productos que tienen variantes WMS importadas
                const prods = (res.data || []).filter(a => (a.CantidadVariantes || 0) > 0);
                setArticles(prods);
            })
            .catch(() => {});
    }, []);

    const loadVariants = (art) => {
        setSelected(art);
        setVariants([]);
        setEdits({});
        setCheckedIds(new Set());
        setBulkPrecio('');
        setVarSearch('');
        setLoadingVars(true);
        api.get(`/products-integration/article-variants/${art.ProIdProducto}`)
            .then(res => {
                if (res.data.success) {
                    setVariants(res.data.data);
                    const init = {};
                    res.data.data.forEach(v => {
                        // moneda_excepcion viene como int: 1=UYU, 2=USD
                        const monedaStr = v.moneda_excepcion === 2 ? 'USD' : 'UYU';
                        init[v.id] = {
                            precio: v.precio_excepcion != null ? String(v.precio_excepcion) : '',
                            moneda: monedaStr
                        };
                    });
                    setEdits(init);
                }
            })
            .finally(() => setLoadingVars(false));
    };

    const saveVariant = async (varId) => {
        setSaving(p => ({ ...p, [varId]: true }));
        try {
            const e = edits[varId];
            await api.put(`/products-integration/article-variants/${varId}/price`, {
                precio_excepcion: e.precio !== '' ? parseFloat(e.precio) : null,
                moneda_excepcion: e.precio !== '' ? e.moneda : null
            });
            setVariants(prev => prev.map(v => v.id === varId
                ? { ...v, precio_excepcion: e.precio !== '' ? parseFloat(e.precio) : null, moneda_excepcion: e.precio !== '' ? e.moneda : null }
                : v
            ));
        } catch { /* silent */ }
        finally { setSaving(p => ({ ...p, [varId]: false })); }
    };

    const saveAll = async () => {
        setSavingAll(true);
        for (const varId of Object.keys(edits)) {
            await saveVariant(parseInt(varId));
        }
        setSavingAll(false);
    };

    // Aplicar precio masivo a los seleccionados
    const applyBulk = async () => {
        if (bulkPrecio === '' || checkedIds.size === 0) return;
        setApplyingBulk(true);
        const precio = parseFloat(bulkPrecio);
        setEdits(prev => {
            const next = { ...prev };
            checkedIds.forEach(id => { next[id] = { precio: String(precio), moneda: bulkMoneda }; });
            return next;
        });
        for (const varId of checkedIds) {
            try {
                await api.put(`/products-integration/article-variants/${varId}/price`, {
                    precio_excepcion: precio, moneda_excepcion: bulkMoneda
                });
                setVariants(prev => prev.map(v => v.id === varId
                    ? { ...v, precio_excepcion: precio, moneda_excepcion: bulkMoneda } : v
                ));
            } catch { /* silent */ }
        }
        setApplyingBulk(false);
        setCheckedIds(new Set());
        setBulkPrecio('');
    };

    // Quitar precio propio de los seleccionados (vuelven al precio base)
    const clearBulk = async () => {
        if (checkedIds.size === 0) return;
        setApplyingBulk(true);
        setEdits(prev => {
            const next = { ...prev };
            checkedIds.forEach(id => { next[id] = { ...next[id], precio: '' }; });
            return next;
        });
        for (const varId of checkedIds) {
            try {
                await api.put(`/products-integration/article-variants/${varId}/price`, {
                    precio_excepcion: null, moneda_excepcion: null
                });
                setVariants(prev => prev.map(v => v.id === varId
                    ? { ...v, precio_excepcion: null, moneda_excepcion: null } : v
                ));
            } catch { /* silent */ }
        }
        setApplyingBulk(false);
        setCheckedIds(new Set());
    };

    const toggleCheck = (id) => {
        setCheckedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const filteredArticles = articles.filter(a =>
        (a.Descripcion || '').toLowerCase().includes(search.toLowerCase()) ||
        (a.CodArticulo || '').toLowerCase().includes(search.toLowerCase())
    );

    const displayVariants = varSearch.trim()
        ? variants.filter(v => v.nombre_variante.toLowerCase().includes(varSearch.toLowerCase()))
        : variants;

    const allChecked = displayVariants.length > 0 && displayVariants.every(v => checkedIds.has(v.id));
    const someChecked = displayVariants.some(v => checkedIds.has(v.id));

    const toggleAll = () => {
        if (allChecked) {
            setCheckedIds(prev => { const next = new Set(prev); displayVariants.forEach(v => next.delete(v.id)); return next; });
        } else {
            setCheckedIds(prev => { const next = new Set(prev); displayVariants.forEach(v => next.add(v.id)); return next; });
        }
    };

    const filtered = filteredArticles; // alias para claridad

    // Estética nueva (28/10/2026): una variante como fila de la tabla o, en el celular, como tarjeta (mismas cuentas y
    // mismos handlers que la fila de antes)
    const filaVariante = (v) => {
        const e = edits[v.id] || { precio: '', moneda: 'UYU' };
        const hasCustom = v.precio_excepcion != null;
        const isChecked = checkedIds.has(v.id);
        const efectivo = e.precio !== '' ? parseFloat(e.precio) : (selected.PrecioBase != null ? parseFloat(selected.PrecioBase) : null);
        const monEfectiva = e.precio !== '' ? e.moneda : (selected.MonIdMoneda === 2 ? 'U$S' : '$');
        const casilla = (
            <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(v.id)}
                className="w-4 h-4 accent-[#006E97] cursor-pointer" aria-label={`Elegir ${v.nombre_variante}`} />
        );
        const campoMoneda = (
            <Selector filtro resaltar={false} className="w-[84px]" value={e.moneda}
                onChange={ev => setEdits(prev => ({ ...prev, [v.id]: { ...prev[v.id], moneda: ev.target.value } }))}
                aria-label={`Moneda de ${v.nombre_variante}`}>
                <option value="UYU">$</option>
                <option value="USD">US$</option>
            </Selector>
        );
        const campoPrecio = (
            <input type="number" step="0.01" min="0"
                placeholder={selected.PrecioBase != null ? `Base: ${monto(selected.PrecioBase)}` : 'Sin base'}
                value={e.precio}
                onChange={ev => setEdits(prev => ({ ...prev, [v.id]: { ...prev[v.id], precio: ev.target.value } }))}
                className={`w-full min-w-0 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-300 placeholder:font-sans placeholder:font-normal ${INPUT_NUM}`}
                aria-label={`Precio de ${v.nombre_variante}`} />
        );
        const precioEfectivo = efectivo != null ? (
            <span className={`font-black text-sm tabular-nums whitespace-nowrap ${ e.precio !== '' ? 'text-emerald-700' : 'text-zinc-400' }`}>
                {simboloMoneda(monEfectiva)} {monto(efectivo)}
            </span>
        ) : (
            <span className="text-zinc-300 text-xs">sin precio</span>
        );
        const botonGuardar = (
            <button onClick={() => saveVariant(v.id)} disabled={saving[v.id]}
                className={`${BTN_PRINCIPAL} px-3 shrink-0`}
                title="Guardar esta variante" aria-label={`Guardar ${v.nombre_variante}`}>
                {saving[v.id] ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            </button>
        );
        const fondo = isChecked ? 'bg-brand-cyan/5' : hasCustom ? 'bg-emerald-50/70 hover:bg-emerald-50' : 'hover:bg-zinc-50';
        if (conTabla) return (
            <tr key={v.id} className={`transition-colors ${fondo}`}>
                <td className="px-3 py-2.5">{casilla}</td>
                <td className="px-3 py-2.5">
                    <p className="font-semibold text-zinc-800">{v.nombre_variante}</p>
                </td>
                <td className="px-3 py-2.5">{campoMoneda}</td>
                <td className="px-3 py-2.5">{campoPrecio}</td>
                <td className="px-3 py-2.5">{precioEfectivo}</td>
                <td className="px-3 py-2.5 text-right">{botonGuardar}</td>
            </tr>
        );
        return (
            <div key={v.id} className={`p-3.5 flex flex-col gap-2.5 transition-colors ${fondo}`}>
                <div className="flex items-start gap-3">
                    <span className="pt-0.5 flex">{casilla}</span>
                    <p className="font-semibold text-zinc-800 flex-1 min-w-0 break-words">{v.nombre_variante}</p>
                    <span className="shrink-0 text-right">{precioEfectivo}</span>
                </div>
                <div className="flex items-center gap-2">
                    {campoMoneda}
                    <div className="flex-1 min-w-0">{campoPrecio}</div>
                    {botonGuardar}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
            {/* Panel izquierdo */}
            <div className={`${CARD} lg:w-80 shrink-0 flex-col overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] ${selected ? 'hidden lg:flex' : 'flex'}`}>
                <div className="p-3 border-b border-zinc-100 flex flex-col gap-2 shrink-0">
                    <h3 className={`${ROTULO} px-1 flex items-center gap-2`}>
                        <Layers size={14} className="text-brand-cyan" />
                        Productos con variantes
                    </h3>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input className={CAMPO}
                            placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-0.5">
                    {filtered.length === 0 ? (
                        <div className="px-4 py-10 flex flex-col items-center text-center">
                            <PackageOpen size={40} className="mb-3 text-brand-cyan" />
                            <span className="text-sm font-bold text-zinc-700">Sin productos con variantes</span>
                        </div>
                    ) : filtered.map(art => (
                        <div key={art.ProIdProducto} onClick={() => loadVariants(art)}
                            className={`px-3 py-2.5 rounded-xl cursor-pointer transition-colors border shrink-0 ${
                                selected?.ProIdProducto === art.ProIdProducto
                                    ? 'bg-brand-cyan/10 border-brand-cyan/20'
                                    : 'border-transparent hover:bg-zinc-50'
                            }`}>
                            <p className={`font-bold text-sm truncate ${selected?.ProIdProducto === art.ProIdProducto ? 'text-brand-cyan' : 'text-zinc-800'}`}>{art.Descripcion?.trim()}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className={`${CHIP_MINI} bg-zinc-50 text-zinc-500 border-zinc-200 tabular-nums`}>
                                    {art.CantidadVariantes} var.
                                </span>
                                {art.PrecioBase != null && (
                                    <span className={`${CHIP_MINI} ${CHIP_CIAN} tabular-nums`}>
                                        Base: {art.MonIdMoneda === 2 ? 'US$' : '$'} {monto(art.PrecioBase)}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Panel derecho */}
            <div ref={refDetalle} className={`${CARD} flex-1 min-w-0 flex-col overflow-hidden scroll-mt-4 ${selected ? 'flex' : 'hidden lg:flex'}`}>
                {!selected ? (
                    <div className="min-h-[420px] flex flex-col items-center justify-center p-8 text-center gap-2">
                        <MousePointerClick size={40} className="text-brand-cyan" />
                        <p className="text-sm font-bold text-zinc-700">Seleccioná un producto</p>
                        <p className="text-xs text-zinc-400 text-center max-w-xs">Elegí un producto de la izquierda para ver y editar los precios de sus variantes.</p>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="p-4 border-b border-zinc-100 flex flex-wrap items-center gap-3">
                            <button onClick={() => setSelected(null)} className={`${BTN_SECUNDARIO} lg:hidden`}>
                                <ArrowLeft size={15} /> Volver a los productos
                            </button>
                            <div className="min-w-[220px] flex-1 basis-full sm:basis-auto">
                                <h2 className="text-lg font-black text-zinc-800 leading-tight break-words">{selected.Descripcion?.trim()}</h2>
                                <p className="text-sm text-zinc-500 mt-0.5">
                                    Precio base:
                                    <span className="font-bold text-zinc-800 ml-1 tabular-nums">
                                        {selected.PrecioBase != null ? `${selected.MonIdMoneda === 2 ? 'US$' : '$'} ${monto(selected.PrecioBase)}` : 'Sin precio'}
                                    </span>
                                    <span className="ml-1 text-zinc-400">— variantes sin precio propio lo heredan</span>
                                </p>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <div className="relative flex-1 sm:flex-none sm:w-52">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                    <input className={CAMPO}
                                        placeholder="Filtrar variantes..." value={varSearch} onChange={e => setVarSearch(e.target.value)} />
                                </div>
                                <button onClick={saveAll} disabled={savingAll}
                                    className={`${BTN_PRINCIPAL} py-2.5 shrink-0`}>
                                    {savingAll ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                    Guardar todos
                                </button>
                            </div>
                        </div>

                        {/* Barra de acción masiva — solo aparece cuando hay seleccionados */}
                        {checkedIds.size > 0 && (
                            <div className="px-4 py-3 bg-brand-cyan/5 border-b border-brand-cyan/20 flex items-center gap-3 flex-wrap">
                                <span className="inline-flex items-center gap-1.5 bg-brand-cyan text-white text-xs font-bold px-2.5 py-1 rounded-full tabular-nums">
                                    <SquareCheck size={12} />
                                    {checkedIds.size} seleccionadas
                                </span>
                                <div className="flex items-center gap-2 ml-auto flex-wrap">
                                    <span className="text-xs font-bold text-zinc-600">Aplicar a todas:</span>
                                    <Selector filtro resaltar={false} className="w-[84px]" value={bulkMoneda} onChange={e => setBulkMoneda(e.target.value)} aria-label="Moneda a aplicar">
                                        <option value="UYU">$</option>
                                        <option value="USD">US$</option>
                                    </Selector>
                                    <input type="number" step="0.01" min="0" placeholder="Precio..."
                                        value={bulkPrecio} onChange={e => setBulkPrecio(e.target.value)}
                                        className={`w-28 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 placeholder:font-sans placeholder:font-normal ${INPUT_NUM}`}
                                        aria-label="Precio a aplicar" />
                                    <button onClick={applyBulk} disabled={applyingBulk || bulkPrecio === ''}
                                        className={BTN_PRINCIPAL}>
                                        {applyingBulk ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                                        Aplicar
                                    </button>
                                    <button onClick={clearBulk} disabled={applyingBulk}
                                        className={BTN_BORRAR_SEC}
                                        title="Quitar precio propio — usar precio base">
                                        <Trash2 size={14} /> Quitar precio
                                    </button>
                                    <button onClick={() => setCheckedIds(new Set())} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" title="Deseleccionar todas" aria-label="Deseleccionar todas">
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Info bar cuando no hay selección */}
                        {checkedIds.size === 0 && (
                            <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 text-xs text-zinc-500 flex items-start gap-2">
                                <Info size={14} className="text-brand-cyan shrink-0 mt-px" />
                                <span>
                                    Marcá variantes con la casilla <SquareCheck size={13} className="inline -mt-0.5 text-brand-cyan" /> para aplicar un precio masivo.
                                    Las filas en <strong className="text-emerald-700">verde</strong> ya tienen precio propio.
                                </span>
                            </div>
                        )}

                        {/* Tabla */}
                        <div className="min-w-0">
                            {loadingVars ? (
                                <div className="flex items-center justify-center py-16">
                                    <Loader2 size={28} className="animate-spin text-brand-cyan" />
                                </div>
                            ) : conTabla ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-zinc-50 border-b border-zinc-200">
                                            <tr>
                                                <th className={`${TH} w-10`}>
                                                    <input type="checkbox" checked={allChecked}
                                                        ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                                                        onChange={toggleAll}
                                                        className="w-4 h-4 accent-[#006E97] cursor-pointer align-middle" aria-label="Elegir todas" />
                                                </th>
                                                <th className={`${TH} text-left`}>Variante</th>
                                                <th className={`${TH} text-left w-28`}>Moneda</th>
                                                <th className={`${TH} text-left w-44`}>Precio excepción</th>
                                                <th className={`${TH} text-left w-36`}>Precio efectivo</th>
                                                <th className={`${TH} w-16`}></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100">
                                            {displayVariants.map(v => filaVariante(v))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <>
                                    {displayVariants.length > 0 && (
                                        <label className="flex items-center gap-3 px-3.5 py-2.5 border-b border-zinc-100 bg-zinc-50 text-xs font-bold text-zinc-500 cursor-pointer">
                                            <input type="checkbox" checked={allChecked}
                                                ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                                                onChange={toggleAll}
                                                className="w-4 h-4 accent-[#006E97] cursor-pointer" />
                                            Elegir todas
                                        </label>
                                    )}
                                    <div className="divide-y divide-zinc-100">
                                        {displayVariants.map(v => filaVariante(v))}
                                    </div>
                                </>
                            )}
                            {!loadingVars && displayVariants.length === 0 && (
                                <div className="px-4 py-12 flex flex-col items-center text-center">
                                    <SearchX size={40} className="mb-3 text-brand-cyan" />
                                    <span className="text-sm font-bold text-zinc-700">{varSearch.trim() ? 'Ninguna variante coincide con el filtro.' : 'Este producto no tiene variantes.'}</span>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default PriceProfiles;
