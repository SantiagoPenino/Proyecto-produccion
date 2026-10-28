// ─────────────────────────────────────────────────────────────────────────────
// Matriz de catálogo por cliente (/admin/price-catalog): elegís un cliente y una familia y calcula, de a 10 artículos,
// el precio final de cada uno con /prices/calculate (en US$) y las reglas que se le aplican.
// Estética nueva (28/10/2026): encabezado, filtros con Selector, tabla clara (en el celular, una tarjeta por
// artículo) y la barra de avance del cálculo. La lógica (búsqueda de clientes, cálculo por lotes) no se tocó, salvo
// que el cliente se elige y se manda por su id interno (CliIdCliente), no por el código.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import { Search, Layers, RefreshCw, AlertCircle, FileSpreadsheet, ArrowDown, ArrowUp, Tag } from 'lucide-react';
import Selector from '../ui/Selector';

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 whitespace-nowrap';

const fmtUSD = (v) => Number(v || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (v) => `${v > 0 ? '+' : ''}${fmtUSD(v)}`;

// En el celular y la tablet, tarjetas en vez de la tabla de 5 columnas (una vista sola: no se dibujan las dos)
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

const CustomerPriceCatalog = ({ customers = [], onSearch }) => {
    const [products, setProducts] = useState([]);
    const [clientId, setClientId] = useState('');
    const [clientFilter, setClientFilter] = useState('');
    const [loading, setLoading] = useState(false);
    
    // Filtros
    const [selectedGroup, setSelectedGroup] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Precios calculados
    const [calculatedPrices, setCalculatedPrices] = useState({});
    const [calculatingInProgress, setCalculatingInProgress] = useState(false);

    useEffect(() => {
        loadBaseProducts();
    }, []);

    // Efecto para debounce de búsqueda en servidor (clientes)
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (onSearch) {
                onSearch(clientFilter);
            }
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [clientFilter, onSearch]);

    // Cuando cambia el cliente o grupo, borramos caché de cálculos y calculamos los del grupo actual
    useEffect(() => {
        setCalculatedPrices({});
        if (clientId && selectedGroup) {
            calculateGroupPrices();
        }
    }, [clientId, selectedGroup]);

    const loadBaseProducts = async () => {
        try {
            setLoading(true);
            const res = await api.get('/prices/base');
            // Removemos 'TOTAL' de la visualización de catálogo
            const validProducts = (res.data || []).filter(p => p.CodArticulo !== 'TOTAL');
            setProducts(validProducts);
        } catch (e) {
            console.error("Error cargando productos base", e);
            toast.error("Error al cargar maestro de artículos");
        } finally {
            setLoading(false);
        }
    };

    const filteredCustomers = customers.filter(c => {
        if (!clientFilter) return true;
        const search = clientFilter.toLowerCase();
        return (c.Nombre || '').toLowerCase().includes(search) ||
            (c.NombreFantasia || '').toLowerCase().includes(search) ||
            String(c.CodCliente).includes(search);
    }).slice(0, 50);

    const groups = useMemo(() => {
        const uniqueGroups = [...new Set(products.map(p => p.GrupoNombre || p.Grupo).filter(Boolean))];
        return uniqueGroups.sort();
    }, [products]);

    // Productos a mostrar en base a familia y búsqueda
    const displayedProducts = useMemo(() => {
        return products.filter(p => {
            const matchesGroup = !selectedGroup || (p.GrupoNombre || p.Grupo) === selectedGroup;
            const seqMatch = !searchQuery || 
                p.CodArticulo.toLowerCase().includes(searchQuery.toLowerCase()) || 
                (p.Descripcion || '').toLowerCase().includes(searchQuery.toLowerCase());
            return matchesGroup && seqMatch;
        });
    }, [products, selectedGroup, searchQuery]);

    const calculateGroupPrices = async () => {
        if (!clientId || !selectedGroup) return;
        
        const productsToCalculate = displayedProducts;
        if (productsToCalculate.length === 0) return;

        setCalculatingInProgress(true);
        toast.loading(`Calculando precios para ${selectedGroup}...`, { id: 'calc-group' });

        const batchSize = 10;
        let newCalculated = { ...calculatedPrices };

        try {
            for (let i = 0; i < productsToCalculate.length; i += batchSize) {
                const batch = productsToCalculate.slice(i, i + batchSize);
                
                const promises = batch.map(p => 
                    api.post('/prices/calculate', {
                        codArticulo: p.CodArticulo,
                        cantidad: 1,
                        // Solo el id interno (28/10). Antes iba el CodCliente y el cálculo lo probaba primero como
                        // CliIdCliente: si era el id de otro cliente, usaba las reglas del otro.
                        clienteId: { cliIdCliente: Number(clientId) },
                        extraProfileIds: [],
                        variables: {},
                        targetCurrency: 'USD'
                    }).then(res => ({ cod: p.CodArticulo, result: res.data }))
                      .catch(err => ({ cod: p.CodArticulo, error: true }))
                );

                const results = await Promise.all(promises);
                
                results.forEach(r => {
                    if (!r.error) {
                        newCalculated[r.cod] = r.result;
                    }
                });

                // Actualización parcial para que la UI no se congele totalmente
                setCalculatedPrices({ ...newCalculated });
            }
            toast.success(`Cálculo completado para ${selectedGroup}`, { id: 'calc-group' });
        } catch (e) {
            console.error("Error calculando lote", e);
            toast.error("Ocurrió un error en el cálculo por lotes", { id: 'calc-group' });
        } finally {
            setCalculatingInProgress(false);
        }
    };

    // ── Piezas del render ───────────────────────────────────────────────────────
    const conTabla = useConTabla();

    // Base y precio final de un artículo: el mismo cálculo que antes se hacía dentro del map de la tabla.
    const calcularFila = (p) => {
        const calculation = calculatedPrices[p.CodArticulo];
        const isCalculated = !!calculation;

        // Extraer total final y base.
        // El valor de cálculo viene de calculation.breakdown (ej: BASE, DISCOUNT, OVERRIDE, SURCHARGE)
        let finalValue = 0;
        let originalBase = p.Precio || 0;
        let appliedRules = [];

        if (isCalculated) {
            let net = 0;
            let surcharges = 0;
            calculation.breakdown.forEach(b => {
                if (b.tipo === 'BASE' || b.tipo === 'OVERRIDE') {
                    net = b.valor;
                    if (b.tipo === 'BASE') originalBase = b.valor; // En caso q el calc detecte otra
                }
                if (b.tipo === 'DISCOUNT') net -= Math.abs(b.valor);
                if (b.tipo === 'SURCHARGE') surcharges += b.valor;

                if (b.tipo !== 'BASE' && b.tipo !== 'INFO') {
                    appliedRules.push(b);
                }
            });
            finalValue = Math.max(0, net + surcharges);
        }

        const hasChanged = originalBase !== finalValue && isCalculated;
        return { isCalculated, finalValue, originalBase, appliedRules, hasChanged };
    };

    const calculados = displayedProducts.filter(p => calculatedPrices[p.CodArticulo]).length;

    const precioCliente = (f) => f.isCalculated ? (
        <span className={`inline-block text-sm font-black tabular-nums px-2.5 py-1 rounded-lg border whitespace-nowrap ${f.hasChanged ? (f.finalValue < f.originalBase ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-brand-magenta bg-brand-magenta/5 border-brand-magenta/20') : 'text-zinc-800 bg-zinc-50 border-zinc-200'}`}>
            US$ {fmtUSD(f.finalValue)}
        </span>
    ) : (
        <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold whitespace-nowrap">{calculatingInProgress ? 'Calculando…' : 'Sin calcular'}</span>
    );

    const reglas = (f) => f.isCalculated && f.appliedRules.length > 0 ? (
        <div className="flex flex-wrap gap-1">
            {f.appliedRules.map((rule, idx) => (
                <span key={idx} className={`text-[10px] font-bold px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${
                    rule.tipo === 'DISCOUNT' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    rule.tipo === 'OVERRIDE' ? 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20' :
                    'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                    {rule.tipo === 'DISCOUNT' && <ArrowDown size={11} className="shrink-0" />}
                    {rule.tipo === 'OVERRIDE' && <Tag size={11} className="shrink-0" />}
                    {rule.tipo !== 'DISCOUNT' && rule.tipo !== 'OVERRIDE' && <ArrowUp size={11} className="shrink-0" />}
                    {rule.desc} ({conSigno(rule.valor)})
                </span>
            ))}
        </div>
    ) : f.isCalculated ? (
        <span className="text-xs text-zinc-400">Precio de lista</span>
    ) : (
        <span className="text-xs text-zinc-300">—</span>
    );

    const vacio = (Icono, titulo, texto) => (
        <div className={`${CARD} px-6 py-14 flex flex-col items-center text-center`}>
            <Icono size={40} className="text-zinc-300 mb-3" />
            <h3 className="text-base font-black text-zinc-800">{titulo}</h3>
            <p className="text-sm text-zinc-500 mt-1 max-w-md">{texto}</p>
        </div>
    );

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3">
                <Layers size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Matriz de catálogo por cliente</h1>
                    <p className="text-sm text-zinc-500 mt-1">Los precios finales de un cliente y las reglas que se le aplican, familia por familia.</p>
                </div>
            </div>

            {/* Filtros */}
            <div className={`${CARD} p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-start`}>
                <div className="min-w-0">
                    <span className={ETIQUETA}>Cliente</span>
                    <div className="relative mb-2">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            className={CAMPO}
                            placeholder="Buscar por nombre o código"
                            aria-label="Buscar cliente"
                            value={clientFilter}
                            onChange={e => setClientFilter(e.target.value)}
                        />
                    </div>
                    <Selector value={clientId} onChange={e => setClientId(e.target.value)} buscar={false} aria-label="Cliente">
                        <option value="">Elegí un cliente</option>
                        {filteredCustomers.map(c => (
                            <option key={c.CliIdCliente} value={c.CliIdCliente} descripcion={`Código ${c.CodCliente}`}>
                                {c.Nombre || c.NombreFantasia}
                            </option>
                        ))}
                    </Selector>
                </div>

                <div className="min-w-0">
                    <span className={ETIQUETA}>Familia</span>
                    <Selector value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} disabled={!clientId} aria-label="Familia">
                        <option value="">Elegí una familia</option>
                        {groups.map(g => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </Selector>
                    <p className="text-[11px] text-zinc-500 mt-2">Los precios se calculan de a una familia, para que sea rápido.</p>
                </div>

                <div className="min-w-0">
                    <span className={ETIQUETA}>Buscar artículo</span>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            className={CAMPO}
                            placeholder="Código o descripción (ej. DF0123)"
                            aria-label="Buscar artículo"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Resultados */}
            {!clientId ? (
                vacio(Search, 'Elegí un cliente', 'Buscalo arriba para ver sus precios finales y las reglas que se le aplican.')
            ) : !selectedGroup ? (
                vacio(Layers, 'Elegí una familia', 'Elegí la familia a revisar (por ejemplo Tazas o DTF Textil) para ver sus artículos.')
            ) : (
                <div className={`${CARD} overflow-hidden relative`}>
                    {(loading || calculatingInProgress) && (
                        <div className="absolute top-0 left-0 right-0 h-1 bg-brand-cyan/10">
                            <div className="h-full bg-brand-cyan transition-all duration-300" style={{ width: `${displayedProducts.length ? Math.max(8, Math.round(calculados * 100 / displayedProducts.length)) : 8}%` }} />
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-zinc-100">
                        <FileSpreadsheet size={18} className="text-brand-cyan shrink-0" />
                        <span className="font-black text-zinc-900">{selectedGroup}</span>
                        <span className={CHIP}>{displayedProducts.length} artículo{displayedProducts.length !== 1 ? 's' : ''}</span>
                        {calculatingInProgress && <span className="text-xs text-zinc-500 tabular-nums">Calculados {calculados} de {displayedProducts.length}</span>}
                        <button
                            type="button"
                            onClick={calculateGroupPrices}
                            disabled={calculatingInProgress}
                            className={`${BTN_SECUNDARIO} ml-auto`}
                        >
                            <RefreshCw size={15} className={`text-brand-cyan ${calculatingInProgress ? 'animate-spin' : ''}`} />
                            Recalcular
                        </button>
                    </div>

                    {displayedProducts.length === 0 && !loading ? (
                        <div className="px-6 py-10 flex flex-col items-center text-center text-sm text-zinc-500">
                            <AlertCircle size={32} className="text-zinc-300 mb-2" />
                            No hay artículos de esta familia que coincidan con la búsqueda.
                        </div>
                    ) : conTabla ? (
                        <table className="w-full text-sm">
                            <thead className="bg-zinc-50 border-b border-zinc-200">
                                <tr>
                                    <th className={TH}>Artículo</th>
                                    <th className={TH}>Descripción</th>
                                    <th className={`${TH} text-right`}>Lista (US$)</th>
                                    <th className={`${TH} text-right`}>Precio cliente (US$)</th>
                                    <th className={`${TH} w-[34%]`}>Reglas aplicadas</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {displayedProducts.map(p => {
                                    const f = calcularFila(p);
                                    return (
                                        <tr key={p.CodArticulo} className="hover:bg-zinc-50/70 transition-colors align-middle">
                                            <td className="px-4 py-3 font-mono text-[13px] font-bold text-zinc-900 whitespace-nowrap">{p.CodArticulo}</td>
                                            <td className="px-4 py-3 text-zinc-600 max-w-[260px] truncate" title={p.Descripcion}>{p.Descripcion}</td>
                                            <td className="px-4 py-3 text-right text-zinc-500 tabular-nums whitespace-nowrap">US$ {fmtUSD(f.originalBase)}</td>
                                            <td className="px-4 py-3 text-right">{precioCliente(f)}</td>
                                            <td className="px-4 py-3">{reglas(f)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <div className="divide-y divide-zinc-100">
                            {displayedProducts.map(p => {
                                const f = calcularFila(p);
                                return (
                                    <div key={p.CodArticulo} className="px-4 py-3.5 flex flex-col gap-2">
                                        <div className="flex items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="font-mono text-[13px] font-bold text-zinc-900">{p.CodArticulo}</div>
                                                <div className="text-sm text-zinc-600 break-words">{p.Descripcion}</div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                {precioCliente(f)}
                                                <div className="text-[11px] text-zinc-400 tabular-nums mt-1">Lista US$ {fmtUSD(f.originalBase)}</div>
                                            </div>
                                        </div>
                                        {reglas(f)}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CustomerPriceCatalog;
