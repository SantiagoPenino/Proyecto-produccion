import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// Componente de Grupo Colapsable
const PriceGroup = ({ label, items, pendingChanges, onPriceChange }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border-b border-slate-100 last:border-0">
            <div
                className="flex items-center gap-2 p-3 bg-slate-50/50 hover:bg-slate-100 cursor-pointer select-none transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <i className={`fa-solid fa-folder${expanded ? '-open' : ''} text-amber-400 decoration-slate-300`}></i>
                <span className="font-bold text-slate-700 text-sm flex-1">{label || 'Sin Familia'}</span>
                <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{items.length}</span>
                <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-400 text-xs`}></i>
            </div>

            {expanded && (
                <div className="pl-4 border-l-2 border-slate-100 ml-4 mb-2">
                    <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-slate-100/50">
                            {items.map(item => (
                                <PriceRow
                                    key={item.CodArticulo}
                                    item={item}
                                    pendingVal={pendingChanges[item.CodArticulo]}
                                    onChange={onPriceChange}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// Componente Fila Editable (Optimizado para Bulk)
const PriceRow = ({ item, pendingVal, onChange }) => {
    // Si pendingVal existe, es el valor mostrado. Si no, el valor original.
    const displayVal = pendingVal !== undefined ? pendingVal : (item.Precio || 0);
    const isDirty = pendingVal !== undefined && pendingVal !== item.Precio;

    return (
        <tr className="hover:bg-slate-50 group transition-colors">
            <td className="p-3 font-mono text-slate-600 font-medium w-32">{item.CodArticulo}</td>
            <td className="p-3 text-slate-800">{item.Descripcion || <span className="text-slate-400 italic">Sin descripción</span>}</td>
            <td className="p-3 text-right">
                <input
                    type="number" step="0.01"
                    className={`
                        w-28 text-right border rounded px-2 py-1 outline-none transition-all font-mono text-sm
                        ${isDirty
                            ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-100 font-bold text-slate-900 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                        }
                    `}
                    placeholder="0.00"
                    value={displayVal}
                    onChange={(e) => onChange(item.CodArticulo, e.target.value)}
                    onFocus={(e) => e.target.select()}
                />
            </td>
            <td className="p-3 text-center text-xs text-slate-500 w-24">{item.Moneda || 'UYU'}</td>
            <td className="p-3 text-right w-12">
                {isDirty && <span className="text-amber-500 animate-pulse">●</span>}
            </td>
        </tr>
    );
};

const BasePrices = () => {
    // --- ESTADO ---
    const [prices, setPrices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');

    // Cambios Pendientes
    const [pendingChanges, setPendingChanges] = useState({}); // { Cod: Val }

    // Simulador
    const [simCode, setSimCode] = useState('');
    const [simClient, setSimClient] = useState('');
    const [simResult, setSimResult] = useState(null);

    useEffect(() => {
        loadPrices();
    }, []);

    const loadPrices = () => {
        setLoading(true);
        api.get('/prices/base')
            .then(res => setPrices(res.data))
            .catch(e => toast.error("Error al cargar precios base"))
            .finally(() => setLoading(false));
    };

    const handlePriceChange = (cod, valStr) => {
        const val = valStr === '' ? 0 : parseFloat(valStr);
        setPendingChanges(prev => ({ ...prev, [cod]: val }));
    };

    const handleSaveAll = async () => {
        const itemsToSave = Object.entries(pendingChanges).map(([cod, val]) => ({
            codArticulo: cod,
            precio: val,
            moneda: 'UYU'
        }));

        if (itemsToSave.length === 0) return;

        try {
            await api.post('/prices/base/bulk', { items: itemsToSave });
            toast.success(`${itemsToSave.length} precios actualizados correctamente`);
            setPendingChanges({}); // Limpiar cambios
            loadPrices(); // Recargar
        } catch (e) {
            toast.error("Error guardando precios: " + e.message);
        }
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

    // Filtrado
    const filtered = prices.filter(p =>
        (p.CodArticulo || '').toLowerCase().includes(filter.toLowerCase()) ||
        (p.Descripcion || '').toLowerCase().includes(filter.toLowerCase())
    );

    // Agrupación
    const groupedItems = useMemo(() => {
        if (filter) return null; // Si filtra, mostrar plano

        const groups = {};
        prices.forEach(p => {
            const key = p.SupFlia ? `${p.SupFlia} ${p.Grupo ? '- ' + p.Grupo : ''}` : 'Otros / Sin Familia';
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        });

        // Ordenar claves
        const sortedKeys = Object.keys(groups).sort();
        const sortedGroups = {};
        sortedKeys.forEach(k => sortedGroups[k] = groups[k]);

        return sortedGroups;
    }, [prices, filter]);

    const changesCount = Object.keys(pendingChanges).length;

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden p-6 gap-6 relative">

            {/* FLOATING SAVE BAR (Si hay cambios) */}
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
                        onClick={() => setPendingChanges({})}
                        className="text-slate-400 hover:text-white px-2"
                        title="Descartar cambios"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* ENCABEZADO */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Precios Base (Estándar)</h1>
                    <p className="text-slate-500 text-sm">Define el precio de lista para todos los productos.</p>
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
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 animate-in fade-in slide-in-from-top-4">
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

            {/* TABLA PRECIOS */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <input
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64 focus:ring-2 focus:ring-indigo-100 outline-none"
                        placeholder="Buscar producto (filtra y aplana)..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                    <div className="text-xs text-slate-400">
                        {filter ? `Resultados: ${filtered.length}` : `Total: ${prices.length} productos`}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="p-8 text-center text-slate-400">Cargando precios...</div>
                    ) : (
                        <>
                            {/* VISTA PLANA (SearchResults) */}
                            {!groupedItems && (
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="p-3 border-b">Código</th>
                                            <th className="p-3 border-b">Descripción</th>
                                            <th className="p-3 border-b text-right">Precio Base ($)</th>
                                            <th className="p-3 border-b text-center">Moneda</th>
                                            <th className="p-3 border-b"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filtered.map(item => (
                                            <PriceRow
                                                key={item.CodArticulo}
                                                item={item}
                                                pendingVal={pendingChanges[item.CodArticulo]}
                                                onChange={handlePriceChange}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {/* VISTA AGRUPADA (Folders) */}
                            {groupedItems && (
                                <div className="flex flex-col">
                                    {Object.entries(groupedItems).map(([groupName, items]) => (
                                        <PriceGroup
                                            key={groupName}
                                            label={groupName}
                                            items={items}
                                            pendingChanges={pendingChanges}
                                            onPriceChange={handlePriceChange}
                                        />
                                    ))}
                                    {Object.keys(groupedItems).length === 0 && <div className="p-8 text-center text-slate-400">Sin datos.</div>}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BasePrices;
