import React, { useState, useEffect } from 'react';
import { Calculator, Search, Lock, Lightbulb, Loader2, Receipt, Minus, Pencil, Bug } from 'lucide-react';
import api from '../../services/api'; // Ajustar import según tu estructura
import { toast } from 'react-hot-toast';
import Selector from '../ui/Selector';

// Estética nueva (28/10/2026): todo claro (zinc + brand-cyan), datos y resultado en tarjetas, cliente con Selector,
// íconos Lucide y montos en formato uruguayo con «US$»/«$». Sin encabezado propio (va dentro de la pestaña de
// Perfiles de Precios). Los cálculos, las llamadas y los estados no cambiaron.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_NUM = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 font-mono tabular-nums placeholder:text-zinc-400 placeholder:font-sans focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';

// Montos en pantalla: formato uruguayo y «US$» / «$» (solo presentación; las cuentas siguen igual)
const monto = (n) => Number(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const simbolo = (m) => (m === 'USD' ? 'US$' : m === 'UYU' ? '$' : (m || '$'));
const precioEnPantalla = (v) => (v !== null && v !== undefined && v !== '' && !isNaN(Number(v)) ? monto(v) : v);

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
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <input
                    className={`${CAMPO} font-mono uppercase placeholder:normal-case placeholder:font-sans`}
                    value={value}
                    onChange={e => handleSearch(e.target.value)}
                    placeholder="Busca un producto..."
                    aria-label="Producto"
                    onFocus={() => { if (value === '' && catalog.length > 0) { setSuggestions(catalog.slice(0, 10)); setShowSuggestions(true); } else if (value) { handleSearch(value); } }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                />
            </div>
            {selectedProduct && (
                <div className="mt-2 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2 leading-tight">
                    <div className="text-xs text-zinc-700 font-bold">{selectedProduct.Descripcion}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">Precio Base: <span className="font-mono font-bold tabular-nums text-zinc-700">{simbolo(selectedProduct.Moneda)} {precioEnPantalla(selectedProduct.Precio)}</span></div>
                </div>
            )}
            {showSuggestions && (
                <div className="absolute top-full left-0 w-full bg-white border border-zinc-200 shadow-lg shadow-zinc-900/5 rounded-xl z-50 max-h-60 overflow-y-auto mt-1 py-1">
                    {suggestions.map(s => (
                        <div
                            key={s.CodArticulo}
                            className="px-3 py-2 hover:bg-zinc-50 cursor-pointer text-xs border-b border-zinc-100 last:border-0 flex justify-between items-center gap-2"
                            onClick={() => { onChange(s.CodArticulo); setShowSuggestions(false); }}
                        >
                            <div className="flex flex-col overflow-hidden min-w-0">
                                <span className="font-mono font-bold text-brand-cyan">{s.CodArticulo}</span>
                                <span className="text-[10px] text-zinc-400 truncate">{s.GrupoNombre || s.Grupo}</span>
                            </div>
                            <span className="text-zinc-500 truncate max-w-[150px] sm:max-w-[220px] text-right ml-2">{s.Descripcion}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const PriceCalculatorTest = ({ customers = [], assignments = {}, onSearch }) => {
    const [products, setProducts] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [showDebug, setShowDebug] = useState(false);

    // Formulario
    const [selectedProduct, setSelectedProduct] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientFilter, setClientFilter] = useState(''); // Nuevo filtro
    const [quantity, setQuantity] = useState(1);
    const [puntadas, setPuntadas] = useState('');

    const [extraProfiles, setExtraProfiles] = useState([]); // IDs manuales
    const [activeProfiles, setActiveProfiles] = useState([]); // Todos los perfiles activos en la UI

    // Resultado
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [ignoredSurcharges, setIgnoredSurcharges] = useState([]); // Indices de recargos desactivados manualmente

    useEffect(() => {
        loadData();
    }, []);

    // Effect to trigger server search when filter changes
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (onSearch) {
                onSearch(clientFilter);
            }
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [clientFilter]);

    const loadData = async () => {
        try {
            const [prodRes, profRes] = await Promise.all([
                api.get('/prices/base'),
                api.get('/profiles')
            ]);
            setProducts(prodRes.data || []);
            setProfiles(profRes.data || []);
        } catch (e) {
            console.error("Error loading initial data", e);
            toast.error("Error cargando productos/perfiles");
        }
    };

    // Filtrar clientes para el select (Top 50)
    const filteredCustomers = customers.filter(c => {
        if (!clientFilter) return true;
        const search = clientFilter.toLowerCase();
        return (c.Nombre || '').toLowerCase().includes(search) ||
            (c.NombreFantasia || '').toLowerCase().includes(search) ||
            String(c.CodCliente).includes(search);
    }).slice(0, 50);

    // Calcular perfiles BASE (Globales + Asignados al cliente)
    const baseProfileIds = React.useMemo(() => {
        let ids = [];
        // 1. Globales
        const globalProfiles = profiles.filter(p => p.EsGlobal).map(p => p.ID);
        ids = [...ids, ...globalProfiles];
        // 2. Asignados
        if (clientId && assignments[clientId]) {
            const assigned = assignments[clientId].pid;
            if (Array.isArray(assigned)) ids = [...ids, ...assigned];
            else if (assigned) ids.push(assigned);
        }
        return [...new Set(ids)];
    }, [clientId, profiles, assignments]);

    // Sincronizar perfiles activos cuando cambia el cliente o la base
    useEffect(() => {
        setActiveProfiles(baseProfileIds);
    }, [baseProfileIds]);

    const handleCalculate = async () => {
        if (!selectedProduct) return toast.error("Selecciona un producto");

        setLoading(true);
        try {
            const payload = {
                codArticulo: selectedProduct,
                cantidad: quantity,
                clienteId: clientId || null,
                extraProfileIds: extraProfiles,
                variables: puntadas ? { puntadas } : {},
                targetCurrency: 'USD'
            };

            const res = await api.post('/prices/calculate', payload);
            setResult(res.data);
            setIgnoredSurcharges([]); // Reset manual toggles on new calculation

        } catch (e) {
            console.error(e);
            toast.error("Error al calcular precio");
        } finally {
            setLoading(false);
        }
    };

    const toggleProfile = (id) => {
        if (activeProfiles.includes(id)) {
            setActiveProfiles(activeProfiles.filter(pid => pid !== id));
        } else {
            setActiveProfiles([...activeProfiles, id]);
        }
        // Sync extraProfiles for backend call (although backend enforces globals, we verify in frontend)
        if (extraProfiles.includes(id)) {
            setExtraProfiles(extraProfiles.filter(p => p !== id));
        } else if (!baseProfileIds.includes(id)) {
            setExtraProfiles([...extraProfiles, id]);
        }
    };

    return (
        <div className="flex flex-col gap-4 min-w-0 text-zinc-700 animate-fade-in">
            <div className="flex items-center gap-2.5">
                <Calculator size={20} className="text-brand-cyan shrink-0" />
                <h2 className="text-base font-black text-zinc-800 leading-tight">Simulador de Precios</h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {/* CONFIGURACIÓN */}
                <div className={`${CARD} p-4 sm:p-5 flex flex-col gap-4 min-w-0`}>
                    <div>
                        <label className={ETIQUETA}>Producto</label>
                        <ProductSearchInput
                            value={selectedProduct}
                            onChange={setSelectedProduct}
                            catalog={products}
                        />
                    </div>

                    <div>
                        <label className={ETIQUETA}>Cliente</label>

                        {/* Combo Buscador Clientes */}
                        <div className="flex flex-col gap-2">
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                <input
                                    className={CAMPO}
                                    placeholder="Buscar cliente..."
                                    aria-label="Buscar cliente"
                                    value={clientFilter}
                                    onChange={e => setClientFilter(e.target.value)}
                                />
                            </div>
                            <Selector
                                aria-label="Cliente"
                                value={clientId}
                                onChange={e => setClientId(e.target.value)}
                                anchoLista={320}
                            >
                                <option value="">-- Cliente Genérico --</option>
                                {filteredCustomers.map(c => (
                                    <option key={c.CodCliente} value={c.CodCliente}>
                                        {c.Nombre || c.NombreFantasia} (ID: {c.CodCliente})
                                    </option>
                                ))}
                            </Selector>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1.5">Busca arriba para filtrar la lista.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0">
                            <label className={ETIQUETA}>Cantidad</label>
                            <input
                                type="number"
                                className={CAMPO_NUM}
                                min="1"
                                aria-label="Cantidad"
                                value={quantity}
                                onChange={e => setQuantity(e.target.value)}
                            />
                        </div>

                        <div className="min-w-0">
                            <label className={ETIQUETA}>
                                Puntadas (Opcional)
                            </label>
                            <input
                                type="number"
                                placeholder="Ej: 7500"
                                className={CAMPO_NUM}
                                min="0"
                                aria-label="Puntadas (opcional)"
                                value={puntadas}
                                onChange={e => setPuntadas(e.target.value)}
                                title="Usado solo si el perfil tiene reglas matemáticas por puntadas"
                            />
                        </div>
                    </div>

                    <div>
                        <label className={ETIQUETA}>
                            Condiciones / Perfiles Aplicados
                        </label>
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 max-h-72 overflow-y-auto space-y-1.5">
                            {profiles.map(p => {
                                const isBase = baseProfileIds.includes(p.ID);
                                const isChecked = isBase || extraProfiles.includes(p.ID);

                                return (
                                    <label
                                        key={p.ID}
                                        className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-colors ${isBase
                                            ? 'bg-brand-cyan/5 border-brand-cyan/20 cursor-not-allowed'
                                            : isChecked
                                                ? 'bg-white border-zinc-400 cursor-pointer'
                                                : 'bg-white border-zinc-200 hover:border-zinc-300 cursor-pointer'
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={activeProfiles.includes(p.ID)}
                                            onChange={() => toggleProfile(p.ID)}
                                            className="w-4 h-4 shrink-0 accent-[#006E97]"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center gap-2">
                                                <span className={`text-sm font-bold ${isBase ? 'text-brand-cyan' : 'text-zinc-700'}`}>
                                                    {p.Nombre}
                                                </span>
                                                {isBase && (
                                                    <span className={`${CHIP} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20`}>
                                                        <Lock size={10} />
                                                        {p.EsGlobal ? 'Global' : 'Cliente'}
                                                    </span>
                                                )}
                                            </div>
                                            {p.Descripcion && <div className="text-xs text-zinc-500 mt-0.5">{p.Descripcion}</div>}
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-2 bg-zinc-50 px-3 py-2 rounded-xl border border-zinc-200 flex gap-2">
                            <Lightbulb size={14} className="text-brand-cyan shrink-0 mt-px" />
                            <span>
                                Usa los perfiles marcados en azul (<Lock size={10} className="inline -mt-0.5 text-brand-cyan" />) para ver lo que el cliente ya tiene. Marca otros (como <b>Tinta</b> o <b>Urgencias</b>) para simular.
                            </span>
                        </p>
                    </div>

                    <button
                        onClick={handleCalculate}
                        disabled={loading}
                        className={`${BTN_PRINCIPAL} w-full py-2.5`}
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <Calculator size={15} />}
                        Calcular Precio
                    </button>
                </div>

                {/* RESULTADOS */}
                <div className={`${CARD} p-4 sm:p-5 min-w-0 relative`}>
                    {!result ? (
                        <div className="flex flex-col items-center justify-center text-center min-h-[260px] gap-2">
                            <Receipt size={40} className="text-brand-cyan" />
                            <p className="text-sm font-bold text-zinc-700">Ingresa datos para ver el desglose</p>
                        </div>
                    ) : (
                        <div className="animate-fade-in-up">
                            {/* Lógica de Cálculo Visual */}
                            {(() => {
                                let base = 0;
                                let discounts = 0;
                                let activeSurcharges = 0;

                                // Filtrar breakdown basado en perfiles activos en UI
                                const filteredBreakdown = result.breakdown.filter(item => {
                                    if (!item.profileId) return true; // Reglas sin perfil (AdHoc o Base original) pasan
                                    return activeProfiles.includes(item.profileId);
                                });

                                // Primera pasada: Base y Descuentos
                                filteredBreakdown.forEach((item) => {
                                    if (item.tipo === 'BASE' || item.tipo === 'OVERRIDE') base = item.valor;
                                    if (item.tipo === 'DISCOUNT') discounts += Math.abs(item.valor);
                                });

                                const netPrice = base - discounts;

                                // Segunda pasada: Recargos Activos
                                filteredBreakdown.forEach((item, idx) => {
                                    if (item.tipo === 'SURCHARGE' && !ignoredSurcharges.includes(idx)) {
                                        activeSurcharges += item.valor;
                                    }
                                });

                                const finalUnit = Math.max(0, netPrice + activeSurcharges);
                                const finalTotal = finalUnit * result.cantidad;

                                return (
                                    <>
                                        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-zinc-100 pb-4 mb-3">
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>Artículo</span>
                                                <h3 className="text-lg font-black font-mono text-zinc-900 leading-tight break-all">{result.codArticulo}</h3>
                                                <p className="text-sm text-zinc-500 mt-0.5"><span className="tabular-nums">{result.cantidad}</span> unidades</p>
                                            </div>
                                            <div className="text-right ml-auto">
                                                <p className="text-[10px] text-zinc-400 uppercase font-black tracking-widest">Precio Unitario</p>
                                                <p className="text-3xl font-black text-zinc-900 tabular-nums whitespace-nowrap leading-tight mt-0.5">
                                                    <span className="text-base font-bold text-zinc-400 mr-1">{simbolo(result.moneda)}</span>
                                                    {monto(finalUnit)}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Desglose */}
                                        <div className="text-sm">
                                            {/* 1. Base y Descuentos */}
                                            {filteredBreakdown.map((item, idx) => {
                                                if (item.tipo === 'SURCHARGE' || item.tipo === 'INFO') return null;
                                                return (
                                                    <div key={idx} className="flex justify-between items-center gap-3 py-2 border-b border-dashed border-zinc-200">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            {item.tipo === 'BASE' && <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0"></span>}
                                                            {item.tipo === 'DISCOUNT' && <Minus size={13} className="text-emerald-600 shrink-0" />}
                                                            {item.tipo === 'OVERRIDE' && <Pencil size={12} className="text-brand-cyan shrink-0" />}
                                                            <span className={`${item.tipo === 'BASE' ? 'font-bold' : ''} text-zinc-700`}>{item.desc}</span>
                                                        </div>
                                                        <span className={`font-mono font-bold tabular-nums whitespace-nowrap ${item.valor < 0 ? 'text-emerald-600' : 'text-zinc-600'}`}>
                                                            {item.valor > 0 && item.tipo !== 'BASE' ? '+' : ''}{monto(item.valor)}
                                                        </span>
                                                    </div>
                                                );
                                            })}

                                            {/* Subtotal Neto (Nuevo) */}
                                            <div className="flex justify-between items-center gap-3 my-2 px-3 py-2 rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 font-bold text-brand-cyan">
                                                <span>Precio Neto (sin recargos)</span>
                                                <span className="font-mono tabular-nums whitespace-nowrap">{simbolo(result.moneda)} {monto(netPrice)}</span>
                                            </div>

                                            {/* 2. Recargos (Simulables) */}
                                            {filteredBreakdown.map((item, idx) => {
                                                if (item.tipo !== 'SURCHARGE') return null;
                                                const isIgnored = ignoredSurcharges.includes(idx);
                                                return (
                                                    <div key={idx} className={`flex justify-between items-center gap-3 py-2 border-b border-dashed border-zinc-200 transition-opacity ${isIgnored ? 'opacity-50' : 'opacity-100'}`}>
                                                        <label className="flex items-center gap-2 min-w-0 cursor-pointer select-none hover:text-amber-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={!isIgnored}
                                                                onChange={() => setIgnoredSurcharges(prev => isIgnored ? prev.filter(i => i !== idx) : [...prev, idx])}
                                                                className="w-4 h-4 shrink-0 accent-amber-500 cursor-pointer"
                                                            />
                                                            <span className={`text-zinc-700 ${isIgnored ? 'line-through decoration-zinc-400' : ''}`}>
                                                                {item.desc}
                                                            </span>
                                                        </label>
                                                        <span className={`font-mono font-bold tabular-nums whitespace-nowrap ${isIgnored ? 'line-through text-zinc-400' : 'text-amber-600'}`}>
                                                            +{monto(item.valor)}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-zinc-200 flex justify-between items-center gap-3">
                                            <span className="text-sm font-black uppercase tracking-wide text-zinc-800">Total Final</span>
                                            <span className="text-2xl font-black text-zinc-900 tabular-nums whitespace-nowrap">
                                                <span className="text-sm font-bold text-zinc-400 mr-1">{simbolo(result.moneda)}</span>
                                                {monto(finalTotal)}
                                            </span>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>
            </div>

            {/* DEBUG SECTION */}
            <div className="flex flex-col gap-2">
                <button
                    onClick={() => setShowDebug(!showDebug)}
                    className="self-start inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                    <Bug size={13} className={showDebug ? 'text-brand-cyan' : ''} />
                    {showDebug ? 'Ocultar Info Técnica' : 'Ver Info Técnica (Debug)'}
                </button>

                {showDebug && result && result._debug && (
                    <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl font-mono text-xs text-zinc-700 overflow-x-auto">
                        <pre>{JSON.stringify(result._debug, null, 2)}</pre>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceCalculatorTest;
