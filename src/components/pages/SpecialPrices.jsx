import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// --- PANEL LATERAL (DRAWER): Nueva Excepción de Precio (Catálogo Integrado) ---
const NewRuleDrawer = ({ isOpen, onClose, baseProducts, onAddRule, onRemoveRule, editingRule, rowStateMap }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterTab, setFilterTab] = useState('todos'); // 'todos', 'sin_regla', 'con_regla'
    const [selectedItem, setSelectedItem] = useState(null);
    const [customStr, setCustomStr] = useState('');
    const [discStr, setDiscStr] = useState('');

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
        return baseProducts.filter(item => {
            const term = searchQuery.toLowerCase().trim();
            const matchSearch = item.CodArticulo.toLowerCase().includes(term) || 
                                (item.Descripcion || '').toLowerCase().includes(term);
            if (!matchSearch) return false;

            const stateObj = rowStateMap[item.CodArticulo];
            const isActive = stateObj?.isActive || false;

            if (filterTab === 'sin_regla') {
                return !isActive;
            }
            if (filterTab === 'con_regla') {
                return isActive;
            }
            return true;
        });
    }, [baseProducts, searchQuery, filterTab, rowStateMap]);

    // Contadores para las pestañas (en base a todo el catálogo)
    const counts = useMemo(() => {
        let sinRegla = 0;
        let conRegla = 0;
        baseProducts.forEach(p => {
            if (rowStateMap[p.CodArticulo]?.isActive) {
                conRegla++;
            } else {
                sinRegla++;
            }
        });
        return { todos: baseProducts.length, sinRegla, conRegla };
    }, [baseProducts, rowStateMap]);

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

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/40 z-[990] transition-opacity animate-in fade-in duration-200" onClick={onClose}></div>
            
            {/* Drawer (Split Layout max-w-2xl) */}
            <div className="fixed inset-y-0 right-0 z-[995] w-full max-w-2xl bg-white shadow-2xl flex flex-col transform translate-x-0 transition-transform duration-300 text-slate-700 animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <div>
                        <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-tags text-indigo-500"></i> Asignar Reglas de Precio
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">Asigna y edita tarifas especiales sobre productos y familias de forma unificada.</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Body (Pantalla Dividida) */}
                <div className="flex-1 flex overflow-hidden p-6 gap-6">
                    {/* Columna Izquierda: Buscador y Listado del Catálogo */}
                    <div className="w-3/5 flex flex-col h-full overflow-hidden border-r border-slate-100 pr-6">
                        {/* Buscador */}
                        <div className="relative mb-3">
                            <i className="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                            <input
                                type="text"
                                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 text-xs text-slate-700 bg-white"
                                placeholder="Buscar por código o descripción..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button 
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600"
                                >
                                    <i className="fa-solid fa-circle-xmark text-xs"></i>
                                </button>
                            )}
                        </div>

                        {/* Tabs de Filtro */}
                        <div className="flex bg-slate-100 p-0.5 rounded-lg mb-3">
                            <button
                                type="button"
                                onClick={() => setFilterTab('todos')}
                                className={`flex-1 py-1.5 text-[10px] font-black rounded transition-all text-center ${filterTab === 'todos' ? 'bg-[#1E1B4B] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
                            >
                                Todos ({counts.todos})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterTab('sin_regla')}
                                className={`flex-1 py-1.5 text-[10px] font-black rounded transition-all text-center ${filterTab === 'sin_regla' ? 'bg-[#1E1B4B] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
                                title="Productos y familias sin regla asignada (no coincidentes)"
                            >
                                Sin Regla ({counts.sinRegla})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterTab('con_regla')}
                                className={`flex-1 py-1.5 text-[10px] font-black rounded transition-all text-center ${filterTab === 'con_regla' ? 'bg-[#1E1B4B] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
                            >
                                Con Regla ({counts.conRegla})
                            </button>
                        </div>

                        {/* Listado */}
                        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                            {visibleList.length === 0 ? (
                                <div className="text-center py-10 text-slate-400 text-xs">
                                    <i className="fa-solid fa-folder-open text-2xl mb-2 opacity-50 block"></i>
                                    No se encontraron ítems coincidentes.
                                </div>
                            ) : (
                                visibleList.map(item => {
                                    const isSelected = selectedItem?.CodArticulo === item.CodArticulo;
                                    const state = rowStateMap[item.CodArticulo];
                                    const hasRule = state?.isActive;
                                    
                                    let badgeContent = null;
                                    if (hasRule) {
                                        if (state.tipoRegla === 'percentage') {
                                            badgeContent = <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-1.5 py-0.5 rounded whitespace-nowrap">{state.discStr}% OFF</span>;
                                        } else {
                                            badgeContent = <span className="bg-blue-100 text-blue-800 text-[9px] font-black px-1.5 py-0.5 rounded whitespace-nowrap">${state.customStr}</span>;
                                        }
                                    } else {
                                        badgeContent = <span className="bg-slate-100 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Sin Regla</span>;
                                    }

                                    let typeIcon = "📦";
                                    let typeLabel = "Producto";
                                    if (item.CodArticulo === 'TOTAL') {
                                        typeIcon = "🌐";
                                        typeLabel = "Global";
                                    } else if (item.CodArticulo.startsWith('GRUPO:')) {
                                        typeIcon = "📁";
                                        typeLabel = "Familia";
                                    }

                                    return (
                                        <div
                                            key={item.CodArticulo}
                                            onClick={() => handleSelectItem(item)}
                                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${isSelected ? 'bg-indigo-50/50 border-indigo-300 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span className="text-base select-none" title={typeLabel}>{typeIcon}</span>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-700 text-xs truncate" title={item.Descripcion}>{item.Descripcion}</div>
                                                    <div className="text-[9px] font-mono text-slate-400 mt-0.5 truncate">
                                                        Ref: {item.CodArticulo} {item.Precio > 0 && `| Base: $${Number(item.Precio).toFixed(2)}`}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                                {badgeContent}
                                                {hasRule && (
                                                    <button
                                                        onClick={(e) => handleRemoveDirect(e, item.CodArticulo)}
                                                        className="w-5 h-5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 flex items-center justify-center transition-colors"
                                                        title="Eliminar excepción"
                                                    >
                                                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            {filteredItems.length > 100 && (
                                <div className="text-[10px] text-slate-400 text-center py-2 border-t border-slate-100">
                                    Mostrando los primeros 100 de {filteredItems.length} ítems. Usa el buscador.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Columna Derecha: Configuración de la Regla (Formulario Contextual) */}
                    <div className="w-2/5 flex flex-col h-full overflow-hidden pl-2">
                        {!selectedItem ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                <i className="fa-solid fa-arrow-left text-2xl text-slate-300 mb-3 animate-pulse"></i>
                                <p className="text-xs font-black text-slate-500">Selecciona un elemento</p>
                                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">Elige un producto o familia de la lista izquierda para definir su precio especial o descuento.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                                    <p className="text-[9px] text-indigo-500 font-black tracking-wide uppercase">Configurar Excepción</p>
                                    <h4 className="font-bold text-slate-800 text-xs mt-0.5 leading-snug">{selectedItem.Descripcion}</h4>
                                    <p className="text-[9px] font-mono text-slate-400 mt-1">Ref: {selectedItem.CodArticulo}</p>
                                    {selectedItem.Precio > 0 && (
                                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 mt-2.5 pt-2.5 border-t border-indigo-200/30">
                                            <span>Precio Base:</span>
                                            <span className="font-mono text-slate-700 bg-white px-2 py-0.5 rounded border border-indigo-100 font-bold">${Number(selectedItem.Precio).toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Formulario */}
                                {selectedItem.CodArticulo !== 'TOTAL' && !selectedItem.CodArticulo.startsWith('GRUPO:') ? (
                                    // PRODUCTO: Entradas duales
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Precio Fijo ({selectedItem.Moneda === 'USD' ? 'USD' : '$'})</label>
                                            <div className="relative">
                                                <span className="absolute left-2.5 top-1.5 text-slate-400 font-bold text-xs">{selectedItem.Moneda === 'USD' ? 'USD' : '$'}</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded-lg font-mono text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                                    placeholder="Ej: 150"
                                                    value={customStr}
                                                    onChange={e => handlePriceChange(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Descuento (%)</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-full pl-3 pr-6 py-1.5 border border-slate-300 rounded-lg font-mono text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                                                    placeholder="Ej: 10"
                                                    value={discStr}
                                                    onChange={e => handleDiscChange(e.target.value)}
                                                />
                                                <span className="absolute right-2.5 top-1.5 text-slate-400 font-bold text-xs">%</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    // FAMILIA O GLOBAL: Solo descuento
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Descuento (%)</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-full pl-3 pr-6 py-1.5 border border-slate-300 rounded-lg font-mono text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                                    placeholder="Ej: 15"
                                                    value={discStr}
                                                    onChange={e => setDiscStr(e.target.value)}
                                                />
                                                <span className="absolute right-2.5 top-1.5 text-slate-400 font-bold text-xs">%</span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-400 leading-relaxed">
                                            {selectedItem.CodArticulo === 'TOTAL' 
                                                ? 'Esta regla actúa como descuento global para cualquier producto que no tenga regla específica o de familia.' 
                                                : 'Este descuento se aplicará a todos los productos que pertenezcan a esta familia.'}
                                        </p>
                                    </div>
                                )}

                                {/* Acciones del Formulario */}
                                <div className="pt-2 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setSelectedItem(null); setCustomStr(''); setDiscStr(''); }}
                                        className="flex-1 py-2 border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg font-bold transition-colors text-xs"
                                    >
                                        Limpiar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSubmit}
                                        className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-colors text-xs shadow-md shadow-indigo-100"
                                    >
                                        Aplicar Regla
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
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

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[9990] transition-opacity animate-in fade-in duration-200" onClick={onClose}></div>
            
            {/* Modal */}
            <div className="fixed inset-0 z-[9995] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh] text-slate-700 transform scale-100 transition-all duration-300 animate-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                        <div>
                            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                <i className="fa-solid fa-user-gear text-indigo-500"></i> Gestionar Perfiles
                            </h3>
                            <p className="text-xs text-slate-400 mt-0.5">Asigna o quita perfiles de precios para este cliente.</p>
                        </div>
                        <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                        {/* Perfiles Globales (Activos / Bloqueados) */}
                        <div>
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <i className="fa-solid fa-earth-americas text-slate-400"></i> Perfiles Globales (Activos)
                            </h4>
                            {globalProfiles.length === 0 ? (
                                <p className="text-xs text-slate-400 italic">No hay perfiles globales configurados en el sistema.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {globalProfiles.map(p => (
                                        <div key={p.ID} className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl select-none opacity-80">
                                            <div className="min-w-0 pr-2">
                                                <div className="font-bold text-slate-700 text-xs truncate">{p.Nombre}</div>
                                                <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.Descripcion || 'Perfil global activo por defecto'}</div>
                                            </div>
                                            <span className="text-slate-400 bg-white border border-slate-200 w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 shadow-sm" title="Este perfil es global y se aplica automáticamente">
                                                <i className="fa-solid fa-lock"></i>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Asignación de Perfiles (Editables) */}
                        <div>
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <i className="fa-solid fa-user-tag text-slate-400"></i> Asignación de Perfiles
                            </h4>
                            {assignableProfiles.length === 0 ? (
                                <p className="text-xs text-slate-400 italic">No hay perfiles asignables configurados.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {assignableProfiles.map(p => {
                                        const isChecked = tempIds.has(p.ID);
                                        return (
                                            <div 
                                                key={p.ID} 
                                                onClick={() => handleToggle(p.ID)}
                                                className={`flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all border select-none ${isChecked ? 'bg-indigo-50/40 border-indigo-500 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                                            >
                                                <div className="min-w-0 pr-2">
                                                    <div className="font-bold text-slate-800 text-xs truncate">{p.Nombre}</div>
                                                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.Descripcion || 'Sin descripción'}</div>
                                                </div>
                                                <div className={`w-5.5 h-5.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100' : 'border-slate-300 bg-white'}`}>
                                                    {isChecked && <i className="fa-solid fa-check text-[10px]"></i>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2.5">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="px-4 py-2 border border-slate-200 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all text-xs"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="button" 
                            onClick={handleSubmit} 
                            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all text-xs shadow-md shadow-indigo-100"
                        >
                            Aplicar Perfiles
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

// --- COMPONENTE PRINCIPAL ---
const SpecialPrices = () => {
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

    useEffect(() => {
        setShowAllProducts(false);
        setEditingRule(null);
        if (selClientId) {
            loadRules(selClientId);
        } else {
            setClientData({ client: null });
            setRowStateMap({});
            setSelectedRows(new Set());
            setIsDirtyMap(false);
            setExpandedGroups(new Set());
            setHiddenGroups(new Set());
            setSelectedProfileIds(new Set());
        }
    }, [selClientId]);

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
                    prods.push({
                        CodArticulo: `GRUPO:${g}`,
                        ProIdProducto: null,
                        Descripcion: `${firstP.GrupoNombre ? `${g} - ${firstP.GrupoNombre}` : g}`,
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
                }
            } else {
                if (bp === 0) customStr = "";
            }

            newMap[prod.CodArticulo] = {
                basePrice: bp,
                customStr,
                discStr,
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
                [cod]: { ...row, customStr: strVal, discStr: dStr, tipoRegla: 'fixed', isActive: strVal !== "" }
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
                [cod]: { ...row, discStr: strVal, customStr: cStr, tipoRegla: 'percentage', isActive: strVal !== "" && strVal !== "0" }
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

    const handleDeleteClient = () => {
        if (!selClientId || !window.confirm(`¿Seguro que deseas eliminar los precios especiales del cliente ${selClientId}? Volverá a tarifa normal.`)) return;
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

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden text-sm relative">
            <style>{`
                @keyframes highlight-fade {
                    0% { background-color: rgba(253, 224, 71, 0.4); }
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

            {/* SIDEBAR CLIENTES */}
            <div className="w-72 bg-white border-r border-slate-200 flex flex-col flex-shrink-0 z-10 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                {/* Header */}
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                    <span className="font-bold text-slate-700 flex items-center gap-2 text-base">
                        <i className="fa-solid fa-user-tag text-indigo-500"></i> Clientes
                    </span>
                </div>

                {/* Tabs */}
                <div className="p-3 bg-white">
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => {
                                setSidebarTab('tarifas');
                                if (dbSearchTerm) setFilterClient(dbSearchTerm);
                            }}
                            className={`flex-1 py-2 text-xs font-black rounded-lg transition-all flex flex-col items-center justify-center ${sidebarTab === 'tarifas' ? 'bg-[#1E1B4B] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
                        >
                            <span>Con Tarifas</span>
                            <span className="text-[10px] opacity-75 font-normal">{clients.length} clientes</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setSidebarTab('db');
                                if (filterClient) setDbSearchTerm(filterClient);
                            }}
                            className={`flex-1 py-2 text-xs font-black rounded-lg transition-all flex flex-col items-center justify-center ${sidebarTab === 'db' ? 'bg-[#1E1B4B] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
                        >
                            <span>Buscar en DB</span>
                            <span className="text-[10px] opacity-75 font-normal">Base completa</span>
                        </button>
                    </div>
                </div>

                {/* Search / Filter Input */}
                <div className="px-3 pb-3 bg-white border-b border-slate-100">
                    {sidebarTab === 'tarifas' ? (
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-3 text-slate-400"></i>
                            <input
                                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all text-xs"
                                placeholder="Buscar por nombre o ID..."
                                value={filterClient}
                                onChange={e => setFilterClient(e.target.value)}
                            />
                        </div>
                    ) : (
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-3 text-slate-400"></i>
                            <input
                                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all text-xs"
                                placeholder="Buscar por nombre o ID..."
                                value={dbSearchTerm}
                                onChange={e => setDbSearchTerm(e.target.value)}
                                autoFocus
                            />
                            {loadingDbSearch && <i className="fa-solid fa-circle-notch fa-spin absolute right-3 top-3 text-slate-400"></i>}
                        </div>
                    )}
                </div>

                {/* Sidebar List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50 custom-scrollbar">
                    {sidebarTab === 'tarifas' ? (
                        loading ? (
                            <div className="p-4 text-slate-400 text-center"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Cargando...</div>
                        ) : filteredClients.length === 0 ? (
                            <div className="p-4 flex flex-col items-center justify-center text-center mt-4">
                                <span className="text-slate-400 mb-3 text-xs font-semibold">No se encontraron clientes con tarifas.</span>
                                <button 
                                    onClick={() => {
                                        setSidebarTab('db');
                                        setDbSearchTerm(filterClient);
                                    }} 
                                    className="w-full bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white border border-indigo-200 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center justify-center gap-2 text-xs"
                                >
                                    <i className="fa-solid fa-database"></i> Buscar "{filterClient}" en DB
                                </button>
                            </div>
                        ) : (
                            filteredClients.map(c => {
                                const isSelected = selClientId === c.ClienteID;
                                const displayName = c.Nombre || c.NombreFantasia || `Cliente ${c.ClienteID}`;
                                const words = displayName.split(' ').filter(Boolean);
                                let initials = words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : displayName.substring(0, 2).toUpperCase();
                                const avatarColor = ['#f43f5e','#ec4899','#d946ef','#8b5cf6','#3b82f6','#0ea5e9','#14b8a6','#10b981'][ (displayName.charCodeAt(0) || 0) % 8 ];

                                return (
                                    <div
                                        key={c.ClienteID}
                                        onClick={() => setSelClientId(c.ClienteID)}
                                        className={`rounded-xl p-3 cursor-pointer transition-all border ${isSelected ? 'bg-white border-indigo-600 shadow-md ring-1 ring-indigo-600/35' : 'bg-white border-slate-100 hover:border-slate-300 shadow-sm'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0" style={{ backgroundColor: avatarColor }}>
                                                {initials}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-slate-800 text-sm truncate" title={displayName}>{displayName}</div>
                                                <div className="flex gap-2 mt-1 text-[10px] font-mono">
                                                    <span className="text-slate-400" title="ID del cliente">ID: {c.ClienteID}</span>
                                                </div>
                                            </div>
                                            {c.CantReglas > 0 && (
                                                <span className="bg-[#1E1B4B] text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm whitespace-nowrap">
                                                    {c.CantReglas} Reglas
                                                </span>
                                            )}
                                        </div>
                                        
                                        {/* Detalle igual a Caja */}
                                        <div className="flex flex-col gap-0.5 text-[10px] text-slate-500 font-medium border-t border-slate-100 pt-2 mt-2">
                                            {c.IDCliente && <div>IdCliente: <span className="font-mono text-slate-700 font-bold">{c.IDCliente}</span></div>}
                                            {c.CioRuc && <div>RUC / CI: <span className="font-mono font-bold text-slate-800">{c.CioRuc}</span></div>}
                                            {c.Email && <div className="truncate">Email: <span className="font-mono text-slate-600">{c.Email}</span></div>}
                                            {c.TelefonoTrabajo && <div>Teléfono: <span className="font-mono text-slate-600">{c.TelefonoTrabajo}</span></div>}
                                            {c.DireccionTrabajo && <div className="leading-tight truncate">Dirección: <span className="text-slate-600">{c.DireccionTrabajo}</span></div>}
                                        </div>
                                    </div>
                                );
                            })
                        )
                    ) : (
                        // DB Tab Search Results
                        loadingDbSearch ? (
                            <div className="p-4 text-slate-400 text-center"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Buscando en la DB...</div>
                        ) : dbSearchResults.length === 0 ? (
                            <div className="p-4 text-slate-400 text-center text-xs">
                                {dbSearchTerm.length < 2 ? 'Escribe al menos 2 letras para buscar...' : 'No se encontraron clientes en la base de datos.'}
                            </div>
                        ) : (
                            dbSearchResults.map(c => {
                                const displayName = c.Nombre || c.NombreFantasia || `Cliente ${c.CodCliente}`;
                                const words = displayName.split(' ').filter(Boolean);
                                let initials = words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : displayName.substring(0, 2).toUpperCase();
                                const avatarColor = ['#f43f5e','#ec4899','#d946ef','#8b5cf6','#3b82f6','#0ea5e9','#14b8a6','#10b981'][ (displayName.charCodeAt(0) || 0) % 8 ];

                                return (
                                    <div
                                        key={c.CodCliente}
                                        onClick={() => {
                                            handleCreateClient(c.CodCliente, displayName);
                                            setSidebarTab('tarifas');
                                            setFilterClient(displayName);
                                            setDbSearchTerm('');
                                            setDbSearchResults([]);
                                        }}
                                        className="rounded-xl p-3 cursor-pointer transition-all border bg-white border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/20 shadow-sm group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0" style={{ backgroundColor: avatarColor }}>
                                                {initials}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-slate-700 group-hover:text-indigo-800 text-sm truncate" title={displayName}>{displayName}</div>
                                                <div className="flex gap-2 mt-1 text-[10px] font-mono">
                                                    <span className="text-slate-400" title="ID del cliente">ID: {c.CodCliente}</span>
                                                </div>
                                            </div>
                                            <span className="text-indigo-600 font-bold bg-indigo-50 px-2.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 text-[10px] whitespace-nowrap">
                                                <i className="fa-solid fa-plus text-[8px]"></i> Agregar
                                            </span>
                                        </div>
                                        
                                        {/* Detalle igual a Caja */}
                                        <div className="flex flex-col gap-0.5 text-[10px] text-slate-500 font-medium border-t border-slate-100 pt-2 mt-2">
                                            {c.IDCliente && <div>IdCliente: <span className="font-mono text-slate-600 font-bold">{c.IDCliente}</span></div>}
                                            {c.CioRuc && <div>RUC / CI: <span className="font-mono font-bold text-slate-700">{c.CioRuc}</span></div>}
                                            {c.Email && <div className="truncate">Email: <span className="font-mono text-slate-600">{c.Email}</span></div>}
                                            {c.TelefonoTrabajo && <div>Teléfono: <span className="font-mono text-slate-600">{c.TelefonoTrabajo}</span></div>}
                                            {c.DireccionTrabajo && <div className="leading-tight truncate">Dirección: <span className="text-slate-600">{c.DireccionTrabajo}</span></div>}
                                        </div>
                                    </div>
                                );
                            })
                        )
                    )}
                </div>
            </div>

            {/* MAIN CONTENT V2 (CRISTAL DASHBOARD) */}
            <div className="flex-1 flex flex-col bg-[#F8FAFC]">
                {selClientId ? (
                    <>
                        {/* HEADER DASHBOARD */}
                        <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.03)] z-10">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
                                            {clientData.client?.Nombre || clientData.client?.NombreCliente || `Cliente ID: ${selClientId}`}
                                        </h2>
                                        {clientData.client?.IDCliente && (
                                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-bold">
                                                IDCLIENTE: {clientData.client.IDCliente}
                                            </span>
                                        )}
                                    </div>

                                    {/* Grid de Datos del Cliente */}
                                    {(clientData.client?.CioRuc || clientData.client?.Email || clientData.client?.TelefonoTrabajo || clientData.client?.DireccionTrabajo) && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-2.5 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs">
                                            {clientData.client.CioRuc && (
                                                <div>
                                                    <span className="text-slate-400 font-black uppercase text-[10px] block">RUC / CI</span>
                                                    <span className="font-mono font-bold text-slate-800">{clientData.client.CioRuc}</span>
                                                </div>
                                            )}
                                            {clientData.client.Email && (
                                                <div>
                                                    <span className="text-slate-400 font-black uppercase text-[10px] block">Email</span>
                                                    <span className="font-mono text-slate-700 truncate block" title={clientData.client.Email}>{clientData.client.Email}</span>
                                                </div>
                                            )}
                                            {clientData.client.TelefonoTrabajo && (
                                                <div>
                                                    <span className="text-slate-400 font-black uppercase text-[10px] block">Teléfono</span>
                                                    <span className="font-mono text-slate-700">{clientData.client.TelefonoTrabajo}</span>
                                                </div>
                                            )}
                                            {clientData.client.DireccionTrabajo && (
                                                <div>
                                                    <span className="text-slate-400 font-black uppercase text-[10px] block">Dirección</span>
                                                    <span className="text-slate-700 truncate block" title={clientData.client.DireccionTrabajo}>{clientData.client.DireccionTrabajo}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                        <span className="text-slate-500 font-medium text-sm">Mostrando todas las familias y productos.</span>
                                        <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-2.5 py-0.5 rounded font-bold text-xs uppercase tracking-wide">
                                            {activeRulesCount} EXCEPCIONES CARGADAS
                                        </span>
                                        
                                        {clientData.profiles && clientData.profiles.map((p, idx) => {
                                            const name = p.NombrePerfil || '';
                                            const nameLower = name.toLowerCase();
                                            
                                            // Configurar colores e íconos en base al perfil
                                            let icon = "fa-solid fa-tag";
                                            let bgClass = "bg-indigo-50 text-indigo-700 border-indigo-200";
                                            
                                            if (nameLower.includes("trabajador") || nameLower.includes("funcionario") || nameLower.includes("empleado")) {
                                                icon = "fa-solid fa-briefcase";
                                                bgClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                                            } else if (nameLower.includes("estudiante") || nameLower.includes("alumno") || nameLower.includes("escolar") || nameLower.includes("colegio")) {
                                                icon = "fa-solid fa-graduation-cap";
                                                bgClass = "bg-sky-50 text-sky-700 border-sky-200";
                                            } else if (nameLower.includes("mayorista") || nameLower.includes("distribuidor")) {
                                                icon = "fa-solid fa-store";
                                                bgClass = "bg-purple-50 text-purple-700 border-purple-200";
                                            } else if (nameLower.includes("jubilado") || nameLower.includes("pensionista") || nameLower.includes("pasivo")) {
                                                icon = "fa-solid fa-person-cane";
                                                bgClass = "bg-amber-50 text-amber-700 border-amber-200";
                                            }
                                            
                                            return (
                                                <span 
                                                    key={idx}
                                                    className={`border px-2.5 py-0.5 rounded shadow-sm font-bold text-xs uppercase flex items-center gap-1.5 transition-all ${bgClass}`}
                                                    title={`Perfil de precio general asignado: ${name}`}
                                                >
                                                    <i className={icon}></i>
                                                    {name}
                                                </span>
                                            );
                                        })}

                                        {isDirtyMap && (
                                            <span className="text-amber-600 font-bold text-xs animate-pulse flex items-center gap-1">
                                                <i className="fa-solid fa-circle text-[8px]"></i> Cambios sin guardar
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setIsProfileModalOpen(true)}
                                        className="bg-slate-50 border border-slate-300 text-slate-700 hover:bg-slate-100 px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-sm"
                                    >
                                        <i className="fa-solid fa-user-gear text-slate-500"></i> Gestionar Perfiles
                                    </button>
                                    <button 
                                        onClick={() => setIsDrawerOpen(true)}
                                        className="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-sm"
                                    >
                                        <i className="fa-solid fa-plus-circle text-indigo-600"></i> Nueva Excepción
                                    </button>
                                    <button onClick={handleDeleteClient} className="px-4 py-2 text-slate-500 hover:bg-slate-100 hover:text-red-500 rounded font-semibold transition-colors" title="Eliminar este cliente y todas sus reglas de la lista de precios especiales">
                                        <i className="fa-solid fa-trash mr-2"></i> Quitar Cliente
                                    </button>
                                    <button onClick={handleSaveRules} className="bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white shadow-lg shadow-indigo-200 px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-transform active:scale-95">
                                        <i className="fa-solid fa-floppy-disk"></i> Guardar Tarifa
                                    </button>
                                </div>
                            </div>

                            {/* EXCEL-LIKE TOOLBAR */}
                            <div className="flex items-center justify-between bg-slate-50 p-2 border border-slate-200 rounded-lg">
                                <div className="flex gap-3 flex-1 items-center">
                                    {/* Vista Selector Toggle */}
                                    <button
                                        onClick={() => setShowAllProducts(prev => !prev)}
                                        className={`px-3 py-1.5 rounded-lg border font-bold text-xs flex items-center gap-2 transition-all ${!showAllProducts ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm' : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-100'}`}
                                    >
                                        <i className={`fa-solid ${!showAllProducts ? 'fa-border-all' : 'fa-list-check'}`}></i>
                                        {!showAllProducts ? 'Ver Catálogo Completo' : 'Ver Reglas Asignadas'}
                                    </button>

                                    {showAllProducts && (
                                        <>
                                            <select 
                                                value={filterCategory} 
                                                onChange={(e)=>setFilterCategory(e.target.value)}
                                                className="bg-white border border-slate-300 rounded px-3 py-1.5 font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100 max-w-sm truncate text-xs"
                                            >
                                                {categoriasDropdown.map(cat => {
                                                    if (cat === "TODAS" || cat === "ACTIVAS") {
                                                        return <option key={cat} value={cat}>{cat === "ACTIVAS" ? "⭐ VER SOLO CON REGLAS" : `Familia: ${cat}`}</option>;
                                                    }
                                                    const groupProd = baseProducts.find(p => p.CodArticulo === `GRUPO:${cat}`);
                                                    const desc = groupProd ? groupProd.Descripcion : cat;
                                                    return <option key={cat} value={cat}>Familia: {desc}</option>;
                                                })}
                                            </select>
                                            
                                            <div className="relative w-64">
                                                <i className="fa-solid fa-search absolute left-3 top-2 text-slate-400 text-xs"></i>
                                                <input
                                                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded outline-none focus:border-indigo-400 text-xs"
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
                                    <div className="flex items-center gap-3 pl-4 border-l border-slate-300 animate-in fade-in duration-200">
                                        <span className="text-slate-600 font-medium">Masivo ({selectedRows.size}):</span>
                                        <div className="relative">
                                            <input 
                                                type="number"
                                                value={bulkDiscountPct}
                                                onChange={e => setBulkDiscountPct(e.target.value)}
                                                placeholder="10"
                                                className="w-20 pl-3 pr-6 py-1.5 bg-white border border-slate-300 rounded font-mono outline-none focus:border-emerald-500 text-xs"
                                            />
                                            <span className="absolute right-2 top-2 text-slate-400 font-bold text-xs">%</span>
                                        </div>
                                        <button 
                                            onClick={applyBulkDiscount}
                                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded font-bold shadow-sm flex items-center gap-2 text-xs"
                                        >
                                            <i className="fa-solid fa-bolt"></i> Aplicar
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* DATA GRID */}
                        <div className="flex-1 overflow-auto p-6 pt-2 custom-scrollbar relative">
                            {loadingRules ? (
                                <div className="flex justify-center mt-20"><i className="fa-solid fa-circle-notch fa-spin text-3xl text-indigo-400"></i></div>
                            ) : !showAllProducts ? (
                                activeRules.length === 0 ? (
                                    <div className="text-center py-20 bg-white border border-slate-200 rounded-xl shadow-sm animate-in fade-in duration-300">
                                        <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-500 text-xl mx-auto mb-4">
                                            <i className="fa-solid fa-list-check"></i>
                                        </div>
                                        <h3 className="font-bold text-slate-800 text-base mb-1">Sin excepciones de precios</h3>
                                        <p className="text-xs text-slate-400 max-w-xs mx-auto mb-6">Este cliente está operando con la tarifa base del sistema. Comienza asignando su primera excepción.</p>
                                        <div className="flex justify-center gap-3">
                                            <button
                                                onClick={() => setIsDrawerOpen(true)}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-md shadow-indigo-100 flex items-center gap-1.5 transition-colors"
                                            >
                                                <i className="fa-solid fa-plus-circle"></i> Nueva Excepción
                                            </button>
                                            <button
                                                onClick={() => setShowAllProducts(true)}
                                                className="bg-slate-50 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold px-4 py-2 rounded-lg text-xs transition-colors"
                                            >
                                                Ver Catálogo Completo
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <table className="w-full text-left bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm animate-in fade-in duration-300">
                                        <thead className="bg-[#f8fafc] border-b border-slate-200 text-xs text-slate-500 uppercase font-black">
                                            <tr>
                                                <th className="p-3 w-16 text-center">Tipo</th>
                                                <th className="p-3">Excepción / Referencia</th>
                                                <th className="p-3 w-32 border-l border-slate-100">Precio Base</th>
                                                <th className="p-3 w-44 bg-indigo-50/20 text-indigo-800">Tarifa Especial</th>
                                                <th className="p-3 w-28 text-center">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {activeRules.map(rule => {
                                                const { codArticulo, descripcion, tipoSimbolo, precioBase, moneda, state } = rule;
                                                
                                                let reglaAplicadaText = "";
                                                if (state.tipoRegla === 'percentage') {
                                                    const discPct = parseFloat(state.discStr) || 0;
                                                    if (precioBase > 0) {
                                                        const calculatedPrice = precioBase * (1 - discPct / 100);
                                                        reglaAplicadaText = `${moneda} ${calculatedPrice.toFixed(2)} (${discPct}% OFF)`;
                                                    } else {
                                                        reglaAplicadaText = `${discPct}% OFF`;
                                                    }
                                                } else {
                                                    const fixedPrice = parseFloat(state.customStr) || 0;
                                                    if (precioBase > 0) {
                                                        const discPct = ((precioBase - fixedPrice) / precioBase) * 100;
                                                        reglaAplicadaText = `${moneda} ${fixedPrice.toFixed(2)} (${discPct.toFixed(1)}% OFF)`;
                                                    } else {
                                                        reglaAplicadaText = `${moneda} ${fixedPrice.toFixed(2)}`;
                                                    }
                                                }

                                                return (
                                                    <tr key={codArticulo} className="hover:bg-slate-50 transition-colors">
                                                        <td className="p-3 text-center text-lg select-none" title={tipoSimbolo === '📦' ? 'Producto' : tipoSimbolo === '📁' ? 'Familia' : 'Global'}>
                                                            {tipoSimbolo}
                                                        </td>
                                                        <td className="p-3">
                                                            <div className="font-bold text-slate-800">{descripcion}</div>
                                                            <div className="text-[11px] font-mono text-slate-400 mt-0.5">Ref: {codArticulo}</div>
                                                        </td>
                                                        <td className="p-3 font-mono text-slate-500 border-l border-slate-100">
                                                            {precioBase > 0 ? `${moneda} ${Number(precioBase).toFixed(2)}` : '--'}
                                                        </td>
                                                        <td className="p-3 font-mono bg-indigo-50/10 text-indigo-700 font-bold">
                                                            {reglaAplicadaText}
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingRule({ codArticulo, state });
                                                                        setIsDrawerOpen(true);
                                                                    }}
                                                                    className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition-colors text-slate-500"
                                                                    title="Editar excepción"
                                                                >
                                                                    <i className="fa-solid fa-pencil text-xs"></i>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleRemoveRule(codArticulo)}
                                                                    className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 hover:border-red-300 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors text-slate-500"
                                                                    title="Eliminar excepción"
                                                                >
                                                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )
                            ) : (
                                <table className="w-full text-left bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm animate-in fade-in duration-300">
                                    <thead className="bg-[#f8fafc] border-b border-slate-200">
                                        <tr>
                                            <th className="p-3 w-12 text-center text-slate-400">
                                                <input 
                                                    type="checkbox" 
                                                    onChange={() => toggleSelectAll(visibleProducts)} 
                                                    checked={selectedRows.size > 0 && selectedRows.size >= visibleProducts.length && visibleProducts.length > 0}
                                                />
                                            </th>
                                            <th className="p-3 font-semibold text-slate-600">Producto / Código</th>
                                            <th className="p-3 font-semibold text-slate-600 w-32 border-l border-slate-100">Precio Base</th>
                                            <th className="p-3 font-semibold text-indigo-700 w-40 bg-indigo-50/30">Nuevo Precio ($)</th>
                                            <th className="p-3 font-semibold text-emerald-700 w-32 bg-emerald-50/30">Desc. (%)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {visibleProducts.map(prod => {
                                            const st = rowStateMap[prod.CodArticulo] || {};
                                            const isSelected = selectedRows.has(prod.CodArticulo);
                                            const isActive = st.isActive;
                                            const isGroupRow = prod.ProIdProducto === null && prod.CodArticulo.startsWith('GRUPO:');
                                            const isGlobal = prod.ProIdProducto === 0;
                                            const isExpanded = expandedGroups.has(prod.Grupo);
                                            const isHidden = hiddenGroups.has(prod.Grupo);
                                            
                                            // Estilos para la fila del Grupo (Arbolito)
                                            if (isGroupRow) {
                                                return (
                                                    <tr 
                                                        key={prod.CodArticulo} 
                                                        id={`row-${prod.CodArticulo}`}
                                                        className={`border-t-2 border-slate-200 transition-all ${isHidden ? 'bg-slate-50 opacity-60 grayscale' : 'bg-slate-100'} ${isActive && !isHidden ? 'bg-indigo-50/20' : ''}`}
                                                    >
                                                        <td className="p-3 text-center">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={isSelected}
                                                                onChange={() => toggleRowSelect(prod.CodArticulo)}
                                                                className="w-4 h-4 text-indigo-600 cursor-pointer"
                                                                disabled={isHidden}
                                                            />
                                                        </td>
                                                        <td colSpan="4" className="p-3">
                                                            <div className="flex items-center gap-3 w-full cursor-pointer select-none" onClick={() => { if(!isHidden) toggleGroupNode(prod.Grupo); }}>
                                                                {/* OJO TOGGLE */}
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); toggleHideGroupNode(prod.Grupo); }}
                                                                    className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isHidden ? 'bg-slate-200 text-slate-500 hover:bg-slate-300' : 'bg-white text-slate-400 hover:text-red-500 shadow-sm border border-slate-200'}`}
                                                                    title={isHidden ? "Mostrar esta familia" : "Ocultar esta familia e ignorarla"}
                                                                >
                                                                    <i className={`fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                                                </button>
                                                                
                                                                <button disabled={isHidden} className={`w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded shadow-sm text-slate-500 ${!isHidden && 'hover:text-indigo-600 hover:border-indigo-400 transition-colors'}`}>
                                                                    <i className={`fa-solid ${isExpanded && !isHidden ? 'fa-minus' : 'fa-plus'} text-xs`}></i>
                                                                </button>
                                                                <i className={`fa-solid ${isExpanded && !isHidden ? 'fa-folder-open text-indigo-500' : 'fa-folder text-slate-400'} text-lg`}></i>
                                                                <span className={`font-black tracking-wide ${isHidden ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                                                                    {prod.Descripcion.toUpperCase()}
                                                                </span>
                                                                
                                                                {/* Si el Grupo en sí tiene un % de descuento guardado (Regla a nivel raíz de familia) */}
                                                                {isActive && !isHidden && (
                                                                    <div className="ml-4 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                                        <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
                                                                            REGLA ENTERA FAMILIA: {st.discStr}% OFF
                                                                        </span>
                                                                        <button 
                                                                            onClick={() => handleRemoveRule(prod.CodArticulo)}
                                                                            className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 w-5 h-5 rounded flex items-center justify-center transition-colors text-[10px]"
                                                                            title="Eliminar regla de familia"
                                                                        >
                                                                            <i className="fa-solid fa-trash-can"></i>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                
                                                                {/* Inputs rápidos en la misma fila del grupo para descuento global de familia */}
                                                                {!isHidden && (
                                                                    <div className="ml-auto flex items-center gap-2 pr-6" onClick={(e) => e.stopPropagation()}>
                                                                        <span className="text-xs font-semibold text-slate-400 uppercase">Tarifa Familia:</span>
                                                                        <div className="relative w-28">
                                                                            <input 
                                                                                type="number" step="0.01"
                                                                                value={st.discStr}
                                                                                onChange={e => handleDiscStrChange(prod.CodArticulo, e.target.value)}
                                                                                className="w-full pl-3 pr-7 py-1 bg-white border border-slate-300 text-slate-800 rounded outline-none h-7 text-xs font-mono font-bold focus:border-indigo-500 shadow-sm"
                                                                                placeholder="0"
                                                                            />
                                                                            <span className="absolute right-2 top-1.5 text-slate-400 text-[10px] font-black">%</span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            }

                                            // Filas normales (Productos) o Regla Total
                                            return (
                                                <tr 
                                                    key={prod.CodArticulo} 
                                                    id={`row-${prod.CodArticulo}`}
                                                    className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : isActive ? 'bg-amber-50/10' : ''} ${!isGlobal ? 'pl-8' : ''}`}
                                                >
                                                    <td className="p-3 text-center">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={isSelected}
                                                            onChange={() => toggleRowSelect(prod.CodArticulo)}
                                                            className="w-4 h-4 text-indigo-600 cursor-pointer"
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            {!isGlobal && <div className="w-4 border-b border-l border-slate-300 h-4 ml-2 mr-2 opacity-50 rounded-bl"></div>}
                                                            <div>
                                                                <div className={`font-bold ${isGlobal ? 'text-indigo-600 text-base flex items-center gap-2' : 'text-slate-700'}`}>
                                                                    {isGlobal && <i className="fa-solid fa-earth-americas"></i>}
                                                                    {prod.Descripcion}
                                                                </div>
                                                                <div className="flex gap-2 items-center mt-0.5">
                                                                    <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-1 py-0.5 rounded">{prod.CodArticulo}</span>
                                                                    {isActive && (
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shadow-sm">Activa</span>
                                                                            <button 
                                                                                onClick={() => handleRemoveRule(prod.CodArticulo)}
                                                                                className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 w-5 h-5 rounded flex items-center justify-center transition-colors text-[10px]"
                                                                                title="Eliminar regla"
                                                                            >
                                                                                <i className="fa-solid fa-trash-can"></i>
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-3 font-mono text-slate-500 border-l border-slate-100">
                                                        {prod.Precio > 0 ? `${prod.Moneda} ${Number(prod.Precio).toFixed(2)}` : '--'}
                                                    </td>
                                                    <td className="p-2 bg-indigo-50/10">
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-2 text-slate-400 text-xs font-bold">{prod.Moneda !== 'UYU' ? prod.Moneda : '$'}</span>
                                                            <input 
                                                                type="number"
                                                                step="0.01"
                                                                value={st.customStr}
                                                                onChange={e => handlePriceStrChange(prod.CodArticulo, e.target.value)}
                                                                className={`w-full pl-7 pr-3 py-1.5 border rounded font-mono outline-none transition-all ${isActive && st.tipoRegla === 'fixed' ? 'border-indigo-400 bg-white shadow-[0_0_0_2px_rgba(99,102,241,0.1)]' : 'border-slate-300 bg-white/50 focus:bg-white focus:border-indigo-400'}`}
                                                                placeholder="Base"
                                                                disabled={isGlobal}
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="p-2 bg-emerald-50/10">
                                                        <div className="relative">
                                                            <input 
                                                                type="number"
                                                                step="0.01"
                                                                value={st.discStr}
                                                                onChange={e => handleDiscStrChange(prod.CodArticulo, e.target.value)}
                                                                className={`w-full pl-3 pr-7 py-1.5 border rounded font-mono outline-none transition-all ${isActive && st.tipoRegla === 'percentage' ? 'border-emerald-400 bg-white shadow-[0_0_0_2px_rgba(16,185,129,0.1)]' : 'border-slate-300 bg-white/50 focus:bg-white focus:border-emerald-400'}`}
                                                                placeholder="0"
                                                            />
                                                            <span className="absolute right-3 top-1.5 text-slate-400 text-sm font-bold">%</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                            {showAllProducts && visibleProducts.length === 0 && !loadingRules && (
                                <div className="text-center py-12 text-slate-400 animate-in fade-in duration-200">
                                    <i className="fa-solid fa-box-open text-4xl mb-3 opacity-50"></i>
                                    <p>No se encontraron productos con los filtros actuales.</p>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                        <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-sm mb-6">
                            <i className="fa-solid fa-tags text-4xl text-indigo-200"></i>
                        </div>
                        <h2 className="text-xl font-bold text-slate-700 mb-2">Selecciona un cliente</h2>
                        <p className="text-slate-500 max-w-sm text-center">
                            Elige de la lista lateral o crea uno nuevo para comenzar a personalizar su tabla de tarifas y descuentos.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SpecialPrices;
