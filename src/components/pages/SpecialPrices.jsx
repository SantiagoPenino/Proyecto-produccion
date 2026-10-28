import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    Tags, BadgePercent, Search, X, CircleX, Loader2, Users, UserCog, Plus, PlusCircle, Trash2, Save, Pencil, Package,
    Folder, FolderOpen, Globe, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, Lock, Check, Ban, Briefcase,
    GraduationCap, Store, PersonStanding, Tag, Database, Eye, EyeOff, Minus, Zap, LayoutGrid, ListChecks, Asterisk,
    PackageOpen, SearchX
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (28/10/2026): encabezado con ícono, todo claro (zinc + brand-cyan); lista de clientes, ficha del cliente,
// tablas, panel lateral y ventana de perfiles con el estilo del sistema; montos en formato uruguayo (US$ / $) y el
// descuento como «25 % menos» (recargo en magenta); Selector propio para la familia; «Quitar cliente» con confirmación
// propia (antes window.confirm). En el celular: la lista va arriba y se pliega al elegir un cliente, y tarjetas en vez de
// tablas. La lógica (estados, cuentas, guardado) no cambió.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_ELEGIDO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-900 bg-zinc-900 text-sm font-bold text-white hover:bg-zinc-800 transition-colors';
// Destructivo: gris que se pone magenta al pasar
const BTN_PELIGRO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-500 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors';
// Botones de la ficha del cliente: en el celular van de a dos y un punto más chicos
const BTN_FICHA = 'text-[13px] sm:text-sm whitespace-nowrap';
const BTN_ICONO = 'w-8 h-8 rounded-lg border border-zinc-200 bg-white flex items-center justify-center text-zinc-400 transition-colors';
const BTN_ICONO_CHICO = 'w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors';
const CAMPO_BASE = 'w-full py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO = `${CAMPO_BASE} pl-9 pr-4`;
const CAMPO_CON_X = `${CAMPO_BASE} pl-9 pr-9`;
// Campos de números (sin ancho ni relleno lateral: cada uno pone el suyo)
const CAMPO_NUM = 'py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-mono text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
// Campos de la grilla del catálogo: el borde lo pone cada uno (cian si es el tipo de regla activo)
const CAMPO_TABLA = 'w-full py-1.5 bg-white border rounded-lg text-sm font-mono text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 disabled:bg-zinc-50 disabled:text-zinc-400 transition-colors';
const BORDE_ACTIVO = 'border-brand-cyan ring-2 ring-brand-cyan/15';
const BORDE_NORMAL = 'border-zinc-200';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1';
const ROTULO = 'text-[11px] font-black uppercase tracking-widest text-zinc-400';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';
const CHIP_CIAN = 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20';
const CHIP_ZINC = 'bg-zinc-50 text-zinc-500 border-zinc-200';
const CHIP_AMBAR = 'bg-amber-50 text-amber-700 border-amber-200';
// Pestañas / segmentados: la elegida en negro
const PESTANA = 'px-2 py-1.5 rounded-lg text-xs font-bold transition-colors text-center';
const PESTANA_SI = 'bg-zinc-900 text-white';
const PESTANA_NO = 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100';

// Montos en pantalla: formato uruguayo con 2 decimales y «US$» / «$» (la moneda llega como USD / UYU)
const simboloMoneda = (m) => (m === 'USD' || m === 'US$' || m === 'U$S') ? 'US$' : (!m || m === 'UYU' || m === '$') ? '$' : m;
const fmtMonto = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPrecio = (moneda, n) => `${simboloMoneda(moneda)} ${fmtMonto(n)}`;

// Porcentaje con su sentido: descuento en verde («25 % menos»), recargo en magenta («10 % más»), cero en gris
const ChipPct = ({ pct, dec = 2 }) => {
    const n = parseFloat(pct) || 0;
    const texto = Math.abs(n).toLocaleString('es-UY', { maximumFractionDigits: dec });
    const clase = n > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : n < 0 ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20'
        : 'bg-zinc-50 text-zinc-500 border-zinc-200';
    return (
        <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${clase}`}>
            {n > 0 ? `${texto} % menos` : n < 0 ? `${texto} % más` : '0 %'}
        </span>
    );
};

// Tarifa especial de una excepción, para la tabla de reglas asignadas. Las cuentas son las de antes, copiadas tal cual
// (armaban el texto «USD 16.50 (25.0% OFF)»); ahora devuelven el precio y el porcentaje por separado para mostrarlos en
// formato uruguayo. dec = decimales del porcentaje (el del precio fijo se redondeaba a 1, igual que antes).
const tarifaDeRegla = (precioBase, moneda, state) => {
    const r = { precio: null, pct: null, dec: 2 };
    if (state.tipoRegla === 'percentage') {
        const discPct = parseFloat(state.discStr) || 0;
        if (precioBase > 0) {
            const calculatedPrice = precioBase * (1 - discPct / 100);
            r.precio = calculatedPrice; r.pct = discPct;
        } else {
            r.pct = discPct;
        }
    } else {
        const fixedPrice = parseFloat(state.customStr) || 0;
        if (precioBase > 0) {
            const discPct = ((precioBase - fixedPrice) / precioBase) * 100;
            r.precio = fixedPrice; r.pct = Number(discPct.toFixed(1)); r.dec = 1;
        } else {
            r.precio = fixedPrice;
        }
    }
    return r;
};

// Tipo de la excepción para el ícono (antes un emoji): global, familia o producto (misma clasificación que activeRules)
const tipoDeRegla = (cod) => cod === 'TOTAL' ? { Icono: Globe, texto: 'Global' }
    : cod.startsWith('GRUPO:') ? { Icono: Folder, texto: 'Familia' }
    : { Icono: Package, texto: 'Producto' };

// En el celular, tarjetas en vez de tablas (una vista sola: no se dibujan las dos ocultando una). Desde 1024 px, tabla
// y la lista de clientes al costado.
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

// Listas de clientes de a 50 (patrón useDeAPoco de ExcepcionesDeudaView): «Buscar en la base» con dos letras trae miles
// (con «ma», más de 5.000) y se dibujaban todos de una. Al acercarse al final se agregan 50 más; vuelve a 50 cuando
// cambia algo de `reinicio` (la lista, el filtro, la pestaña). El margen se mide contra el contenedor que scrollea de
// verdad (la lista en la compu, la página en el celular). El centinela va con ref de función porque la lista se desmonta
// al cambiar de pestaña o al plegarla en el celular.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setCuantos(DE_A); }, reinicio);
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

// --- PANEL LATERAL (DRAWER): Nueva Excepción de Precio (Catálogo Integrado) ---
const NewRuleDrawer = ({ isOpen, onClose, baseProducts, onAddRule, onRemoveRule, editingRule, rowStateMap }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterTab, setFilterTab] = useState('todos'); // 'todos', 'sin_regla', 'con_regla'
    const [selectedItem, setSelectedItem] = useState(null);
    const [customStr, setCustomStr] = useState('');
    const [discStr, setDiscStr] = useState('');
    const [expandedFamilies, setExpandedFamilies] = useState(new Set()); // Familias abiertas en el árbol

    const toggleFamily = (grupo) => {
        setExpandedFamilies(prev => {
            const next = new Set(prev);
            if (next.has(grupo)) next.delete(grupo); else next.add(grupo);
            return next;
        });
    };

    // El endpoint /prices/base puede devolver el mismo artículo varias veces (multimoneda o
    // filas repetidas en PreciosBase). Para el árbol nos quedamos con una sola entrada por
    // CodArticulo: evita duplicados visuales, cuentas infladas y keys repetidas en React.
    const catalog = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const p of baseProducts) {
            if (seen.has(p.CodArticulo)) continue;
            seen.add(p.CodArticulo);
            out.push(p);
        }
        return out;
    }, [baseProducts]);

    // Pre-cargar valores si estamos en modo edición, o resetear si estamos en modo creación
    useEffect(() => {
        if (isOpen) {
            if (editingRule) {
                const { codArticulo, state } = editingRule;
                const prod = baseProducts.find(p => p.CodArticulo === codArticulo);
                if (prod) {
                    setSelectedItem(prod);
                    setCustomStr(state.customStr || '');
                    setDiscStr(state.discStr || '');
                    setFilterTab('con_regla');
                }
            } else {
                setSelectedItem(null);
                setSearchQuery('');
                setFilterTab('todos');
                setCustomStr('');
                setDiscStr('');
            }
        }
    }, [isOpen, editingRule, baseProducts]);

    // Filtrar catálogo (productos y familias) en base a búsqueda y pestañas
    const filteredItems = useMemo(() => {
        const term = searchQuery.toLowerCase().trim();
        // Modo "plano": al buscar texto o filtrar por pestaña mostramos todo lo coincidente
        // sin respetar el colapso del árbol, para no esconder resultados.
        const flatMode = term !== '' || filterTab !== 'todos';

        return catalog.filter(item => {
            const matchSearch = item.CodArticulo.toLowerCase().includes(term) ||
                                (item.Descripcion || '').toLowerCase().includes(term);
            if (!matchSearch) return false;

            const stateObj = rowStateMap[item.CodArticulo];
            const isActive = stateObj?.isActive || false;

            if (filterTab === 'sin_regla' && isActive) return false;
            if (filterTab === 'con_regla' && !isActive) return false;

            // Árbol: en modo normal, un producto hijo sólo se muestra si su familia está abierta.
            const isFamily = item.CodArticulo.startsWith('GRUPO:');
            const isGlobal = item.CodArticulo === 'TOTAL';
            const isChild = !isFamily && !isGlobal;
            if (!flatMode && isChild && !expandedFamilies.has(item.Grupo)) return false;

            return true;
        });
    }, [catalog, searchQuery, filterTab, rowStateMap, expandedFamilies]);

    // Contadores para las pestañas (en base a todo el catálogo)
    const counts = useMemo(() => {
        let sinRegla = 0;
        let conRegla = 0;
        catalog.forEach(p => {
            if (rowStateMap[p.CodArticulo]?.isActive) {
                conRegla++;
            } else {
                sinRegla++;
            }
        });
        return { todos: catalog.length, sinRegla, conRegla };
    }, [catalog, rowStateMap]);

    // Cantidad de productos hijos por familia (para mostrar en el nodo carpeta)
    const familyChildCount = useMemo(() => {
        const m = {};
        catalog.forEach(p => {
            if (!p.CodArticulo.startsWith('GRUPO:') && p.CodArticulo !== 'TOTAL') {
                m[p.Grupo] = (m[p.Grupo] || 0) + 1;
            }
        });
        return m;
    }, [catalog]);

    // Primeros 100 elementos de la lista filtrada para optimizar rendimiento de renderizado
    const visibleList = useMemo(() => {
        return filteredItems.slice(0, 100);
    }, [filteredItems]);

    const handleSelectItem = (item) => {
        setSelectedItem(item);
        const state = rowStateMap[item.CodArticulo];
        if (state && state.isActive) {
            setCustomStr(state.customStr || '');
            setDiscStr(state.discStr || '');
        } else {
            setCustomStr('');
            setDiscStr('');
        }
    };

    const handleRemoveDirect = (e, cod) => {
        e.stopPropagation(); // Evitar que al eliminar se seleccione el elemento
        onRemoveRule(cod);
        if (selectedItem && selectedItem.CodArticulo === cod) {
            setSelectedItem(null);
            setCustomStr('');
            setDiscStr('');
        }
    };

    const handlePriceChange = (valStr) => {
        setCustomStr(valStr);
        if (!selectedItem) return;
        const bp = parseFloat(selectedItem.Precio) || 0;
        const cp = parseFloat(valStr);
        if (bp > 0 && !isNaN(cp)) {
            const d = ((bp - cp) / bp) * 100;
            setDiscStr(d.toFixed(2).replace(/\.00$/, ''));
        } else {
            setDiscStr('');
        }
    };

    const handleDiscChange = (valStr) => {
        setDiscStr(valStr);
        if (!selectedItem) return;
        const bp = parseFloat(selectedItem.Precio) || 0;
        const d = parseFloat(valStr);
        if (bp > 0 && !isNaN(d)) {
            const cp = bp * (1 - d / 100);
            setCustomStr(cp.toFixed(2).replace(/\.00$/, ''));
        } else {
            setCustomStr('');
        }
    };

    const handleSubmit = () => {
        if (!selectedItem) {
            toast.error("Selecciona un producto o familia de la lista.");
            return;
        }
        const cod = selectedItem.CodArticulo;
        const isProd = selectedItem.ProIdProducto !== null && selectedItem.ProIdProducto !== 0 && !cod.startsWith('GRUPO:');
        const isFamily = cod.startsWith('GRUPO:');
        const isGlobal = cod === 'TOTAL';

        if (isProd) {
            if (customStr === '' && discStr === '') {
                toast.error("Ingresa un precio o un descuento.");
                return;
            }
            const type = discStr !== '' ? 'percentage' : 'fixed';
            const val = type === 'percentage' ? discStr : customStr;
            onAddRule(cod, type, val);
        } else if (isFamily) {
            if (!discStr || isNaN(parseFloat(discStr))) {
                toast.error("Ingresa un porcentaje de descuento válido.");
                return;
            }
            onAddRule(cod, 'percentage', discStr);
        } else if (isGlobal) {
            if (!discStr || isNaN(parseFloat(discStr))) {
                toast.error("Ingresa un porcentaje de descuento global válido.");
                return;
            }
            onAddRule(cod, 'percentage', discStr);
        }
        
        toast.success("Regla aplicada localmente.");
        setSelectedItem(null);
        setCustomStr('');
        setDiscStr('');
    };

    if (!isOpen) return null;

    // Va en portal y en z-[6000]/[6010]: arriba de la barra de arriba (5010), aunque la pantalla esté embebida
    return createPortal(
        <>
            {/* Fondo */}
            <div className="fixed inset-0 bg-black/40 z-[6000] animate-in fade-in duration-200" onClick={onClose}></div>

            {/* Panel lateral: en la compu, la lista a la izquierda y la regla a la derecha; en el celular, una cosa por vez */}
            <div className="fixed inset-y-0 right-0 z-[6010] w-full max-w-3xl bg-white shadow-2xl flex flex-col text-zinc-700 text-sm animate-in slide-in-from-right duration-300">
                {/* Encabezado */}
                <div className="px-4 sm:px-5 py-4 border-b border-zinc-200 flex items-start gap-3">
                    <Tags size={22} className="text-brand-cyan shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-black text-zinc-900 leading-tight">Asignar reglas de precio</h3>
                        <p className="text-xs text-zinc-500 mt-0.5">Asigná y editá tarifas especiales sobre productos y familias desde un solo lugar.</p>
                    </div>
                    <button onClick={onClose} title="Cerrar" aria-label="Cerrar" className="w-8 h-8 rounded-xl hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
                        <X size={18} />
                    </button>
                </div>

                {/* Cuerpo */}
                <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                    {/* Lista del catálogo */}
                    <div className="flex-1 md:flex-none w-full md:w-3/5 flex flex-col min-h-0 p-4 sm:p-5 md:border-r md:border-zinc-200">
                        {/* Buscador */}
                        <div className="relative mb-3">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                className={CAMPO_CON_X}
                                placeholder="Buscar por código o descripción..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    title="Borrar la búsqueda"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                                >
                                    <CircleX size={16} />
                                </button>
                            )}
                        </div>

                        {/* Pestañas de filtro */}
                        <div className="grid grid-cols-3 rounded-xl border border-zinc-200 bg-white p-1 gap-1 mb-3">
                            <button
                                type="button"
                                onClick={() => setFilterTab('todos')}
                                className={`${PESTANA} ${filterTab === 'todos' ? PESTANA_SI : PESTANA_NO}`}
                            >
                                Todos <span className="opacity-70">({counts.todos})</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterTab('sin_regla')}
                                className={`${PESTANA} ${filterTab === 'sin_regla' ? PESTANA_SI : PESTANA_NO}`}
                                title="Productos y familias sin regla asignada (no coincidentes)"
                            >
                                Sin regla <span className="opacity-70">({counts.sinRegla})</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterTab('con_regla')}
                                className={`${PESTANA} ${filterTab === 'con_regla' ? PESTANA_SI : PESTANA_NO}`}
                            >
                                Con regla <span className="opacity-70">({counts.conRegla})</span>
                            </button>
                        </div>

                        {/* Listado */}
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                            {visibleList.length === 0 ? (
                                <div className="flex flex-col items-center justify-center text-center py-10">
                                    <SearchX size={40} className="mb-3 text-brand-cyan" />
                                    <span className="text-sm font-bold text-zinc-700">No se encontraron ítems coincidentes.</span>
                                    <span className="text-xs text-zinc-400 mt-1">Probá con otra búsqueda u otra pestaña.</span>
                                </div>
                            ) : (
                                visibleList.map(item => {
                                    const isSelected = selectedItem?.CodArticulo === item.CodArticulo;
                                    const state = rowStateMap[item.CodArticulo];
                                    const hasRule = state?.isActive;

                                    // Regla del ítem: porcentaje (verde si es descuento, magenta si es recargo), precio fijo en cian
                                    let badgeContent = null;
                                    if (hasRule) {
                                        if (state.tipoRegla === 'percentage') {
                                            badgeContent = <ChipPct pct={state.discStr} />;
                                        } else {
                                            badgeContent = <span className={`${CHIP} ${CHIP_CIAN} normal-case`}>{fmtPrecio(item.Moneda, state.customStr)}</span>;
                                        }
                                    } else {
                                        badgeContent = <span className={`${CHIP} ${CHIP_ZINC} normal-case`}>Sin regla</span>;
                                    }

                                    const isGlobal = item.CodArticulo === 'TOTAL';
                                    const isFamily = item.CodArticulo.startsWith('GRUPO:');
                                    const isChild = !isGlobal && !isFamily;
                                    const isExpanded = isFamily && expandedFamilies.has(item.Grupo);
                                    const searching = searchQuery.trim() !== '' || filterTab !== 'todos';

                                    // Ícono del tipo (antes un emoji)
                                    let TypeIcon = Package;
                                    let typeLabel = "Producto";
                                    if (isGlobal) {
                                        TypeIcon = Globe;
                                        typeLabel = "Global";
                                    } else if (isFamily) {
                                        TypeIcon = isExpanded ? FolderOpen : Folder;
                                        typeLabel = "Familia";
                                    }

                                    // Al hacer clic en una familia: abrir/cerrar el árbol y seleccionarla para configurar su descuento.
                                    const handleRowClick = () => {
                                        if (isFamily && !searching) toggleFamily(item.Grupo);
                                        handleSelectItem(item);
                                    };

                                    return (
                                        <div
                                            key={item.CodArticulo}
                                            data-item-catalogo
                                            onClick={handleRowClick}
                                            style={isChild && !searching ? { marginLeft: '1.25rem' } : undefined}
                                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors border ${isSelected ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan/30' : isFamily ? 'bg-zinc-50 border-zinc-200 hover:border-brand-cyan/40' : 'bg-white border-zinc-200 hover:border-zinc-300'} ${isChild && !searching ? 'border-l-2 border-l-zinc-300' : ''}`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                {isFamily && !searching && (
                                                    isExpanded
                                                        ? <ChevronDown size={14} className="text-zinc-400 shrink-0" />
                                                        : <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                                                )}
                                                <span className="shrink-0" title={typeLabel}><TypeIcon size={17} className="text-brand-cyan" /></span>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-zinc-800 text-sm truncate" title={item.Descripcion}>{item.Descripcion}</div>
                                                    <div className="text-[11px] font-mono text-zinc-400 mt-0.5 truncate">
                                                        Ref: {item.CodArticulo}{item.Precio > 0 && ` · Base ${fmtPrecio(item.Moneda, item.Precio)}`}
                                                        {isFamily && familyChildCount[item.Grupo] ? ` · ${familyChildCount[item.Grupo]} productos` : ''}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {badgeContent}
                                                {hasRule && (
                                                    <button
                                                        onClick={(e) => handleRemoveDirect(e, item.CodArticulo)}
                                                        className={BTN_ICONO_CHICO}
                                                        title="Eliminar excepción"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            {filteredItems.length > 100 && (
                                <div className="text-[11px] text-zinc-400 text-center py-2 border-t border-zinc-100">
                                    Mostrando los primeros 100 de {filteredItems.length} ítems. Usá el buscador.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* La regla del elemento elegido (formulario). En el celular va abajo de la lista, solo con algo elegido. */}
                    <div className={`${selectedItem ? 'flex' : 'hidden md:flex'} w-full md:w-2/5 flex-col shrink-0 md:shrink min-h-0 max-h-[58%] md:max-h-none overflow-y-auto p-4 sm:p-5 border-t border-zinc-200 md:border-t-0 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] md:shadow-none`}>
                        {!selectedItem ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-zinc-200 rounded-2xl">
                                <ArrowLeft size={28} className="text-brand-cyan mb-3" />
                                <p className="text-sm font-bold text-zinc-700">Elegí un elemento</p>
                                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">Elegí un producto o una familia de la lista para definir su precio especial o descuento.</p>
                            </div>
                        ) : (
                            <div className="space-y-3 md:space-y-4">
                                <div className="p-3 md:p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-cyan">Configurar excepción</p>
                                    <h4 className="font-bold text-zinc-900 text-sm mt-1 leading-snug">{selectedItem.Descripcion}</h4>
                                    <p className="text-[11px] font-mono text-zinc-400 mt-1">Ref: {selectedItem.CodArticulo}</p>
                                    {selectedItem.Precio > 0 && (
                                        <div className="flex justify-between items-center gap-2 text-xs font-bold text-zinc-500 mt-3 pt-3 border-t border-zinc-200">
                                            <span>Precio base</span>
                                            <span className="font-mono text-zinc-800 bg-white px-2 py-0.5 rounded-lg border border-zinc-200">{fmtPrecio(selectedItem.Moneda, selectedItem.Precio)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Formulario */}
                                {selectedItem.CodArticulo !== 'TOTAL' && !selectedItem.CodArticulo.startsWith('GRUPO:') ? (
                                    // PRODUCTO: Entradas duales
                                    <div className="space-y-3">
                                        <div>
                                            <label className={ETIQUETA}>Precio fijo ({selectedItem.Moneda === 'USD' ? 'US$' : '$'})</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold text-sm pointer-events-none">{selectedItem.Moneda === 'USD' ? 'US$' : '$'}</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className={`${CAMPO_NUM} w-full pl-12 pr-3`}
                                                    placeholder="Ej: 150"
                                                    value={customStr}
                                                    onChange={e => handlePriceChange(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={ETIQUETA}>Descuento (%)</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className={`${CAMPO_NUM} w-full pl-3 pr-8`}
                                                    placeholder="Ej: 10"
                                                    value={discStr}
                                                    onChange={e => handleDiscChange(e.target.value)}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold text-sm pointer-events-none">%</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    // FAMILIA O GLOBAL: Solo descuento
                                    <div className="space-y-3">
                                        <div>
                                            <label className={ETIQUETA}>Descuento (%)</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className={`${CAMPO_NUM} w-full pl-3 pr-8`}
                                                    placeholder="Ej: 15"
                                                    value={discStr}
                                                    onChange={e => setDiscStr(e.target.value)}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold text-sm pointer-events-none">%</span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-zinc-500 leading-relaxed">
                                            {selectedItem.CodArticulo === 'TOTAL'
                                                ? 'Esta regla actúa como descuento global para cualquier producto que no tenga regla específica o de familia.'
                                                : 'Este descuento se aplicará a todos los productos que pertenezcan a esta familia.'}
                                        </p>
                                    </div>
                                )}

                                {/* Acciones del formulario */}
                                <div className="pt-1 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setSelectedItem(null); setCustomStr(''); setDiscStr(''); }}
                                        className={`${BTN_SECUNDARIO} shrink-0`}
                                    >
                                        Limpiar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSubmit}
                                        className={`${BTN_PRINCIPAL} flex-1 whitespace-nowrap`}
                                    >
                                        <Check size={15} /> Aplicar regla
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};

// --- MODAL DE GESTIÓN DE PERFILES ---
const ProfileSelectionModal = ({ isOpen, onClose, allProfiles, selectedProfileIds, onApply }) => {
    const [tempIds, setTempIds] = useState(new Set(selectedProfileIds));

    useEffect(() => {
        setTempIds(new Set(selectedProfileIds));
    }, [selectedProfileIds, isOpen]);

    if (!isOpen) return null;

    // Clasificar perfiles
    const globalProfiles = allProfiles.filter(p => p.EsGlobal === 1 || p.Global === 1 || p.EsGlobal === true || p.Global === true);
    const assignableProfiles = allProfiles.filter(p => !(p.EsGlobal === 1 || p.Global === 1 || p.EsGlobal === true || p.Global === true));

    const handleToggle = (id) => {
        setTempIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSubmit = () => {
        onApply(tempIds);
    };

    // Sin blur; en portal y en z-[6000]/[6010], arriba de la barra de arriba (5010)
    return createPortal(
        <>
            {/* Fondo */}
            <div className="fixed inset-0 bg-black/40 z-[6000] animate-in fade-in duration-200" onClick={onClose}></div>

            {/* Ventana */}
            <div className="fixed inset-0 z-[6010] flex items-center justify-center p-3 sm:p-4">
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh] text-zinc-700 text-sm animate-in zoom-in-95 duration-200">
                    {/* Encabezado */}
                    <div className="px-4 sm:px-5 py-4 border-b border-zinc-200 flex items-start gap-3">
                        <UserCog size={22} className="text-brand-cyan shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <h3 className="text-lg font-black text-zinc-900 leading-tight">Gestionar perfiles</h3>
                            <p className="text-xs text-zinc-500 mt-0.5">Asigná o quitá perfiles de precios para este cliente.</p>
                        </div>
                        <button onClick={onClose} title="Cerrar" aria-label="Cerrar" className="w-8 h-8 rounded-xl hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Cuerpo */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6 custom-scrollbar">
                        {/* Perfiles Globales (Activos / Bloqueados) */}
                        <div>
                            <h4 className={`${ROTULO} mb-3 flex items-center gap-1.5`}>
                                <Globe size={14} className="text-brand-cyan" /> Perfiles globales (activos)
                            </h4>
                            {globalProfiles.length === 0 ? (
                                <p className="text-xs text-zinc-400">No hay perfiles globales configurados en el sistema.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                    {globalProfiles.map(p => (
                                        <div key={p.ID} className="flex items-center justify-between gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-xl select-none">
                                            <div className="min-w-0">
                                                <div className="font-bold text-zinc-700 text-sm truncate">{p.Nombre}</div>
                                                <div className="text-xs text-zinc-400 truncate mt-0.5">{p.Descripcion || 'Perfil global activo por defecto'}</div>
                                            </div>
                                            <span className="text-zinc-400 shrink-0" title="Este perfil es global y se aplica automáticamente">
                                                <Lock size={15} />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Asignación de Perfiles (Editables) */}
                        <div>
                            <h4 className={`${ROTULO} mb-3 flex items-center gap-1.5`}>
                                <UserCog size={14} className="text-brand-cyan" /> Asignación de perfiles
                            </h4>
                            {assignableProfiles.length === 0 ? (
                                <p className="text-xs text-zinc-400">No hay perfiles asignables configurados.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                    {assignableProfiles.map(p => {
                                        const isChecked = tempIds.has(p.ID);
                                        return (
                                            <div
                                                key={p.ID}
                                                role="checkbox"
                                                aria-checked={isChecked}
                                                onClick={() => handleToggle(p.ID)}
                                                className={`flex items-center justify-between gap-2 p-3 rounded-xl cursor-pointer transition-colors border select-none ${isChecked ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan/30' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}
                                            >
                                                <div className="min-w-0">
                                                    <div className="font-bold text-zinc-800 text-sm truncate">{p.Nombre}</div>
                                                    <div className="text-xs text-zinc-400 truncate mt-0.5">{p.Descripcion || 'Sin descripción'}</div>
                                                </div>
                                                <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${isChecked ? 'bg-brand-cyan border-brand-cyan text-white' : 'border-zinc-300 bg-white'}`}>
                                                    {isChecked && <Check size={13} strokeWidth={3} />}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Pie */}
                    <div className="px-4 sm:px-5 py-3 border-t border-zinc-200 bg-zinc-50 grid grid-cols-2 sm:flex sm:justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className={BTN_SECUNDARIO}
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            className={BTN_PRINCIPAL}
                        >
                            <Check size={15} /> Aplicar perfiles
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};

// --- COMPONENTE PRINCIPAL ---
// Props (opcionales, para embeber la vista en el Panel 360 del cliente):
//   clienteFijo = { id: CliIdCliente, Nombre }  → se abre directo en ese cliente, sin la
//                 lista de clientes de la izquierda; el resto (excepciones, perfiles,
//                 urgencia, guardar, quitar) es exactamente la misma pantalla.
//   embebido    = true → sin alto fijo ni scroll propio (lo maneja la página que la contiene).
const SpecialPrices = ({ clienteFijo = null, embebido = false }) => {
    // Referencias y Listas base de la DB
    const [clients, setClients] = useState([]);
    const [selClientId, setSelClientId] = useState(null);
    const [clientData, setClientData] = useState({ client: null, profiles: [] });
    const [baseProducts, setBaseProducts] = useState([]);

    // Estado Dual Interactivo por Fila: rowStateMap[CodArticulo]
    const [rowStateMap, setRowStateMap] = useState({});

    // Bulk & Filters
    const [filterCategory, setFilterCategory] = useState("TODAS");
    const [filterSearch, setFilterSearch] = useState("");
    const [filterClient, setFilterClient] = useState("");
    const [selectedRows, setSelectedRows] = useState(new Set());
    const [bulkDiscountPct, setBulkDiscountPct] = useState("");

    // UI States
    const [loading, setLoading] = useState(false);
    const [loadingRules, setLoadingRules] = useState(false);
    const [isDirtyMap, setIsDirtyMap] = useState(false); // Para el tooltip de "Tienes cambios sin guardar"

    const [expandedGroups, setExpandedGroups] = useState(new Set()); // Para el modo arbolito
    const [hiddenGroups, setHiddenGroups] = useState(new Set()); // Para familias con 'ojito' tachado
    const [pendingNewClient, setPendingNewClient] = useState(null);

    // Nuevos estados para pestañas, búsqueda en DB, drawer, edición y vista dual
    const [sidebarTab, setSidebarTab] = useState('tarifas'); // 'tarifas' o 'db'
    const [dbSearchTerm, setDbSearchTerm] = useState('');
    const [dbSearchResults, setDbSearchResults] = useState([]);
    const [loadingDbSearch, setLoadingDbSearch] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [showAllProducts, setShowAllProducts] = useState(false);
    const [editingRule, setEditingRule] = useState(null);

    // Gestión Integrada de Perfiles
    const [allProfiles, setAllProfiles] = useState([]);
    const [selectedProfileIds, setSelectedProfileIds] = useState(new Set());
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

    // Excepciones de Urgencia del cliente seleccionado
    const [urgExcForClient, setUrgExcForClient] = useState([]);
    const [urgExcPanelOpen, setUrgExcPanelOpen] = useState(false);
    const [urgExcAreas, setUrgExcAreas] = useState([]);       // lista de áreas disponibles
    const [urgExcAreaSearch, setUrgExcAreaSearch] = useState('');
    const [urgExcProdDropOpen, setUrgExcProdDropOpen] = useState(false);

    // Estética nueva: en el celular (sin tabla) la lista de clientes va arriba y se pliega al elegir uno (queda un botón
    // para volver a abrirla). «Quitar cliente» confirma con la ventana propia (antes window.confirm).
    const conTabla = useConTabla();
    const [listaAbiertaCelular, setListaAbiertaCelular] = useState(false);
    useEffect(() => { setListaAbiertaCelular(false); }, [selClientId]);
    const [confirmar, ventanaConfirmar] = useConfirmar();

    useEffect(() => {
        loadClients();
        loadProducts();
        loadAllProfiles();
    }, []);

    const loadAllProfiles = () => {
        api.get('/profiles')
            .then(res => setAllProfiles(res.data || []))
            .catch(e => console.error("Error cargando perfiles:", e));
    };

    const loadUrgExcForClient = async (cliId) => {
        if (!cliId) { setUrgExcForClient([]); return; }
        try {
            const res = await api.get(`/profiles/urgencia-excepciones?cliId=${cliId}`);
            setUrgExcForClient(res.data?.data || []);
        } catch (e) {
            console.error('Error cargando excepciones urgencia:', e);
        }
    };

    const loadUrgExcAreas = async () => {
        try {
            const res = await api.get('/profiles/urgencia-excepciones/areas');
            setUrgExcAreas(res.data?.data || []);
        } catch (e) {
            console.error('Error cargando áreas:', e);
        }
    };

    const handleAddUrgExcArea = async (area) => {
        const cliId = selClientId || clientData.client?.CliIdCliente;
        if (!cliId) return;
        try {
            await api.post('/profiles/urgencia-excepciones', {
                CliIdCliente: cliId,
                CodArea:      area ? area.CodArea : null,
            });
            toast.success(area ? `Excepción agregada: ${area.AreaNombre}` : 'Cliente exento de urgencia en todos los servicios.');
            setUrgExcAreaSearch('');
            setUrgExcProdDropOpen(false);
            loadUrgExcForClient(cliId);
        } catch (e) {
            toast.error(e.response?.data?.error || 'Error al guardar excepción.');
        }
    };

    const handleDeleteUrgExc = async (id) => {
        try {
            await api.delete(`/profiles/urgencia-excepciones/${id}`);
            toast.success('Excepción eliminada.');
            loadUrgExcForClient(selClientId || clientData.client?.CliIdCliente);
        } catch (e) {
            toast.error('Error al eliminar.');
        }
    };

    useEffect(() => {
        setShowAllProducts(false);
        setEditingRule(null);
        setUrgExcPanelOpen(false);
        setUrgExcAreaSearch('');
        if (selClientId) {
            loadRules(selClientId);
            loadUrgExcForClient(selClientId);
            loadUrgExcAreas();
        } else {
            setClientData({ client: null });
            setRowStateMap({});
            setSelectedRows(new Set());
            setIsDirtyMap(false);
            setExpandedGroups(new Set());
            setHiddenGroups(new Set());
            setSelectedProfileIds(new Set());
            setUrgExcForClient([]);
        }
    }, [selClientId]);

    // Embebido en el Panel 360: el cliente viene fijo. Si todavía no tiene tarifas, queda
    // "en preparación" igual que al elegirlo desde "Buscar en DB" (se crea al Guardar Tarifa).
    useEffect(() => {
        if (!clienteFijo || !clienteFijo.id) return;
        const id = clienteFijo.id;
        const nombre = clienteFijo.Nombre || `Cliente ${id}`;
        setClients(prev => prev.find(c => c.ClienteID === id) ? prev : [{ ClienteID: id, Nombre: nombre, CantReglas: 0 }, ...prev]);
        setPendingNewClient({ id, Nombre: nombre });
        setSelClientId(id);
    }, [clienteFijo?.id]);

    useEffect(() => {
        if (!dbSearchTerm || dbSearchTerm.length < 2) {
            setDbSearchResults([]);
            return;
        }

        const timer = setTimeout(() => {
            setLoadingDbSearch(true);
            api.get('/clients', { params: { q: dbSearchTerm } })
                .then(res => setDbSearchResults(res.data || []))
                .catch(e => {
                    console.error("Error buscando clientes en DB:", e);
                    setDbSearchResults([]);
                })
                .finally(() => setLoadingDbSearch(false));
        }, 500);

        return () => clearTimeout(timer);
    }, [dbSearchTerm]);

    const loadClients = () => {
        setLoading(true);
        api.get('/special-prices/clients')
            .then(res => setClients(res.data))
            .catch(err => toast.error("Error cargando clientes"))
            .finally(() => setLoading(false));
    };

    const loadProducts = () => {
        api.get('/prices/base')
            .then(res => {
                const prods = [
                    { CodArticulo: 'TOTAL', ProIdProducto: 0, Descripcion: 'Aplica a todo el resto (Regla Global)', Precio: 0, Moneda: 'UYU', Grupo: 'GLOBAL' }
                ];
                
                const grouped = {};
                res.data.forEach(p => {
                    const g = p.Grupo || 'Sin Familia';
                    if (!grouped[g]) grouped[g] = [];
                    grouped[g].push({ ...p, Grupo: g });
                });

                Object.keys(grouped).sort().forEach(g => {
                    const firstP = grouped[g][0];
                    // Nombre real de la familia: preferimos el mapeo del grupo (ConfigMapeoERP.NombreReferencia),
                    // que describe al grupo completo. Solo si falta caemos al nombre de stock del primer producto.
                    const nombreGrupo = firstP.NombreReferenciaGrupo || firstP.GrupoNombre;
                    prods.push({
                        CodArticulo: `GRUPO:${g}`,
                        ProIdProducto: null,
                        Descripcion: nombreGrupo ? `${g} - ${nombreGrupo}` : g,
                        Grupo: g,
                        Precio: 0,
                        Moneda: 'UYU'
                    });
                    prods.push(...grouped[g]);
                });
                
                setBaseProducts(prods);
            })
            .catch(e => console.error("Error loading products list", e));
    };

    const loadRules = (cid) => {
        setLoadingRules(true);
        api.get(`/special-prices/${cid}`)
            .then(res => {
                setClientData({ 
                    client: res.data.client,
                    profiles: res.data.profiles || [] 
                });
                setSelectedProfileIds(new Set((res.data.profiles || []).map(p => p.ID)));
                const rules = res.data.rules || [];
                
                // Auto-expandir familias que tengan reglas activas
                const activeGroups = new Set();
                rules.forEach(r => {
                    // Si la regla en si misma es de familia, expandimos su propia familia
                    if(r.CodArticulo && r.CodArticulo.startsWith('GRUPO:')) {
                        activeGroups.add(r.CodArticulo.replace('GRUPO:', ''));
                    } else {
                        // Si es un articulo normal, buscamos a que familia pertenece para abrirla
                        const prodRef = baseProducts.find(bp => bp.CodArticulo === r.CodArticulo);
                        if(prodRef && prodRef.Grupo) activeGroups.add(prodRef.Grupo);
                    }
                });
                const allFamilies = new Set(baseProducts.filter(p => p.Grupo && p.Grupo !== 'GLOBAL').map(p => p.Grupo));
                const hiddenByDefault = new Set([...allFamilies].filter(g => !activeGroups.has(g)));

                setExpandedGroups(activeGroups);
                setHiddenGroups(hiddenByDefault);
                
                buildRowMap(baseProducts, rules);
            })
            .catch(err => {
                if (err.response?.status === 404) {
                    // Significa que es un cliente listado pero sin reglas aún (en preparación local)
                    const temp = clients.find(c => c.ClienteID === cid) || pendingNewClient;
                    setClientData({ 
                        client: { CliIdCliente: cid, Nombre: temp?.Nombre || `Cliente ${cid}` },
                        profiles: []
                    });
                    setSelectedProfileIds(new Set());
                    
                    const allFamilies = new Set(baseProducts.filter(p => p.Grupo && p.Grupo !== 'GLOBAL').map(p => p.Grupo));
                    setExpandedGroups(new Set());
                    setHiddenGroups(allFamilies); // Todo oculto por defecto
                    buildRowMap(baseProducts, []);
                } else {
                    console.error("Error loading rules:", err);
                }
            })
            .finally(() => setLoadingRules(false));
    };

    // Construye el estado dual $ y % para TODAS las filas
    const buildRowMap = (products, rules) => {
        const newMap = {};
        products.forEach(prod => {
            const rule = rules.find(r => r.CodArticulo === prod.CodArticulo);
            const bp = parseFloat(prod.Precio) || 0;
            
            let customStr = bp > 0 ? bp.toString() : "";
            let discStr = "0";
            let amtStr = "";     // descuento por IMPORTE fijo por unidad (regla 'subtract')
            let tipo = 'percentage';
            let active = false;

            if (rule) {
                active = true;
                tipo = rule.TipoRegla;
                const rv = parseFloat(rule.Valor) || 0;

                if (tipo.includes('percentage')) {
                    discStr = rv.toString();
                    if (bp > 0) {
                        customStr = (bp * (1 - rv / 100)).toFixed(2);
                        if(customStr.endsWith('.00')) customStr = customStr.slice(0, -3);
                    } else customStr = "";
                } else if (tipo === 'fixed' || tipo === 'fixed_price') {
                    customStr = rv.toString();
                    if (bp > 0) {
                        discStr = (((bp - rv) / bp) * 100).toFixed(2);
                        if(discStr.endsWith('.00')) discStr = discStr.slice(0, -3);
                    } else discStr = "0";
                } else if (tipo === 'subtract') {
                    amtStr = rv.toString();
                    if (bp > 0) {
                        customStr = (bp - rv).toFixed(2);
                        if(customStr.endsWith('.00')) customStr = customStr.slice(0, -3);
                        discStr = ((rv / bp) * 100).toFixed(2);
                        if(discStr.endsWith('.00')) discStr = discStr.slice(0, -3);
                    } else { customStr = ""; discStr = "0"; }
                }
            } else {
                if (bp === 0) customStr = "";
            }

            newMap[prod.CodArticulo] = {
                basePrice: bp,
                customStr,
                discStr,
                amtStr,
                tipoRegla: tipo,
                isActive: active
            };
        });
        setRowStateMap(newMap);
        setIsDirtyMap(false);
    };

    // Actualiza filas si se cargaron productos después
    useEffect(() => {
        if (selClientId && baseProducts.length > 0 && Object.keys(rowStateMap).length === 0) {
            loadRules(selClientId); // re-trigger build
        }
    }, [baseProducts]);


    // --- HANDLERS INTERACTIVOS DE ENTRADA DOBLE ---
    
    const cleanNum = (str) => {
        const p = parseFloat(str);
        if(isNaN(p)) return null;
        let s = p.toFixed(2);
        if(s.endsWith('.00')) s = s.slice(0, -3);
        return s;
    };

    const handlePriceStrChange = (cod, strVal) => {
        setRowStateMap(prev => {
            const row = prev[cod];
            const cp = parseFloat(strVal);
            let dStr = "";

            if (row.basePrice > 0 && !isNaN(cp)) {
                let d = ((row.basePrice - cp) / row.basePrice) * 100;
                dStr = cleanNum(d);
            }

            return {
                ...prev,
                [cod]: { ...row, customStr: strVal, discStr: dStr, amtStr: '', tipoRegla: 'fixed', isActive: strVal !== "" }
            };
        });
        setIsDirtyMap(true);
    };

    const handleDiscStrChange = (cod, strVal) => {
         setRowStateMap(prev => {
            const row = prev[cod];
            const d = parseFloat(strVal);
            let cStr = "";

            if (row.basePrice > 0 && !isNaN(d)) {
                let cp = row.basePrice * (1 - d / 100);
                cStr = cleanNum(cp);
            }

            return {
                ...prev,
                [cod]: { ...row, discStr: strVal, customStr: cStr, amtStr: '', tipoRegla: 'percentage', isActive: strVal !== "" && strVal !== "0" }
            };
        });
        setIsDirtyMap(true);
    };

    // Descuento por IMPORTE fijo por unidad ("bonificación en $"): regla 'subtract', que el
    // motor resta de la lista. Excluyente con el % y con el precio fijo.
    const handleAmtStrChange = (cod, strVal) => {
         setRowStateMap(prev => {
            const row = prev[cod];
            const a = parseFloat(strVal);
            let cStr = "", dStr = "";
            if (row.basePrice > 0 && !isNaN(a)) {
                cStr = cleanNum(row.basePrice - a);
                dStr = cleanNum((a / row.basePrice) * 100);
            }
            return {
                ...prev,
                [cod]: { ...row, amtStr: strVal, customStr: cStr, discStr: dStr, tipoRegla: 'subtract', isActive: strVal !== "" && strVal !== "0" }
            };
        });
        setIsDirtyMap(true);
    };

    // --- ACCIONES MASIVAS (BULK) ---
    const toggleRowSelect = (cod) => {
        setSelectedRows(prev => {
            const next = new Set(prev);
            if(next.has(cod)) next.delete(cod);
            else next.add(cod);
            return next;
        });
    };

    const toggleSelectAll = (visibleItems) => {
        if (selectedRows.size >= visibleItems.length && visibleItems.length > 0) {
            setSelectedRows(new Set()); // Deselect all
        } else {
            const next = new Set(selectedRows);
            visibleItems.forEach(i => next.add(i.CodArticulo));
            setSelectedRows(next);
        }
    };

    const applyBulkDiscount = () => {
        if(selectedRows.size === 0) return toast.info("No hay filas seleccionadas.");
        const val = parseFloat(bulkDiscountPct);
        if(isNaN(val)) return toast.error("Ingresa un porcentaje válido.");

        setRowStateMap(prev => {
            const ms = { ...prev };
            selectedRows.forEach(cod => {
                const row = ms[cod];
                if (!row) return;
                let cStr = "";
                if (row.basePrice > 0) {
                    cStr = cleanNum(row.basePrice * (1 - val / 100));
                }
                ms[cod] = { ...row, discStr: val.toString(), customStr: cStr, tipoRegla: 'percentage', isActive: true };
            });
            return ms;
        });
        setBulkDiscountPct("");
        setSelectedRows(new Set());
        setIsDirtyMap(true);
        toast.success(`Descuento de ${val}% aplicado a ${selectedRows.size} productos.`);
    };

    // --- GUARDAR A BASE DE DATOS ---
    const handleApplyProfiles = (tempIds) => {
        setSelectedProfileIds(tempIds);
        // Actualizar localmente clientData.profiles para que las etiquetas del header se actualicen inmediatamente
        const updatedProfiles = allProfiles.filter(p => tempIds.has(p.ID));
        setClientData(prev => ({
            ...prev,
            profiles: updatedProfiles
        }));
        setIsDirtyMap(true);
        setIsProfileModalOpen(false);
        toast.info("Perfiles de precio modificados localmente. Recuerda guardar tarifa.");
    };

    const handleSaveRules = () => {
        if (!selClientId) return;
        const payloadRules = [];

        Object.keys(rowStateMap).forEach(cod => {
            const row = rowStateMap[cod];
            const prod = baseProducts.find(p => p.CodArticulo === cod);
            if (!prod) return;

            let isConfigured = false;
            let finalVal = 0;

            if (row.tipoRegla === 'percentage') {
                const d = parseFloat(row.discStr);
                if (!isNaN(d) && d !== 0) { isConfigured = true; finalVal = d; }
            } else if (row.tipoRegla === 'subtract') {
                const a = parseFloat(row.amtStr);
                if (!isNaN(a) && a > 0) { isConfigured = true; finalVal = a; }
            } else {
                const cp = parseFloat(row.customStr);
                // Si el precio fijo es diferente a la base, o si la base es 0 y pusieron un precio
                if (!isNaN(cp) && (cp !== row.basePrice || row.basePrice === 0)) {
                    isConfigured = true; finalVal = cp;
                }
            }

            // Si estaba configurada, la agregamos al payload (el backend hace Upsert + Clean)
            if (isConfigured) {
                payloadRules.push({
                    CodArticulo: cod,
                    ProIdProducto: prod.ProIdProducto,
                    TipoRegla: row.tipoRegla,
                    Valor: finalVal,
                    Moneda: prod.Moneda || 'UYU',
                    MinCantidad: 0
                });
            }
        });

        api.post('/special-prices/profile', {
            clientId: selClientId,
            nombre: clientData.client?.Nombre || clientData.client?.NombreCliente || `Cliente ${selClientId}`,
            rules: payloadRules,
            profileIds: Array.from(selectedProfileIds)
        })
        .then(() => {
            toast.success("Tarifa y perfiles guardados exitosamente");
            setIsDirtyMap(false);
            loadRules(selClientId); // refrescar orgánicos
        })
        .catch(e => toast.error("Error guardando: " + e.message));
    };

    const handleCreateClient = (id, nombre) => {
        // Enlazar de forma puramente local en la UI. No tocar Base de Datos hasta que apreten "Guardar Tarifa".
        const cNombre = nombre || `Cliente ${id}`;
        
        if (!clients.find(c => c.ClienteID === id)) {
            setClients(prev => [{ ClienteID: id, Nombre: cNombre, CantReglas: 0 }, ...prev]);
        }
        
        setPendingNewClient({ id, Nombre: cNombre });
        toast.info(`Comenzando edición para ${cNombre}. Recuerda "Guardar Tarifa" al finalizar.`);
        setSelClientId(id);
    };

    const handleAddRuleFromDrawer = (codArticulo, type, valueStr) => {
        // Encontrar si el artículo pertenece a un grupo para auto-expandirlo y desocultarlo
        const prodRef = baseProducts.find(bp => bp.CodArticulo === codArticulo);
        if (prodRef && prodRef.Grupo) {
            setExpandedGroups(prev => {
                const next = new Set(prev);
                next.add(prodRef.Grupo);
                return next;
            });
            setHiddenGroups(prev => {
                const next = new Set(prev);
                next.delete(prodRef.Grupo);
                return next;
            });
        }

        if (type === 'fixed') {
            handlePriceStrChange(codArticulo, valueStr);
        } else {
            handleDiscStrChange(codArticulo, valueStr);
        }

        // Auto scroll y animación de resaltado
        setTimeout(() => {
            const el = document.getElementById(`row-${codArticulo}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('animate-highlight');
                setTimeout(() => {
                    if (el) el.classList.remove('animate-highlight');
                }, 2000);
            }
        }, 200);

        toast.success(`Excepción de precio agregada localmente.`);
    };

    const handleRemoveRule = (codArticulo) => {
        setRowStateMap(prev => {
            const row = prev[codArticulo];
            if (!row) return prev;
            return {
                ...prev,
                [codArticulo]: {
                    ...row,
                    customStr: "",
                    discStr: "0",
                    tipoRegla: "percentage",
                    isActive: false
                }
            };
        });
        setIsDirtyMap(true);
        toast.info(`Regla eliminada para ${codArticulo}.`);
    };

    const handleDeleteClient = async () => {
        if (!selClientId || !(await confirmar({ titulo: 'Quitar cliente de precios especiales', texto: `¿Seguro que deseas eliminar los precios especiales del cliente ${selClientId}? Volverá a tarifa normal.`, confirmar: 'Quitar cliente', peligro: true }))) return;
        api.delete(`/special-prices/${selClientId}`)
            .then(() => {
                toast.success("Cliente eliminado de reglas especiales");
                setSelClientId(null);
                loadClients();
            })
            .catch(e => toast.error("Error: " + e.message));
    };

    // --- FILTROS VISUALES ---
    const filteredClients = clients.filter(c => {
        const term = filterClient.toLowerCase().trim();
        return String(c.ClienteID).includes(term) ||
               (c.Nombre || "").toLowerCase().includes(term) ||
               (c.NombreFantasia || "").toLowerCase().includes(term) ||
               (c.IDCliente || "").toLowerCase().includes(term);
    });

    const activeRulesCount = Object.values(rowStateMap).filter(r => r.isActive).length;

    const toggleGroupNode = (grupo) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(grupo)) next.delete(grupo);
            else next.add(grupo);
            return next;
        });
    };

    const toggleHideGroupNode = (grupo) => {
        setHiddenGroups(prev => {
            const next = new Set(prev);
            if (next.has(grupo)) {
                next.delete(grupo);
            } else {
                next.add(grupo);
                // Si la ocultamos, nos aseguramos que también se cierre
                setExpandedGroups(exp => {
                    const nExp = new Set(exp);
                    nExp.delete(grupo);
                    return nExp;
                });
            }
            return next;
        });
    };

    const visibleProducts = useMemo(() => {
        return baseProducts.filter(p => {
            const matchSearch = String(p.CodArticulo).toLowerCase().includes(filterSearch.toLowerCase()) || 
                                String(p.Descripcion || "").toLowerCase().includes(filterSearch.toLowerCase());
            const matchCat = filterCategory === "TODAS" || p.Grupo === filterCategory || (filterCategory === "ACTIVAS" && rowStateMap[p.CodArticulo]?.isActive);
            
            // Si no coincide con la busqueda general, se oculta
            if(!matchSearch || !matchCat) return false;

            // Si el producto pertenece a una familia con el "Ojito" tachado (hidden), SE EXCLUYE COMPLETAMENTE (incluso de busquedas y expansiones)
            if(p.ProIdProducto !== null && p.ProIdProducto !== 0 && hiddenGroups.has(p.Grupo)) {
                return false;
            }

            // Si es un producto hijo (no grupo, no global) y su familia NO esta expandida, y NO estamos buscando activamente un filtro de texto
            if(p.ProIdProducto !== null && p.ProIdProducto !== 0 && !expandedGroups.has(p.Grupo) && filterSearch === "") {
                return false;
            }

            return true;
        });
    }, [baseProducts, filterSearch, filterCategory, rowStateMap, expandedGroups]);

    // Obtener listado de excepciones configuradas de forma compacta
    const activeRules = useMemo(() => {
        const list = [];
        Object.keys(rowStateMap).forEach(cod => {
            const stateObj = rowStateMap[cod];
            if (stateObj && stateObj.isActive) {
                let desc = "";
                let group = "";
                let basePrice = 0;
                let moneda = "UYU";
                let typeSymbol = "📦";

                if (cod === 'TOTAL') {
                    desc = "Aplica a todo el resto (Regla Global)";
                    typeSymbol = "🌐";
                    group = "GLOBAL";
                } else if (cod.startsWith('GRUPO:')) {
                    const familyName = cod.replace('GRUPO:', '');
                    desc = `Toda la familia: ${familyName}`;
                    typeSymbol = "📁";
                    group = familyName;
                } else {
                    const prod = baseProducts.find(p => p.CodArticulo === cod);
                    if (prod) {
                        desc = prod.Descripcion;
                        basePrice = prod.Precio;
                        moneda = prod.Moneda;
                        group = prod.Grupo;
                    } else {
                        desc = `Producto ${cod}`;
                    }
                }

                list.push({
                    codArticulo: cod,
                    descripcion: desc,
                    grupo: group,
                    precioBase: basePrice,
                    moneda: moneda,
                    tipoSimbolo: typeSymbol,
                    state: stateObj
                });
            }
        });
        return list;
    }, [rowStateMap, baseProducts]);

    // Extraer Categorías Únicas para Selector (ignorar GLOBAL)
    const categoriasDropdown = ["TODAS", "ACTIVAS", ...new Set(baseProducts.filter(p => p.Grupo !== 'GLOBAL').map(p => p.Grupo).filter(Boolean))];

    // --- PRESENTACIÓN (estética nueva) ---
    const [cuantosTarifas, centinelaTarifas] = useDeAPoco(filteredClients.length, clients, filterClient, sidebarTab);
    const [cuantosBase, centinelaBase] = useDeAPoco(dbSearchResults.length, dbSearchResults, sidebarTab);
    const mostrarLista = conTabla || !selClientId || listaAbiertaCelular;

    // Acciones de una excepción (tabla en la compu, tarjeta en el celular)
    const accionesRegla = (codArticulo, state) => (
        <div className="flex items-center justify-center gap-2">
            <button
                onClick={() => {
                    setEditingRule({ codArticulo, state });
                    setIsDrawerOpen(true);
                }}
                className={`${BTN_ICONO} hover:text-brand-cyan hover:border-brand-cyan/40 hover:bg-brand-cyan/5`}
                title="Editar excepción"
            >
                <Pencil size={14} />
            </button>
            <button
                onClick={() => handleRemoveRule(codArticulo)}
                className={`${BTN_ICONO} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}
                title="Eliminar excepción"
            >
                <Trash2 size={14} />
            </button>
        </div>
    );

    // Tarifa especial de una excepción: precio en formato uruguayo + el porcentaje con su sentido
    const celdaTarifa = (tarifa, moneda) => (
        <div className="flex items-center gap-1.5 flex-wrap">
            {tarifa.precio !== null && <span className="font-mono font-bold text-zinc-900 whitespace-nowrap">{fmtPrecio(moneda, tarifa.precio)}</span>}
            {tarifa.pct !== null && <ChipPct pct={tarifa.pct} dec={tarifa.dec} />}
        </div>
    );

    // Datos de una fila del catálogo completo (mismas cuentas que antes vivían dentro del map de la tabla)
    const datosFila = (prod) => {
        const st = rowStateMap[prod.CodArticulo] || {};
        const isSelected = selectedRows.has(prod.CodArticulo);
        const isActive = st.isActive;
        const isGroupRow = prod.ProIdProducto === null && prod.CodArticulo.startsWith('GRUPO:');
        const isGlobal = prod.ProIdProducto === 0;
        const isExpanded = expandedGroups.has(prod.Grupo);
        const isHidden = hiddenGroups.has(prod.Grupo);
        return { st, isSelected, isActive, isGroupRow, isGlobal, isExpanded, isHidden };
    };

    // Casilla de "todas" (encabezado de la tabla o arriba de las tarjetas)
    const chkTodos = () => (
        <input
            type="checkbox"
            className="w-4 h-4 accent-[#006E97] cursor-pointer align-middle"
            aria-label="Elegir todas las filas visibles"
            onChange={() => toggleSelectAll(visibleProducts)}
            checked={selectedRows.size > 0 && selectedRows.size >= visibleProducts.length && visibleProducts.length > 0}
        />
    );

    const chkGrupo = (prod, { isSelected, isHidden }) => (
        <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleRowSelect(prod.CodArticulo)}
            className="w-4 h-4 accent-[#006E97] cursor-pointer align-middle disabled:cursor-not-allowed"
            disabled={isHidden}
        />
    );

    const chkProducto = (prod, { isSelected }) => (
        <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleRowSelect(prod.CodArticulo)}
            className="w-4 h-4 accent-[#006E97] cursor-pointer align-middle"
        />
    );

    // Cabeza de una familia del árbol: ojo (ocultar/mostrar), +/- (abrir/cerrar), nombre, regla de la familia y su %
    const cabezaGrupo = (prod, { st, isActive, isExpanded, isHidden }) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 w-full cursor-pointer select-none" onClick={() => { if(!isHidden) toggleGroupNode(prod.Grupo); }}>
            {/* OJO TOGGLE */}
            <button
                onClick={(e) => { e.stopPropagation(); toggleHideGroupNode(prod.Grupo); }}
                className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors shrink-0 ${isHidden ? 'bg-zinc-200 border-zinc-200 text-zinc-500 hover:bg-zinc-300' : 'bg-white border-zinc-200 text-zinc-400 hover:text-brand-magenta hover:border-brand-magenta/30'}`}
                title={isHidden ? "Mostrar esta familia" : "Ocultar esta familia e ignorarla"}
            >
                {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>

            <button disabled={isHidden} className={`w-6 h-6 flex items-center justify-center bg-white border border-zinc-200 rounded-md text-zinc-500 shrink-0 ${!isHidden ? 'hover:text-brand-cyan hover:border-brand-cyan/40 transition-colors' : ''}`}>
                {isExpanded && !isHidden ? <Minus size={13} /> : <Plus size={13} />}
            </button>
            {isExpanded && !isHidden ? <FolderOpen size={18} className="text-brand-cyan shrink-0" /> : <Folder size={18} className="text-zinc-400 shrink-0" />}
            <span className={`font-black tracking-wide min-w-0 break-words ${isHidden ? 'text-zinc-500 line-through' : 'text-zinc-800'}`}>
                {prod.Descripcion.toUpperCase()}
            </span>

            {/* Si el Grupo en sí tiene un % de descuento guardado (Regla a nivel raíz de familia) */}
            {isActive && !isHidden && (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <span className={`${CHIP} ${CHIP_CIAN}`}>Regla de toda la familia</span>
                    <ChipPct pct={st.discStr} />
                    <button
                        onClick={() => handleRemoveRule(prod.CodArticulo)}
                        className={BTN_ICONO_CHICO}
                        title="Eliminar regla de familia"
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            )}

            {/* Inputs rápidos en la misma fila del grupo para descuento global de familia */}
            {!isHidden && (
                <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest whitespace-nowrap">Tarifa familia</span>
                    <div className="relative w-28">
                        <input
                            type="number" step="0.01"
                            value={st.discStr}
                            onChange={e => handleDiscStrChange(prod.CodArticulo, e.target.value)}
                            className={`${CAMPO_TABLA} ${BORDE_NORMAL} pl-3 pr-7 font-bold`}
                            placeholder="0"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-black pointer-events-none">%</span>
                    </div>
                </div>
            )}
        </div>
    );

    // Nombre, código y "Activa" de un producto (o de la regla global)
    const celdaProducto = (prod, { isActive, isGlobal }) => (
        <div className="flex items-center gap-2 min-w-0">
            {!isGlobal && <div className="w-4 h-4 border-b border-l border-zinc-300 ml-1 mr-1 rounded-bl shrink-0"></div>}
            <div className="min-w-0">
                <div className={`font-bold break-words ${isGlobal ? 'text-brand-cyan flex items-center gap-2' : 'text-zinc-800'}`}>
                    {isGlobal && <Globe size={16} className="shrink-0" />}
                    {prod.Descripcion}
                </div>
                <div className="flex gap-2 items-center mt-1 flex-wrap">
                    <span className="font-mono text-[11px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">{prod.CodArticulo}</span>
                    {isActive && (
                        <div className="flex items-center gap-1.5">
                            <span className={`${CHIP} ${CHIP_CIAN}`}>Activa</span>
                            <button
                                onClick={() => handleRemoveRule(prod.CodArticulo)}
                                className={BTN_ICONO_CHICO}
                                title="Eliminar regla"
                            >
                                <Trash2 size={13} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const precioBaseFila = (prod) => (prod.Precio > 0 ? fmtPrecio(prod.Moneda, prod.Precio) : '—');

    // Los tres campos de un producto: precio fijo, descuento en % y descuento por importe (borde cian = el tipo activo)
    const inputPrecio = (prod, { st, isActive, isGlobal }) => (
        <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold pointer-events-none">{simboloMoneda(prod.Moneda)}</span>
            <input
                type="number"
                step="0.01"
                value={st.customStr}
                onChange={e => handlePriceStrChange(prod.CodArticulo, e.target.value)}
                className={`${CAMPO_TABLA} pl-10 pr-2 ${isActive && st.tipoRegla === 'fixed' ? BORDE_ACTIVO : BORDE_NORMAL}`}
                placeholder="Base"
                disabled={isGlobal}
            />
        </div>
    );

    const inputPct = (prod, { st, isActive }) => (
        <div className="relative">
            <input
                type="number"
                step="0.01"
                value={st.discStr}
                onChange={e => handleDiscStrChange(prod.CodArticulo, e.target.value)}
                className={`${CAMPO_TABLA} pl-2.5 pr-7 ${isActive && st.tipoRegla === 'percentage' ? BORDE_ACTIVO : BORDE_NORMAL}`}
                placeholder="0"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold pointer-events-none">%</span>
        </div>
    );

    const inputImporte = (prod, { st, isActive }) => (
        <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold pointer-events-none">{simboloMoneda(prod.Moneda)}</span>
            <input
                type="number"
                step="0.01"
                value={st.amtStr || ''}
                onChange={e => handleAmtStrChange(prod.CodArticulo, e.target.value)}
                className={`${CAMPO_TABLA} pl-10 pr-2 ${isActive && st.tipoRegla === 'subtract' ? BORDE_ACTIVO : BORDE_NORMAL}`}
                placeholder="0"
                title="Descuento por importe fijo por unidad"
            />
        </div>
    );

    // Datos de contacto de un cliente en la tarjeta de la lista (igual que en Caja)
    const datosCliente = (c) => (
        (c.IDCliente || c.CioRuc || c.Email || c.TelefonoTrabajo || c.DireccionTrabajo) ? (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] border-t border-zinc-100 pt-2 mt-2.5">
                {c.IDCliente && <><span className="text-zinc-400">IdCliente</span><span className="font-mono font-bold text-zinc-700 truncate">{c.IDCliente}</span></>}
                {c.CioRuc && <><span className="text-zinc-400">RUC / CI</span><span className="font-mono font-bold text-zinc-700 truncate">{c.CioRuc}</span></>}
                {c.Email && <><span className="text-zinc-400">Email</span><span className="font-mono text-zinc-600 truncate">{c.Email}</span></>}
                {c.TelefonoTrabajo && <><span className="text-zinc-400">Teléfono</span><span className="font-mono text-zinc-600 truncate">{c.TelefonoTrabajo}</span></>}
                {c.DireccionTrabajo && <><span className="text-zinc-400">Dirección</span><span className="text-zinc-600 truncate">{c.DireccionTrabajo}</span></>}
            </div>
        ) : null
    );

    // Aviso de "faltan más" al pie de una lista de a 50
    const pieDeAPoco = (ref, cuantos, total) => (
        <div ref={ref} className="flex items-center justify-center gap-2 py-3 text-xs text-zinc-400">
            <Loader2 size={14} className="animate-spin text-brand-cyan" /> Mostrando {cuantos.toLocaleString('es-UY')} de {total.toLocaleString('es-UY')}…
        </div>
    );

    return (
        <div className={embebido ? 'text-zinc-700 text-sm flex flex-col gap-4' : 'px-3 sm:px-6 py-5 min-h-full text-zinc-700 text-sm flex flex-col gap-4'}>
            <style>{`
                @keyframes highlight-fade {
                    0% { background-color: rgba(0, 110, 151, 0.18); }
                    100% { background-color: transparent; }
                }
                .animate-highlight {
                    animation: highlight-fade 2s ease-out;
                }
            `}</style>

            <NewRuleDrawer
                isOpen={isDrawerOpen}
                onClose={() => { setIsDrawerOpen(false); setEditingRule(null); }}
                baseProducts={baseProducts}
                onAddRule={handleAddRuleFromDrawer}
                onRemoveRule={handleRemoveRule}
                editingRule={editingRule}
                rowStateMap={rowStateMap}
            />

            <ProfileSelectionModal
                isOpen={isProfileModalOpen}
                onClose={() => setIsProfileModalOpen(false)}
                allProfiles={allProfiles}
                selectedProfileIds={selectedProfileIds}
                onApply={handleApplyProfiles}
            />

            {ventanaConfirmar}

            {/* ENCABEZADO (embebido en el Panel 360 no va: lo pone esa pantalla) */}
            {!embebido && (
                <div className="flex flex-wrap items-center gap-3">
                    <BadgePercent size={30} className="text-brand-cyan shrink-0" />
                    <div className="min-w-[220px] flex-1">
                        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Precios especiales</h1>
                        <p className="text-sm text-zinc-500 mt-1">Tarifas por cliente: excepciones por producto o familia, perfiles asignados y urgencia.</p>
                    </div>
                </div>
            )}

            <div className={embebido ? 'flex flex-col gap-4' : 'flex flex-col lg:flex-row lg:items-start gap-4'}>
                {/* LISTA DE CLIENTES (no se muestra embebido en el Panel 360: el cliente ya está elegido). En la compu va
                    al costado y queda fija al bajar; en el celular va arriba y se pliega al elegir un cliente. */}
                {!embebido && (mostrarLista ? (
                    <div className={`${CARD} w-full lg:w-80 shrink-0 flex flex-col overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-12.5rem)]`}>
                        <div className="p-3 border-b border-zinc-100 flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className={`${ROTULO} inline-flex items-center gap-1.5`}>
                                    <Users size={14} className="text-brand-cyan" /> Clientes
                                </span>
                                {!conTabla && selClientId && (
                                    <button type="button" onClick={() => setListaAbiertaCelular(false)} className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-800">
                                        Ocultar lista <ChevronUp size={14} />
                                    </button>
                                )}
                            </div>

                            {/* Pestañas */}
                            <div className="grid grid-cols-2 rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSidebarTab('tarifas');
                                        if (dbSearchTerm) setFilterClient(dbSearchTerm);
                                    }}
                                    className={`${PESTANA} flex flex-col items-center justify-center ${sidebarTab === 'tarifas' ? PESTANA_SI : PESTANA_NO}`}
                                >
                                    <span>Con tarifas</span>
                                    <span className="text-[10px] opacity-75 font-medium">{clients.length} clientes</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSidebarTab('db');
                                        if (filterClient) setDbSearchTerm(filterClient);
                                    }}
                                    className={`${PESTANA} flex flex-col items-center justify-center ${sidebarTab === 'db' ? PESTANA_SI : PESTANA_NO}`}
                                >
                                    <span>Buscar en la base</span>
                                    <span className="text-[10px] opacity-75 font-medium">Base completa</span>
                                </button>
                            </div>

                            {/* Buscador */}
                            {sidebarTab === 'tarifas' ? (
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                    <input
                                        className={CAMPO}
                                        placeholder="Buscar por nombre o ID..."
                                        value={filterClient}
                                        onChange={e => setFilterClient(e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                    <input
                                        className={CAMPO_CON_X}
                                        placeholder="Buscar por nombre o ID..."
                                        value={dbSearchTerm}
                                        onChange={e => setDbSearchTerm(e.target.value)}
                                        autoFocus
                                    />
                                    {loadingDbSearch && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-cyan" />}
                                </div>
                            )}
                        </div>

                        {/* Lista */}
                        <div className="p-3 space-y-2 lg:flex-1 lg:min-h-0 lg:overflow-y-auto custom-scrollbar">
                            {sidebarTab === 'tarifas' ? (
                                loading ? (
                                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400"><Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando...</div>
                                ) : filteredClients.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center text-center py-6 px-2">
                                        <SearchX size={40} className="mb-3 text-brand-cyan" />
                                        <span className="text-sm font-bold text-zinc-700">No se encontraron clientes con tarifas.</span>
                                        <button
                                            onClick={() => {
                                                setSidebarTab('db');
                                                setDbSearchTerm(filterClient);
                                            }}
                                            className={`${BTN_SECUNDARIO} w-full mt-4`}
                                        >
                                            <Database size={15} className="text-brand-cyan" /> Buscar «{filterClient}» en la base
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {filteredClients.slice(0, cuantosTarifas).map(c => {
                                            const isSelected = selClientId === c.ClienteID;
                                            const displayName = c.Nombre || c.NombreFantasia || `Cliente ${c.ClienteID}`;
                                            const words = displayName.split(' ').filter(Boolean);
                                            let initials = words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : displayName.substring(0, 2).toUpperCase();

                                            return (
                                                <div
                                                    key={c.ClienteID}
                                                    data-tarjeta-cliente
                                                    onClick={() => setSelClientId(c.ClienteID)}
                                                    className={`rounded-xl p-3 cursor-pointer transition-colors border ${isSelected ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan/30' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${isSelected ? 'bg-brand-cyan text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                                                            {initials}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-zinc-800 text-sm truncate" title={displayName}>{displayName}</div>
                                                            <div className="text-[11px] font-mono text-zinc-400 mt-0.5" title="ID del cliente">ID: {c.ClienteID}</div>
                                                        </div>
                                                        {c.CantReglas > 0 && (
                                                            <span className={`${CHIP} ${CHIP_CIAN}`}>
                                                                {c.CantReglas} {c.CantReglas === 1 ? 'regla' : 'reglas'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {datosCliente(c)}
                                                </div>
                                            );
                                        })}
                                        {cuantosTarifas < filteredClients.length && pieDeAPoco(centinelaTarifas, cuantosTarifas, filteredClients.length)}
                                    </>
                                )
                            ) : (
                                // Resultados de la búsqueda en la base
                                loadingDbSearch ? (
                                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400"><Loader2 size={18} className="animate-spin text-brand-cyan" /> Buscando en la base...</div>
                                ) : dbSearchResults.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center text-center py-6 px-2">
                                        <Search size={40} className="mb-3 text-brand-cyan" />
                                        <span className="text-sm font-bold text-zinc-700">
                                            {dbSearchTerm.length < 2 ? 'Escribí al menos 2 letras para buscar...' : 'No se encontraron clientes en la base de datos.'}
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        {dbSearchResults.slice(0, cuantosBase).map(c => {
                                            const displayName = c.Nombre || c.NombreFantasia || `Cliente ${c.CodCliente}`;
                                            const words = displayName.split(' ').filter(Boolean);
                                            let initials = words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : displayName.substring(0, 2).toUpperCase();

                                            return (
                                                <div
                                                    key={c.CodCliente}
                                                    data-tarjeta-cliente
                                                    onClick={() => {
                                                        handleCreateClient(c.CodCliente, displayName);
                                                        setSidebarTab('tarifas');
                                                        setFilterClient(displayName);
                                                        setDbSearchTerm('');
                                                        setDbSearchResults([]);
                                                    }}
                                                    className="group rounded-xl p-3 cursor-pointer transition-colors border bg-white border-zinc-200 hover:border-brand-cyan/50 hover:bg-brand-cyan/5"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 bg-zinc-100 text-zinc-600">
                                                            {initials}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-zinc-800 text-sm truncate" title={displayName}>{displayName}</div>
                                                            <div className="text-[11px] font-mono text-zinc-400 mt-0.5" title="ID del cliente">ID: {c.CodCliente}</div>
                                                        </div>
                                                        <span className={`${CHIP} ${CHIP_CIAN} lg:opacity-0 lg:group-hover:opacity-100 transition-opacity`}>
                                                            <Plus size={11} /> Agregar
                                                        </span>
                                                    </div>
                                                    {datosCliente(c)}
                                                </div>
                                            );
                                        })}
                                        {cuantosBase < dbSearchResults.length && pieDeAPoco(centinelaBase, cuantosBase, dbSearchResults.length)}
                                    </>
                                )
                            )}
                        </div>
                    </div>
                ) : (
                    // Celular con un cliente elegido: la lista plegada
                    <button type="button" onClick={() => setListaAbiertaCelular(true)} className={`${CARD} w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-50 transition-colors`}>
                        <Users size={18} className="text-brand-cyan shrink-0" />
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold text-zinc-800">Cambiar de cliente</span>
                            <span className="block text-xs text-zinc-400">{clients.length} clientes con tarifa · buscar en la base</span>
                        </span>
                        <ChevronDown size={18} className="text-zinc-400 shrink-0" />
                    </button>
                ))}

                {/* DETALLE DEL CLIENTE */}
                <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
                    {selClientId ? (
                        <>
                            {/* FICHA DEL CLIENTE */}
                            <div className={`${CARD} p-4 sm:p-5 flex flex-col gap-4`}>
                                <div className="flex flex-wrap items-start gap-3">
                                    <div className="min-w-[220px] flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h2 className="text-lg sm:text-xl font-black text-zinc-900 tracking-tight leading-tight">
                                                {clientData.client?.Nombre || clientData.client?.NombreCliente || `Cliente ID: ${selClientId}`}
                                            </h2>
                                            {clientData.client?.IDCliente && (
                                                <span className={`${CHIP} ${CHIP_ZINC} font-mono normal-case`}>
                                                    IdCliente: {clientData.client.IDCliente}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto sm:ml-auto">
                                        <button
                                            onClick={() => setIsProfileModalOpen(true)}
                                            className={`${BTN_SECUNDARIO} ${BTN_FICHA}`}
                                        >
                                            <UserCog size={15} className="text-brand-cyan shrink-0" />
                                            <span className="sm:hidden">Perfiles</span><span className="hidden sm:inline">Gestionar perfiles</span>
                                        </button>
                                        <button
                                            onClick={() => setIsDrawerOpen(true)}
                                            className={`${BTN_SECUNDARIO} ${BTN_FICHA}`}
                                        >
                                            <PlusCircle size={15} className="text-brand-cyan shrink-0" /> Nueva excepción
                                        </button>
                                        <button onClick={handleDeleteClient} className={`${BTN_PELIGRO} ${BTN_FICHA}`} title="Eliminar este cliente y todas sus reglas de la lista de precios especiales">
                                            <Trash2 size={15} className="shrink-0" /> Quitar cliente
                                        </button>
                                        <button onClick={handleSaveRules} className={`${BTN_PRINCIPAL} ${BTN_FICHA}`}>
                                            <Save size={15} className="shrink-0" /> Guardar tarifa
                                        </button>
                                    </div>
                                </div>

                                {/* Datos del cliente */}
                                {(clientData.client?.CioRuc || clientData.client?.Email || clientData.client?.TelefonoTrabajo || clientData.client?.DireccionTrabajo) && (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                                        {clientData.client.CioRuc && (
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>RUC / CI</span>
                                                <span className="font-mono font-bold text-zinc-800 truncate block">{clientData.client.CioRuc}</span>
                                            </div>
                                        )}
                                        {clientData.client.Email && (
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>Email</span>
                                                <span className="font-mono text-zinc-700 truncate block" title={clientData.client.Email}>{clientData.client.Email}</span>
                                            </div>
                                        )}
                                        {clientData.client.TelefonoTrabajo && (
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>Teléfono</span>
                                                <span className="font-mono text-zinc-700 truncate block">{clientData.client.TelefonoTrabajo}</span>
                                            </div>
                                        )}
                                        {clientData.client.DireccionTrabajo && (
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>Dirección</span>
                                                <span className="text-zinc-700 truncate block" title={clientData.client.DireccionTrabajo}>{clientData.client.DireccionTrabajo}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Estado: excepciones, perfiles, urgencia y cambios sin guardar */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-zinc-500 text-sm mr-1">Mostrando todas las familias y productos.</span>
                                    <span className={`${CHIP} ${CHIP_CIAN}`}>
                                        {activeRulesCount} excepciones cargadas
                                    </span>

                                    {clientData.profiles && clientData.profiles.map((p, idx) => {
                                        const name = p.NombrePerfil || '';
                                        const nameLower = name.toLowerCase();

                                        // Ícono según el perfil (antes, además, un color por tipo: ahora todos en cian)
                                        let Icono = Tag;
                                        if (nameLower.includes("trabajador") || nameLower.includes("funcionario") || nameLower.includes("empleado")) {
                                            Icono = Briefcase;
                                        } else if (nameLower.includes("estudiante") || nameLower.includes("alumno") || nameLower.includes("escolar") || nameLower.includes("colegio")) {
                                            Icono = GraduationCap;
                                        } else if (nameLower.includes("mayorista") || nameLower.includes("distribuidor")) {
                                            Icono = Store;
                                        } else if (nameLower.includes("jubilado") || nameLower.includes("pensionista") || nameLower.includes("pasivo")) {
                                            Icono = PersonStanding;
                                        }

                                        return (
                                            <span
                                                key={idx}
                                                className={`${CHIP} ${CHIP_CIAN}`}
                                                title={`Perfil de precio general asignado: ${name}`}
                                            >
                                                <Icono size={12} />
                                                {name}
                                            </span>
                                        );
                                    })}

                                    {/* Excepciones de urgencia (ámbar si el cliente tiene alguna) */}
                                    {(() => {
                                        const hasTotal = urgExcForClient.some(e => e.ProIdProducto === null && e.CodArea === null);
                                        const hasPartial = urgExcForClient.filter(e => e.ProIdProducto !== null || e.CodArea !== null);
                                        if (urgExcForClient.length === 0) return (
                                            <button
                                                onClick={() => setUrgExcPanelOpen(p => !p)}
                                                className={`${CHIP} ${CHIP_ZINC} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5 transition-colors`}
                                                title="Configurar excepciones de urgencia para este cliente"
                                            >
                                                <Ban size={11} /> Sin exc. urgencia
                                            </button>
                                        );
                                        return (
                                            <button
                                                onClick={() => setUrgExcPanelOpen(p => !p)}
                                                className={`${CHIP} ${CHIP_AMBAR} hover:bg-amber-100 transition-colors`}
                                                title="Ver excepciones de urgencia activas"
                                            >
                                                <Ban size={11} />
                                                {hasTotal ? 'Exento de urgencia (todo)' : `Sin urgencia (${hasPartial.length} servicio${hasPartial.length !== 1 ? 's' : ''})`}
                                            </button>
                                        );
                                    })()}

                                    {isDirtyMap && (
                                        <span className="inline-flex items-center gap-1.5 text-amber-700 font-bold text-xs">
                                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> Cambios sin guardar
                                        </span>
                                    )}
                                </div>

                                {/* PANEL EXCEPCIONES URGENCIA */}
                                {urgExcPanelOpen && (
                                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <h4 className="font-black text-zinc-800 text-sm flex items-center gap-2">
                                                <Ban size={16} className="text-brand-cyan" /> Excepciones de urgencia
                                            </h4>
                                            <button onClick={() => setUrgExcPanelOpen(false)} title="Cerrar" aria-label="Cerrar" className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
                                                <X size={15} />
                                            </button>
                                        </div>
                                        <p className="text-xs text-zinc-500 mb-3">
                                            Tildá los servicios que <strong className="text-zinc-700">NO cobrarán urgencia</strong> a este cliente. Solo aparecen los que tienen urgencia activa en el sistema.
                                        </p>

                                        {urgExcAreas.length === 0 ? (
                                            <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 py-4"><Loader2 size={14} className="animate-spin text-brand-cyan" /> Cargando servicios...</div>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                                                {urgExcAreas.map(area => {
                                                    const excTotal = urgExcForClient.find(e => e.ProIdProducto === null && e.CodArea === null);
                                                    const excArea  = urgExcForClient.find(e => e.CodArea === area.CodArea);
                                                    const isExento = !!(excTotal || excArea);

                                                    return (
                                                        <button
                                                            key={area.CodArea}
                                                            onClick={() => {
                                                                if (excTotal) return;
                                                                if (isExento && excArea) handleDeleteUrgExc(excArea.ID);
                                                                else if (!isExento) handleAddUrgExcArea(area);
                                                            }}
                                                            disabled={!!excTotal}
                                                            title={excTotal ? 'Exento por regla global' : isExento ? 'Clic para volver a cobrar urgencia' : 'Clic para eximir urgencia'}
                                                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors text-sm font-medium
                                                                ${excTotal
                                                                    ? 'bg-amber-50 border-amber-200 text-amber-700 opacity-70 cursor-default'
                                                                    : isExento
                                                                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                                                                        : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'
                                                                }`}
                                                        >
                                                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                                                                ${isExento ? 'bg-amber-500 border-amber-500 text-white' : 'border-zinc-300 bg-white'}`}>
                                                                {isExento && <Check size={11} strokeWidth={3} />}
                                                            </span>
                                                            <span className="truncate">{area.AreaNombre || area.CodArea}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="mt-3 pt-3 border-t border-zinc-200 flex flex-wrap items-center gap-2 sm:gap-3">
                                            {(() => {
                                                const excTotal = urgExcForClient.find(e => e.ProIdProducto === null && e.CodArea === null);
                                                return excTotal ? (
                                                    <>
                                                        <span className={`${CHIP} ${CHIP_AMBAR}`}>
                                                            <Asterisk size={11} /> Exento en todo
                                                        </span>
                                                        <span className="text-xs text-zinc-500 flex-1 min-w-[160px]">No se cobra urgencia en ningún servicio.</span>
                                                        <button onClick={() => handleDeleteUrgExc(excTotal.ID)}
                                                            className={`${BTN_PELIGRO} text-xs px-2.5 py-1.5`}>
                                                            <X size={13} /> Quitar
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="text-xs text-zinc-500 flex-1 min-w-[160px]">¿Eximir de urgencia en <strong className="text-zinc-700">todos</strong> los servicios?</span>
                                                        <button onClick={() => handleAddUrgExcArea(null)}
                                                            className={`${BTN_SECUNDARIO} text-xs px-2.5 py-1.5`}>
                                                            <Ban size={13} className="text-brand-cyan" /> Eximir todo
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* REGLAS / CATÁLOGO */}
                            <div className={`${CARD} overflow-hidden`}>
                                {/* Barra: vista, familia, búsqueda y descuento masivo */}
                                <div className="p-3 border-b border-zinc-200 flex flex-col xl:flex-row xl:items-center gap-3">
                                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                                        {/* Vista Selector Toggle */}
                                        <button
                                            onClick={() => setShowAllProducts(prev => !prev)}
                                            className={`${!showAllProducts ? BTN_SECUNDARIO : BTN_ELEGIDO} h-[42px]`}
                                        >
                                            {!showAllProducts ? <LayoutGrid size={15} className="text-brand-cyan" /> : <ListChecks size={15} />}
                                            {!showAllProducts ? 'Ver catálogo completo' : 'Ver reglas asignadas'}
                                        </button>

                                        {showAllProducts && (
                                            <>
                                                <Selector
                                                    value={filterCategory}
                                                    onChange={(e)=>setFilterCategory(e.target.value)}
                                                    className="sm:w-72"
                                                    anchoLista={320}
                                                    aria-label="Familia"
                                                >
                                                    {categoriasDropdown.map(cat => {
                                                        if (cat === "TODAS" || cat === "ACTIVAS") {
                                                            return <option key={cat} value={cat}>{cat === "ACTIVAS" ? "Solo los que tienen regla" : `Familia: ${cat}`}</option>;
                                                        }
                                                        const groupProd = baseProducts.find(p => p.CodArticulo === `GRUPO:${cat}`);
                                                        const desc = groupProd ? groupProd.Descripcion : cat;
                                                        return <option key={cat} value={cat}>Familia: {desc}</option>;
                                                    })}
                                                </Selector>

                                                <div className="relative w-full sm:w-64">
                                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                                    <input
                                                        className={CAMPO}
                                                        placeholder="Buscar producto o código..."
                                                        value={filterSearch}
                                                        onChange={e => setFilterSearch(e.target.value)}
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* BULK ACCION MASIVA */}
                                    {showAllProducts && (
                                        <div className="flex flex-wrap items-center gap-2 xl:pl-3 xl:border-l xl:border-zinc-200">
                                            <span className="text-zinc-600 font-bold text-xs whitespace-nowrap">Masivo ({selectedRows.size}):</span>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={bulkDiscountPct}
                                                    onChange={e => setBulkDiscountPct(e.target.value)}
                                                    placeholder="10"
                                                    aria-label="Descuento masivo (%)"
                                                    className={`${CAMPO_NUM} w-24 pl-3 pr-8`}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold text-sm pointer-events-none">%</span>
                                            </div>
                                            <button
                                                onClick={applyBulkDiscount}
                                                className={`${BTN_PRINCIPAL} h-[42px]`}
                                            >
                                                <Zap size={15} /> Aplicar
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* DATOS */}
                                {loadingRules ? (
                                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400"><Loader2 size={20} className="animate-spin text-brand-cyan" /> Cargando reglas...</div>
                                ) : !showAllProducts ? (
                                    activeRules.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center text-center px-6 py-14 animate-in fade-in duration-300">
                                            <ListChecks size={40} className="mb-3 text-brand-cyan" />
                                            <span className="text-sm font-bold text-zinc-700">Sin excepciones de precios</span>
                                            <span className="text-xs text-zinc-400 mt-1 max-w-xs">Este cliente está operando con la tarifa base del sistema. Empezá asignando su primera excepción.</span>
                                            <div className="flex flex-wrap justify-center gap-2 mt-5">
                                                <button
                                                    onClick={() => setIsDrawerOpen(true)}
                                                    className={BTN_PRINCIPAL}
                                                >
                                                    <PlusCircle size={15} /> Nueva excepción
                                                </button>
                                                <button
                                                    onClick={() => setShowAllProducts(true)}
                                                    className={BTN_SECUNDARIO}
                                                >
                                                    <LayoutGrid size={15} className="text-brand-cyan" /> Ver catálogo completo
                                                </button>
                                            </div>
                                        </div>
                                    ) : conTabla ? (
                                        <div className="overflow-x-auto animate-in fade-in duration-300">
                                            <table className="w-full text-left">
                                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                                    <tr>
                                                        <th className={`${TH} w-16 text-center`}>Tipo</th>
                                                        <th className={`${TH} text-left`}>Excepción / referencia</th>
                                                        <th className={`${TH} w-40 text-right`}>Precio base</th>
                                                        <th className={`${TH} w-64 text-left`}>Tarifa especial</th>
                                                        <th className={`${TH} w-28 text-center`}>Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100">
                                                    {activeRules.map(rule => {
                                                        const { codArticulo, descripcion, tipoSimbolo, precioBase, moneda, state } = rule;
                                                        const tarifa = tarifaDeRegla(precioBase, moneda, state);
                                                        const tipo = tipoDeRegla(codArticulo);

                                                        return (
                                                            <tr key={codArticulo} className="hover:bg-zinc-50 transition-colors">
                                                                <td className="px-4 py-3 text-center" title={tipo.texto}>
                                                                    <tipo.Icono size={18} className="text-brand-cyan inline-block" />
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="font-bold text-zinc-800">{descripcion}</div>
                                                                    <div className="text-[11px] font-mono text-zinc-400 mt-0.5">Ref: {codArticulo}</div>
                                                                </td>
                                                                <td className="px-4 py-3 font-mono text-zinc-500 text-right whitespace-nowrap">
                                                                    {precioBase > 0 ? fmtPrecio(moneda, precioBase) : '—'}
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    {celdaTarifa(tarifa, moneda)}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    {accionesRegla(codArticulo, state)}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        // Celular: una tarjeta por excepción
                                        <div className="divide-y divide-zinc-100 animate-in fade-in duration-300">
                                            {activeRules.map(rule => {
                                                const { codArticulo, descripcion, tipoSimbolo, precioBase, moneda, state } = rule;
                                                const tarifa = tarifaDeRegla(precioBase, moneda, state);
                                                const tipo = tipoDeRegla(codArticulo);

                                                return (
                                                    <div key={codArticulo} className="p-4 flex flex-col gap-3">
                                                        <div className="flex items-start gap-3">
                                                            <span className="mt-0.5 shrink-0" title={tipo.texto}><tipo.Icono size={18} className="text-brand-cyan" /></span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-bold text-zinc-800 break-words">{descripcion}</div>
                                                                <div className="text-[11px] font-mono text-zinc-400 mt-0.5">Ref: {codArticulo}</div>
                                                            </div>
                                                            <div className="shrink-0">{accionesRegla(codArticulo, state)}</div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-3 bg-zinc-50 rounded-xl px-3 py-2.5">
                                                            <div className="min-w-0">
                                                                <span className={ETIQUETA}>Precio base</span>
                                                                <span className="font-mono text-zinc-600">{precioBase > 0 ? fmtPrecio(moneda, precioBase) : '—'}</span>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <span className={ETIQUETA}>Tarifa especial</span>
                                                                {celdaTarifa(tarifa, moneda)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )
                                ) : conTabla ? (
                                    <div className="overflow-x-auto animate-in fade-in duration-300">
                                        <table className="w-full text-left">
                                            <thead className="bg-zinc-50 border-b border-zinc-200">
                                                <tr>
                                                    <th className={`${TH} w-12 text-center`}>{chkTodos()}</th>
                                                    <th className={`${TH} text-left`}>Producto / código</th>
                                                    <th className={`${TH} w-36 text-right`}>Precio base</th>
                                                    <th className={`${TH} w-40 text-left`}>Nuevo precio</th>
                                                    <th className={`${TH} w-32 text-left`}>Desc. (%)</th>
                                                    <th className={`${TH} w-36 text-left`} title="Descuento por importe fijo por unidad (bonificación en $). Excluyente con el % y con el precio fijo.">Desc. ($)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100">
                                                {visibleProducts.map(prod => {
                                                    const d = datosFila(prod);

                                                    // Fila del Grupo (Arbolito)
                                                    if (d.isGroupRow) {
                                                        return (
                                                            <tr
                                                                key={prod.CodArticulo}
                                                                id={`row-${prod.CodArticulo}`}
                                                                className={`border-t-2 border-zinc-200 transition-colors ${d.isHidden ? 'bg-zinc-50 opacity-60' : d.isActive ? 'bg-brand-cyan/5' : 'bg-zinc-100/70'}`}
                                                            >
                                                                <td className="px-3 py-2.5 text-center">{chkGrupo(prod, d)}</td>
                                                                <td colSpan="5" className="px-3 py-2.5">{cabezaGrupo(prod, d)}</td>
                                                            </tr>
                                                        );
                                                    }

                                                    // Filas normales (Productos) o Regla Total
                                                    return (
                                                        <tr
                                                            key={prod.CodArticulo}
                                                            id={`row-${prod.CodArticulo}`}
                                                            className={`hover:bg-zinc-50 transition-colors ${d.isSelected ? 'bg-brand-cyan/5' : d.isActive ? 'bg-brand-cyan/[0.03]' : ''}`}
                                                        >
                                                            <td className="px-3 py-2.5 text-center">{chkProducto(prod, d)}</td>
                                                            <td className="px-3 py-2.5">{celdaProducto(prod, d)}</td>
                                                            <td className="px-3 py-2.5 font-mono text-zinc-500 text-right whitespace-nowrap">{precioBaseFila(prod)}</td>
                                                            <td className="px-2 py-2">{inputPrecio(prod, d)}</td>
                                                            <td className="px-2 py-2">{inputPct(prod, d)}</td>
                                                            <td className="px-2 py-2">{inputImporte(prod, d)}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    // Celular: el catálogo en tarjetas (familias como cabeza, productos con sus tres campos)
                                    <div className="animate-in fade-in duration-300">
                                        {visibleProducts.length > 0 && (
                                            <label className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 border-b border-zinc-200 text-xs font-bold text-zinc-500 cursor-pointer">
                                                {chkTodos()} Elegir todas las filas visibles
                                            </label>
                                        )}
                                        <div className="divide-y divide-zinc-100">
                                            {visibleProducts.map(prod => {
                                                const d = datosFila(prod);

                                                if (d.isGroupRow) {
                                                    return (
                                                        <div
                                                            key={prod.CodArticulo}
                                                            id={`row-${prod.CodArticulo}`}
                                                            className={`px-3 py-3 flex items-start gap-3 border-t-2 border-zinc-200 ${d.isHidden ? 'bg-zinc-50 opacity-60' : d.isActive ? 'bg-brand-cyan/5' : 'bg-zinc-100/70'}`}
                                                        >
                                                            <div className="pt-1.5">{chkGrupo(prod, d)}</div>
                                                            <div className="min-w-0 flex-1">{cabezaGrupo(prod, d)}</div>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div
                                                        key={prod.CodArticulo}
                                                        id={`row-${prod.CodArticulo}`}
                                                        className={`px-3 py-3 flex flex-col gap-3 ${d.isSelected ? 'bg-brand-cyan/5' : d.isActive ? 'bg-brand-cyan/[0.03]' : ''}`}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <div className="pt-1">{chkProducto(prod, d)}</div>
                                                            <div className="min-w-0 flex-1">{celdaProducto(prod, d)}</div>
                                                            <div className="text-right shrink-0">
                                                                <span className={ETIQUETA}>Base</span>
                                                                <span className="font-mono text-xs text-zinc-600 whitespace-nowrap">{precioBaseFila(prod)}</span>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-3 gap-2">
                                                            <div className="min-w-0"><span className={ETIQUETA}>Precio</span>{inputPrecio(prod, d)}</div>
                                                            <div className="min-w-0"><span className={ETIQUETA}>Desc. %</span>{inputPct(prod, d)}</div>
                                                            <div className="min-w-0"><span className={ETIQUETA}>Desc. $</span>{inputImporte(prod, d)}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {showAllProducts && visibleProducts.length === 0 && !loadingRules && (
                                    <div className="flex flex-col items-center justify-center text-center py-12 animate-in fade-in duration-200">
                                        <PackageOpen size={40} className="mb-3 text-brand-cyan" />
                                        <span className="text-sm font-bold text-zinc-700">No se encontraron productos con los filtros actuales.</span>
                                        <span className="text-xs text-zinc-400 mt-1">Probá con otra familia u otra búsqueda.</span>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (conTabla || embebido) && (
                        <div className={`${CARD} flex flex-col items-center justify-center text-center px-6 py-20`}>
                            <Tags size={40} className="mb-3 text-brand-cyan" />
                            <span className="text-sm font-bold text-zinc-700">Elegí un cliente</span>
                            <span className="text-xs text-zinc-400 mt-1 max-w-sm">
                                Elegilo de la lista o buscalo en la base para empezar a personalizar su tabla de tarifas y descuentos.
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SpecialPrices;
