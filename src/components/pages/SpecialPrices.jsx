import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// --- MODALES AUXILIARES ---

// 1. Agregar Cliente
// 1. Agregar Cliente (Con Buscador)
const AddClientModal = ({ isOpen, onClose, onSave }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedClient, setSelectedClient] = useState(null);

    // Debounce search
    useEffect(() => {
        if (!searchTerm || searchTerm.length < 2) {
            setResults([]);
            return;
        }
        // Si ya seleccionamos uno, no buscar
        if (selectedClient && (
            selectedClient.NombreCliente === searchTerm ||
            selectedClient.RazonSocial === searchTerm ||
            `Cliente ${selectedClient.ClienteID}` === searchTerm
        )) return;

        const timer = setTimeout(() => {
            setLoading(true);
            api.get('/clients', { params: { q: searchTerm } })
                .then(res => setResults(res.data || []))
                .catch(e => {
                    console.error("Error buscando clientes:", e);
                    // Fallback visual si falla
                    setResults([]);
                })
                .finally(() => setLoading(false));
        }, 500);

        return () => clearTimeout(timer);
    }, [searchTerm, selectedClient]);

    const handleSelect = (client) => {
        setSelectedClient(client);
        setSearchTerm(client.NombreCliente || client.RazonSocial || `Cliente ${client.ClienteID}`);
        setResults([]); // Ocultar lista
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 flex flex-col max-h-[85vh]">
                <h3 className="text-lg font-bold mb-4">Agregar Cliente Especial</h3>

                <div className="mb-4 relative">
                    <label className="block text-sm text-slate-500 mb-1">Buscar Cliente (Nombre o ID)</label>
                    <div className="relative">
                        <input
                            className="w-full border p-2 rounded pr-8 focus:ring-2 focus:ring-indigo-100 outline-none"
                            placeholder="Ej: Perez, 211480..."
                            value={searchTerm}
                            onChange={e => {
                                setSearchTerm(e.target.value);
                                if (selectedClient) setSelectedClient(null);
                            }}
                            autoFocus
                        />
                        {loading && <i className="fa-solid fa-circle-notch fa-spin absolute right-3 top-3 text-slate-400"></i>}
                    </div>

                    {/* Resultados de Búsqueda */}
                    {results.length > 0 && !selectedClient && (
                        <div className="absolute z-50 w-full bg-white border border-slate-200 rounded-b shadow-lg max-h-48 overflow-y-auto mt-1">
                            {results.map(c => (
                                <div
                                    key={c.ClienteID}
                                    onClick={() => handleSelect(c)}
                                    className="p-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                                >
                                    <div className="font-bold text-sm text-slate-700">{c.NombreCliente || c.RazonSocial}</div>
                                    <div className="text-xs text-slate-400">ID: {c.ClienteID} {c.RUT ? `| RUT: ${c.RUT}` : ''}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {selectedClient && (
                    <div className="mb-4 p-3 bg-indigo-50 border border-indigo-100 rounded text-sm text-indigo-800 animate-in fade-in zoom-in">
                        <p className="text-xs text-indigo-500 font-bold uppercase">Seleccionado</p>
                        <p className="font-bold text-lg">{selectedClient.NombreCliente || selectedClient.RazonSocial}</p>
                        <p className="text-xs opacity-75">ID Interno: {selectedClient.ClienteID}</p>
                    </div>
                )}

                <div className="flex justify-end gap-2 mt-auto pt-4 border-t border-slate-100">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded font-medium">Cancelar</button>
                    <button
                        onClick={() => {
                            if (selectedClient) {
                                onSave(selectedClient.ClienteID, selectedClient.NombreCliente || selectedClient.RazonSocial);
                            } else if (searchTerm && !isNaN(searchTerm)) {
                                // Fallback ID manual
                                onSave(searchTerm, `Cliente ${searchTerm}`);
                            } else {
                                toast.error("Selecciona un cliente de la lista");
                            }
                        }}
                        className={`px-6 py-2 rounded text-white font-bold transition-all shadow-sm ${selectedClient || (searchTerm && !isNaN(searchTerm)) ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'}`}
                    >
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
};

// 2. Bulk Action Modal (Agregar/Editar Descuentos)
const BulkActionModal = ({ isOpen, onClose, onApply, allProducts }) => {
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(new Set());
    const [config, setConfig] = useState({ type: 'percentage', val: 10, mode: 'add' }); // mode: add, update, replace

    if (!isOpen) return null;

    const filteredProds = allProducts.filter(p => !search || p.toLowerCase().includes(search.toLowerCase()));

    const toggleWait = (p) => {
        const newSet = new Set(selected);
        if (newSet.has(p)) newSet.delete(p);
        else newSet.add(p);
        setSelected(newSet);
    };

    const handleSelectAll = () => {
        const newSet = new Set(selected);
        filteredProds.forEach(p => newSet.add(p));
        setSelected(newSet);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-lg">Agregar / Editar Descuentos Masivos</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Columna Izquierda: Selección Productos */}
                    <div className="w-1/2 p-4 border-r flex flex-col gap-2">
                        <label className="font-semibold text-sm text-slate-600">Seleccionar Productos ({selected.size})</label>
                        <div className="flex gap-2">
                            <input
                                className="flex-1 border p-1 text-sm rounded"
                                placeholder="Buscar..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                            <button onClick={handleSelectAll} className="px-2 py-1 text-xs bg-slate-100 border rounded">Todos</button>
                            <button onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs bg-slate-100 border rounded">Ninguno</button>
                        </div>
                        <div className="flex-1 overflow-y-auto border rounded p-2 bg-slate-50 gap-1 flex flex-col">
                            {filteredProds.map(p => (
                                <label key={p} className="flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer text-sm">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(p)}
                                        onChange={() => toggleWait(p)}
                                    />
                                    <span className="truncate">{p}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Columna Derecha: Configuración */}
                    <div className="w-1/2 p-4 flex flex-col gap-4 bg-white">
                        <div>
                            <label className="block text-sm font-semibold mb-1">Tipo de Regla</label>
                            <select
                                className="w-full border p-2 rounded"
                                value={config.type}
                                onChange={e => setConfig({ ...config, type: e.target.value })}
                            >
                                <option value="percentage">Porcentaje (%)</option>
                                <option value="fixed">Precio Fijo ($)</option>
                                <option value="subtract">Restar Cantidad ($)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-1">Valor</label>
                            <input
                                type="number" step="0.01"
                                className="w-full border p-2 rounded font-mono"
                                value={config.val}
                                onChange={e => setConfig({ ...config, val: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div className="pt-4 border-t mt-auto">
                            <label className="block text-sm font-semibold mb-2">Modo de Aplicación</label>
                            <div className="flex flex-col gap-2 text-sm text-slate-600">
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="mode" checked={config.mode === 'add'} onChange={() => setConfig({ ...config, mode: 'add' })} />
                                    <span>Agregar solo si falta (No tocar existentes)</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="mode" checked={config.mode === 'update'} onChange={() => setConfig({ ...config, mode: 'update' })} />
                                    <span>Actualizar existentes (Solo seleccionados que ya tengan regla)</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="mode" checked={config.mode === 'replace'} onChange={() => setConfig({ ...config, mode: 'replace' })} />
                                    <span>Reemplazar todo (Sobrescribir seleccionados)</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 border rounded bg-white hover:bg-slate-50">Cancelar</button>
                    <button
                        onClick={() => onApply(Array.from(selected), config)}
                        className="px-6 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 shadow-sm"
                    >
                        Aplicar Cambios
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- COMPONENTE PRINCIPAL ---
const SpecialPrices = () => {
    // Estado Global
    const [clients, setClients] = useState([]);
    const [selClientId, setSelClientId] = useState(null);
    const [clientData, setClientData] = useState({ client: null, rules: [] }); // Reglas cargadas
    const [productsList, setProductsList] = useState([]); // Lista string productos para selector

    // UI Estado
    const [loading, setLoading] = useState(false);
    const [loadingRules, setLoadingRules] = useState(false);
    const [filterClient, setFilterClient] = useState("");

    // Modales
    const [showAddClient, setShowAddClient] = useState(false);
    const [showBulk, setShowBulk] = useState(false);

    // Carga Inicial
    useEffect(() => {
        loadClients();
        loadProducts();
    }, []);

    // Carga Reglas al seleccionar cliente
    useEffect(() => {
        if (selClientId) {
            loadRules(selClientId);
        } else {
            setClientData({ client: null, rules: [] });
        }
    }, [selClientId]);

    const loadClients = () => {
        setLoading(true);
        api.get('/special-prices/clients')
            .then(res => setClients(res.data))
            .catch(err => toast.error("Error cargando clientes"))
            .finally(() => setLoading(false));
    };

    const loadProducts = () => {
        // Reusamos endpoint de integrationLocal que trae todos los artículos
        api.get('/products-integration/local')
            .then(res => {
                // Extraer Codigos únicos (o Descripcion + Codigo)
                // El usuario en el HTML usaba 'Descripcion' o 'Codigo'?
                // Usaremos CodArticulo como ID clave.
                const prods = res.data.map(p => p.CodArticulo).filter(Boolean); // Solo codigos
                setProductsList(prods);
            })
            .catch(e => console.error("Error loading products list", e));
    };

    const loadRules = (cid) => {
        setLoadingRules(true);
        api.get(`/special-prices/${cid}`)
            .then(res => {
                setClientData({
                    client: res.data.client,
                    rules: res.data.rules.map(r => ({ ...r, _id: Math.random().toString(36).substr(2, 9), edit: false }))
                });
            })
            .catch(err => {
                console.error(err);
                if (err.response?.status === 404) {
                    // Cliente nuevo localmente pero no en DB? No debería pasar si seleccionamos de la lista.
                    // Pero si acabamos de crear uno...
                }
            })
            .finally(() => setLoadingRules(false));
    };

    // --- ACCIONES DE NEGOCIO ---

    const handleCreateClient = (id, nombre) => {
        // Guardar vacío primero para crearlo. Si viene nombre, lo usamos.
        api.post('/special-prices/profile', { clientId: id, nombre: nombre || `Cliente ${id}`, rules: [] })
            .then(() => {
                toast.success(`Cliente ${nombre || id} agregado`);
                setShowAddClient(false);
                loadClients();
                setSelClientId(id); // Auto-seleccionar
            })
            .catch(e => toast.error("Error: " + e.message));
    };

    const handleSaveRules = () => {
        if (!selClientId) return;

        // Preparar payload
        const payloadRules = clientData.rules.map(r => ({
            CodArticulo: r.CodArticulo,
            TipoRegla: r.TipoRegla,
            Valor: r.Valor,
            Moneda: 'UYU', // Default por ahora
            MinCantidad: 0
        }));

        api.post('/special-prices/profile', {
            clientId: selClientId,
            nombre: clientData.client?.NombreCliente,
            rules: payloadRules
        })
            .then(() => toast.success("Cambios guardados correctamente"))
            .catch(e => toast.error("Error guardando: " + e.message));
    };

    const handleDeleteClient = () => {
        if (!selClientId || !window.confirm(`¿Eliminar configuración de Cliente ${selClientId}?`)) return;

        api.delete(`/special-prices/${selClientId}`)
            .then(() => {
                toast.success("Cliente eliminado");
                setSelClientId(null);
                loadClients();
            })
            .catch(e => toast.error("Error: " + e.message));
    };

    // --- MANEJO DE REGLAS LOCALES (En Memoria hasta Guardar) ---

    const updateRule = (id, field, val) => {
        setClientData(prev => ({
            ...prev,
            rules: prev.rules.map(r => r._id === id ? { ...r, [field]: val } : r)
        }));
    };

    const removeRule = (id) => {
        setClientData(prev => ({
            ...prev,
            rules: prev.rules.filter(r => r._id !== id)
        }));
    };

    const handleBulkApply = (selectedProds, config) => {
        // config: { type, val, mode }
        setClientData(prev => {
            let newRules = [...prev.rules];
            const selSet = new Set(selectedProds);

            selectedProds.forEach(prodCode => {
                const existingIdx = newRules.findIndex(r => r.CodArticulo === prodCode);

                if (existingIdx >= 0) {
                    // Ya existe
                    if (config.mode === 'update' || config.mode === 'replace') {
                        newRules[existingIdx] = {
                            ...newRules[existingIdx],
                            TipoRegla: config.type,
                            Valor: config.val
                        };
                    }
                } else {
                    // No existe
                    if (config.mode !== 'update') {
                        newRules.push({
                            _id: Math.random().toString(36),
                            CodArticulo: prodCode,
                            TipoRegla: config.type,
                            Valor: config.val,
                            Moneda: 'UYU',
                            edit: false
                        });
                    }
                }
            });

            return { ...prev, rules: newRules };
        });

        setShowBulk(false);
        toast.info("Reglas aplicadas en memoria. Recuerda GUARDAR.");
    };


    // Filtrado Clientes Sidebar
    const filteredClients = clients.filter(c =>
        String(c.ClienteID).includes(filterClient) ||
        (c.NombreCliente || "").toLowerCase().includes(filterClient.toLowerCase())
    );

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden">
            {/* ADD CLIENT MODAL */}
            <AddClientModal
                isOpen={showAddClient}
                onClose={() => setShowAddClient(false)}
                onSave={handleCreateClient}
            />
            {/* BULK EDIT MODAL */}
            <BulkActionModal
                isOpen={showBulk}
                onClose={() => setShowBulk(false)}
                allProducts={productsList}
                onApply={handleBulkApply}
            />

            {/* SIDEBAR */}
            <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                    <span className="font-bold text-slate-700">Clientes</span>
                    <button onClick={() => setShowAddClient(true)} className="text-indigo-600 hover:bg-indigo-50 px-2 rounded text-sm font-bold">+</button>
                </div>
                <div className="p-2 border-b border-slate-100">
                    <input
                        className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm outline-none focus:border-indigo-400"
                        placeholder="Buscar cliente..."
                        value={filterClient}
                        onChange={e => setFilterClient(e.target.value)}
                    />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loading ? <div className="p-4 text-slate-400 text-sm">Cargando...</div> : (
                        filteredClients.map(c => (
                            <div
                                key={c.ClienteID}
                                onClick={() => setSelClientId(c.ClienteID)}
                                className={`
                                    px-4 py-3 cursor-pointer border-b border-slate-50 hover:bg-slate-50 transition-colors
                                    ${selClientId === c.ClienteID ? 'bg-indigo-50 border-indigo-100' : ''}
                                `}
                            >
                                <div className={`text-sm font-medium ${selClientId === c.ClienteID ? 'text-indigo-700' : 'text-slate-700'}`}>
                                    {c.ClienteID}
                                </div>
                                <div className="text-xs text-slate-500 truncate">{c.NombreCliente}</div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selClientId ? (
                    <>
                        {/* EDITOR HEADER */}
                        <div className="bg-white border-b border-slate-200 p-4 flex flex-col gap-4 shadow-sm z-10">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                        <i className="fa-solid fa-user-tag text-indigo-500"></i>
                                        Cliente {selClientId}
                                    </h2>
                                    <p className="text-sm text-slate-500">{clientData.client?.NombreCliente || 'Cargando...'}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSaveRules}
                                        className="btn-primary flex items-center gap-2 px-4 py-2"
                                    >
                                        <i className="fa-solid fa-save"></i> Guardar Cambios ({clientData.rules.length})
                                    </button>
                                </div>
                            </div>

                            {/* TOOLBAR */}
                            <div className="flex gap-2 flex-wrap items-center">
                                <button
                                    onClick={() => setShowBulk(true)}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-sm border border-slate-300 transition-colors"
                                >
                                    <i className="fa-solid fa-layer-group mr-2"></i>
                                    Agregar / Editar Masivo
                                </button>
                                <div className="h-6 w-[1px] bg-slate-300 mx-2"></div>
                                <button
                                    onClick={handleDeleteClient}
                                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded text-sm border border-red-200 transition-colors ml-auto"
                                >
                                    <i className="fa-solid fa-trash mr-2"></i>
                                    Eliminar Cliente
                                </button>
                            </div>
                        </div>

                        {/* RULES LIST */}
                        <div className="flex-1 overflow-y-auto bg-slate-50 p-4 custom-scrollbar">
                            {loadingRules ? (
                                <div className="flex items-center justify-center h-full text-slate-400">
                                    <i className="fa-solid fa-circle-notch fa-spin mr-2"></i> Cargando reglas...
                                </div>
                            ) : clientData.rules.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
                                    <i className="fa-solid fa-tags text-4xl mb-4 text-slate-300"></i>
                                    <p>No hay reglas de descuento definidas.</p>
                                    <p className="text-sm">Usa "Agregar Masivo" para comenzar.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2 max-w-5xl mx-auto">
                                    {clientData.rules.map((rule, idx) => (
                                        <div key={rule._id || idx} className="bg-white border border-slate-200 rounded p-3 flex items-center gap-4 hover:shadow-sm transition-shadow">
                                            {/* Producto */}
                                            <div className="w-1/3 min-w-[200px]">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded text-slate-600">
                                                        {rule.CodArticulo === 'TOTAL' ? 'GLOBAL' : 'PROD'}
                                                    </span>
                                                    <span className="font-bold text-slate-800 truncate" title={rule.CodArticulo}>
                                                        {rule.CodArticulo}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Regla */}
                                            <div className="flex-1 flex items-center gap-4">
                                                <select
                                                    className="border border-slate-300 rounded text-sm p-1 bg-white focus:border-indigo-500 outline-none"
                                                    value={rule.TipoRegla}
                                                    onChange={(e) => updateRule(rule._id, 'TipoRegla', e.target.value)}
                                                >
                                                    <option value="percentage">Porcentaje (%)</option>
                                                    <option value="fixed">Precio Fijo ($)</option>
                                                    <option value="subtract">Restar ($)</option>
                                                </select>

                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="border border-slate-300 rounded p-1 w-24 text-right font-mono"
                                                        value={rule.Valor}
                                                        onChange={(e) => updateRule(rule._id, 'Valor', parseFloat(e.target.value))}
                                                    />
                                                    <span className="text-slate-500 text-sm font-medium">
                                                        {rule.TipoRegla === 'percentage' ? '%' : 'UYU'}
                                                    </span>
                                                </div>

                                                {/* Visualización de efecto (Opcional, requeriria saber precio base) */}
                                            </div>

                                            {/* Acciones */}
                                            <button
                                                onClick={() => removeRule(rule._id)}
                                                className="text-slate-400 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-colors"
                                                title="Eliminar regla"
                                            >
                                                <i className="fa-solid fa-xmark"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                        <i className="fa-solid fa-arrow-left text-4xl mb-4 text-slate-300"></i>
                        <p className="font-medium text-lg text-slate-500">Selecciona un cliente</p>
                        <p className="text-sm">o crea uno nuevo para configurar sus precios.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SpecialPrices;
