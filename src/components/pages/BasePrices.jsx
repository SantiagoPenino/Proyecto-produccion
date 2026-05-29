import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// --- HELPERS PARA UNIDADES Y PRECIOS ---

const getMetricUnit = (categoria) => {
    const cat = (categoria || '').toUpperCase();
    if (cat.includes('BORDAD') || cat.includes('EMB') || cat.includes('BOR')) return 'pts';
    if (cat.includes('ESTAMPAD') || cat.includes('EST')) return 'baj.';
    return 'u.';
};

const calculateDiscountPct = (baseVal, fixedVal) => {
    const base = parseFloat(baseVal);
    const fixed = parseFloat(fixedVal);
    if (!base || isNaN(base) || !fixed || isNaN(fixed) || base <= 0) return null;
    const diff = base - fixed;
    const pct = (diff / base) * 100;
    return pct.toFixed(0);
};

const calculateFinalPrice = (baseVal, pctVal) => {
    const base = parseFloat(baseVal);
    const pct = parseFloat(pctVal);
    if (!base || isNaN(base) || isNaN(pct)) return null;
    const finalPrice = base * (1 - pct / 100);
    return finalPrice.toFixed(2);
};

// Componente de Grupo Colapsable
const PriceGroup = ({ 
    label, 
    items, 
    pendingChanges, 
    onPriceChange, 
    onAddPrice,
    profile,
    qtyColumns = [],
    profileRules = [],
    pendingTieredChanges = {},
    onTieredChange,
    onAddQtyColumn,
    onRemoveQtyColumn,
    onRenameQtyColumn
}) => {
    const [expanded, setExpanded] = useState(false);
    const metricUnit = profile ? getMetricUnit(profile.Categoria) : 'u.';

    // Prepend the virtual TOTAL row if profile exists
    const groupItems = useMemo(() => {
        if (!profile) return items;
        const totalItem = {
            ID: null,
            _tempID: `total-${profile.ID}`,
            CodArticulo: 'TOTAL',
            Descripcion: 'Aplica a TODOS (General)',
            Precio: '-',
            Moneda: 'USD',
            ProIdProducto: 0,
            _isVirtualTotal: true
        };
        return [totalItem, ...items];
    }, [items, profile]);

    return (
        <div className="border-b border-slate-100 last:border-0">
            <div
                className="flex items-center gap-2 p-3 bg-slate-50/50 hover:bg-slate-100 cursor-pointer select-none transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <i className={`fa-solid fa-folder${expanded ? '-open' : ''} text-amber-400 decoration-slate-300`}></i>
                <span className="font-bold text-slate-700 text-sm flex-1">{label || 'Sin Familia'}</span>
                
                {/* Badge con Nombre de Perfil Asociado y Unidad de Medida */}
                {profile && (
                    <div className="flex items-center gap-1.5 mr-4" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100 font-bold">
                            <i className="fa-solid fa-tags mr-1"></i>
                            {profile.Nombre}
                        </span>
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                            Métrica: {metricUnit === 'pts' ? 'Puntadas' : metricUnit === 'baj.' ? 'Bajadas' : 'Unidades'}
                        </span>
                    </div>
                )}

                <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{items.length}</span>
                <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-400 text-xs`}></i>
            </div>

            {expanded && (
                <div className="pl-4 border-l-2 border-slate-100 ml-4 mb-2 overflow-x-auto">
                    <table className="min-w-full text-left text-sm border-collapse">
                        <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 border-b w-32">Código</th>
                                <th className="p-3 border-b">Descripción</th>
                                <th className="p-3 border-b text-right w-28">Precio Base</th>
                                <th className="p-3 border-b text-center w-24">Moneda</th>
                                
                                {/* Columnas de escalas */}
                                {qtyColumns.map(q => (
                                    <th key={q} className="p-3 border-b text-center w-28 relative group/hdr select-none">
                                        Min {q} {metricUnit}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveQtyColumn(profile.ID, q);
                                            }}
                                            className="absolute top-1/2 -translate-y-1/2 right-1 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded w-5 h-5 flex items-center justify-center opacity-0 group-hover/hdr:opacity-100 transition-colors shadow-sm"
                                            title={`Eliminar rango Min ${q}`}
                                        >
                                            ✕
                                        </button>
                                    </th>
                                ))}
                                
                                {/* Botón para agregar nueva escala */}
                                {profile && (
                                    <th className="p-3 border-b text-center w-12 align-middle" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onAddQtyColumn(profile.ID);
                                            }}
                                            className="bg-indigo-100 text-indigo-600 rounded-full w-5 h-5 flex items-center justify-center hover:bg-indigo-200 mx-auto"
                                            title="Agregar columna de cantidad (Rango)"
                                        >
                                            +
                                        </button>
                                    </th>
                                )}
                                
                                <th className="p-3 border-b w-16"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/50">
                            {groupItems.map(item => (
                                <PriceRow
                                    key={item.ID || item._tempID}
                                    item={item}
                                    changes={pendingChanges[item.ID || item._tempID]}
                                    onChange={onPriceChange}
                                    onAdd={onAddPrice}
                                    qtyColumns={qtyColumns}
                                    profileRules={profileRules}
                                    pendingTieredChanges={pendingTieredChanges}
                                    onTieredChange={onTieredChange}
                                    profile={profile}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// Componente Fila Editable con Escalas e Incorporación
const PriceRow = ({ 
    item, 
    changes, 
    onChange, 
    onAdd,
    qtyColumns = [],
    profileRules = [],
    pendingTieredChanges = {},
    onTieredChange,
    profile
}) => {
    const isTotalRow = item._isVirtualTotal || item.CodArticulo === 'TOTAL';
    const displayVal = changes?.precio !== undefined ? changes.precio : (item.Precio || 0);
    const displayMoneda = changes?.moneda !== undefined ? changes.moneda : (item.Moneda || 'UYU');
    const isDirty = changes !== undefined;

    const rowId = item.ID || item._tempID;

    // Obtener reglas activas de este producto específico
    const activeRules = profileRules.filter(r => 
        (isTotalRow && (r.CodArticulo === 'TOTAL' || r.ProIdProducto === 0)) ||
        (!isTotalRow && (r.ProIdProducto === item.ProIdProducto || (item.CodArticulo && r.CodArticulo === item.CodArticulo)))
    );
    
    // Ver si el tipo de regla general se cambió localmente
    const typeChangeKey = profile ? `${profile.ID}-${item.CodArticulo}-type` : null;
    const pendingType = typeChangeKey ? pendingTieredChanges[typeChangeKey]?.tipoRegla : null;
    
    const ruleType = pendingType || (activeRules.length > 0 ? activeRules[0].TipoRegla : 'percentage_discount');

    const handleTypeSelectorChange = (e) => {
        const newType = e.target.value;
        if (!profile) return;
        
        onTieredChange(typeChangeKey, {
            perfilId: profile.ID,
            proIdProducto: item.ProIdProducto,
            codArticulo: item.CodArticulo,
            tipoRegla: newType,
            isTypeChangeOnly: true
        });
        
        // Actualizar tipos de regla de todas las columnas en cambios pendientes
        qtyColumns.forEach(q => {
            const rule = activeRules.find(r => r.CantidadMinima === q);
            const ruleKey = `${profile.ID}-${item.CodArticulo}-${q}`;
            const currentVal = pendingTieredChanges[ruleKey]?.valor !== undefined
                ? pendingTieredChanges[ruleKey].valor
                : (rule ? rule.Valor : '');
            
            if (currentVal !== '') {
                onTieredChange(ruleKey, {
                    id: rule ? rule.ID : null,
                    perfilId: profile.ID,
                    proIdProducto: item.ProIdProducto,
                    codArticulo: item.CodArticulo,
                    cantidadMinima: q,
                    tipoRegla: newType,
                    valor: currentVal,
                    moneda: displayMoneda
                });
            }
        });
    };

    return (
        <tr className={`transition-all duration-150 ${isTotalRow ? 'bg-indigo-50/40 font-semibold border-b-2 border-indigo-100/50' : 'hover:bg-slate-50/80 group'}`}>
            <td className="p-3.5 font-mono text-slate-500 font-bold text-xs align-middle">
                {isTotalRow ? (
                    <span className="text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider">TOTAL</span>
                ) : (
                    item.CodArticulo
                )}
            </td>
            <td className="p-3.5 text-slate-800 align-middle">
                <div className={isTotalRow ? 'text-indigo-950 font-bold text-sm' : 'font-semibold text-slate-700 text-sm'}>
                    {item.Descripcion || <span className="text-slate-400 italic">Sin descripción</span>}
                </div>
                {item._isNew && <span className="inline-block mt-1 text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-extrabold">NUEVO</span>}
                
                {/* Tipo de regla selector (solo si pertenece a un perfil) */}
                {profile && (
                    <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Cálculo:</span>
                        <select
                            className="text-[10px] font-bold text-indigo-600 border border-slate-200 rounded px-1.5 py-0.5 bg-white cursor-pointer outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                            value={ruleType}
                            onChange={handleTypeSelectorChange}
                        >
                            <option value="percentage_discount">Descuento (%)</option>
                            <option value="fixed_price">Precio Fijo ($)</option>
                            <option value="percentage_surcharge">Recargo (%)</option>
                        </select>
                    </div>
                )}
            </td>
            <td className="p-3.5 text-right align-middle w-32">
                {isTotalRow ? (
                    <span className="text-slate-300 font-extrabold text-center block">-</span>
                ) : (
                    <input
                        type="number" step="0.01"
                        className={`
                            w-28 text-right border rounded-lg px-2.5 py-1.5 outline-none transition-all font-mono font-bold text-sm
                            ${isDirty
                                ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-100 text-slate-900 shadow-sm'
                                : 'border-slate-200 bg-slate-50/50 text-slate-700 hover:bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                            }
                        `}
                        placeholder="0.00"
                        value={displayVal}
                        onChange={(e) => onChange(rowId, { precio: e.target.value })}
                        onFocus={(e) => e.target.select()}
                    />
                )}
            </td>
            <td className="p-3.5 text-center w-28 align-middle">
                {isTotalRow ? (
                    <span className="text-slate-300 font-extrabold text-center block">-</span>
                ) : (
                    <select
                        className={`text-xs border rounded-lg p-1.5 font-bold outline-none transition-colors ${isDirty && changes?.moneda !== undefined ? 'bg-amber-50 text-slate-900 border-amber-400 ring-2 ring-amber-100' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-400 focus:ring-2 focus:ring-indigo-100'}`}
                        value={displayMoneda}
                        onChange={(e) => onChange(rowId, { moneda: e.target.value })}
                    >
                        <option value="UYU">UYU</option>
                        <option value="USD">USD</option>
                    </select>
                )}
            </td>

            {/* Celdas de las escalas de volumen */}
            {qtyColumns.map(q => {
                const rule = activeRules.find(r => r.CantidadMinima === q);
                const ruleKey = profile ? `${profile.ID}-${item.CodArticulo}-${q}` : null;
                
                const pendingRule = ruleKey ? pendingTieredChanges[ruleKey] : null;
                const ruleVal = pendingRule?.valor !== undefined 
                    ? pendingRule.valor 
                    : (rule ? rule.Valor : '');
                
                const isRuleDirty = pendingRule !== undefined && pendingRule.valor !== undefined;
                const isDeleted = pendingRule?.action === 'delete';

                const cellSymbol = ruleType.includes('percentage') ? '%' : (displayMoneda === 'USD' ? 'U$S' : '$');
                const isPct = ruleType.includes('percentage');

                // Si NO es la fila TOTAL, buscamos si hay una regla heredada de la fila general
                const totalRule = !isTotalRow && profileRules.find(r => r.CantidadMinima === q && (r.CodArticulo === 'TOTAL' || r.ProIdProducto === 0));
                const isInherited = !isTotalRow && ruleVal === '' && totalRule && !isDeleted;
                
                const effectiveVal = ruleVal !== '' && !isDeleted 
                    ? ruleVal 
                    : (isInherited ? totalRule.Valor : '');

                // Previsualización dinámica de cálculo
                let previewText = '';
                if (effectiveVal !== '' && !isNaN(parseFloat(effectiveVal)) && !isTotalRow) {
                    if (isPct) {
                        const finalPrice = calculateFinalPrice(displayVal, effectiveVal);
                        if (finalPrice !== null) {
                            previewText = `${displayMoneda === 'USD' ? 'U$S' : '$'} ${finalPrice}`;
                        }
                    } else {
                        const discountPct = calculateDiscountPct(displayVal, effectiveVal);
                        if (discountPct !== null) {
                            previewText = `-${discountPct}%`;
                        }
                    }
                }

                return (
                    <td key={q} className="p-3.5 text-center align-middle w-32" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col items-center justify-center gap-1">
                            <div className="relative flex items-center justify-center">
                                <input
                                    type="text"
                                    className={`
                                        w-24 text-center border rounded-lg px-2 py-1.5 outline-none transition-all font-mono font-bold text-xs
                                        ${isDeleted 
                                            ? 'border-red-200 bg-red-50 text-red-400 line-through' 
                                            : isRuleDirty 
                                                ? 'border-indigo-400 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-100' 
                                                : isInherited
                                                    ? 'border-slate-100 bg-slate-100/30 text-slate-400 italic font-normal'
                                                    : 'border-slate-200 bg-slate-50/30 text-slate-700 hover:bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                                        }
                                    `}
                                    placeholder={isInherited ? `${totalRule.Valor}` : '-'}
                                    value={isDeleted ? '' : ruleVal}
                                    onChange={(e) => {
                                        if (!profile) return;
                                        const inputVal = e.target.value;
                                        
                                        if (inputVal === '') {
                                            if (rule) {
                                                onTieredChange(ruleKey, {
                                                    id: rule.ID,
                                                    perfilId: profile.ID,
                                                    proIdProducto: item.ProIdProducto,
                                                    codArticulo: item.CodArticulo,
                                                    cantidadMinima: q,
                                                    tipoRegla: ruleType,
                                                    action: 'delete'
                                                });
                                            } else {
                                                onTieredChange(ruleKey, undefined);
                                            }
                                        } else {
                                            onTieredChange(ruleKey, {
                                                id: rule ? rule.ID : null,
                                                perfilId: profile.ID,
                                                proIdProducto: item.ProIdProducto,
                                                codArticulo: item.CodArticulo,
                                                cantidadMinima: q,
                                                tipoRegla: ruleType,
                                                valor: inputVal,
                                                moneda: displayMoneda
                                            });
                                        }
                                    }}
                                    onFocus={(e) => e.target.select()}
                                />
                                <span className="text-[10px] text-slate-400 font-bold ml-1">{cellSymbol}</span>
                            </div>
                            
                            {/* Previsualización dinámica: Badge o Precio final */}
                            {previewText && (
                                <div className="text-[11px] leading-none mt-1 select-none font-mono">
                                    {isPct ? (
                                        <span className="text-slate-400 font-semibold">
                                            {previewText} {isInherited && <span className="text-[8px] text-slate-300 italic font-sans">(Gen)</span>}
                                        </span>
                                    ) : (
                                        <span className={`inline-block px-1.5 py-0.5 rounded border font-bold text-[9px] ${isInherited ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
                                            {previewText} {isInherited && <span className="text-[8px] opacity-75 font-sans">(Gen)</span>}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </td>
                );
            })}

            {qtyColumns.length > 0 && <td className="w-12"></td>}

            <td className="p-3.5 text-right w-16 align-middle">
                {!isTotalRow && (
                    <div className="flex justify-end items-center gap-2">
                        {isDirty && <span className="text-amber-500 animate-pulse text-[10px]">●</span>}
                        <button
                            onClick={() => onAdd(item)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50"
                            title="Agregar precio en otra moneda"
                        >
                            <i className="fa-solid fa-plus text-xs"></i>
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
};

const BasePrices = () => {
    // --- ESTADO ---
    const [prices, setPrices] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [tieredRules, setTieredRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');

    // Categoría seleccionada (por defecto 'ALL' o la primera que cargue)
    const [selectedGroupKey, setSelectedGroupKey] = useState('ALL');

    // Cambios Pendientes Base
    const [pendingChanges, setPendingChanges] = useState({});
    
    // Cambios Pendientes Escalas
    const [pendingTieredChanges, setPendingTieredChanges] = useState({});

    // Columnas agregadas localmente por perfil
    const [addedColumns, setAddedColumns] = useState({});

    // Modal para agregar/modificar escala de volumen (reemplaza prompts nativos)
    const [scaleModal, setScaleModal] = useState({
        isOpen: false,
        type: 'add',
        profileId: null,
        oldQty: null,
        value: ''
    });

    // Simulador
    const [simCode, setSimCode] = useState('');
    const [simClient, setSimClient] = useState('');
    const [simResult, setSimResult] = useState(null);

    useEffect(() => {
        loadPrices();
    }, []);

    const loadPrices = async () => {
        setLoading(true);
        try {
            const [pricesRes, profilesRes, tieredRes] = await Promise.all([
                api.get('/prices/base'),
                api.get('/profiles'),
                api.get('/prices/tiered')
            ]);
            
            const data = pricesRes.data.map(item => ({
                ...item,
                Precio: item.Precio ?? 0,
                Moneda: item.Moneda || 'UYU',
                _tempID: item.ID ? null : `init-${item.CodArticulo}`
            }));
            
            setPrices(data);
            setProfiles(profilesRes.data || []);
            setTieredRules(tieredRes.data || []);
        } catch (e) {
            console.error("Error loadPrices/profiles:", e);
            toast.error("Error al cargar datos de precios");
        } finally {
            setLoading(false);
        }
    };

    const handlePriceChange = (id, changes) => {
        if (!id) return;
        setPendingChanges(prev => {
            const current = prev[id] || {};
            return { ...prev, [id]: { ...current, ...changes } };
        });
    };

    const handleTieredChange = (key, change) => {
        if (!key) return;
        setPendingTieredChanges(prev => {
            if (change === undefined) {
                const next = { ...prev };
                delete next[key];
                return next;
            }
            return { ...prev, [key]: change };
        });
    };

    const handleAddPrice = (sourceItem) => {
        const newMoneda = (sourceItem.Moneda === 'UYU') ? 'USD' : 'UYU';
        const newItem = {
            ...sourceItem,
            ID: null,
            _tempID: `new-${sourceItem.CodArticulo}-${Date.now()}`,
            Moneda: newMoneda,
            Precio: 0,
            _isNew: true
        };

        const index = prices.findIndex(p => p === sourceItem);
        const newPrices = [...prices];
        newPrices.splice(index + 1, 0, newItem);

        setPrices(newPrices);
        handlePriceChange(newItem._tempID, { precio: 0, moneda: newMoneda });
    };

    const handleSaveAll = async () => {
        const baseIds = Object.keys(pendingChanges);
        const tieredKeys = Object.keys(pendingTieredChanges);

        if (baseIds.length === 0 && tieredKeys.length === 0) return;

        // 1. Preparar precios base
        const baseToSave = [];
        baseIds.forEach(id => {
            const changes = pendingChanges[id];
            const item = prices.find(p => String(p.ID) === id || p._tempID === id);
            if (!item) return;

            baseToSave.push({
                id: item.ID,
                proIdProducto: item.ProIdProducto,
                codArticulo: item.CodArticulo,
                precio: changes.precio !== undefined ? parseFloat(changes.precio) : parseFloat(item.Precio || 0),
                moneda: changes.moneda !== undefined ? changes.moneda : (item.Moneda || 'UYU')
            });
        });

        // 2. Preparar escalas (con parsing a float seguro al momento de guardar)
        const tieredToSave = [];
        tieredKeys.forEach(key => {
            const change = pendingTieredChanges[key];
            if (!change) return;

            if (change.isTypeChangeOnly) return;

            tieredToSave.push({
                id: change.id,
                perfilId: change.perfilId,
                proIdProducto: change.proIdProducto,
                codGrupo: change.codGrupo,
                tipoRegla: change.tipoRegla,
                valor: change.valor !== undefined && change.valor !== '' && change.valor !== null ? parseFloat(change.valor) : null,
                moneda: change.moneda,
                cantidadMinima: change.cantidadMinima,
                action: change.action
            });
        });

        try {
            const promises = [];
            if (baseToSave.length > 0) {
                promises.push(api.post('/prices/base/bulk', { items: baseToSave }));
            }
            if (tieredToSave.length > 0) {
                promises.push(api.post('/prices/tiered/bulk', { items: tieredToSave }));
            }

            await Promise.all(promises);
            toast.success("Precios base y escalas guardados correctamente");
            setPendingChanges({});
            setPendingTieredChanges({});
            setAddedColumns({});
            loadPrices();
        } catch (e) {
            console.error("Error guardando cambios:", e);
            toast.error("Error al guardar: " + e.message);
        }
    };

    const handleAddQtyColumn = (profileId) => {
        setScaleModal({
            isOpen: true,
            type: 'add',
            profileId,
            oldQty: null,
            value: ''
        });
    };

    const handleRemoveQtyColumn = (profileId, q) => {
        if (!window.confirm(`¿Quitar escala Min ${q}? Se borrarán las reglas correspondientes al guardar.`)) return;

        // Buscar reglas activas en DB para marcar de borrado
        const activeRules = tieredRules.filter(r => r.PerfilID === profileId && r.CantidadMinima === q);
        activeRules.forEach(rule => {
            const ruleKey = `${profileId}-${rule.CodArticulo}-${q}`;
            setPendingTieredChanges(prev => ({
                ...prev,
                [ruleKey]: {
                    id: rule.ID,
                    perfilId: profileId,
                    proIdProducto: rule.ProIdProducto,
                    codArticulo: rule.CodArticulo,
                    cantidadMinima: q,
                    action: 'delete'
                }
            }));
        });

        // Quitar de las columnas agregadas localmente
        setAddedColumns(prev => {
            const list = prev[profileId] || [];
            return { ...prev, [profileId]: list.filter(item => item !== q) };
        });

        // Limpiar cambios locales no guardados para esa columna
        setPendingTieredChanges(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                if (key.endsWith(`-${q}`) && key.startsWith(`${profileId}-`)) {
                    if (!next[key].id) delete next[key];
                }
            });
            return next;
        });

        // Eliminar del estado visual inmediatamente
        setTieredRules(prev => prev.filter(r => !(r.PerfilID === profileId && r.CantidadMinima === q)));
    };

    const handleRenameQtyColumn = (profileId, oldQty) => {
        setScaleModal({
            isOpen: true,
            type: 'edit',
            profileId,
            oldQty,
            value: String(oldQty)
        });
    };

    const handleScaleModalSubmit = () => {
        const { type, profileId, oldQty, value } = scaleModal;
        const num = parseInt(value);
        if (isNaN(num) || num <= 1) {
            return toast.error("La cantidad debe ser un número mayor a 1");
        }

        if (type === 'add') {
            const existingColumns = getQtyColumnsForProfile(profileId);
            if (existingColumns.includes(num)) {
                return toast.error(`La escala Min ${num} ya existe en este perfil`);
            }

            setAddedColumns(prev => {
                const list = prev[profileId] || [];
                if (list.includes(num)) return prev;
                return { ...prev, [profileId]: [...list, num].sort((a, b) => a - b) };
            });

            toast.success(`Columna 'Min ${num}' añadida. Ingrese valores y guarde.`);
        } else if (type === 'edit') {
            if (num === oldQty) {
                setScaleModal(prev => ({ ...prev, isOpen: false }));
                return;
            }

            const existingColumns = getQtyColumnsForProfile(profileId);
            if (existingColumns.includes(num) && num !== oldQty) {
                return toast.error(`La escala Min ${num} ya existe en este perfil`);
            }

            // 1. Actualizar las reglas cargadas en memoria
            setTieredRules(prev => prev.map(rule => {
                if (rule.PerfilID === profileId && rule.CantidadMinima === oldQty) {
                    const ruleKey = `${profileId}-${rule.CodArticulo}-${num}`;
                    const originalKey = `${profileId}-${rule.CodArticulo}-${oldQty}`;
                    
                    const existingChange = pendingTieredChanges[originalKey];
                    
                    setPendingTieredChanges(prevChanges => {
                        const next = { ...prevChanges };
                        delete next[originalKey];
                        next[ruleKey] = {
                            id: rule.ID,
                            perfilId: profileId,
                            proIdProducto: rule.ProIdProducto,
                            codArticulo: rule.CodArticulo,
                            cantidadMinima: num,
                            tipoRegla: existingChange?.tipoRegla || rule.TipoRegla,
                            valor: existingChange?.valor !== undefined ? existingChange.valor : rule.Valor,
                            moneda: existingChange?.moneda || rule.Moneda
                        };
                        return next;
                    });

                    return { ...rule, CantidadMinima: num };
                }
                return rule;
            }));

            // 2. Actualizar cambios locales totalmente nuevos (que no tienen ID en DB)
            setPendingTieredChanges(prevChanges => {
                const next = { ...prevChanges };
                Object.keys(next).forEach(key => {
                    if (key.endsWith(`-${oldQty}`) && key.startsWith(`${profileId}-`)) {
                        const change = next[key];
                        if (!change.id) {
                            const newKey = key.replace(`-${oldQty}`, `-${num}`);
                            delete next[key];
                            next[newKey] = {
                                ...change,
                                cantidadMinima: num
                            };
                        }
                    }
                });
                return next;
            });

            // 3. Actualizar columnas locales
            setAddedColumns(prev => {
                const list = prev[profileId] || [];
                return {
                    ...prev,
                    [profileId]: list.map(item => item === oldQty ? num : item).sort((a, b) => a - b)
                };
            });

            toast.success(`Escala modificada de Min ${oldQty} a Min ${num}. Recuerde guardar los cambios.`);
        }

        setScaleModal(prev => ({ ...prev, isOpen: false }));
    };

    const getProfileForGroup = (groupLabel) => {
        const upper = groupLabel.toUpperCase();
        let matchedCat = null;
        if (upper.includes('DTF')) matchedCat = 'DTF';
        else if (upper.includes('TPU')) matchedCat = 'TPU';
        else if (upper.includes('IMPRESION DIRECTA') || upper.includes('IMD')) matchedCat = 'IMD';
        else if (upper.includes('SUBLIMAC') || upper.includes('SB')) matchedCat = 'SB';
        else if (upper.includes('ECOUV')) matchedCat = 'ECOUV';
        else if (upper.includes('ESTAMPAD')) matchedCat = 'Estampados';
        else if (upper.includes('BORDAD')) matchedCat = 'Bordado';

        if (!matchedCat) return null;
        return profiles.find(p => p.Categoria === matchedCat && p.Activo);
    };

    const getQtyColumnsForProfile = (profileId) => {
        if (!profileId) return [];
        const rules = tieredRules.filter(r => r.PerfilID === profileId);
        const quantities = new Set();
        rules.forEach(r => {
            if (r.CantidadMinima > 1) quantities.add(parseInt(r.CantidadMinima));
        });
        
        // Agregar columnas locales
        const localList = addedColumns[profileId] || [];
        localList.forEach(q => quantities.add(q));

        return Array.from(quantities).sort((a, b) => a - b);
    };

    const handleSimulate = () => {
        if (!simCode) return toast.error("Ingresa código de artículo");

        api.post('/prices/calculate', {
            codArticulo: simCode,
            cantidad: 1,
            clienteId: simClient || null
        })
            .then(res => setSimResult(res.data))
            .catch(e => toast.error("Error simulación: " + e.message));
    };

    // Agrupación optimizada con trim() para evitar carpetas duplicadas (ej: ECOUV)
    const groupedItems = useMemo(() => {
        const groups = {};
        prices.forEach(p => {
            const cleanSupFlia = (p.SupFlia || '').trim();
            const cleanGrupo = (p.Grupo || '').trim();
            const cleanRef = (p.NombreReferenciaGrupo || '').trim();

            let key = cleanSupFlia ? `${cleanSupFlia}${cleanGrupo ? ' - ' + cleanGrupo : ''}` : 'Otros / Sin Familia';
            if (cleanRef) {
                key += ` (${cleanRef})`;
            }
            
            if (!groups[key]) groups[key] = [];
            groups[key].push({
                ...p,
                SupFlia: cleanSupFlia,
                Grupo: cleanGrupo,
                NombreReferenciaGrupo: cleanRef
            });
        });

        const sortedKeys = Object.keys(groups).sort();
        const sortedGroups = {};
        sortedKeys.forEach(k => sortedGroups[k] = groups[k]);

        return sortedGroups;
    }, [prices]);

    // Filtrar los productos del grupo seleccionado si se usa el buscador
    const getFilteredGroupItems = (groupName) => {
        const items = groupedItems[groupName] || [];
        if (!filter) return items;
        
        return items.filter(p =>
            (p.CodArticulo || '').toLowerCase().includes(filter.toLowerCase()) ||
            (p.Descripcion || '').toLowerCase().includes(filter.toLowerCase())
        );
    };

    // Lista de productos para la pestaña 'ALL' (buscador general)
    const allFiltered = useMemo(() => {
        if (!filter) return prices;
        return prices.filter(p =>
            (p.CodArticulo || '').toLowerCase().includes(filter.toLowerCase()) ||
            (p.Descripcion || '').toLowerCase().includes(filter.toLowerCase())
        );
    }, [prices, filter]);

    const changesCount = Object.keys(pendingChanges).length + Object.keys(pendingTieredChanges).length;

    // Seleccionar por defecto la primera categoría si es que no está en 'ALL' y ya cargaron los datos
    useEffect(() => {
        if (selectedGroupKey === 'ALL' && Object.keys(groupedItems).length > 0 && !filter) {
            setSelectedGroupKey(Object.keys(groupedItems)[0]);
        }
    }, [groupedItems, selectedGroupKey, filter]);

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden p-6 gap-6 relative">

            {/* FLOATING SAVE BAR */}
            {changesCount > 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 animate-in slide-in-from-top-4 fade-in duration-300">
                    <span className="font-bold text-amber-400">{changesCount}</span> cambios pendientes
                    <button
                        onClick={handleSaveAll}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-full text-sm font-bold transition-colors shadow-sm"
                    >
                        Guardar Todo
                    </button>
                    <button
                        onClick={() => { 
                            setPendingChanges({}); 
                            setPendingTieredChanges({}); 
                            setAddedColumns({}); 
                            loadPrices(); 
                        }}
                        className="text-slate-400 hover:text-white px-2"
                        title="Descartar cambios"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* ENCABEZADO */}
            <div className="flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Precios y Escalas de Volumen</h1>
                    <p className="text-slate-500 text-sm">Gestiona precios base y escalas por volumen de forma integrada desde un solo lugar.</p>
                </div>
                <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-200 flex gap-4 items-end">
                    {/* SIMULADOR */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Simular Precio</label>
                        <div className="flex gap-2">
                            <input className="border rounded p-1 text-sm w-32" placeholder="Cód. Art." value={simCode} onChange={e => setSimCode(e.target.value)} />
                            <input className="border rounded p-1 text-sm w-24" placeholder="Cliente ID" value={simClient} onChange={e => setSimClient(e.target.value)} />
                            <button onClick={handleSimulate} className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">
                                <i className="fa-solid fa-calculator"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* RESULTADO SIMULACION */}
            {simResult && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 animate-in fade-in slide-in-from-top-4 shrink-0">
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-indigo-900">Resultado Simulación: {simResult.codArticulo}</h3>
                        <button onClick={() => setSimResult(null)} className="text-indigo-400 hover:text-indigo-700">✕</button>
                    </div>
                    <div className="flex gap-8">
                        <div className="text-3xl font-bold text-indigo-700">
                            $ {simResult.precioTotal.toFixed(2)} <span className="text-sm font-normal text-indigo-500">{simResult.moneda}</span>
                        </div>
                        <div className="flex-1 border-l border-indigo-200 pl-4 text-sm">
                            {simResult.breakdown.map((step, i) => (
                                <div key={i} className="flex justify-between py-1 border-b border-indigo-100 last:border-0">
                                    <span className="text-indigo-800">{step.desc}</span>
                                    <span className={`font-mono ${step.valor < 0 ? 'text-green-600' : 'text-slate-600'}`}>{step.valor > 0 ? '+' : ''}{step.valor.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* MAIN WORKSPACE: SIDEBAR + EDITOR PANE */}
            <div className="flex-1 flex gap-6 overflow-hidden">
                {/* SIDEBAR: Category list */}
                <div className="w-80 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden shrink-0">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                        <h3 className="font-bold text-slate-700 text-sm">Categorías / Familias</h3>
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                            {Object.keys(groupedItems).length} Grupos
                        </span>
                    </div>
                    
                    {/* Buscador de productos rápido */}
                    <div className="p-3 border-b border-slate-100 shrink-0">
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                            <input
                                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                placeholder="Filtrar productos..."
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar bg-slate-50/30">
                        {/* Pestaña Virtual de TODOS los productos */}
                        <div
                            onClick={() => setSelectedGroupKey('ALL')}
                            className={`
                                flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150 select-none border text-xs
                                ${selectedGroupKey === 'ALL'
                                    ? 'bg-indigo-600 border-indigo-600 text-white font-bold shadow-md shadow-indigo-100'
                                    : 'hover:bg-slate-50 border-transparent text-slate-600 hover:text-slate-900'
                                }
                            `}
                        >
                            <i className="fa-solid fa-globe text-sm"></i>
                            <span className="flex-1 truncate">Todos los Productos</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${selectedGroupKey === 'ALL' ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                {allFiltered.length}
                            </span>
                        </div>

                        {loading ? (
                            <div className="p-4 text-center text-slate-400 text-xs">Cargando...</div>
                        ) : (
                            Object.keys(groupedItems).map(groupName => {
                                const isSelected = selectedGroupKey === groupName;
                                const items = getFilteredGroupItems(groupName);
                                const profile = getProfileForGroup(groupName);

                                if (filter && items.length === 0) return null;

                                return (
                                    <div
                                        key={groupName}
                                        onClick={() => setSelectedGroupKey(groupName)}
                                        className={`
                                            flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150 select-none border text-xs
                                            ${isSelected 
                                                ? 'bg-indigo-600 border-indigo-600 text-white font-bold shadow-md shadow-indigo-100' 
                                                : 'hover:bg-slate-100/50 border-transparent text-slate-600 hover:text-slate-900'
                                            }
                                        `}
                                    >
                                        <i className={`fa-solid fa-folder${isSelected ? '-open' : ''} ${isSelected ? 'text-white' : 'text-amber-400'} text-sm`}></i>
                                        <div className="flex-1 min-w-0">
                                            <div className="truncate font-semibold">{groupName}</div>
                                            {profile && (
                                                <div className={`text-[9px] truncate mt-0.5 font-bold ${isSelected ? 'text-indigo-200' : 'text-indigo-500'}`}>
                                                    {profile.Nombre}
                                                </div>
                                            )}
                                        </div>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isSelected ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                            {items.length}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* EDITOR PANE: Main product table grid */}
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                    {selectedGroupKey ? (
                        (() => {
                            const isAllTab = selectedGroupKey === 'ALL';
                            const items = isAllTab ? allFiltered : getFilteredGroupItems(selectedGroupKey);
                            const profile = isAllTab ? null : getProfileForGroup(selectedGroupKey);
                            const qtyColumns = profile ? getQtyColumnsForProfile(profile.ID) : [];
                            const metricUnit = profile ? getMetricUnit(profile.Categoria) : 'u.';

                            // Prepend TOTAL virtual row
                            const groupItems = (profile && items.length > 0) ? [
                                {
                                    ID: null,
                                    _tempID: `total-${profile.ID}`,
                                    CodArticulo: 'TOTAL',
                                    Descripcion: 'Aplica a TODOS (General)',
                                    Precio: '-',
                                    Moneda: 'USD',
                                    ProIdProducto: 0,
                                    _isVirtualTotal: true
                                },
                                ...items
                            ] : items;

                            return (
                                <div className="h-full flex flex-col overflow-hidden">
                                    {/* Editor Header */}
                                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-800">
                                                {isAllTab ? 'Catálogo General de Precios' : selectedGroupKey}
                                            </h2>
                                            {profile && (
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Perfil: <span className="font-bold text-indigo-600">{profile.Nombre}</span> • Métrica: <span className="font-bold text-indigo-600 uppercase">{metricUnit === 'pts' ? 'Puntadas' : metricUnit === 'baj.' ? 'Bajadas' : 'Unidades'}</span>
                                                </p>
                                            )}
                                            {isAllTab && (
                                                <p className="text-xs text-slate-400 mt-0.5">Muestra la lista de precios estándar para todo el catálogo.</p>
                                            )}
                                        </div>
                                        
                                        {/* Botón para añadir escala de cantidad */}
                                        {profile && items.length > 0 && (
                                            <button
                                                onClick={() => handleAddQtyColumn(profile.ID)}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-100 flex items-center gap-1.5"
                                            >
                                                <i className="fa-solid fa-plus"></i> Agregar Escala
                                            </button>
                                        )}
                                    </div>

                                    {/* Table Grid container */}
                                    <div className="flex-1 overflow-auto custom-scrollbar p-4 bg-white">
                                        {items.length === 0 ? (
                                            <div className="p-12 text-center text-slate-400 text-sm">
                                                No se encontraron productos en esta sección.
                                            </div>
                                        ) : (
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead className="bg-slate-50/80 text-slate-500 font-bold sticky top-0 z-10 border-b border-slate-100 text-xs uppercase tracking-wider select-none">
                                                    <tr>
                                                        <th className="p-3.5 w-28 text-left">Código</th>
                                                        <th className="p-3.5 text-left">Producto</th>
                                                        <th className="p-3.5 text-right w-32">Precio Base</th>
                                                        <th className="p-3.5 text-center w-28">Moneda</th>
                                                        {qtyColumns.map(q => (
                                                            <th key={q} className="p-3.5 text-center w-32 relative group/hdr select-none">
                                                                {profile ? (
                                                                    <span
                                                                        onClick={() => handleRenameQtyColumn(profile.ID, q)}
                                                                        className="cursor-pointer hover:underline hover:text-indigo-600 inline-flex items-center gap-1"
                                                                        title="Haga clic para renombrar o cambiar la cantidad de este rango"
                                                                    >
                                                                        Min {q} {metricUnit}
                                                                        <i className="fa-solid fa-pencil text-[9px] opacity-40"></i>
                                                                    </span>
                                                                ) : (
                                                                    `Min ${q} ${metricUnit}`
                                                                )}
                                                                
                                                                {profile && (
                                                                    <button
                                                                        onClick={() => handleRemoveQtyColumn(profile.ID, q)}
                                                                        className="absolute top-1/2 -translate-y-1/2 right-2 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded w-5 h-5 flex items-center justify-center opacity-0 group-hover/hdr:opacity-100 transition-all shadow-sm"
                                                                        title={`Eliminar rango Min ${q}`}
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                )}
                                                            </th>
                                                        ))}
                                                        <th className="p-3.5 w-16"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {groupItems.map(item => (
                                                        <PriceRow
                                                            key={item.ID || item._tempID}
                                                            item={item}
                                                            changes={pendingChanges[item.ID || item._tempID]}
                                                            onChange={handlePriceChange}
                                                            onAdd={handleAddPrice}
                                                            qtyColumns={qtyColumns}
                                                            profileRules={profile ? tieredRules.filter(r => r.PerfilID === profile.ID) : []}
                                                            pendingTieredChanges={pendingTieredChanges}
                                                            onTieredChange={handleTieredChange}
                                                            profile={profile}
                                                        />
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            );
                        })()
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center gap-4">
                            <i className="fa-regular fa-folder-open text-5xl opacity-20"></i>
                            <h3 className="font-bold text-slate-600">Selecciona una categoría</h3>
                            <p className="max-w-xs text-xs">Elige una familia de productos en el listado de la izquierda para ver y editar sus precios.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* MODAL PARA AGREGAR/MODIFICAR ESCALA */}
            {scaleModal.isOpen && (
                <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setScaleModal(prev => ({ ...prev, isOpen: false }))}>
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-150 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-extrabold text-slate-800 text-sm">
                                {scaleModal.type === 'add' ? 'Agregar Escala de Volumen' : 'Modificar Escala de Volumen'}
                            </h3>
                            <button 
                                onClick={() => setScaleModal(prev => ({ ...prev, isOpen: false }))} 
                                className="text-slate-400 hover:text-slate-600 transition-colors w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-100"
                            >
                                <i className="fa-solid fa-xmark text-sm"></i>
                            </button>
                        </div>
                        
                        {/* Body */}
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-[10px] font-extrabold text-slate-450 uppercase tracking-wider mb-1.5">
                                    Cantidad Mínima ({selectedGroupKey && (() => {
                                        const profile = getProfileForGroup(selectedGroupKey);
                                        return profile ? getMetricUnit(profile.Categoria) : 'u.';
                                    })()})
                                </label>
                                <input
                                    type="number"
                                    min="2"
                                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-mono"
                                    placeholder="Ej: 50"
                                    value={scaleModal.value}
                                    onChange={(e) => setScaleModal(prev => ({ ...prev, value: e.target.value }))}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleScaleModalSubmit();
                                    }}
                                    autoFocus
                                />
                                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                                    {scaleModal.type === 'add' 
                                        ? 'Ingrese el volumen a partir del cual se aplicará esta escala.' 
                                        : `Cambiando el volumen mínimo anterior de ${scaleModal.oldQty} unidades.`}
                                </p>
                            </div>
                        </div>
                        
                        {/* Footer */}
                        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                            <button
                                onClick={() => setScaleModal(prev => ({ ...prev, isOpen: false }))}
                                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleScaleModalSubmit}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-100"
                            >
                                {scaleModal.type === 'add' ? 'Aceptar' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BasePrices;
