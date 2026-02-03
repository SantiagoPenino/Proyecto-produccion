import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import PriceCalculatorTest from './PriceCalculatorTest';

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
    const [ruleType, setRuleType] = useState('fixed_price');
    const [value, setValue] = useState(0);

    useEffect(() => {
        api.get('/prices/base')
            .then(res => {
                const prods = [
                    { CodArticulo: 'TOTAL', Descripcion: 'Aplica a todo el resto', Precio: 0, Grupo: 'General' },
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

    const handleConfirm = () => {
        if (selection.length === 0) return toast.error("Selecciona al menos un producto");

        const newRules = selection.map(cod => ({
            CodArticulo: cod,
            TipoRegla: ruleType,
            Valor: value,
            CantidadMinima: 1
        }));

        onAdd(newRules);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
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

                    {/* DERECHA: Configuración Regla */}
                    <div className="w-1/3 p-6 bg-slate-50 flex flex-col justify-center space-y-6 shadow-inner">
                        <div className="text-center">
                            <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto shadow-sm mb-4 border border-slate-200">
                                <i className="fa-solid fa-wand-magic-sparkles text-2xl text-indigo-500"></i>
                            </div>
                            <h4 className="font-bold text-slate-700">Regla Común</h4>
                            <p className="text-xs text-slate-500 mt-1">Se aplicará a los {selection.length} productos seleccionados.</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Tipo de Regla</label>
                                <select
                                    className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-200 outline-none bg-white"
                                    value={ruleType}
                                    onChange={e => setRuleType(e.target.value)}
                                >
                                    <option value="fixed_price">Precio Fijo Exacto ($)</option>
                                    <option value="percentage_discount">Descuento Porcentual (%)</option>
                                    <option value="percentage_surcharge">Recargo Porcentual (%)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Valor</label>
                                <input
                                    type="number" step="0.01"
                                    className="w-full border rounded p-2 text-xl font-bold text-center text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                                    value={value}
                                    onChange={e => setValue(e.target.value)}
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleConfirm}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-md transition-all active:scale-95 flex justify-center items-center gap-2 mt-auto"
                        >
                            <i className="fa-solid fa-plus-circle"></i>
                            Aplicar Reglas
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ProfileEditor = ({ profile, onSave, onBack }) => {
    const [name, setName] = useState(profile?.Nombre || '');
    const [desc, setDesc] = useState(profile?.Descripcion || '');
    const [esGlobal, setEsGlobal] = useState(profile?.EsGlobal || false);
    const [showBulk, setShowBulk] = useState(false);

    // Catalogo para lookup
    const [catalog, setCatalog] = useState([]);

    useEffect(() => {
        api.get('/prices/base')
            .then(res => {
                setCatalog([{ CodArticulo: 'TOTAL', Descripcion: 'Aplica a TODOS los productos' }, ...res.data]);
            })
            .catch(console.error);
    }, []);

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
        setItems([...items, { CodArticulo: 'TOTAL', TipoRegla: 'percentage', Valor: 0, _tempId: Date.now() }]);
    };

    const handleRemoveItem = (id) => {
        setItems(items.filter(i => i._tempId !== id));
    };

    const handleChangeItem = (id, field, val) => {
        setItems(items.map(i => i._tempId === id ? { ...i, [field]: val } : i));
    };

    return (
        <div className="flex flex-col h-full bg-white p-6 relative">
            {/* Header */}
            <div className="flex justify-between items-center mb-6 border-b pb-4">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <i className="fa-solid fa-arrow-left text-lg"></i>
                    </button>
                    <h2 className="text-xl font-bold text-slate-800">{profile?.ID ? 'Editar Perfil' : 'Nuevo Perfil'}</h2>
                </div>
                <button
                    onClick={() => onSave({ id: profile?.ID, nombre: name, descripcion: desc, items, esGlobal })}
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
                <div className="flex items-center">
                    <label className="flex items-center gap-3 p-4 border rounded bg-white cursor-pointer hover:border-indigo-300 transition-colors shadow-sm w-full">
                        <input
                            type="checkbox"
                            checked={esGlobal}
                            onChange={e => setEsGlobal(e.target.checked)}
                            className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                        <div>
                            <span className="block font-bold text-slate-700 text-sm">Perfil Global (Por Defecto)</span>
                            <span className="block text-xs text-slate-500">Aplica automáticamente a TODOS los clientes. No se puede desasignar individualmente.</span>
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
                    <div className="flex gap-2">
                        <button onClick={() => setShowBulk(true)} className="text-xs bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded font-bold shadow-sm flex items-center gap-1 transition-colors">
                            <i className="fa-solid fa-list-check"></i> Carga Masiva / Precios
                        </button>
                        <button onClick={handleAddItem} className="text-xs text-indigo-600 hover:text-indigo-800 font-bold bg-indigo-50 px-3 py-1.5 rounded border border-indigo-100 flex items-center gap-1 transition-colors">
                            <i className="fa-solid fa-plus"></i> Manual
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto border rounded-lg bg-white shadow-inner custom-scrollbar">
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
                            {items.length === 0 ? (
                                <tr><td colSpan="5" className="p-8 text-center text-slate-400">Este perfil no tiene reglas definidas.</td></tr>
                            ) : (
                                items.map(item => (
                                    <tr key={item._tempId} className="hover:bg-slate-50 group">
                                        <td className="p-2 pl-3">
                                            <ProductSearchInput
                                                value={item.CodArticulo}
                                                onChange={(val) => handleChangeItem(item._tempId, 'CodArticulo', val)}
                                                catalog={catalog}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <select
                                                className="w-full border rounded px-2 py-1 text-sm bg-white focus:border-indigo-400 outline-none"
                                                value={item.TipoRegla}
                                                onChange={e => handleChangeItem(item._tempId, 'TipoRegla', e.target.value)}
                                            >
                                                <option value="fixed_price">Precio Fijo Exacto ($)</option>
                                                <option value="percentage_discount">Descuento Porcentual (%)</option>
                                                <option value="percentage_surcharge">Recargo Porcentual (%)</option>
                                                <option value="fixed_discount">Descuento Monto ($)</option>
                                                <option value="fixed_surcharge">Recargo Monto ($)</option>
                                            </select>
                                        </td>
                                        <td className="p-2 text-center">
                                            <input
                                                type="number" min="1"
                                                className="w-full border rounded px-2 py-1 text-center font-mono text-sm focus:border-indigo-400 outline-none"
                                                value={item.CantidadMinima || 1}
                                                onChange={e => handleChangeItem(item._tempId, 'CantidadMinima', e.target.value)}
                                                title="Cantidad mínima para aplicar esta regla"
                                            />
                                        </td>
                                        <td className="p-2 text-right">
                                            <input
                                                type="number" step="0.01"
                                                className="w-full border rounded px-2 py-1 text-right font-bold text-slate-700 focus:border-indigo-400 outline-none"
                                                value={item.Valor}
                                                onChange={e => handleChangeItem(item._tempId, 'Valor', e.target.value)}
                                            />
                                        </td>
                                        <td className="p-2 text-center">
                                            <button
                                                onClick={() => handleRemoveItem(item._tempId)}
                                                className="text-slate-300 hover:text-red-500 transition-colors"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-2 text-xs text-slate-400 italic">
                    * Tip: La regla "TOTAL" aplica a todo lo que no tenga una regla específica definida aquí.
                </div>
            </div>
            {showBulk && <BulkAddModal onAdd={handleBulkAdd} onCancel={() => setShowBulk(false)} profileName={name} />}
        </div>
    );
};


// --- PANTALLA PRINCIPAL ---

const PriceProfiles = () => {
    const [activeTab, setActiveTab] = useState('profiles'); // profiles | assignments
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(false);

    // Asignaciones
    const [customers, setCustomers] = useState([]); // Lista completa clientes ERP
    const [assignments, setAssignments] = useState({}); // Map ClienteID -> PerfilID
    const [filterCust, setFilterCust] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // all, profile, exceptions, standard

    const [selectedProfile, setSelectedProfile] = useState(null);
    const [openDropdown, setOpenDropdown] = useState(null); // ID del cliente con dropdown abierto

    // (Dropdown click listener eliminado para el nuevo layout Master-Detail)

    useEffect(() => {
        loadProfiles();
        if (activeTab === 'assignments' || activeTab === 'simulator') loadCustomersAndAssignments();
    }, [activeTab]);

    const loadProfiles = () => {
        api.get('/profiles').then(res => setProfiles(res.data)).catch(console.error);
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

    const loadCustomersAndAssignments = async () => {
        setLoading(true);
        try {
            // Intentar cargar ambos, pero si falla asignaciones, mostrar clientes igual
            const [clientsRes, assignRes] = await Promise.allSettled([
                api.get('/clients'),
                api.get('/profiles/assignments')
            ]);

            // Procesar Clientes
            if (clientsRes.status === 'fulfilled') {
                setCustomers(clientsRes.value.data || []);
            } else {
                console.error("Fallo carga clientes:", clientsRes.reason);
                toast.error("Error al cargar lista de clientes");
            }

            // Procesar Asignaciones
            const assignMap = {};
            if (assignRes.status === 'fulfilled') {
                assignRes.value.data.forEach(a => {
                    let pids = [];
                    if (a.PerfilesIDs) {
                        pids = String(a.PerfilesIDs).split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
                    } else if (a.PerfilID) {
                        pids = [parseInt(a.PerfilID)];
                    }
                    assignMap[a.ClienteID] = { pid: pids, rules: a.CantReglas || 0 };
                });
            } else {
                console.error("Fallo carga asignaciones:", assignRes.reason);
                // No bloqueante, solo avisamos
                // toast.warning("No se pudieron cargar las asignaciones actuales");
            }

            setAssignments(assignMap);

        } catch (e) {
            console.error("Error general:", e);
            toast.error("Error inesperado cargando datos");
        } finally {
            setLoading(false);
        }
    };

    const handleAssign = (clienteId, perfilId) => {
        // Buscar cliente usando CodCliente (o IDReact si fuera el caso, pero backend usa CodCliente)
        const cliente = customers.find(c => c.CodCliente === clienteId);
        const pidVal = parseInt(perfilId) || null;

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
    const filteredCustomers = customers.filter(c => {
        const cId = c.CodCliente; // Propiedad correcta del endpoint
        const cNombre = c.Nombre || c.NombreFantasia || '';

        const data = assignments[cId] || {};
        const hasProfile = !!data.pid;
        const hasExceptions = (data.rules || 0) > 0;

        // Filtro Texto
        const matchesText = cNombre.toLowerCase().includes(filterCust.toLowerCase()) ||
            String(cId).includes(filterCust);

        if (!matchesText) return false;

        // Filtro Estado
        if (filterStatus === 'profile' && !hasProfile) return false;
        if (filterStatus === 'exceptions' && !hasExceptions) return false;
        if (filterStatus === 'standard' && (hasProfile || hasExceptions)) return false; // Estándar puro

        return true;
    });

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* TABS HEADER */}
            <div className="bg-white border-b border-slate-200 px-6 pt-4 flex gap-6">
                <button
                    onClick={() => setActiveTab('profiles')}
                    className={`pb-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'profiles' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-list-ul mr-2"></i> Gestión de Perfiles
                </button>
                <button
                    onClick={() => {
                        setActiveTab('assignments');
                        if (activeTab !== 'assignments') loadCustomersAndAssignments();
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
            </div>

            {/* CONTENIDO */}
            <div className="flex-1 overflow-hidden p-6">
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
                                {profiles.map(p => (
                                    <div
                                        key={p.ID}
                                        onClick={() => handleSelectProfile(p)}
                                        className={`p-3 border-b cursor-pointer group transition-colors rounded mb-1 flex justify-between items-center ${selectedProfile?.ID === p.ID ? 'bg-indigo-50 border-indigo-100' : 'hover:bg-slate-50 border-slate-100'}`}
                                    >
                                        <div>
                                            <div className={`font-bold ${selectedProfile?.ID === p.ID ? 'text-indigo-700' : 'text-slate-800'}`}>{p.Nombre}</div>
                                            <div className="text-xs text-slate-500 mb-1">{p.Descripcion}</div>
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
                                {profiles.length === 0 && <div className="p-8 text-center text-slate-400 text-sm">No hay perfiles definidos.</div>}
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
                                    <div className="divide-y divide-slate-100">
                                        {filteredCustomers.map(c => {
                                            const cId = c.CodCliente;
                                            const cName = c.Nombre || c.NombreFantasia || `Cliente ${cId}`;
                                            const data = assignments[cId] || {};
                                            const pid = data.pid;
                                            const hasProfiles = pid && (Array.isArray(pid) ? pid.length > 0 : true);
                                            const hasManual = (data.rules || 0) > 0;

                                            return (
                                                <div
                                                    key={cId}
                                                    onClick={() => setOpenDropdown(cId)}
                                                    className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors border-l-4 ${openDropdown === cId ? 'bg-indigo-50 border-indigo-600' : 'border-transparent'}`}
                                                >
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex-1 min-w-0">
                                                            <div className={`font-bold text-sm truncate ${openDropdown === cId ? 'text-indigo-900' : 'text-slate-700'}`}>{cName}</div>
                                                            <div className="text-xs text-slate-400 font-mono mt-0.5">{cId}</div>
                                                        </div>
                                                        <div className="flex gap-1">
                                                            {hasManual && <i className="fa-solid fa-triangle-exclamation text-amber-500 text-xs" title="Reglas manuales"></i>}
                                                            {hasProfiles && <span className="w-2 h-2 rounded-full bg-indigo-500 mt-1" title="Perfiles asignados"></span>}
                                                        </div>
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
                                    const customer = customers.find(c => c.CodCliente === cId);
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
                        <PriceCalculatorTest customers={customers} assignments={assignments} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceProfiles;
