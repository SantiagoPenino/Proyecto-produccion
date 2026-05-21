import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// --- MODAL AUXILIAR: Agregar Cliente ---
const AddClientModal = ({ isOpen, onClose, onSave }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedClient, setSelectedClient] = useState(null);

    useEffect(() => {
        if (!searchTerm || searchTerm.length < 2) {
            setResults([]);
            return;
        }
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
                    setResults([]);
                })
                .finally(() => setLoading(false));
        }, 500);

        return () => clearTimeout(timer);
    }, [searchTerm, selectedClient]);

    const handleSelect = (client) => {
        setSelectedClient(client);
        setSearchTerm(client.Nombre || client.NombreFantasia || `Cliente ${client.CodCliente}`);
        setResults([]);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-center justify-center p-4">
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
                    {results.length > 0 && !selectedClient && (
                        <div className="absolute z-50 w-full bg-white border border-slate-200 rounded-b shadow-lg max-h-48 overflow-y-auto mt-1">
                            {results.map(c => (
                                <div
                                    key={c.CodCliente || c.CliIdCliente}
                                    onClick={() => handleSelect(c)}
                                    className="p-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                                >
                                    <div className="font-bold text-sm text-slate-700 w-full truncate">{c.Nombre || c.NombreFantasia}</div>
                                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">ID: {c.CodCliente} {c.CioRuc ? ` | RUC: ${c.CioRuc}` : ''}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {selectedClient && (
                    <div className="mb-4 p-3 bg-indigo-50 border border-indigo-100 rounded text-sm text-indigo-800 animate-in fade-in zoom-in">
                        <p className="text-[10px] text-indigo-500 font-black tracking-wide uppercase mb-0.5">Seleccionado</p>
                        <p className="font-bold text-lg leading-tight">{selectedClient.Nombre || selectedClient.NombreFantasia}</p>
                        <p className="text-xs font-mono opacity-75 mt-1">ID Local: {selectedClient.CodCliente}</p>
                    </div>
                )}
                <div className="flex justify-end gap-2 mt-auto pt-4 border-t border-slate-100">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded font-medium">Cancelar</button>
                    <button
                        onClick={() => {
                            if (selectedClient) {
                                onSave(selectedClient.CodCliente, selectedClient.Nombre || selectedClient.NombreFantasia);
                            } else if (searchTerm && !isNaN(searchTerm)) {
                                onSave(searchTerm, `Cliente ${searchTerm}`);
                            } else {
                                toast.error("Selecciona un cliente de la lista");
                            }
                        }}
                        className={`px-6 py-2 rounded text-white font-bold transition-all shadow-sm ${selectedClient || (searchTerm && !isNaN(searchTerm)) ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'}`}
                    >
                        Comenzar
                    </button>
                </div>
            </div>
        </div>
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
    const [showAddClient, setShowAddClient] = useState(false);
    const [isDirtyMap, setIsDirtyMap] = useState(false); // Para el tooltip de "Tienes cambios sin guardar"

    const [expandedGroups, setExpandedGroups] = useState(new Set()); // Para el modo arbolito
    const [hiddenGroups, setHiddenGroups] = useState(new Set()); // Para familias con 'ojito' tachado
    const [pendingNewClient, setPendingNewClient] = useState(null);

    useEffect(() => {
        loadClients();
        loadProducts();
    }, []);

    useEffect(() => {
        if (selClientId) {
            loadRules(selClientId);
        } else {
            setClientData({ client: null });
            setRowStateMap({});
            setSelectedRows(new Set());
            setIsDirtyMap(false);
            setExpandedGroups(new Set());
            setHiddenGroups(new Set());
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
            rules: payloadRules
        })
        .then(() => {
            toast.success("Perfil de precios guardado exitosamente");
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
        setShowAddClient(false);
        setSelClientId(id);
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
    const filteredClients = clients.filter(c =>
        String(c.ClienteID).includes(filterClient) ||
        (c.NombreCliente || "").toLowerCase().includes(filterClient.toLowerCase())
    );

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

    // Extraer Categorías Únicas para Selector (ignorar GLOBAL)
    const categoriasDropdown = ["TODAS", "ACTIVAS", ...new Set(baseProducts.filter(p => p.Grupo !== 'GLOBAL').map(p => p.Grupo).filter(Boolean))];

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden text-sm">
            <AddClientModal isOpen={showAddClient} onClose={() => setShowAddClient(false)} onSave={handleCreateClient} />

            {/* SIDEBAR CLIENTES */}
            <div className="w-72 bg-white border-r border-slate-200 flex flex-col flex-shrink-0 z-10 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <span className="font-bold text-slate-700 flex items-center gap-2">
                        <i className="fa-solid fa-user-tag text-indigo-500"></i> Clientes
                    </span>
                    <button onClick={() => setShowAddClient(true)} className="text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded font-bold border border-indigo-200 transition-colors">+ Añadir</button>
                </div>
                <div className="p-3 border-b border-slate-100 bg-white">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <i className="fa-solid fa-filter absolute left-3 top-2.5 text-slate-400"></i>
                            <input
                                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 transition-all text-xs"
                                placeholder="Filtrar lista..."
                                value={filterClient}
                                onChange={e => setFilterClient(e.target.value)}
                            />
                        </div>
                        <button 
                            onClick={() => setShowAddClient(true)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded font-bold shadow-sm flex items-center gap-2 text-xs transition-colors shrink-0"
                            title="Buscar cliente en la base de datos completa"
                        >
                            <i className="fa-solid fa-search"></i> Buscar
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                    {loading ? (
                        <div className="p-4 text-slate-400 text-center"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Cargando...</div>
                    ) : filteredClients.length === 0 ? (
                        <div className="p-4 flex flex-col items-center justify-center text-center mt-4">
                            <span className="text-slate-400 mb-3 text-sm">No está en esta lista.</span>
                            <button 
                                onClick={() => setShowAddClient(true)} 
                                className="w-full bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white border border-indigo-200 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center justify-center gap-2"
                            >
                                <i className="fa-solid fa-database"></i> Buscar en Base de Datos
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
                                    className={`rounded-xl p-3 cursor-pointer transition-all border ${isSelected ? 'bg-indigo-50 border-indigo-400 shadow-sm' : 'bg-white border-transparent hover:border-slate-200'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white font-bold text-sm shadow-sm" style={{ backgroundColor: avatarColor }}>
                                            {initials}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-slate-800 truncate" title={displayName}>{displayName}</div>
                                            <div className="flex gap-2 mt-1 text-[10px] font-mono">
                                                <span className="text-slate-400" title="Código numérico y IDCliente">ID: {c.ClienteID} {c.IDCliente && c.IDCliente !== String(c.ClienteID) ? `- ${c.IDCliente}` : ''}</span>
                                                {c.CantReglas > 0 && <span className="text-emerald-600 font-bold bg-emerald-50 px-1 rounded">{c.CantReglas} reglas</span>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* MAIN CONTENT V2 (CRISTAL DASHBOARD) */}
            <div className="flex-1 flex flex-col bg-[#F8FAFC]">
                {selClientId ? (
                    <>
                        {/* HEADER DASHBOARD */}
                        <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col gap-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] z-10">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                                        {clientData.client?.Nombre || clientData.client?.NombreCliente || `Cliente ID: ${selClientId}`}
                                    </h2>
                                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                        <span className="text-slate-500 font-medium text-sm">Mostrando todas las familias y productos.</span>
                                        <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-2.5 py-0.5 rounded font-bold text-xs uppercase tracking-wide">
                                            {activeRulesCount} EXCEPCIONES CARGADAS
                                        </span>
                                        
                                        {clientData.profiles && clientData.profiles.length > 0 && (
                                            <span className="bg-amber-50 border border-amber-300 text-amber-700 px-2 py-0.5 rounded shadow-sm font-semibold text-[11px] uppercase flex items-center gap-1.5">
                                                <i className="fa-solid fa-triangle-exclamation"></i>
                                                Tiene Perfiles Asignados: {clientData.profiles.map(p => p.NombrePerfil).join(', ')}
                                            </span>
                                        )}

                                        {isDirtyMap && (
                                            <span className="text-amber-600 font-bold text-xs animate-pulse flex items-center gap-1">
                                                <i className="fa-solid fa-circle text-[8px]"></i> Cambios sin guardar
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={handleDeleteClient} className="px-4 py-2 text-slate-500 hover:bg-slate-100 hover:text-red-500 rounded font-semibold transition-colors">
                                        <i className="fa-solid fa-trash mr-2"></i> Resetear
                                    </button>
                                    <button onClick={handleSaveRules} className="bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white shadow-lg shadow-indigo-200 px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-transform active:scale-95">
                                        <i className="fa-solid fa-floppy-disk"></i> Guardar Tarifa
                                    </button>
                                </div>
                            </div>

                            {/* EXCEL-LIKE TOOLBAR */}
                            <div className="flex items-center justify-between bg-slate-50 p-2 border border-slate-200 rounded-lg">
                                <div className="flex gap-3 flex-1">
                                    <select 
                                        value={filterCategory} 
                                        onChange={(e)=>setFilterCategory(e.target.value)}
                                        className="bg-white border border-slate-300 rounded px-3 py-1.5 font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100 max-w-sm truncate"
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
                                        <i className="fa-solid fa-search absolute left-3 top-2.5 text-slate-400"></i>
                                        <input
                                            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded outline-none focus:border-indigo-400"
                                            placeholder="Buscar producto o código..."
                                            value={filterSearch}
                                            onChange={e => setFilterSearch(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {/* BULK ACCION MASIVA */}
                                <div className="flex items-center gap-3 pl-4 border-l border-slate-300">
                                    <span className="text-slate-600 font-medium">Masivo ({selectedRows.size}):</span>
                                    <div className="relative">
                                        <input 
                                            type="number"
                                            value={bulkDiscountPct}
                                            onChange={e => setBulkDiscountPct(e.target.value)}
                                            placeholder="10"
                                            className="w-20 pl-3 pr-6 py-1.5 bg-white border border-slate-300 rounded font-mono outline-none focus:border-emerald-500"
                                        />
                                        <span className="absolute right-2 top-2 text-slate-400 font-bold">%</span>
                                    </div>
                                    <button 
                                        onClick={applyBulkDiscount}
                                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded font-bold shadow-sm flex items-center gap-2"
                                    >
                                        <i className="fa-solid fa-bolt"></i> Aplicar
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* DATA GRID */}
                        <div className="flex-1 overflow-auto p-6 pt-2 custom-scrollbar relative">
                            {loadingRules ? (
                                <div className="flex justify-center mt-20"><i className="fa-solid fa-circle-notch fa-spin text-3xl text-indigo-400"></i></div>
                            ) : (
                                <table className="w-full text-left bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
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
                                                    <tr key={prod.CodArticulo} className={`border-t-2 border-slate-200 transition-all ${isHidden ? 'bg-slate-50 opacity-60 grayscale' : 'bg-slate-100'}`}>
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
                                                                     <span className="ml-4 bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
                                                                        REGLA ENTERA FAMILIA: {st.discStr}% OFF
                                                                    </span>
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
                                                <tr key={prod.CodArticulo} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : isActive ? 'bg-amber-50/10' : ''} ${!isGlobal ? 'pl-8' : ''}`}>
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
                                                                    {isActive && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shadow-sm">Activa</span>}
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
                            {visibleProducts.length === 0 && !loadingRules && (
                                <div className="text-center py-12 text-slate-400">
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
