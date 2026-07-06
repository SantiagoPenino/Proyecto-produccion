import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { toast } from 'sonner';
import PriceCalculatorTest from './PriceCalculatorTest';
import PriceReports from './PriceReports';
import BasePrices from './BasePrices';

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
                className="w-full border rounded px-2 py-1 font-mono text-sm focus:border-indigo-400 outline-none uppercase"
                value={value}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Busca un producto..."
                title="Escribe 'TOTAL' o busca por nombre/código."
                onFocus={() => { if (value === '' || suggestions.length === 0) { setSuggestions(catalog.slice(0, 10)); setShowSuggestions(true); } }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            />
            {selectedProduct && (
                <div className="mt-1 ml-1 leading-tight">
                    <div className="text-[10px] text-slate-500 truncate" title={selectedProduct.Descripcion}>{selectedProduct.Descripcion}</div>
                    {(selectedProduct.GrupoNombre || selectedProduct.Grupo) && <div className="text-[9px] inline-block px-1.5 rounded bg-slate-100 text-slate-500 border border-slate-200 mt-0.5">{selectedProduct.GrupoNombre || selectedProduct.Grupo}</div>}
                </div>
            )}
            {showSuggestions && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 shadow-lg rounded z-50 max-h-60 overflow-y-auto">
                    {suggestions.map(s => (
                        <div
                            key={s.CodArticulo}
                            className="p-2 hover:bg-indigo-50 cursor-pointer text-xs border-b last:border-0 flex justify-between items-center"
                            onClick={() => { onChange(s.CodArticulo); setShowSuggestions(false); }}
                        >
                            <div className="flex flex-col overflow-hidden">
                                <span className="font-bold text-indigo-700">{s.CodArticulo}</span>
                                {(s.GrupoNombre || s.Grupo) && <span className="text-[9px] text-slate-400">{s.GrupoNombre || s.Grupo}</span>}
                            </div>
                            <span className="text-slate-500 truncate max-w-[120px] text-right ml-2" title={s.Descripcion}>{s.Descripcion}</span>
                        </div>
                    ))}
                    {catalog.length === 0 && <div className="p-2 text-xs text-slate-400">Cargando catálogo...</div>}
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4  animate-fade-in">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-lg">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><i className="fa-solid fa-layer-group text-indigo-600"></i> Edición Masiva de Reglas</h3>
                        <p className="text-xs text-slate-500 mt-1">Perfil: <span className="font-bold text-indigo-600">{profileName || 'Sin Nombre'}</span></p>
                    </div>
                    <button onClick={onCancel} className="text-slate-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* IZQUIERDA: Selector Productos */}
                    <div className="w-2/3 border-r flex flex-col p-4 bg-white">
                        <div className="mb-2 flex gap-2">
                            <select
                                className="border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100 bg-white w-40 truncate"
                                value={selectedGroup}
                                onChange={e => setSelectedGroup(e.target.value)}
                            >
                                <option value="">Todos los Grupos</option>
                                {groups.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                            <input
                                className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100 min-w-0"
                                placeholder="Buscar..."
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                            />
                            <button onClick={toggleSelectAll} className={`whitespace-nowrap px-3 py-2 rounded text-xs font-bold transition-colors ${areAllSelected ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title={areAllSelected ? "Deseleccionar visibles" : "Seleccionar visibles"}>
                                <i className={`fa-solid ${areAllSelected ? 'fa-square-minus' : 'fa-check-double'} mr-1`}></i> {areAllSelected ? 'Ninguno' : 'Todos'}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto border rounded bg-slate-50/30">
                            {loading ? <div className="p-4 text-center">Cargando...</div> : filtered.map(p => (
                                <label key={p.CodArticulo} className="flex items-center p-2 hover:bg-indigo-50 border-b last:border-0 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selection.includes(p.CodArticulo)}
                                        onChange={() => toggleSelect(p.CodArticulo)}
                                        className="w-4 h-4 text-indigo-600 rounded mr-3"
                                    />
                                    <div className="overflow-hidden flex-1">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="font-bold text-xs text-slate-700">{p.CodArticulo}</span>
                                            {(p.GrupoNombre || p.Grupo) && <span className="text-[10px] px-1.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 font-semibold max-w-[150px] truncate" title={p.GrupoNombre || p.Grupo}>{p.GrupoNombre || p.Grupo}</span>}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate" title={p.Descripcion}>{p.Descripcion}</div>
                                    </div>
                                    {p.CodArticulo !== 'TOTAL' && <div className="ml-auto font-mono text-xs text-slate-400">${p.Precio}</div>}
                                </label>
                            ))}
                        </div>
                        <div className="mt-2 text-xs text-slate-500 font-bold">
                            {selection.length} productos seleccionados
                        </div>
                    </div>

                    {/* DERECHA: Configuración Reglas Escalonadas */}
                    <div className="w-1/3 p-6 bg-slate-50 flex flex-col shadow-inner">
                        <div className="text-center mb-6">
                            <h4 className="font-bold text-slate-700 flex items-center justify-center gap-2">
                                <i className="fa-solid fa-wand-magic-sparkles text-indigo-500"></i> Reglas a Aplicar
                            </h4>
                            <p className="text-xs text-slate-500 mt-1">Se crearán las siguientes reglas para cada uno de los <b>{selection.length}</b> productos seleccionados.</p>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1">
                            <div className="space-y-3">
                                {scales.map((s, idx) => (
                                    <div key={idx} className="bg-white p-3 rounded border border-slate-200 shadow-sm relative group">
                                        <div className="grid grid-cols-2 gap-3 mb-2">
                                            <div>
                                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Cant. Mínima</label>
                                                <input
                                                    type="number" min="1"
                                                    className="w-full border rounded p-1.5 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400"
                                                    value={s.qty}
                                                    onChange={e => updateScale(idx, 'qty', e.target.value)}
                                                    placeholder="1"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Valor</label>
                                                <input
                                                    type="number" step="0.01"
                                                    className="w-full border rounded p-1.5 text-sm font-bold text-right text-indigo-700 outline-none focus:border-indigo-400"
                                                    value={s.val}
                                                    onChange={e => updateScale(idx, 'val', e.target.value)}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <select
                                                className="w-full border-t border-slate-100 pt-2 mt-1 text-xs outline-none bg-transparent text-slate-500"
                                                value={s.type}
                                                onChange={e => updateScale(idx, 'type', e.target.value)}
                                            >
                                                <option value="fixed_price">Precio Fijo Exacto ($)</option>
                                                <option value="percentage_discount">Descuento Porcentual (%)</option>
                                                <option value="percentage_surcharge">Recargo Porcentual (%)</option>
                                            </select>
                                        </div>

                                        {scales.length > 1 && (
                                            <button
                                                onClick={() => removeScale(idx)}
                                                className="absolute -top-2 -right-2 bg-white text-slate-300 hover:text-red-500 rounded-full w-5 h-5 shadow border border-slate-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <i className="fa-solid fa-times text-xs"></i>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <button onClick={addScale} className="w-full py-2 mt-4 border-2 border-dashed border-indigo-200 text-indigo-500 rounded font-bold text-xs hover:bg-indigo-50 hover:border-indigo-300 transition-colors flex items-center justify-center gap-2">
                                <i className="fa-solid fa-plus"></i> Agregar Otro Rango
                            </button>
                        </div>

                        <button
                            onClick={handleConfirm}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-md transition-all active:scale-95 flex justify-center items-center gap-2 mt-6"
                        >
                            <i className="fa-solid fa-check-circle"></i>
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

    const handleSave = () => {
        // Validar
        const validScales = scales.filter(s => s.qty && s.val !== '');
        if (validScales.length === 0) return toast.error("Define al menos una escala válida");

        // Ordenar por cantidad
        validScales.sort((a, b) => parseInt(a.qty) - parseInt(b.qty));

        // Validation for base qty 1
        if (parseFloat(validScales[0].qty) !== 1) {
            if (!confirm(`La primera escala comienza en cantidad ${validScales[0].qty}. ¿Deseas guardar así?`)) {
                return;
            }
        }

        onSave(validScales, type);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4  animate-fade-in">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg flex flex-col">
                <div className="p-4 border-b bg-slate-50 rounded-t-lg flex justify-between items-center">
                    <h3 className="font-bold text-slate-800"><i className="fa-solid fa-wand-magic-sparkles text-indigo-600 mr-2"></i> {productName}</h3>
                    <button onClick={onCancel} className="text-slate-400 hover:text-red-500"><i className="fa-solid fa-xmark"></i></button>
                </div>
                <div className="p-6">
                    <p className="text-xs text-slate-500 mb-4">Configura precios escalonados (por volumen). Elige si definir precios fijos o descuentos porcentuales sobre el precio de lista.</p>

                    {/* TYPE SELECTOR */}
                    <div className="flex bg-slate-100 p-1 rounded-lg mb-6">
                        <button
                            onClick={() => setType('fixed')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${type === 'fixed' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <i className="fa-solid fa-tag mr-1"></i> Precio Fijo ($)
                        </button>
                        <button
                            onClick={() => setType('percentage')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${type === 'percentage' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <i className="fa-solid fa-percent mr-1"></i> Descuento (%)
                        </button>
                    </div>

                    <div className="space-y-2 mb-4">
                        <div className="flex text-xs font-bold text-slate-500 uppercase tracking-wider px-2 gap-2">
                            <div className="w-1/2">Cant. Mínima</div>
                            <div className="w-1/2">{type === 'fixed' ? 'Precio Unitario ($)' : 'Descuento (%)'}</div>
                            <div className="w-8"></div>
                        </div>
                        {scales.map((s, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                                <div className="w-1/2 relative">
                                    <input
                                        type="number" min="1"
                                        className="w-full border rounded p-2 pl-3 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-200 outline-none font-mono text-sm"
                                        value={s.qty}
                                        onChange={e => updateScale(idx, 'qty', e.target.value)}
                                        placeholder="Ej: 1"
                                    />
                                    <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">u.</span>
                                </div>
                                <div className="w-1/2 relative">
                                    {type === 'fixed' ? (
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                                    ) : (
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">Desc.</span>
                                    )}

                                    <input
                                        type="number" step={type === 'fixed' ? "0.01" : "1"}
                                        className={`w-full border rounded p-2 text-right font-bold text-sm bg-white focus:ring-2 focus:ring-indigo-200 outline-none ${type === 'percentage' ? 'text-green-600 pl-10 pr-6' : 'text-slate-800 pl-6'}`}
                                        value={s.val}
                                        onChange={e => updateScale(idx, 'val', e.target.value)}
                                        placeholder="0"
                                    />
                                    {type === 'percentage' && (
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                                    )}
                                </div>
                                <button onClick={() => removeScale(idx)} className="w-8 text-slate-300 hover:text-red-500 transition-colors">
                                    <i className="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        ))}
                    </div>

                    <button onClick={addScale} className="text-xs text-indigo-600 font-bold hover:underline mb-6 flex items-center gap-1">
                        <i className="fa-solid fa-plus-circle"></i> Agregar Escala
                    </button>

                    <div className="flex gap-3">
                        <button onClick={onCancel} className="flex-1 py-2 border rounded text-slate-600 hover:bg-slate-50 transition-colors font-bold text-sm">Cancelar</button>
                        <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors shadow font-bold text-sm">Guardar Escalas</button>
                    </div>
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
                <i className="fa-solid fa-search absolute left-2 text-xs text-slate-400"></i>
                <input
                    className="w-full border border-red-200 rounded px-2 py-1 pl-7 text-xs font-mono text-red-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-red-50/30 placeholder-red-300"
                    value={value}
                    onChange={e => { setValue(e.target.value); setActive(true); }}
                    onFocus={() => setActive(true)}
                    onBlur={() => setTimeout(() => setActive(false), 200)}
                    placeholder="Buscar producto..."
                    autoFocus
                />
            </div>
            {active && suggestions.length > 0 && (
                <div className="absolute top-full left-0 w-[400px] bg-white border border-slate-200 shadow-xl rounded-lg z-[80] max-h-60 overflow-y-auto mt-1 divide-y divide-slate-100">
                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 border-b">Resultados ({suggestions.length})</div>
                    {suggestions.map(p => (
                        <div
                            key={p.CodArticulo}
                            className="px-3 py-2 hover:bg-indigo-50 cursor-pointer transition-colors"
                            onMouseDown={() => onSelect(p)}
                        >
                            <div className="flex justify-between items-baseline">
                                <span className="font-bold text-indigo-700 text-xs">{p.CodArticulo}</span>
                                <span className="text-[10px] text-slate-400 ml-2">{p.GrupoNombre || p.Grupo}</span>
                            </div>
                            <div className="text-[11px] text-slate-600 truncate">{p.Descripcion}</div>
                        </div>
                    ))}
                </div>
            )}
            {active && value.length >= 2 && suggestions.length === 0 && (
                <div className="absolute top-full left-0 w-64 bg-white border p-3 shadow-xl rounded z-[80] text-xs text-slate-400 italic text-center">
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
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4  animate-fade-in">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-lg">
                    <h3 className="font-bold text-lg text-slate-800"><i className="fa-solid fa-file-excel text-green-600 mr-2"></i> Importar desde Excel</h3>
                    <button onClick={onCancel} className="text-slate-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                {step === 1 ? (
                    <div className="flex-1 p-6 flex flex-col">
                        <p className="mb-2 text-sm text-slate-600">
                            Copia tus celdas de Excel (incluyendo la cabecera) y pégalas aquí.<br />
                            <span className="text-xs text-slate-400">Formato: Primera columna = Producto (Nombre o Código). Resto columnas = Precios por cantidad.</span>
                        </p>
                        <textarea
                            className="flex-1 w-full border rounded p-4 font-mono text-xs bg-slate-50 focus:ring-2 focus:ring-indigo-200 outline-none resize-none"
                            placeholder={"Producto\tMin 15\tMin 30\tMin 100\nTPU XYZ\t3,5\t3,0\t2,5\n..."}
                            value={text}
                            onChange={e => setText(e.target.value)}
                        />
                        <div className="mt-4 flex justify-end">
                            <button onClick={processText} className="btn-primary px-8 py-2 shadow-lg">Analizar Datos <i className="fa-solid fa-arrow-right ml-2"></i></button>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Configuration */}
                        <div className="p-4 bg-indigo-50 border-b flex gap-6 overflow-x-auto items-center">
                            <div className="font-bold text-sm text-indigo-900 whitespace-nowrap">Mapeo de Columnas:</div>
                            {headers.slice(1).map((h, i) => {
                                const colIdx = i + 1;
                                return (
                                    <div key={i} className="flex flex-col gap-1 min-w-[120px]">
                                        <div className="text-[10px] uppercase font-bold text-indigo-400 truncate" title={h}>{h}</div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs text-slate-500">Cant:</span>
                                            <input
                                                type="number"
                                                className="w-16 border rounded px-1 py-0.5 text-sm font-bold text-center"
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
                        <div className="flex-1 overflow-auto p-4 content-start">
                            <table className="w-full text-xs text-left border-collapse">
                                <thead className="bg-slate-100 text-slate-500 sticky top-0 z-10">
                                    <tr>
                                        <th className="p-2 border bg-slate-100">Dato Original</th>
                                        <th className="p-2 border w-80 bg-indigo-50 border-indigo-100 text-indigo-700">Producto Detectado</th>
                                        {headers.slice(1).map((h, i) => (
                                            <th key={i} className={`p-2 border text-center ${colMappings[i + 1] ? 'bg-green-50 text-green-700' : 'bg-slate-50 text-slate-300'}`}>
                                                {colMappings[i + 1] ? `Min ${colMappings[i + 1]}` : '(Ignorar)'}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsedData.map((row, rIdx) => (
                                        <tr key={rIdx} className="hover:bg-slate-50">
                                            <td className="p-2 border font-mono text-slate-500 truncate max-w-[150px]" title={row.term}>{row.term}</td>
                                            <td className="p-2 border relative">
                                                {row.prod ? (
                                                    <div className="flex items-center gap-2 group justify-between">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <i className="fa-solid fa-check text-green-500 flex-shrink-0"></i>
                                                            <div className="min-w-0">
                                                                <div className="font-bold text-slate-700 truncate">{row.prod.CodArticulo}</div>
                                                                <div className="text-[10px] text-slate-400 truncate w-40">{row.prod.Descripcion}</div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => updateRowProduct(rIdx, null)}
                                                            className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                                            title="Cambiar producto"
                                                        >
                                                            <i className="fa-solid fa-pencil"></i>
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
                                                <td key={cIdx} className="p-2 border text-right font-mono">
                                                    {v}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 border-t bg-white flex justify-between items-center">
                            <button onClick={() => setStep(1)} className="text-slate-500 font-bold hover:text-slate-800">Volver a pegar</button>
                            <div className="text-xs text-slate-400">
                                Se importarán reglas solo para los productos confirmados (Check verde).
                            </div>
                            <button onClick={handleImport} className="btn-primary px-6 py-2 shadow-lg">
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
                <i className="fa-solid fa-magnifying-glass absolute left-3 text-slate-400"></i>
                <input
                    className="w-full border border-slate-300 rounded-lg pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none transition-all shadow-sm uppercase font-mono"
                    value={query}
                    onChange={e => handleSearch(e.target.value)}
                    onFocus={() => { if (query) setShowSuggestions(true); }}
                    placeholder={placeholder}
                />
                {query && (
                    <button
                        onClick={() => { setQuery(''); setSuggestions([]); }}
                        className="absolute right-3 text-slate-300 hover:text-slate-500"
                    >
                        <i className="fa-solid fa-times"></i>
                    </button>
                )}
            </div>

            {showSuggestions && (
                <div className="absolute bottom-full mb-1 left-0 w-full bg-white border border-slate-200 shadow-xl rounded-lg z-[100] max-h-80 overflow-y-auto">
                    {suggestions.length > 0 ? (
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0">
                                <tr>
                                    <th className="px-3 py-2">Código</th>
                                    <th className="px-3 py-2">Descripción</th>
                                    <th className="px-3 py-2 text-right">Grupo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {suggestions.map(s => (
                                    <tr
                                        key={s.CodArticulo}
                                        onClick={() => handleSelect(s.CodArticulo)}
                                        className="hover:bg-indigo-50 cursor-pointer transition-colors"
                                    >
                                        <td className="px-3 py-2 font-bold text-indigo-700 whitespace-nowrap">{s.CodArticulo}</td>
                                        <td className="px-3 py-2 text-slate-600 container-query">{s.Descripcion}</td>
                                        <td className="px-3 py-2 text-right text-slate-400 text-[10px]">{s.GrupoNombre || s.Grupo || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="p-4 text-center text-slate-400 text-sm">
                            No se encontraron productos que coincidan.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const TieredPriceTable = ({ items, onUpdate, catalog }) => {
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

    const addQuantityColumn = () => {
        const qty = prompt("Ingrese la cantidad mínima para la nueva columna (ej: 15):");
        if (qty && !isNaN(qty) && qty > 1) {
            toast.info("Columna visual agregada. Ingrese precios para guardar.");
            const firstProd = Object.keys(groupedItems)[0];
            if (firstProd) handlePriceChange(firstProd, parseInt(qty), 0);
        }
    };

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
                <thead>
                    <tr className="bg-slate-100 text-slate-600">
                        <th className="p-3 text-left border overflow-hidden">Producto</th>
                        <th className="p-3 text-center border w-32 bg-indigo-50/50">Base (Min 1)</th>
                        {quantityColumns.map(q => (
                            <th key={q} className="p-3 text-center border w-32 relative group">
                                Min {q}
                                <button
                                    type="button"
                                    className="absolute top-1/2 -translate-y-1/2 right-1 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors shadow-sm"
                                    title="Quitar este Rango"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (window.confirm(`¿Quitar rango Min ${q}? Se borrarán los precios de esta columna en todos los productos de este perfil.`)) {
                                            onUpdate(items.filter(i => parseInt(i.CantidadMinima) !== q));
                                        }
                                    }}
                                ><i className="fa-solid fa-trash-can text-xs"></i></button>
                            </th>
                        ))}
                        <th className="p-3 border w-10">
                            <button onClick={addQuantityColumn} className="bg-indigo-100 text-indigo-600 rounded-full w-6 h-6 flex items-center justify-center hover:bg-indigo-200" title="Agregar Rango de Cantidad">+</button>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {Object.keys(groupedItems).map(cod => {
                        const prod = catalog.find(c => c.CodArticulo === cod);
                        const rules = groupedItems[cod];
                        const baseRule = rules.find(i => parseInt(i.CantidadMinima || 1) === 1);
                        const basePrice = baseRule ? baseRule.Valor : 0;

                        // Detect common type
                        const currentType = (rules[0] && rules[0].TipoRegla) || 'fixed_price';
                        const currentCurrency = (rules[0] && rules[0].Moneda) || 'UYU';
                        const isPercentage = currentType.includes('percentage') || (currentType.includes('discount') && !currentType.includes('fixed'));
                        const symbol = isPercentage ? '%' : (currentCurrency === 'USD' ? 'U$S' : '$');

                        return (
                            <tr key={cod} className="hover:bg-slate-50 border-b group">
                                <td className="p-2 border relative">
                                    <div className="font-bold text-slate-700">{cod}</div>
                                    <div className="text-xs text-slate-500 truncate max-w-[200px] mb-1">{prod ? prod.Descripcion : 'Producto desconocido'}</div>

                                    {/* Type Selector */}
                                    <select
                                        className={`text-[10px] p-1 border rounded bg-white outline-none cursor-pointer w-full max-w-[150px] ${currentType !== 'fixed_price' ? 'text-indigo-600 font-bold border-indigo-200' : 'text-slate-400 opacity-50 group-hover:opacity-100 transition-opacity'}`}
                                        value={currentType}
                                        onChange={(e) => handleTypeChange(cod, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <option value="fixed_price">Precio Fijo</option>
                                        <option value="percentage_discount">Descuento (%)</option>
                                        <option value="percentage_surcharge">Recargo (%)</option>
                                    </select>

                                    {!isPercentage && (
                                        <select
                                            className="text-[10px] p-1 border rounded bg-white outline-none cursor-pointer w-full max-w-[150px] mt-1 text-slate-600 font-bold border-slate-200 opacity-50 group-hover:opacity-100 transition-opacity"
                                            value={currentCurrency}
                                            onChange={(e) => handleCurrencyChange(cod, e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <option value="UYU">UYU (Pesos)</option>
                                            <option value="USD">USD (Dólares)</option>
                                        </select>
                                    )}
                                </td>
                                <td className="p-2 border text-center relative">
                                    <span className={`absolute ${isPercentage ? 'right-2' : 'left-2'} top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold`}>{symbol}</span>
                                    <input
                                        type="number"
                                        className={`w-full outline-none bg-transparent font-bold text-slate-800 ${isPercentage ? 'text-left pr-6' : 'text-right pl-6'}`}
                                        value={basePrice}
                                        onChange={e => handlePriceChange(cod, 1, e.target.value)}
                                    />
                                </td>
                                {quantityColumns.map(q => {
                                    const rule = groupedItems[cod].find(i => parseInt(i.CantidadMinima) === q);
                                    return (
                                        <td key={q} className="p-2 border text-center relative">
                                            <span className={`absolute ${isPercentage ? 'right-2' : 'left-2'} top-1/2 -translate-y-1/2 text-slate-300 text-xs`}>{symbol}</span>
                                            <input
                                                type="number"
                                                className={`w-full outline-none bg-transparent text-slate-600 focus:text-indigo-600 font-medium ${isPercentage ? 'text-left pr-6' : 'text-right pl-6'}`}
                                                value={rule ? rule.Valor : ''}
                                                placeholder="-"
                                                onChange={e => handlePriceChange(cod, q, e.target.value)}
                                            />
                                        </td>
                                    );
                                })}
                                <td className="p-2 border text-center">
                                    <button
                                        onClick={() => onUpdate(items.filter(i => i.CodArticulo !== cod))}
                                        className="text-slate-300 hover:text-red-500 transition-colors"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                    <tr>
                        <td className="p-4 border bg-indigo-50/10" colSpan={quantityColumns.length + 3}>
                            <ProductAdderInput
                                onAdd={addProductRow}
                                catalog={catalog.filter(c => !groupedItems[c.CodArticulo])}
                            />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

const ProfileEditor = ({ profile, onSave, onBack }) => {
    const [name, setName] = useState(profile?.Nombre || '');
    const [desc, setDesc] = useState(profile?.Descripcion || '');
    const [categoria, setCategoria] = useState(profile?.Categoria || 'Todos');
    const [esGlobal, setEsGlobal] = useState(profile?.EsGlobal || false);
    const [showBulk, setShowBulk] = useState(false);
    const [allAreas, setAllAreas] = useState([]);
    const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }

    // Catalogo para lookup
    const [catalog, setCatalog] = useState([]);
    const [viewMode, setViewMode] = useState('matrix'); // 'list' | 'matrix'

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

    return (
        <div className="flex flex-col h-full bg-white p-6 relative">

            {/* Modal de confirmación inline */}
            {confirmDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full mx-4">
                        <div className="flex items-start gap-3 mb-5">
                            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                            </div>
                            <p className="text-sm text-slate-700 leading-relaxed">{confirmDialog.message}</p>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirmDialog(null)}
                                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex justify-between items-center mb-6 border-b pb-4">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <i className="fa-solid fa-arrow-left text-lg"></i>
                    </button>
                    <h2 className="text-xl font-bold text-slate-800">{profile?.ID ? 'Editar Perfil' : 'Nuevo Perfil'}</h2>
                </div>
                <button
                    onClick={() => onSave({ id: profile?.ID, nombre: name, descripcion: desc, items, esGlobal, categoria })}
                    className="btn-primary px-6 py-2 shadow-md hover:shadow-lg transition-all"
                >
                    <i className="fa-solid fa-save mr-2"></i> Guardar Perfil
                </button>
            </div>

            {/* Formulario Datos Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 bg-slate-50 p-4 rounded-lg border border-slate-100">
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre del Perfil</label>
                        <input
                            className="w-full border border-slate-300 rounded p-2 focus:ring-2 focus:ring-indigo-100 outline-none font-bold text-slate-700"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Ej: Mayorista A"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descripción</label>
                        <input
                            className="w-full border border-slate-300 rounded p-2 focus:ring-2 focus:ring-indigo-100 outline-none text-slate-600"
                            value={desc}
                            onChange={e => setDesc(e.target.value)}
                            placeholder="Ej: 20% descuento en toda la tienda"
                        />
                    </div>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría(s)</label>
                        <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50 min-h-[44px] flex flex-wrap gap-1.5">
                            {/* Chip Todos */}
                            <button
                                type="button"
                                onClick={toggleTodos}
                                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all flex items-center gap-1
                                    ${selectedCats.length === 0
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                        : 'bg-white border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                    }`}
                            >
                                {selectedCats.length === 0 && <i className="fa-solid fa-check text-[9px]"></i>}
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
                                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all flex items-center gap-1
                                            ${active
                                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                                : 'bg-white border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                            }`}
                                    >
                                        {active && <i className="fa-solid fa-check text-[9px]"></i>}
                                        {a.AreaNombre || a.CodArea}
                                    </button>
                                );
                            })}
                        </div>
                        {selectedCats.length > 0 && (
                            <p className="text-[11px] text-indigo-600 mt-1 flex items-center gap-1">
                                <i className="fa-solid fa-circle-info"></i>
                                Urgencia activa solo en: <strong>{selectedCats.map(cat => {
                                    const found = allAreas.find(a =>
                                        a.CodArea.toUpperCase() === cat.toUpperCase() ||
                                        (a.AreaNombre || '').toUpperCase() === cat.toUpperCase()
                                    );
                                    return found ? (found.AreaNombre || found.CodArea) : cat;
                                }).join(', ')}</strong>
                            </p>
                        )}
                    </div>
                    <label className="flex items-center gap-3 p-4 border rounded bg-white cursor-pointer hover:border-indigo-300 transition-colors shadow-sm w-full">
                        <input
                            type="checkbox"
                            checked={esGlobal}
                            onChange={e => setEsGlobal(e.target.checked)}
                            className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                        <div>
                            <span className="block font-bold text-slate-700 text-sm">Perfil Global</span>
                            <span className="block text-xs text-slate-500">Aplica por defecto a TODOS.</span>
                        </div>
                    </label>
                </div>
            </div>

            {/* Editor de Reglas */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <i className="fa-solid fa-gavel text-indigo-500"></i> Reglas de Precios
                    </h3>
                    <div className="flex gap-2 items-center">
                        <div className="flex bg-slate-100 p-0.5 rounded border border-slate-200 mr-4">
                            <button
                                onClick={() => setViewMode('list')}
                                className={`px-2 py-1 text-xs font-bold rounded flex items-center gap-1 ${viewMode === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <i className="fa-solid fa-list"></i> Lista
                            </button>
                            <button
                                onClick={() => setViewMode('matrix')}
                                className={`px-2 py-1 text-xs font-bold rounded flex items-center gap-1 ${viewMode === 'matrix' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <i className="fa-solid fa-table-cells"></i> Matriz
                            </button>
                        </div>
                        <button onClick={() => setShowExcel(true)} className="text-xs bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded font-bold shadow-sm flex items-center gap-1 transition-colors border border-green-700">
                            <i className="fa-solid fa-file-excel"></i> Importar Excel
                        </button>
                        <button onClick={() => setShowBulk(true)} className="text-xs bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded font-bold shadow-sm flex items-center gap-1 transition-colors">
                            <i className="fa-solid fa-list-check"></i> Carga Masiva
                        </button>
                        {viewMode === 'list' && (
                            <button onClick={handleAddItem} className="text-xs text-indigo-600 hover:text-indigo-800 font-bold bg-indigo-50 px-3 py-1.5 rounded border border-indigo-100 flex items-center gap-1 transition-colors">
                                <i className="fa-solid fa-plus"></i> Manual
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto border rounded-lg bg-white shadow-inner custom-scrollbar relative">
                    {viewMode === 'matrix' ? (
                        <TieredPriceTable items={items} onUpdate={setItems} catalog={catalog} />
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 w-64">Aplica A (Código)</th>
                                    <th className="p-3">Tipo de Regla</th>
                                    <th className="p-3 w-20 text-center">Cant. Mín</th>
                                    <th className="p-3 w-32 text-right">Valor</th>
                                    <th className="p-3 w-16 text-center"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {Object.keys(groupedList).length === 0 ? (
                                    <tr><td colSpan="5" className="p-8 text-center text-slate-400">Este perfil no tiene reglas definidas.</td></tr>
                                ) : (
                                    Object.keys(groupedList).map(cod => {
                                        const rules = groupedList[cod];
                                        // Es escalonado si hay más de 1 regla o si la única regla tiene min > 1
                                        const isTiered = rules.length > 1 || rules.some(r => r.CantidadMinima > 1);
                                        const baseRule = rules.find(r => !r.CantidadMinima || r.CantidadMinima == 1) || rules[0];
                                        const prod = catalog.find(c => c.CodArticulo === cod);

                                        return (
                                            <tr key={cod} className="hover:bg-slate-50 group">
                                                <td className="p-2 pl-3">
                                                    <div className="font-bold text-indigo-700">{cod}</div>
                                                    <div className="text-xs text-slate-500">{prod ? prod.Descripcion : 'Desconocido'}</div>
                                                </td>
                                                <td className="p-2">
                                                    <select
                                                        className="w-full border rounded px-2 py-1 text-sm bg-white focus:border-indigo-400 outline-none"
                                                        value={isTiered ? 'tiered_wizard' : baseRule.TipoRegla}
                                                        onChange={e => {
                                                            if (e.target.value === 'tiered_wizard') {
                                                                setWizardConfig({ cod, rules });
                                                            } else if (e.target.value === 'formula_wizard') {
                                                                // Open a simple prompt to generate the formula string
                                                                const base = prompt("1. Ingrese el Precio Base (Ej: 50):", "50") || "50";
                                                                const minLimit = prompt(`2. Ingrese hasta qué cantidad aplica el Base de $${base} (Ej: 5000):`, "5000") || "5000";
                                                                const stepQty = prompt("3. Ingrese el tamaño de los bloques adicionales (Ej: 1000):", "1000") || "1000";
                                                                const stepPrice = prompt(`4. Ingrese cuánto cobrar por cada ${stepQty} extra (Ej: 10):`, "10") || "10";

                                                                const formulaStr = `formula_${base}_${minLimit}_${stepPrice}_${stepQty}`;
                                                                const newRule = { ...baseRule, TipoRegla: formulaStr, CantidadMinima: 1 };
                                                                const others = items.filter(i => i.CodArticulo !== cod);
                                                                setItems([...others, newRule]);
                                                                toast.success(`Fórmula configurada correctamente: Base $${base}, +$${stepPrice} cada ${stepQty}`);
                                                            } else {
                                                                // Si estaba en wizard y vuelve a simple, se mantiene la base rule pero se borran las otras?
                                                                // O simplemente actualizamos el tipo de la base rule.
                                                                // Para simplificar: cambio directo en propiedad
                                                                if (isTiered && !confirm("Al cambiar a regla simple se perderán las escalas. ¿Continuar?")) return;

                                                                // Reemplazar todas las reglas de este producto por una sola simple
                                                                const newRule = { ...baseRule, TipoRegla: e.target.value, CantidadMinima: 1 };
                                                                // Filtrar otras
                                                                const others = items.filter(i => i.CodArticulo !== cod);
                                                                setItems([...others, newRule]);
                                                            }
                                                        }}
                                                    >
                                                        <option value="fixed_price">Precio Fijo Exacto ($)</option>
                                                        <option value="tiered_wizard" className="font-bold text-indigo-600">Precios Escalonados (Wizard)</option>
                                                        <option value="percentage_discount">Descuento Porcentual (%)</option>
                                                        <option value="percentage_surcharge">Recargo Porcentual (%)</option>
                                                        <option value="fixed_discount">Descuento Monto ($)</option>
                                                        <option value="fixed_surcharge">Recargo Monto ($)</option>
                                                        <option value="formula_wizard" className="font-bold text-blue-600">Fórmula por Bloques (Ej: Puntadas)</option>
                                                    </select>
                                                </td>
                                                {isTiered ? (
                                                    <td colSpan="2" className="p-2 text-center">
                                                        <button
                                                            onClick={() => setWizardConfig({ cod, rules })}
                                                            className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded border border-indigo-200 font-bold hover:bg-indigo-100 w-full"
                                                        >
                                                            <i className="fa-solid fa-layer-group mr-1"></i> {rules.length} Escalas Definidas - Editar
                                                        </button>
                                                    </td>
                                                ) : baseRule.TipoRegla.startsWith('formula_') ? (
                                                    <td colSpan="2" className="p-2 text-center text-xs text-blue-600 font-medium">
                                                        <i className="fa-solid fa-calculator"></i> Cálculo Dinámico Activado (Matemático)
                                                    </td>
                                                ) : (
                                                    <>
                                                        <td className="p-2 text-center">
                                                            <input
                                                                type="number" min="1" disabled={true}
                                                                className="w-full border rounded px-2 py-1 text-center font-mono text-sm bg-slate-50 text-slate-400"
                                                                value={1}
                                                                title="Cantidad Base"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-right">
                                                            <input
                                                                type="number" step="0.01"
                                                                className="w-full border rounded px-2 py-1 text-right font-bold text-slate-800 bg-white focus:border-indigo-400 outline-none"
                                                                value={baseRule.Valor}
                                                                onChange={e => handleChangeItem(baseRule._tempId, 'Valor', e.target.value)}
                                                            />
                                                        </td>
                                                    </>
                                                )}
                                                <td className="p-2 text-center">
                                                    <button
                                                        onClick={() => setItems(items.filter(i => i.CodArticulo !== cod))}
                                                        className="text-slate-300 hover:text-red-500 transition-colors"
                                                    >
                                                        <i className="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                                <tr>
                                    <td colSpan="5" className="p-2 bg-slate-50">
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
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="mt-2 text-xs text-slate-400 italic">
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
        if (!window.confirm('¿Eliminar esta excepción?')) return;
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
        if (!window.confirm("¿Seguro que deseas eliminar este perfil?")) return;

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

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* TABS HEADER */}
            <div className="bg-white border-b border-slate-200 px-6 pt-4 flex gap-6">
                <button
                    onClick={() => setActiveTab('base')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'base' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-tags mr-2"></i> Precios Estándar
                </button>
                <button
                    onClick={() => setActiveTab('profiles')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'profiles' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-list-ul mr-2"></i> Gestión de Perfiles
                </button>
                <button
                    onClick={() => {
                        setActiveTab('assignments');
                    }}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'assignments' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-users-gear mr-2"></i> Asignación a Clientes
                </button>
                <button
                    onClick={() => setActiveTab('simulator')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'simulator' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-calculator mr-2"></i> Simulador de Precios
                </button>
                <button
                    onClick={() => setActiveTab('reports')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'reports' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-microscope mr-2"></i> Inteligencia de Precios
                </button>
                <button
                    onClick={() => setActiveTab('urgencia-excepciones')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'urgencia-excepciones' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-ban mr-2"></i> Excepciones Urgencia
                </button>
                <button
                    onClick={() => setActiveTab('variante-precios')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'variante-precios' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-layer-group mr-2"></i> Precios x Variante
                </button>
            </div>

            {/* CONTENIDO */}
            <div className="flex-1 overflow-hidden p-6">
                {activeTab === 'base' && (
                    <div className="h-full overflow-y-auto">
                        <BasePrices />
                    </div>
                )}
                
                {activeTab === 'profiles' && (
                    <div className="h-full flex gap-6">
                        {/* LISTA PERFILES */}
                        <div className="w-1/3 bg-white rounded-lg shadow border border-slate-200 flex flex-col">
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                                <h3 className="font-bold text-slate-700">Perfiles Definidos</h3>
                                <button
                                    onClick={() => handleSelectProfile(null)}
                                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 transition shadow-sm font-bold"
                                >
                                    + Nuevo
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2">
                                {(() => {
                                    if (profiles.length === 0) return <div className="p-8 text-center text-slate-400 text-sm">No hay perfiles definidos.</div>;

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
                                            <div key={groupName} className="mb-2 border border-slate-200 rounded overflow-hidden">
                                                <div className={`p-2 bg-slate-100 flex items-center justify-between font-bold text-slate-700 text-xs uppercase tracking-wide cursor-pointer`}>
                                                    <span className="flex items-center gap-2">
                                                        <i className={`fa-solid ${groupName === 'TODOS / GENERAL' ? 'fa-globe text-blue-500' : 'fa-folder-open text-amber-400'}`}></i> 
                                                        {groupName}
                                                        <span className="bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full text-[9px]">{items.length}</span>
                                                    </span>
                                                </div>
                                                <div className="flex flex-col bg-white">
                                                    {items.map(p => (
                                                        <div
                                                            key={p.ID}
                                                            onClick={e => { e.stopPropagation(); handleSelectProfile(p); }}
                                                            className={`p-3 border-b last:border-b-0 cursor-pointer group transition-colors flex justify-between items-center ${selectedProfile?.ID === p.ID ? 'bg-indigo-50 border-l-4 border-indigo-600' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                                                        >
                                                            <div>
                                                                <div className={`font-bold text-sm ${selectedProfile?.ID === p.ID ? 'text-indigo-700' : 'text-slate-800'}`}>{p.Nombre}</div>
                                                                <div className="text-xs text-slate-500 mb-1 line-clamp-1">{p.Descripcion}</div>
                                                                {p.EsGlobal && (
                                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200">
                                                                        <i className="fa-solid fa-earth-americas mr-1"></i> Global (Default)
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={(e) => handleDeleteProfile(p.ID, e)}
                                                                className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2"
                                                                title="Eliminar Perfil"
                                                            >
                                                                <i className="fa-solid fa-trash-can"></i>
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
                        <div className="flex-1 bg-white rounded-lg shadow border border-slate-200 overflow-hidden relative">
                            {selectedProfile ? (
                                <ProfileEditor
                                    profile={selectedProfile}
                                    onSave={handleSaveProfile}
                                    onBack={() => setSelectedProfile(null)}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                                    <i className="fa-regular fa-id-card text-6xl opacity-20"></i>
                                    <p>Selecciona un perfil existente o crea uno nuevo.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'assignments' && (
                    <div className="h-full flex gap-6 overflow-hidden">
                        {/* 1. LISTA DE CLIENTES (SIDEBAR) */}
                        <div className="w-96 bg-white rounded-lg shadow border border-slate-200 flex flex-col shrink-0">
                            <div className="p-4 border-b bg-slate-50">
                                <h3 className="font-bold text-slate-700 mb-2">Seleccionar Cliente</h3>
                                <div className="relative">
                                    <i className="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-sm"></i>
                                    <input
                                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-100 outline-none"
                                        placeholder="Buscar por nombre o ID..."
                                        value={filterCust}
                                        onChange={e => setFilterCust(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                {/* Filtros rápidos */}
                                <div className="flex gap-2 mt-2 overflow-x-auto pb-1 no-scrollbar">
                                    {['all', 'profile', 'exceptions', 'standard'].map(f => (
                                        <button
                                            key={f}
                                            onClick={() => setFilterStatus(f)}
                                            className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap transition-colors ${filterStatus === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                        >
                                            {f === 'all' ? 'Todos' : f === 'profile' ? 'Con Perfil' : f === 'exceptions' ? 'Manuales' : 'Estándar'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto">
                                {loading ? (
                                    <div className="p-8 text-center text-slate-400 text-sm">
                                        <i className="fa-solid fa-circle-notch fa-spin mb-2"></i><br />Cargando clientes...
                                    </div>
                                ) : filteredCustomers.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400 text-sm">No se encontraron clientes.</div>
                                ) : (
                                    <div className="pb-4">
                                        {filteredCustomers.map(c => {
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
                                            
                                            // Avatar colors mimicking Nomenclador
                                            const AVATAR_COLORS = ['#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16'];
                                            const charCode = cName.charCodeAt(0) || 0;
                                            const avatarColor = AVATAR_COLORS[charCode % AVATAR_COLORS.length];

                                            return (
                                                <div
                                                    key={cId}
                                                    onClick={() => setOpenDropdown(cId)}
                                                    className={`mx-3 my-2 rounded-xl p-4 cursor-pointer transition-all border ${openDropdown === cId ? 'bg-indigo-50/40 border-indigo-500 shadow-md transform scale-[1.02]' : 'bg-white border-slate-200 hover:shadow-md hover:border-indigo-300'}`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        {/* AVATAR */}
                                                        <div 
                                                            className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-sm"
                                                            style={{ backgroundColor: avatarColor }}
                                                        >
                                                            {initials}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-[#1e1b4b] text-[15px] truncate pr-2">{cName}</div>
                                                            <div className="text-xs text-slate-400 font-medium mb-2.5">
                                                                {c.IDCliente || c.IDReact || `Cód: ${cId}`}
                                                            </div>
                                                            
                                                            {/* INFO BODY */}
                                                            <div className="flex flex-col gap-1.5 text-[13px]">
                                                                {c.TelefonoTrabajo && (
                                                                    <div className="flex items-center gap-2 text-slate-600">
                                                                        <i className="fa-solid fa-phone text-pink-500 w-4 text-center text-xs"></i>
                                                                        <span className="truncate">{c.TelefonoTrabajo}</span>
                                                                    </div>
                                                                )}
                                                                {c.Email && (
                                                                    <div className="flex items-center gap-2 text-slate-600">
                                                                        <i className="fa-solid fa-envelope text-slate-400 w-4 text-center text-xs"></i>
                                                                        <span className="truncate">{c.Email}</span>
                                                                    </div>
                                                                )}
                                                                {c.TipoClienteNombre && (
                                                                    <div className="flex items-center gap-2 text-slate-600">
                                                                        <i className="fa-solid fa-tag text-slate-300 w-4 text-center text-xs"></i>
                                                                        <span className="truncate">{c.TipoClienteNombre}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* ICONS MANUAL/PERFIL */}
                                                        <div className="flex flex-col gap-2 items-end pt-1 pl-1">
                                                            {hasManual && <i className="fa-solid fa-triangle-exclamation text-amber-500 text-sm" title="Reglas manuales"></i>}
                                                            {hasProfiles && <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm" title="Perfiles asignados"></span>}
                                                        </div>
                                                    </div>

                                                    {/* FOOTER */}
                                                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                                                        <div className="flex gap-2">
                                                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${c.IDReact ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 border-dashed'}`}>
                                                                <span className="opacity-70 mr-0.5">📊</span> Planilla
                                                            </span>
                                                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${c.CodReferencia ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-slate-50 text-slate-400 border-slate-200 border-dashed'}`}>
                                                                <span className="opacity-70 mr-0.5">🖥</span> Macrosoft
                                                            </span>
                                                        </div>
                                                        <span className="text-xs text-slate-300 font-bold">#{cId}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="p-2 border-t bg-slate-50 text-xs text-slate-400 text-center">
                                {filteredCustomers.length} clientes encontrados
                            </div>
                        </div>

                        {/* 2. PANEL DE DETALLE (MAIN) */}
                        <div className="flex-1 bg-white rounded-lg shadow border border-slate-200 flex flex-col overflow-hidden relative">
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
                                        <div className="flex flex-col h-full">
                                            {/* Header Cliente */}
                                            <div className="p-6 border-b bg-gradient-to-r from-slate-50 to-white flex justify-between items-start">
                                                <div>
                                                    <div className="inline-flex items-center px-2 py-1 rounded bg-slate-200 text-slate-600 font-mono text-xs mb-2 font-bold">
                                                        ID: {cId}
                                                    </div>
                                                    <h2 className="text-2xl font-bold text-slate-800 mb-1">{cName}</h2>
                                                    {customer.CioRuc && <div className="text-slate-400 text-sm">RUT: {customer.CioRuc}</div>}
                                                </div>
                                                {hasManualRules && (
                                                    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-3 shadow-sm max-w-sm">
                                                        <i className="fa-solid fa-triangle-exclamation text-xl text-amber-500"></i>
                                                        <div>
                                                            <div className="font-bold text-sm">Configuración Manual Detectada</div>
                                                            <div className="text-xs opacity-80">Este cliente tiene {data.rules} reglas de precio específicas definidas fuera de los perfiles.</div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">

                                                {/* Sección Perfiles Globales */}
                                                <div>
                                                    <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                                                        <i className="fa-solid fa-earth-americas text-blue-500"></i> Perfiles Globales (Activos)
                                                    </h3>
                                                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                                                        <div className="flex flex-wrap gap-3">
                                                            {profiles.filter(p => p.EsGlobal).map(p => (
                                                                <div key={p.ID} className="bg-white border border-blue-200 text-blue-800 px-3 py-2 rounded shadow-sm flex items-center gap-3">
                                                                    <div className="bg-blue-100 p-1.5 rounded text-blue-600">
                                                                        <i className="fa-solid fa-lock text-xs"></i>
                                                                    </div>
                                                                    <div>
                                                                        <div className="font-bold text-sm">{p.Nombre}</div>
                                                                        <div className="text-[10px] text-slate-400">{p.Descripcion}</div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {!profiles.some(p => p.EsGlobal) && (
                                                                <div className="text-sm text-blue-400 italic">No hay perfiles globales configurados.</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Sección Asignación Manual */}
                                                <div>
                                                    <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                                                        <i className="fa-solid fa-tags text-indigo-500"></i> Asignación de Perfiles
                                                    </h3>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                        {profiles.filter(p => !p.EsGlobal).map(p => {
                                                            const isAssigned = currentIds.includes(p.ID);
                                                            return (
                                                                <div
                                                                    key={p.ID}
                                                                    onClick={() => toggleProfile(p.ID)}
                                                                    className={`relative cursor-pointer border rounded-lg p-4 transition-all group select-none ${isAssigned ? 'bg-indigo-50 border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm'}`}
                                                                >
                                                                    <div className="flex justify-between items-start mb-2">
                                                                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${isAssigned ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}`}>
                                                                            {isAssigned && <i className="fa-solid fa-check text-white text-[10px]"></i>}
                                                                        </div>
                                                                        {isAssigned && <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">Asignado</span>}
                                                                    </div>
                                                                    <div className={`font-bold text-sm mb-1 ${isAssigned ? 'text-indigo-900' : 'text-slate-700'}`}>{p.Nombre}</div>
                                                                    <div className="text-xs text-slate-500 leading-relaxed line-clamp-2">{p.Descripcion || 'Sin descripción'}</div>
                                                                </div>
                                                            );
                                                        })}
                                                        {profiles.length === 0 && (
                                                            <div className="col-span-3 text-center p-8 border-2 border-dashed border-slate-200 rounded-lg text-slate-400">
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
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                        <i className="fa-solid fa-hand-pointer text-3xl text-slate-300"></i>
                                    </div>
                                    <h3 className="font-bold text-lg text-slate-600 mb-2">Selecciona un cliente</h3>
                                    <p className="max-w-xs text-sm">Elige un cliente del listado de la izquierda para gestionar sus perfiles de precios y descuentos.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'simulator' && (
                    <div className="h-full overflow-y-auto">
                        <PriceCalculatorTest
                            customers={customers}
                            assignments={assignments}
                            onSearch={searchCustomers}
                        />
                    </div>
                )}

                {activeTab === 'reports' && (
                    <div className="h-full overflow-hidden">
                        <PriceReports customers={customers} onSearch={searchCustomers} />
                    </div>
                )}

                {activeTab === 'urgencia-excepciones' && (
                    <div className="h-full overflow-y-auto">
                        <div className="max-w-3xl mx-auto space-y-6">

                            {/* Formulario nueva excepción */}
                            <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-5">
                                <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                    <i className="fa-solid fa-circle-plus text-orange-500"></i>
                                    Nueva excepción
                                </h3>
                                <p className="text-xs text-slate-500 mb-4">
                                    Si dejás el servicio vacío, el cliente queda exento de urgencia en <strong>todos</strong> los servicios.
                                </p>

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    {/* Búsqueda cliente */}
                                    <div className="relative">
                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Cliente <span className="text-red-500">*</span></label>
                                        {urgExcSelectedCli ? (
                                            <div className="flex items-center gap-2 bg-orange-50 border border-orange-300 rounded-lg px-3 py-2 text-sm">
                                                <span className="flex-1 font-medium text-slate-700">{urgExcSelectedCli.Nombre}</span>
                                                <button onClick={() => { setUrgExcSelectedCli(null); setUrgExcCliSearch(''); }} className="text-slate-400 hover:text-red-500">
                                                    <i className="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Buscar cliente..."
                                                    value={urgExcCliSearch}
                                                    onChange={e => setUrgExcCliSearch(e.target.value)}
                                                    onFocus={() => urgExcCliResults.length > 0 && setUrgExcCliDropOpen(true)}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                                                />
                                                {urgExcCliDropOpen && urgExcCliResults.length > 0 && (
                                                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                                        {urgExcCliResults.map(c => (
                                                            <button key={c.CliIdCliente} onClick={() => { setUrgExcSelectedCli(c); setUrgExcCliSearch(''); setUrgExcCliDropOpen(false); }}
                                                                className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 border-b border-slate-100 last:border-0">
                                                                <span className="font-medium">{c.Nombre}</span>
                                                                <span className="text-slate-400 ml-2 text-xs">#{c.CliIdCliente}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {/* Búsqueda servicio/material (opcional) */}
                                    <div className="relative">
                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Servicio / Material <span className="text-slate-400">(opcional)</span></label>
                                        {urgExcSelectedProd ? (
                                            <div className="flex items-center gap-2 bg-orange-50 border border-orange-300 rounded-lg px-3 py-2 text-sm">
                                                <span className="flex-1 font-medium text-slate-700 truncate">{urgExcSelectedProd.Descripcion}</span>
                                                <button onClick={() => { setUrgExcSelectedProd(null); setUrgExcProdSearch(''); }} className="text-slate-400 hover:text-red-500">
                                                    <i className="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Buscar servicio... (vacío = todos)"
                                                    value={urgExcProdSearch}
                                                    onChange={e => setUrgExcProdSearch(e.target.value)}
                                                    onFocus={() => urgExcProdResults.length > 0 && setUrgExcProdDropOpen(true)}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                                                />
                                                {urgExcProdDropOpen && urgExcProdResults.length > 0 && (
                                                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                                        {urgExcProdResults.slice(0, 30).map(p => (
                                                            <button key={p.ProIdProducto} onClick={() => { setUrgExcSelectedProd(p); setUrgExcProdSearch(''); setUrgExcProdDropOpen(false); }}
                                                                className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 border-b border-slate-100 last:border-0">
                                                                <span className="font-medium">{p.Descripcion}</span>
                                                                <span className="text-slate-400 ml-2 text-xs">{p.CodArticulo}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 flex justify-end">
                                    <button onClick={handleAddUrgExc}
                                        className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-5 py-2 rounded-lg shadow transition">
                                        <i className="fa-solid fa-plus mr-2"></i> Agregar excepción
                                    </button>
                                </div>
                            </div>

                            {/* Tabla de excepciones */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                                <div className="px-5 py-3 border-b bg-slate-50 flex justify-between items-center rounded-t-xl">
                                    <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                        <i className="fa-solid fa-list text-orange-500"></i>
                                        Excepciones activas
                                    </h3>
                                    <span className="text-xs text-slate-400">{urgExc.length} registro(s)</span>
                                </div>

                                {urgExcLoading ? (
                                    <div className="p-8 text-center text-slate-400 text-sm">Cargando...</div>
                                ) : urgExc.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400 text-sm">No hay excepciones configuradas.</div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-xs text-slate-500 uppercase border-b bg-slate-50">
                                                <th className="text-left px-4 py-2">Cliente</th>
                                                <th className="text-left px-4 py-2">Servicio / Material</th>
                                                <th className="text-left px-4 py-2">Desde</th>
                                                <th className="px-4 py-2"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {urgExc.map(ex => (
                                                <tr key={ex.ID} className="border-b last:border-0 hover:bg-slate-50">
                                                    <td className="px-4 py-2.5">
                                                        <span className="font-medium text-slate-700">{ex.ClienteNombre}</span>
                                                        <span className="text-slate-400 text-xs ml-1.5">#{ex.CliIdCliente}</span>
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        {ex.CodArea ? (
                                                            <span className="flex items-center gap-1.5 text-slate-700">
                                                                <span className="font-mono font-bold text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded">{ex.CodArea}</span>
                                                                {ex.AreaNombre || ex.CodArea}
                                                            </span>
                                                        ) : ex.ProIdProducto ? (
                                                            <span className="text-slate-700">{ex.ArticuloNombre || ex.CodArticulo}</span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">
                                                                <i className="fa-solid fa-asterisk text-[10px]"></i> Todos los servicios
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-slate-400 text-xs">
                                                        {new Date(ex.FechaAlta).toLocaleDateString('es-UY')}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <button onClick={() => handleDeleteUrgExc(ex.ID)}
                                                            className="text-red-400 hover:text-red-600 transition p-1 rounded" title="Eliminar excepción">
                                                            <i className="fa-solid fa-trash-can text-xs"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                        </div>
                    </div>
                )}

                {activeTab === 'variante-precios' && (
                    <VariantePreciosTab />
                )}
            </div>
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

    return (
        <div className="h-full flex gap-6 overflow-hidden">
            {/* Panel izquierdo */}
            <div className="w-72 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col shrink-0 overflow-hidden">
                <div className="p-4 border-b bg-slate-50">
                    <h3 className="font-bold text-slate-700 text-sm mb-3 flex items-center gap-2">
                        <i className="fa-solid fa-layer-group text-emerald-600"></i>
                        Productos con variantes
                    </h3>
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                        <input className="w-full pl-8 pr-3 py-2 border border-slate-200 bg-white rounded-lg text-sm outline-none focus:border-emerald-500"
                            placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {filtered.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-sm">
                            <i className="fa-solid fa-box-open text-3xl mb-2 block text-slate-200"></i>
                            Sin productos con variantes
                        </div>
                    ) : filtered.map(art => (
                        <div key={art.ProIdProducto} onClick={() => loadVariants(art)}
                            className={`p-3 rounded-lg cursor-pointer transition-all border ${
                                selected?.ProIdProducto === art.ProIdProducto
                                    ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                                    : 'border-transparent hover:bg-slate-50 hover:border-slate-200'
                            }`}>
                            <p className="font-bold text-sm text-slate-800 truncate">{art.Descripcion?.trim()}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                    {art.CantidadVariantes} var.
                                </span>
                                {art.PrecioBase != null && (
                                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                        Base: {art.MonIdMoneda === 2 ? 'U$S' : '$'} {parseFloat(art.PrecioBase).toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Panel derecho */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden min-w-0">
                {!selected ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <i className="fa-solid fa-hand-pointer text-5xl mb-4 text-slate-200"></i>
                        <p className="font-bold text-lg text-slate-500">Seleccioná un producto</p>
                        <p className="text-sm mt-1 text-center max-w-xs">Elegí un producto de la izquierda para ver y editar los precios de sus variantes.</p>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="p-4 border-b bg-slate-50 shrink-0">
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="text-base font-black text-slate-800 truncate">{selected.Descripcion?.trim()}</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Precio base:
                                        <span className="font-bold text-slate-700 ml-1">
                                            {selected.PrecioBase != null ? `${selected.MonIdMoneda === 2 ? 'U$S' : '$'} ${parseFloat(selected.PrecioBase).toFixed(2)}` : 'Sin precio'}
                                        </span>
                                        <span className="ml-1 text-blue-500">— variantes sin precio propio lo heredan</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="relative">
                                        <i className="fa-solid fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                        <input className="pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-400 w-40"
                                            placeholder="Filtrar variantes..." value={varSearch} onChange={e => setVarSearch(e.target.value)} />
                                    </div>
                                    <button onClick={saveAll} disabled={savingAll}
                                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all shadow-sm disabled:opacity-50 flex items-center gap-1.5">
                                        {savingAll ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
                                        Guardar todos
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Barra de acción masiva — solo aparece cuando hay seleccionados */}
                        {checkedIds.size > 0 && (
                            <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3 shrink-0 flex-wrap">
                                <span className="inline-flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                                    <i className="fa-solid fa-check-square text-[10px]"></i>
                                    {checkedIds.size} seleccionadas
                                </span>
                                <div className="flex items-center gap-2 ml-auto flex-wrap">
                                    <span className="text-xs font-bold text-slate-600">Aplicar a todas:</span>
                                    <select value={bulkMoneda} onChange={e => setBulkMoneda(e.target.value)}
                                        className="text-xs font-bold px-2 py-1.5 border border-slate-300 rounded-lg bg-white outline-none focus:border-indigo-400">
                                        <option value="UYU">$ UYU</option>
                                        <option value="USD">U$S USD</option>
                                    </select>
                                    <input type="number" step="0.01" min="0" placeholder="Precio..."
                                        value={bulkPrecio} onChange={e => setBulkPrecio(e.target.value)}
                                        className="w-28 text-sm font-bold px-3 py-1.5 border border-slate-300 rounded-lg bg-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                    <button onClick={applyBulk} disabled={applyingBulk || bulkPrecio === ''}
                                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-sm">
                                        {applyingBulk ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-bolt"></i>}
                                        Aplicar
                                    </button>
                                    <button onClick={clearBulk} disabled={applyingBulk}
                                        className="px-3 py-1.5 bg-white border border-red-200 hover:border-red-400 text-red-500 hover:text-red-700 text-xs font-bold rounded-lg transition-all disabled:opacity-50"
                                        title="Quitar precio propio — usar precio base">
                                        <i className="fa-solid fa-trash-can mr-1"></i>Quitar precio
                                    </button>
                                    <button onClick={() => setCheckedIds(new Set())} className="text-slate-400 hover:text-slate-600 text-xs px-2">
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Info bar cuando no hay selección */}
                        {checkedIds.size === 0 && (
                            <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2 shrink-0">
                                <i className="fa-solid fa-circle-info"></i>
                                Marcá variantes con el ☑ para aplicar un precio masivo.
                                Las filas en <strong className="text-emerald-700 mx-1">verde</strong> ya tienen precio propio.
                            </div>
                        )}

                        {/* Tabla */}
                        <div className="flex-1 overflow-y-auto">
                            {loadingVars ? (
                                <div className="flex items-center justify-center py-16 text-slate-400">
                                    <i className="fa-solid fa-circle-notch fa-spin text-3xl"></i>
                                </div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-white border-b border-slate-200 z-10 shadow-sm">
                                        <tr className="text-xs text-slate-500 uppercase">
                                            <th className="px-4 py-3 w-10">
                                                <input type="checkbox" checked={allChecked}
                                                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                                                    onChange={toggleAll}
                                                    className="w-4 h-4 rounded accent-indigo-600 cursor-pointer" />
                                            </th>
                                            <th className="text-left px-4 py-3">Variante</th>
                                            <th className="text-left px-4 py-3 w-28">Moneda</th>
                                            <th className="text-left px-4 py-3 w-40">Precio excepción</th>
                                            <th className="text-left px-4 py-3 w-32">Precio efectivo</th>
                                            <th className="px-4 py-3 w-16"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayVariants.map(v => {
                                            const e = edits[v.id] || { precio: '', moneda: 'UYU' };
                                            const hasCustom = v.precio_excepcion != null;
                                            const isChecked = checkedIds.has(v.id);
                                            const efectivo = e.precio !== '' ? parseFloat(e.precio) : (selected.PrecioBase != null ? parseFloat(selected.PrecioBase) : null);
                                            const monEfectiva = e.precio !== '' ? e.moneda : (selected.MonIdMoneda === 2 ? 'U$S' : '$');
                                            return (
                                                <tr key={v.id} className={`border-b last:border-0 transition-colors ${
                                                    isChecked ? 'bg-indigo-50' :
                                                    hasCustom ? 'bg-emerald-50 hover:bg-emerald-100/60' :
                                                    'hover:bg-slate-50'
                                                }`}>
                                                    <td className="px-4 py-2.5">
                                                        <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(v.id)}
                                                            className="w-4 h-4 rounded accent-indigo-600 cursor-pointer" />
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <p className="font-semibold text-slate-800">{v.nombre_variante}</p>
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <select value={e.moneda}
                                                            onChange={ev => setEdits(prev => ({ ...prev, [v.id]: { ...prev[v.id], moneda: ev.target.value } }))}
                                                            className="text-xs font-bold px-2 py-1.5 border border-slate-200 rounded-lg bg-white outline-none focus:border-emerald-400 w-full">
                                                            <option value="UYU">$ UYU</option>
                                                            <option value="USD">U$S USD</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <input type="number" step="0.01" min="0"
                                                            placeholder={selected.PrecioBase != null ? `Base: ${parseFloat(selected.PrecioBase).toFixed(2)}` : 'Sin base'}
                                                            value={e.precio}
                                                            onChange={ev => setEdits(prev => ({ ...prev, [v.id]: { ...prev[v.id], precio: ev.target.value } }))}
                                                            className="w-full text-sm font-bold px-3 py-1.5 border border-slate-200 rounded-lg bg-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        {efectivo != null ? (
                                                            <span className={`font-black text-sm ${ e.precio !== '' ? 'text-emerald-700' : 'text-slate-400' }`}>
                                                                {monEfectiva} {efectivo.toFixed(2)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-300 text-xs italic">sin precio</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <button onClick={() => saveVariant(v.id)} disabled={saving[v.id]}
                                                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50"
                                                            title="Guardar esta variante">
                                                            {saving[v.id] ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default PriceProfiles;
