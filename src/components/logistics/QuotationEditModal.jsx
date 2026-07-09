import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../../services/apiClient';

const AREA_COLORS = {
    DF: 'bg-blue-100 text-blue-700',
    SB: 'bg-purple-100 text-purple-700',
    EMB: 'bg-orange-100 text-orange-700',
    TWC: 'bg-teal-100 text-teal-700',
    TWT: 'bg-pink-100 text-pink-700',
    ECOUV: 'bg-green-100 text-green-700',
    EST: 'bg-yellow-100 text-yellow-700',
    TPU: 'bg-indigo-100 text-indigo-700',
};

// ─── Panel de búsqueda (FUERA de la tabla para evitar clip por overflow) ───
function ProductSearchPanel({ onSelect, onCancel, isAdmin, userArea, forceArea }) {
    const [q, setQ] = useState('');
    const [allItems, setAllItems] = useState([]);
    const [loadingItems, setLoadingItems] = useState(true);
    const [fetchError, setFetchError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        api.get('/quotation/search-products')
            .then(r => {
                const items = r.data || [];
                setAllItems(items);
                if (items.length === 0) setFetchError('No se encontraron productos en la tabla Articulos.');
            })
            .catch(err => setFetchError(err.response?.data?.error || err.message))
            .finally(() => setLoadingItems(false));
    }, []);

    const searchFiltered = !q
        ? allItems
        : allItems.filter(p =>
            (p.Descripcion || '').toLowerCase().includes(q.toLowerCase()) ||
            String(p.CodArticulo || '').trim().toLowerCase().includes(q.toLowerCase()) ||
            (p.AreaID || '').toLowerCase().includes(q.toLowerCase())
        );

    // Filtrar por área forzada (editando línea) o por permiso (si no es admin)
    const filtered = searchFiltered.filter(p => {
        if (forceArea) {
            return p.AreaID && p.AreaID.toUpperCase() === forceArea.toUpperCase();
        }
        if (!isAdmin && userArea) {
            return p.AreaID && p.AreaID.toUpperCase() === userArea.toUpperCase();
        }
        return true;
    });

    const grouped = filtered.reduce((acc, p) => {
        const key = p.AreaID || 'Sin Área';
        if (!acc[key]) acc[key] = [];
        acc[key].push(p);
        return acc;
    }, {});

    return (
        <div className="flex flex-col bg-white overflow-hidden w-full h-full">
            {/* Barra de búsqueda */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100">
                {loadingItems
                    ? <i className="fa-solid fa-spinner fa-spin text-indigo-400 text-sm" />
                    : <i className="fa-solid fa-search text-indigo-400 text-sm" />
                }
                <input
                    ref={inputRef}
                    type="text"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && onCancel()}
                    placeholder={
                        loadingItems ? 'Cargando productos...'
                        : fetchError ? '⚠️ Error al cargar productos'
                        : `Filtrar entre ${allItems.length} productos (ej: DTF, sublimación...)`
                    }
                    className="flex-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 bg-transparent"
                />
                {q && (
                    <button onClick={() => setQ('')} className="text-slate-300 hover:text-slate-500">
                        <i className="fa-solid fa-times text-xs" />
                    </button>
                )}
                <button onClick={onCancel} className="text-slate-300 hover:text-red-500 transition-colors ml-1">
                    <i className="fa-solid fa-xmark" />
                </button>
            </div>

            {/* Lista de resultados */}
            <div className="max-h-56 overflow-y-auto">
                {fetchError && (
                    <div className="px-4 py-3 text-xs text-red-600 bg-red-50 flex items-center gap-2">
                        <i className="fa-solid fa-triangle-exclamation" /> {fetchError}
                    </div>
                )}
                {!fetchError && !loadingItems && Object.keys(grouped).length === 0 && (
                    <div className="px-4 py-4 text-sm text-slate-400 italic text-center">
                        {q ? `Sin resultados para "${q}"` : 'Sin productos disponibles'}
                    </div>
                )}
                {Object.entries(grouped).map(([area, items]) => (
                    <div key={area}>
                        <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-t border-slate-100 flex items-center gap-2 sticky top-0">
                            {area !== 'Sin Área' && (
                                <span className={`px-1.5 py-0.5 rounded font-black text-[9px] ${AREA_COLORS[area] || 'bg-slate-100 text-slate-600'}`}>
                                    {area}
                                </span>
                            )}
                            {area} <span className="font-normal text-slate-300">({items.length})</span>
                        </div>
                        {items.map((p, i) => (
                            <button key={i}
                                onClick={() => onSelect(p)}
                                className="w-full text-left px-4 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition-colors flex items-center justify-between gap-3 group">
                                <div className="min-w-0">
                                    <span className="font-semibold text-slate-800 text-sm group-hover:text-indigo-700">
                                        {(p.Descripcion || '').trim()}
                                    </span>
                                    <span className="ml-2 text-[11px] text-slate-400 font-mono">{String(p.CodArticulo || '').trim()}</span>
                                </div>
                                {p.PrecioBase != null && (
                                    <span className="text-xs font-black text-emerald-600 shrink-0">
                                        {p.Moneda} {Number(p.PrecioBase).toFixed(2)}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Fila de datos existente ────────────────────────────────────────────────
function LineRow({ line, userArea, isAdmin, areaFilter, cotizacion, monedaFinal, onChange, onDelete, onRecalculate, allProducts, onProductChange, showTechnicalData, showOrderColumn, readOnly }) {
    const isFiltered = areaFilter && areaFilter !== 'TODOS';
    const areaTag = line.AreaIDInterna || line.AreaID || '';
    const currentCod = line.CodArticulo ? String(line.CodArticulo).trim() : '';
    const isLineTargetArea = areaTag.toUpperCase() === areaFilter?.toUpperCase();
    
    // Permission base rule
    const hasPermission = isAdmin || !userArea || areaTag.toUpperCase() === userArea.toUpperCase();
    // Context rule (UX filter override)
    // ONLY allow edit if it's the target area (or no filter) AND user has permission
    const puedoEditar = !readOnly && hasPermission && (!isFiltered || isLineTargetArea);
    const subtotal = (parseFloat(line.Cantidad) || 0) * (parseFloat(line.PrecioUnitario) || 0);
    const nombreVisible = line.NombreArticulo || line.DescripcionArticulo || line.CodArticulo;
    const timeoutRef = useRef(null);

    const handleDebouncedCalc = (updatedLine) => {
        onChange(updatedLine);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            if (onRecalculate) onRecalculate(updatedLine);
        }, 500);
    };

    const areaProducts = useMemo(() => {
        if (!allProducts) return [];
        const filtered = allProducts.filter(p => p.AreaID && p.AreaID.trim().toUpperCase() === areaTag.trim().toUpperCase());
        console.log(`Line ${line.CodigoOrden} - areaTag: '${areaTag}', allProducts: ${allProducts.length}, filtered: ${filtered.length}`);
        return filtered;
    }, [allProducts, areaTag, line.CodigoOrden]);

    return (
        <tr className={`border-b last:border-0 transition-colors group ${puedoEditar ? 'hover:bg-slate-50/80' : 'bg-slate-50/30 opacity-75'}`}>
            {/* Área */}
            <td className="px-3 py-2.5 w-20 text-center">
                {areaTag ? (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase ${AREA_COLORS[areaTag] || 'bg-slate-100 text-slate-600'}`}>
                        {areaTag}
                    </span>
                ) : <span className="text-slate-300">—</span>}
            </td>
            {/* Producto — Select en línea */}
            <td className="px-3 py-2.5 min-w-[250px]">
                {puedoEditar ? (
                    <div className="relative group/prod">
                        <select
                            value={currentCod}
                            onChange={e => {
                                const match = areaProducts.find(p => p.CodArticulo === e.target.value);
                                if (match && match.CodArticulo !== currentCod) {
                                    onProductChange(line._tempId, match);
                                }
                            }}
                            className="w-full text-sm font-semibold text-slate-800 border border-transparent bg-transparent hover:bg-slate-50 hover:border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-lg px-1 py-1 pr-6 outline-none transition-all truncate cursor-pointer appearance-none"
                            title="Clic para cambiar producto"
                        >
                            {!areaProducts.find(p => p.CodArticulo === currentCod) && (
                                <option value={currentCod} disabled hidden>
                                    {nombreVisible || 'Seleccionar artículo...'}
                                </option>
                            )}
                            {areaProducts.map(p => (
                                <option key={p.CodArticulo} value={p.CodArticulo}>
                                    {p.Descripcion}
                                </option>
                            ))}
                        </select>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none opacity-50 group-hover/prod:opacity-100 transition-opacity">
                            <i className="fa-solid fa-caret-down text-xs"></i>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 px-2 pointer-events-none">{line.CodArticulo}</div>
                    </div>
                ) : (
                    <div className="px-2 py-1">
                        <div className="font-semibold text-slate-800 text-sm leading-tight truncate" title={nombreVisible}>
                            {nombreVisible}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{line.CodArticulo}</div>
                    </div>
                )}
            </td>
            {/* Orden */}
            {showOrderColumn && (
                <td className="px-3 py-2.5">
                    <div className="text-xs font-mono font-bold text-slate-500 whitespace-nowrap">
                        {line.CodigoOrden || line.OrdenID || '-'}
                    </div>
                </td>
            )}
            {/* Cantidad */}
            <td className="px-3 py-2.5 w-24 text-right">
                <input type="number" min="0" step="0.01"
                    disabled={!puedoEditar}
                    value={line.Cantidad}
                    onChange={e => {
                        const newQ = e.target.value;
                        const numQ = parseFloat(newQ) || 0;
                        const puOrig = parseFloat(line.PrecioUnitarioOriginal) || parseFloat(line.PrecioUnitario) || 0;
                        handleDebouncedCalc({ ...line, Cantidad: newQ, SubtotalOriginal: numQ * puOrig, PricingTrace: 'Calculando precio...' });
                    }}
                    className={`w-20 text-right text-sm font-mono border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400
                        ${puedoEditar ? 'border-slate-200 bg-white hover:border-indigo-300 group-hover:border-slate-300' : 'border-transparent bg-transparent cursor-not-allowed text-slate-500'}`}
                />
            </td>
            {/* Dato Técnico (Puntadas/Bajadas) */}
            {showTechnicalData && (
                <td className="px-2 py-2.5 w-24 text-right">
                    <input type="number" min="0" step="1"
                        placeholder="Punt."
                        disabled={!puedoEditar}
                        value={line.DatoTecnico || ''}
                        onChange={e => handleDebouncedCalc({ ...line, DatoTecnico: e.target.value, PricingTrace: 'Calculando precio...' })}
                        className={`w-20 text-right text-sm font-mono border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400
                            ${puedoEditar ? 'border-slate-200 bg-white hover:border-indigo-300' : 'border-transparent bg-transparent cursor-not-allowed text-slate-400'}`}
                    />
                </td>
            )}
            {/* Moneda */}
            <td className="px-2 py-2.5 w-20 text-center">
                <div className="w-full text-xs font-bold text-slate-500 py-1 border border-transparent select-none bg-slate-50 rounded">
                    {line.Moneda || 'UYU'}
                </div>
            </td>
            {/* Precio Unit. */}
            <td className="px-2 py-2.5 w-24 text-right">
                <input type="number" min="0" step="0.01"
                    disabled={!puedoEditar}
                    value={line.PrecioUnitario}
                    onChange={e => {
                        const newP = e.target.value;
                        const numP = parseFloat(newP) || 0;
                        const qty = parseFloat(line.Cantidad) || 0;
                        onChange({ ...line, PrecioUnitario: newP, PrecioUnitarioOriginal: numP, SubtotalOriginal: qty * numP, PricingTrace: 'Edición manual' })
                    }}
                    className={`w-28 text-right text-sm font-mono border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400
                        ${puedoEditar ? 'border-slate-200 bg-white hover:border-indigo-300 group-hover:border-slate-300' : 'border-transparent bg-transparent cursor-not-allowed text-slate-500'}`}
                />
            </td>
            {/* Subtotal Original */}
            <td className="px-3 py-2.5 w-24 text-right font-bold font-mono text-slate-600 text-[13px]">
                {line.MonedaOriginal || line.Moneda} {(parseFloat(line.SubtotalOriginal) || subtotal || 0).toFixed(2)}
            </td>
            {/* Subtotal Final */}
            <td className="px-3 py-2.5 w-28 text-right font-black font-mono text-indigo-700 text-sm bg-indigo-50/50">
                {(monedaFinal === 'USD' 
                    ? (line.Moneda === 'UYU' ? subtotal / (cotizacion || 40) : subtotal)
                    : (line.Moneda === 'USD' ? subtotal * (cotizacion || 40) : subtotal)
                ).toFixed(2)}
            </td>
            {/* Perfil & Tracking */}
            <td className="px-3 py-2.5 text-center">
                <div className="flex flex-col items-center justify-center gap-1.5">
                    {line.PerfilAplicado && line.PerfilAplicado !== 'Manual' ? (
                        <span className="text-[10px] uppercase font-bold bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm text-slate-600 leading-none">
                            {line.PerfilAplicado}
                        </span>
                    ) : (
                        <span className="text-[10px] uppercase font-bold text-orange-400">Manual</span>
                    )}
                    
                    {line.PricingTrace && (
                        <div className="text-[9px] text-slate-500 italic max-w-[140px] leading-tight text-center whitespace-pre-wrap opacity-80" 
                             dangerouslySetInnerHTML={{ __html: line.PricingTrace }}>
                        </div>
                    )}
                </div>
            </td>
            {/* Eliminar */}
            <td className="px-3 py-2.5 text-center w-10">
                {puedoEditar && (
                    <button onClick={() => onDelete(line._tempId)}
                        className="text-slate-300 hover:text-red-500 bg-transparent hover:bg-red-50 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100">
                        <i className="fa-solid fa-trash-can text-xs" />
                    </button>
                )}
            </td>
        </tr>
    );
}

// ─── Modal Principal ────────────────────────────────────────────────────────
export default function QuotationEditModal({ noDocERP, onClose, onSaved, currentUser, areaFilter, embedded = false, readOnly = false, propagarADeposito = false }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [cabecera, setCabecera] = useState(null);
    const [lineas, setLineas] = useState([]);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [activeProductSearch, setActiveProductSearch] = useState(null); // null, 'add'
    const [cotizacion, setCotizacion] = useState(40); // Backup default
    const [allProducts, setAllProducts] = useState([]);
    const [recalculating, setRecalculating] = useState(false);

    const userArea = currentUser?.AreaID || null;
    const isAdmin = !userArea || currentUser?.rol === 'ADMIN' || currentUser?.esAdmin;

    const showTechnicalData = areaFilter === 'EMB' || areaFilter === 'EST' || areaFilter === 'TODOS' || !areaFilter;

    // Cargar datos
    useEffect(() => {
        api.get('/quotation/search-products').then(r => setAllProducts(r.data || [])).catch(() => {});
        api.get('/contabilidad/cotizacion-hoy')
            .then(res => { if (res.data?.data?.promedio) setCotizacion(res.data.data.promedio); })
            .catch(err => console.warn('Error fetching cotizacion:', err));

        if (!noDocERP) return;
        setLoading(true);
        api.get(`/quotation/${encodeURIComponent(noDocERP)}`)
            .then(res => {
                setCabecera(res.data.cabecera);
                setLineas(res.data.detalle.map((l, i) => ({ ...l, _tempId: i })));
            })
            .catch(err => setError(err.response?.data?.error || err.message))
            .finally(() => setLoading(false));
    }, [noDocERP]);

    const handleChange = useCallback((updated) => {
        setLineas(prev => prev.map(l => l._tempId === updated._tempId ? updated : l));
    }, []);

    const handleDelete = useCallback((tempId) => {
        setLineas(prev => prev.filter(l => l._tempId !== tempId));
    }, []);

    const handleRecalculateLine = async (line) => {
        if (!line.CodArticulo) return;
        
        try {
            const res = await api.post('/prices/calculate', {
                codArticulo: line.CodArticulo,
                cantidad: line.Cantidad,
                clienteId: cabecera?.CliIdCliente || cabecera?.ClienteID || cabecera?.CodCliente,
                areaId: line.AreaIDInterna || line.AreaID,
                datoTecnicoValue: line.DatoTecnico,
                variables: { 
                    isUrgente: line.Prioridad?.toUpperCase() === 'URGENTE',
                    ordenId: line.OrdenID || line.OrdenIDExterna || null
                }
            });
            
            const cotizacionData = res.data;
            if (cotizacionData.precioUnitario !== undefined) {
                setLineas(prev => prev.map(l => {
                    if (l._tempId === line._tempId) {
                        // Evitar sobreescritura de estado si el usuario modificó cantidad o dato técnico en el intermedio
                        if (parseFloat(l.Cantidad) !== parseFloat(line.Cantidad) || parseFloat(l.DatoTecnico || 0) !== parseFloat(line.DatoTecnico || 0)) {
                            console.log(`[QuotationEditModal] Recálculo descartado para línea ${line.CodArticulo} debido a cambio de valores.`);
                            return l;
                        }
                        return {
                            ...l,
                            PrecioUnitario: cotizacionData.precioUnitario,
                            Moneda: cotizacionData.moneda || l.Moneda,
                            PrecioUnitarioOriginal: cotizacionData.precioUnitarioOriginal || cotizacionData.precioUnitario,
                            SubtotalOriginal: cotizacionData.precioTotalOriginal || cotizacionData.precioTotal,
                            MonedaOriginal: cotizacionData.monedaOriginal || cotizacionData.moneda,
                            PerfilAplicado: (cotizacionData.perfilesAplicados && cotizacionData.perfilesAplicados.length > 0) ? cotizacionData.perfilesAplicados.join(', ') : 'Precio Base',
                            PricingTrace: cotizacionData.txt || 'Recalculado automático'
                        };
                    }
                    return l;
                }));
            }
        } catch (err) {
            console.error('Error recalculating line price:', err);
        }
    };

    const handleRecalculateAll = async () => {
        setRecalculating(true);
        setError('');
        try {
            await Promise.all(lineas.map(l => handleRecalculateLine(l)));
            setSuccess('Perfiles de precio recargados y recalculados.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
            console.error(e);
            setError('Error al recalcular precios masivamente.');
        } finally {
            setRecalculating(false);
        }
    };

    const handlePickProduct = (product) => {
        // Intentar buscar una línea que pertenezca al área en la que estamos parados
        let targetArea = areaFilter !== 'TODOS' ? areaFilter : (product.AreaID || userArea);
        const baseLine = lineas.find(l => (l.AreaID === targetArea || l.AreaIDInterna === targetArea) && l.OrdenID) || lineas.find(l => l.OrdenID) || {};
        
        const newLine = {
            _tempId: Date.now(),
            OrdenID: baseLine.OrdenID || null,
            CodigoOrden: baseLine.CodigoOrden ? `${baseLine.CodigoOrden} (Extra)` : (cabecera?.NoDocERP ? `${cabecera.NoDocERP} (Extra)` : null),
            Prioridad: baseLine.Prioridad || 'Normal',
            CodArticulo: product.CodArticulo,
            ProIdProducto: product.ProIdProducto,
            NombreArticulo: product.Descripcion,
            DescripcionArticulo: product.Descripcion,
            Cantidad: 1,
            PrecioUnitario: product.PrecioBase || 0,
            Subtotal: product.PrecioBase || 0,
            PrecioUnitarioOriginal: product.PrecioBase || 0,
            SubtotalOriginal: product.PrecioBase || 0,
            MonedaOriginal: product.MonedaOriginal || product.Moneda || cabecera?.Moneda || 'UYU',
            Moneda: product.Moneda || cabecera?.Moneda || 'UYU',
            PerfilAplicado: 'Manual',
            PricingTrace: 'Agregado manualmente',
            AreaID: product.AreaID,
            AreaIDInterna: product.AreaID,
            DatoTecnico: 0
        };
        setLineas(prev => [...prev, newLine]);
        setActiveProductSearch(null);
        handleRecalculateLine(newLine);
    };

    const handlePickProductInline = (tempId, product) => {
        const existingLine = lineas.find(l => l._tempId === tempId);
        if (existingLine) {
            const newLine = {
                ...existingLine,
                CodArticulo: product.CodArticulo,
                ProIdProducto: product.ProIdProducto,
                NombreArticulo: product.Descripcion,
                DescripcionArticulo: product.Descripcion,
                AreaID: product.AreaID,
                AreaIDInterna: product.AreaID,
                PrecioUnitario: product.PrecioBase || 0,
                PrecioUnitarioOriginal: product.PrecioBase || 0,
                Moneda: product.Moneda || existingLine.Moneda || 'UYU',
                MonedaOriginal: product.MonedaOriginal || product.Moneda || 'UYU',
                PerfilAplicado: 'Manual',
                PricingTrace: 'Producto cambiado, calculando...'
            };
            handleChange(newLine);
            handleRecalculateLine(newLine);
        }
    };

    const [puntuacionAjustable, setPuntuacionAjustable] = useState({});

    // DETERMINAR MONEDA FINAL
    const monedaFinal = useMemo(() => {
        return lineas.some(l => l.Moneda === 'USD') ? 'USD' : 'UYU';
    }, [lineas]);

    // Permisos y estados calculados
    const totalCalculadoFinal = lineas.reduce((acc, line) => {
        const sub = (parseFloat(line.Cantidad) || 0) * (parseFloat(line.PrecioUnitario) || 0);
        if (monedaFinal === 'USD') {
            return acc + (line.Moneda === 'UYU' ? sub / (cotizacion || 40) : sub);
        } else {
            return acc + (line.Moneda === 'USD' ? sub * (cotizacion || 40) : sub);
        }
    }, 0);
    
    // We compare with a small epsilon to avoid float matching issues, however we are changing to USD
    // so we will always consider it a change if DB was in UYU. To simplify let's just allow save if valid.
    const hayDiferencia = lineas.length > 0;

    const handleSave = async (forzarConfirmacion = false) => {
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            const payload = lineas.map(l => ({
                OrdenID: l.OrdenID,
                CodArticulo: l.CodArticulo,
                ProIdProducto: l.ProIdProducto,
                Cantidad: parseFloat(l.Cantidad) || 0,
                PrecioUnitario: parseFloat(l.PrecioUnitario) || 0,
                LogPrecioAplicado: l.LogPrecioAplicado || 'Manual',
                PerfilAplicado: l.PerfilAplicado || 'Manual',
                PricingTrace: l.PricingTrace || 'Edición manual',
                Moneda: l.Moneda || 'UYU',
                MonedaOriginal: l.MonedaOriginal || l.Moneda || 'UYU',
                PrecioUnitarioOriginal: parseFloat(l.PrecioUnitarioOriginal) || parseFloat(l.PrecioUnitario) || 0,
                SubtotalOriginal: parseFloat(l.SubtotalOriginal) || ((parseFloat(l.Cantidad) || 0) * (parseFloat(l.PrecioUnitarioOriginal) || parseFloat(l.PrecioUnitario) || 0)),
                DatoTecnico: parseFloat(l.DatoTecnico) || null
            }));
            await api.put(`/quotation/${encodeURIComponent(noDocERP)}`, {
                lineas: payload,
                cotizacion,
                confirmado: forzarConfirmacion,
                propagarADeposito
            });
            setSuccess('✅ Cotización guardada. El QR y los importes fueron actualizados.');
            if (onSaved) onSaved();
        } catch (err) {
            if (err.response?.status === 409 && err.response?.data?.requiereConfirmacion) {
                const advertencias = err.response.data.advertencias || [];
                const detalle = advertencias.map(a => `• ${a.mensaje}`).join('\n');
                setSaving(false);
                const confirmar = window.confirm(
                    `Esta orden ya avanzó de estado:\n\n${detalle}\n\n¿Confirmás modificar la cotización de todas formas? ` +
                    `Se va a actualizar el importe en depósito/retiro/cuenta corriente.`
                );
                if (confirmar) {
                    return handleSave(true);
                }
                setError('Guardado cancelado por el usuario.');
                return;
            }
            setError(err.response?.data?.error || err.message);
        } finally {
            setSaving(false);
        }
    };

    if (embedded) {
        return (
            <div className="flex flex-col h-full w-full bg-white rounded-xl shadow-sm overflow-hidden border border-slate-200">
                {/* Header embedded */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-white shrink-0">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-file-invoice-dollar text-indigo-600" />
                            Tracking y Edición de Cotización
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5 font-mono font-bold">{noDocERP}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={handleRecalculateAll} 
                            disabled={recalculating || loading}
                            className={`px-3 py-1.5 text-xs font-bold rounded shadow-sm flex items-center gap-1.5 transition-all mt-1 border
                                ${recalculating ? 'text-indigo-600 bg-indigo-50 border-indigo-200 cursor-wait' : 'text-slate-600 hover:text-indigo-600 bg-slate-50 border-slate-200 hover:border-indigo-300'}`}
                            title="Recargar precios según base de datos"
                        >
                            {recalculating ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-cloud-arrow-down" />}
                            {recalculating ? 'Recalculando...' : 'Recargar Precios'}
                        </button>
                        {cabecera && (
                            <div className="text-right border-l pl-4 ml-2 border-slate-200">
                                <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Cotización USD</div>
                                <div className="text-base font-black text-slate-700 font-mono"><span className="text-sm text-slate-400 font-normal mr-1">UYU</span>{cotizacion?.toFixed(2)}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">

                    {loading && (
                        <div className="flex justify-center items-center py-20">
                            <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-300" />
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            ⚠️ {error}
                        </div>
                    )}

                    {!loading && success && (
                        <div className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            {success}
                        </div>
                    )}

                    {/* Aviso de permisos */}
                    {!loading && !isAdmin && userArea && (
                        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
                            <i className="fa-solid fa-shield-halved" />
                            Área <strong>{userArea}</strong> — solo podés modificar las líneas de tu área.
                        </div>
                    )}

                    {!loading && (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                            <table className="w-full text-sm text-left min-w-[800px]">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20">Área</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase">Producto</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase">Orden</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Cantidad</th>
                                        {showTechnicalData && (
                                            <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24 line-clamp-1" title="Dato Técnico">Dato Téc.</th>
                                        )}
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20">Moneda</th>
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Precio U.</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Subtotal</th>
                                        <th className="px-3 py-3 text-xs font-bold text-indigo-500 uppercase text-right w-28 bg-indigo-50/50">En {monedaFinal}</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center">Perfil</th>
                                        <th className="px-3 py-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineas.map(line => (
                                        <LineRow
                                            key={line._tempId}
                                            line={line}
                                            userArea={userArea}
                                            isAdmin={isAdmin}
                                            areaFilter={areaFilter}
                                            cotizacion={cotizacion}
                                            monedaFinal={monedaFinal}
                                            onChange={handleChange}
                                            onDelete={handleDelete}
                                            onRecalculate={handleRecalculateLine}
                                            allProducts={allProducts}
                                            onProductChange={handlePickProductInline}
                                            showTechnicalData={showTechnicalData}
                                            showOrderColumn={true}
                                            readOnly={readOnly}
                                        />
                                    ))}

                                    {/* Botón + Agregar Línea */}
                                    {!readOnly && activeProductSearch === null && (
                                        <tr>
                                            <td colSpan={showTechnicalData ? 9 : 8} className="px-3 py-2 border-t border-dashed border-slate-200">
                                                <button
                                                    onClick={() => setActiveProductSearch('add')}
                                                    className="flex items-center gap-2 text-sm font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
                                                >
                                                    <i className="fa-solid fa-plus-circle" />
                                                    Agregar línea
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Modal buscador de producto para nueva línea */}
                    {activeProductSearch === 'add' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 ">
                            <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden border border-slate-200">
                                <ProductSearchPanel
                                    onSelect={handlePickProduct}
                                    onCancel={() => setActiveProductSearch(null)}
                                    isAdmin={isAdmin}
                                    userArea={userArea}
                                    forceArea={areaFilter !== 'TODOS' ? areaFilter : null}
                                />
                            </div>
                        </div>
                    )}

                    {/* Total calculado */}
                    {!loading && (
                        <div className="flex justify-end mt-3">
                            <div className={`px-5 py-2 rounded-xl border font-bold font-mono text-lg shadow-sm transition-colors text-emerald-800 bg-emerald-50 border-emerald-200`}>
                                Nuevo Total: {monedaFinal} {totalCalculadoFinal.toFixed(2)}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-end shrink-0 gap-3">
                    {!readOnly && (
                        <button onClick={() => handleSave()} disabled={saving || loading}
                            className={`px-8 py-2.5 rounded-lg font-bold text-white text-sm transition-all shadow-md flex items-center gap-2
                                ${saving ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-200 hover:scale-105 active:scale-95'}`}>
                            {saving
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Guardando...</>
                                : <><i className="fa-solid fa-floppy-disk" /> Guardar Cotización</>}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60  p-4">
            <div className="bg-white w-full max-w-[95vw] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-white shrink-0">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-file-invoice-dollar text-indigo-600" />
                            Confirmación de Cotización
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5 font-mono font-bold">{noDocERP}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={handleRecalculateAll} 
                            disabled={recalculating || loading}
                            className={`px-3 py-1.5 text-xs font-bold rounded shadow-sm flex items-center gap-1.5 transition-all mt-1 border
                                ${recalculating ? 'text-indigo-600 bg-indigo-50 border-indigo-200 cursor-wait' : 'text-slate-600 hover:text-indigo-600 bg-slate-50 border-slate-200 hover:border-indigo-300'}`}
                            title="Recargar precios según base de datos"
                        >
                            {recalculating ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-cloud-arrow-down" />}
                            {recalculating ? 'Recalculando...' : 'Recargar Precios'}
                        </button>
                        {cabecera && (
                            <div className="text-right border-l pl-4 ml-2 border-slate-200">
                                <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Cotización USD</div>
                                <div className="text-base font-black text-slate-700 font-mono"><span className="text-sm text-slate-400 font-normal mr-1">UYU</span>{cotizacion?.toFixed(2)}</div>
                            </div>
                        )}
                        <button onClick={onClose} className="text-slate-400 hover:text-white hover:bg-red-500 bg-slate-100 rounded-full w-9 h-9 flex items-center justify-center transition-all shadow-sm border border-slate-200 border-transparent">
                            <i className="fa-solid fa-times" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">

                    {loading && (
                        <div className="flex justify-center items-center py-20">
                            <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-300" />
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            ⚠️ {error}
                        </div>
                    )}

                    {!loading && success && (
                        <div className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            {success}
                        </div>
                    )}

                    {/* Aviso de permisos */}
                    {!loading && !isAdmin && userArea && (
                        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
                            <i className="fa-solid fa-shield-halved" />
                            Área <strong>{userArea}</strong> — solo podés modificar las líneas de tu área.
                        </div>
                    )}

                    {!loading && (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20">Área</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase">Producto</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Cantidad</th>
                                        {showTechnicalData && (
                                            <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24 line-clamp-1" title="Dato Técnico">Dato Téc.</th>
                                        )}
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20">Moneda</th>
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Precio U.</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Subtotal</th>
                                        <th className="px-3 py-3 text-xs font-bold text-indigo-500 uppercase text-right w-28 bg-indigo-50/50">En {monedaFinal}</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center">Perfil</th>
                                        <th className="px-3 py-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineas.map(line => (
                                        <LineRow
                                            key={line._tempId}
                                            line={line}
                                            userArea={userArea}
                                            isAdmin={isAdmin}
                                            areaFilter={areaFilter}
                                            cotizacion={cotizacion}
                                            monedaFinal={monedaFinal}
                                            onChange={handleChange}
                                            onDelete={handleDelete}
                                            onRecalculate={handleRecalculateLine}
                                            allProducts={allProducts}
                                            onProductChange={handlePickProductInline}
                                            showTechnicalData={showTechnicalData}
                                            showOrderColumn={false}
                                            readOnly={readOnly}
                                        />
                                    ))}

                                    {/* Botón + Agregar Línea */}
                                    {!readOnly && activeProductSearch === null && (
                                        <tr>
                                            <td colSpan={showTechnicalData ? 9 : 8} className="px-3 py-2 border-t border-dashed border-slate-200">
                                                <button
                                                    onClick={() => setActiveProductSearch('add')}
                                                    className="flex items-center gap-2 text-sm font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
                                                >
                                                    <i className="fa-solid fa-plus-circle" />
                                                    Agregar línea
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Modal buscador de producto para nueva línea */}
                    {activeProductSearch === 'add' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 ">
                            <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden border border-slate-200">
                                <ProductSearchPanel
                                    onSelect={handlePickProduct}
                                    onCancel={() => setActiveProductSearch(null)}
                                    isAdmin={isAdmin}
                                    userArea={userArea}
                                    forceArea={areaFilter !== 'TODOS' ? areaFilter : null}
                                />
                            </div>
                        </div>
                    )}

                    {/* Total calculado */}
                    {!loading && (
                        <div className="flex justify-end mt-3">
                            <div className={`px-5 py-2 rounded-xl border font-bold font-mono text-lg shadow-sm transition-colors text-emerald-800 bg-emerald-50 border-emerald-200`}>
                                Nuevo Total: {monedaFinal} {totalCalculadoFinal.toFixed(2)}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between shrink-0">
                    <button onClick={onClose}
                        className="px-5 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 hover:border-slate-400 rounded-lg transition-all shadow-sm">
                        {readOnly ? 'Cerrar' : 'Cancelar'}
                    </button>
                    {!readOnly && (
                        <button onClick={() => handleSave()} disabled={saving || loading}
                            className={`px-8 py-2.5 rounded-lg font-bold text-white text-sm transition-all shadow-md flex items-center gap-2
                                ${saving ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-200 hover:scale-105 active:scale-95'}`}>
                            {saving
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Guardando...</>
                                : <><i className="fa-solid fa-floppy-disk" /> Guardar Confirmación</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
