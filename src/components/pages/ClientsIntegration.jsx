import React, { useState, useEffect } from 'react';
import './ClientsIntegration.css';
import { toast } from 'sonner';
import api from '../../services/apiClient';
import axios from 'axios';

const ClientsIntegration = () => {
    const [clients, setClients] = useState([]);
    // filteredClients removed - we now fetch exactly what we need
    const [loading, setLoading] = useState(true);

    // Selection & External Data
    const [selectedClient, setSelectedClient] = useState(null);
    const [externalData, setExternalData] = useState(null);
    const [loadingExt, setLoadingExt] = useState(false);

    // Edit State for Selected Client
    const [linkCode, setLinkCode] = useState('');
    const [linkId, setLinkId] = useState('');

    const [searchTerm, setSearchTerm] = useState('');
    const [reactSearchTerm, setReactSearchTerm] = useState('');
    const [reactClientsList, setReactClientsList] = useState([]);

    // Filtros: 'all', 'linked', 'unlinked'
    const [filterMode, setFilterMode] = useState('all');
    const [selectedReactData, setSelectedReactData] = useState(null);


    // Debounced Search Effect
    useEffect(() => {
        const timer = setTimeout(() => {
            loadClients(searchTerm);
        }, 400); // Wait 400ms after user stops typing
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Initial Load of React Clients
    useEffect(() => {
        loadReactClients();
        loadClients(); // Cargar locales al inicio también
    }, []);

    const loadReactClients = async () => {
        try {
            const res = await api.get('/clients/react-list');
            console.log("React RAW Response:", JSON.stringify(res.data).substring(0, 200)); // Ver texto real

            let list = [];

            // 1. Directo es Array
            if (Array.isArray(res.data)) {
                list = res.data;
            }
            // 2. Buscar PROPIEDAD Array dentro del objeto (data, recordset, result, clients...)
            else if (typeof res.data === 'object' && res.data !== null) {
                const values = Object.values(res.data);
                const foundArray = values.find(val => Array.isArray(val) && val.length > 0); // Buscar primer array con contenido

                if (foundArray) {
                    list = foundArray;
                    console.log("Array encontrado automáticamente con", list.length, "elementos.");
                } else {
                    // Intento fallback: arrays vacíos
                    const emptyArray = values.find(val => Array.isArray(val));
                    if (emptyArray) list = emptyArray;
                }
            }

            if (list.length > 0) {
                setReactClientsList(list);
            } else {
                console.warn("NO se encontró ninguna lista en la respuesta:", res.data);
                toast.warning("La API conectó pero no devolvió una lista reconocible.");
            }
        } catch (error) {
            console.error("Error cargando lista clientes React", error);
        }
    };

    const loadClients = async (query = '') => {
        try {
            setLoading(true);
            // Pass query to backend
            const res = await api.get('/clients', { params: { q: query } });
            setClients(res.data || []);
        } catch (error) {
            console.error(error);
            toast.error("Error cargando clientes");
        } finally {
            setLoading(false);
        }
    };

    const handleUnifiedSearch = async () => {
        if (!searchTerm) return;
        setLoadingExt(true);

        try {
            // Unificamos la búsqueda: Local -> y si no -> Legacy (6061)
            const res = await api.get(`/clients/unified-search`, { params: { term: searchTerm } });

            if (res.data.found) {
                const { source, client } = res.data;

                if (source === 'local') {
                    // Encontrado en DB Local
                    // Verificar si ya está en nuestra lista en memoria
                    const existing = clients.find(c => c.CodCliente === client.CodCliente);
                    const finalClient = existing || client;

                    setSelectedClient(finalClient);
                    if (!existing) setClients(prev => [client, ...prev]);

                    toast.success(`Encontrado en Base Local: ${finalClient.Nombre}`);
                }
                else if (source === 'legacy') {
                    // Encontrado en Legacy API (6061)
                    const legacyData = client;
                    const tempClient = {
                        // Preservar ID original Legacy
                        CodCliente: legacyData.CodCliente || legacyData.CodigoCliente || legacyData.IdCliente || legacyData.CliId || 'NUEVO',

                        Nombre: legacyData.NombreCliente || legacyData.CliNombreApellido || legacyData.CliNombre || legacyData.RazonSocial || legacyData.Nombre || legacyData.Descripcion || searchTerm,
                        NombreFantasia: legacyData.EmpresaCliente || legacyData.CliNombreEmpresa || legacyData.NombreFantasia || legacyData.RazonSocial,
                        CioRuc: legacyData.CioRuc || legacyData.DocumentoCliente || legacyData.CliDocumento || legacyData.Rut || legacyData.Ruc || legacyData.Cedula,
                        TelefonoTrabajo: legacyData.TelefonoTrabajo || legacyData.Celular || legacyData.CliCelular || legacyData.Telefono || legacyData.TelefonoParticular,
                        Email: legacyData.MailCliente || legacyData.CliMail || legacyData.Email,
                        Direccion: legacyData.DireccionTrabajo || legacyData.DireccionParticular || legacyData.DireccionCliente || legacyData.CliDireccion || legacyData.Direccion,

                        isLegacyProvisional: true,
                        rawLegacy: legacyData
                    };

                    setSelectedClient(tempClient);
                    setExternalData(legacyData);
                    toast.success("Encontrado en API Legacy (Listo para Importar)");
                }
            } else {
                toast.error("No se encontró el cliente en Local ni en Legacy (6061)");
            }
        } catch (error) {
            console.error(error);
            const msg = error.response?.data?.details || error.response?.data?.error || error.message;
            toast.error(`Error de búsqueda: ${msg}`);
        } finally {
            setLoadingExt(false);
        }
    };

    const handleSelectClient = async (client) => {
        setSelectedClient(client);

        const cleanName = client.Nombre ? client.Nombre.trim() : '';
        setReactSearchTerm(cleanName);

        // Lógica de Autosugerencia:
        // Si el cliente NO tiene vínculo (CodigoReact vacío), buscamos coincidencia exacta por nombre
        let suggestedCode = client.CodigoReact || '';
        let suggestedId = client.IDReact || '';

        if (!suggestedCode && reactClientsList.length > 0 && cleanName) {
            // Buscamos alguien en la lista externa con el mismo nombre
            const exactMatch = reactClientsList.find(rc =>
                rc.NombreCliente && rc.NombreCliente.trim().toLowerCase() === cleanName.toLowerCase()
            );

            if (exactMatch) {
                suggestedCode = exactMatch.CodigoCliente;
                suggestedId = exactMatch.IdCliente;
                toast.success(`Coincidencia automática: ${exactMatch.NombreCliente}`);
            }
        }

        setLinkCode(suggestedCode);
        setLinkId(suggestedId);

        setExternalData(null);
        setLoadingExt(true);

        try {
            // Fetch from External Macrosoft API via Local Proxy (Bypasses CORS)
            const res = await api.get(`/clients/external/${client.CodCliente}`);
            setExternalData(res.data);
        } catch (error) {
            console.error("Error API Externa:", error);
            // Si falla, no mostramos error bloqueante, solo feedback visual
        } finally {
            setLoadingExt(false);
        }
    };

    const handleSaveLink = async () => {
        if (!selectedClient) return;

        const payload = {
            codigoReact: linkCode,
            idReact: linkId
        };

        try {
            await api.put(`/clients/${selectedClient.CodCliente}/link`, payload);
            toast.success(`Cliente vinculado correctamente`);

            // Update local state
            setClients(prev => prev.map(c =>
                c.CodCliente === selectedClient.CodCliente ? { ...c, CodigoReact: linkCode, IDReact: linkId } : c
            ));

            // Update selected client reference to reflect changes immediately
            setSelectedClient(prev => ({ ...prev, CodigoReact: linkCode, IDReact: linkId }));

        } catch (error) {
            console.error(error);
            toast.error("Error al guardar vinculación");
        }
    };

    const handleImportFromReact = async (reactClient) => {
        if (!confirm(`¿Crear cliente local basado en "${reactClient.NombreCliente || reactClient.Nombre}"?`)) return;

        try {
            setLoading(true);
            const res = await api.post('/clients/import-react', reactClient);
            toast.success("Cliente creado localmente: " + res.data.client.Nombre);
            loadClients(res.data.client.Nombre); // Recargar y buscar
            setFilterMode('all');
        } catch (error) {
            console.error(error);
            toast.error("Error al importar cliente");
        } finally {
            setLoading(false);
        }
    };

    const importLegacyClient = async (tempClient) => {
        const detectedID = (tempClient.CodCliente && tempClient.CodCliente !== 'NUEVO') ? tempClient.CodCliente : "AUTO (Generar Nuevo)";

        if (!confirm(`CONFIRMAR IMPORTACIÓN:\n\nNombre detectado: ${tempClient.Nombre}\nID a usar: ${detectedID}\nRUC: ${tempClient.CioRuc || 'Vacío'}\n\n¿Los datos son correctos?`)) return;

        setLoading(true);
        try {
            const legacy = tempClient.rawLegacy || {};

            // Intentar detectar IDs de React para autovincular
            // (Si viene de 'Hub Legacy > React', rawLegacy es el objeto de la API externa)
            const codReact = legacy.CodigoCliente || legacy.CliCodigoCliente || null;
            const idReact = legacy.IdCliente || legacy.CliIdCliente || null;

            const payload = {
                nombre: tempClient.Nombre,
                telefono: tempClient.TelefonoTrabajo,
                email: tempClient.Email,
                direccion: tempClient.Direccion,
                ruc: tempClient.CioRuc,
                nombreFantasia: tempClient.NombreFantasia,
                codReact: codReact,
                idReact: idReact,
                codCliente: (tempClient.CodCliente && tempClient.CodCliente !== 'NUEVO') ? tempClient.CodCliente : null
            };

            console.log("Importing Client Payload:", payload); // Debug
            const res = await api.post('/clients', payload);
            toast.success("Cliente importado localmente - " + tempClient.Nombre);
            loadClients(tempClient.Nombre); // Recargar y buscar
        } catch (error) {
            console.error(error);
            toast.error("Error al importar: " + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleCreateInReact = async () => {
        if (!selectedClient) return;
        if (!confirm(`¿Crear cliente "${selectedClient.Nombre}" en el sistema externo React?`)) return;

        try {
            setLoading(true);
            const res = await api.post('/clients/export-react', selectedClient);

            if (res.data.success) {
                toast.success(res.data.message);
                loadReactClients(); // Recargar lista externa para ver el nuevo
            }
        } catch (error) {
            console.error(error);
            const errMsg = error.response?.data?.error || "Error al exportar cliente";
            toast.error(errMsg);
        } finally {
            setLoading(false);
        }
    };

    // Vista de Clientes Externos (Derecha)
    const reactView = reactClientsList.filter(c => {
        if (!reactSearchTerm) return true;
        const term = reactSearchTerm.toLowerCase();
        return (
            (c.NombreCliente && c.NombreCliente.toLowerCase().includes(term)) ||
            (c.EmpresaCliente && c.EmpresaCliente.toLowerCase().includes(term)) ||
            (c.CodigoCliente && String(c.CodigoCliente).toLowerCase().includes(term))
        );
    }).slice(0, 50); // Muestro hasta 50 para que sea útil

    // Filtrado de clientes locales
    const filteredClients = clients.filter(c => {
        if (filterMode === 'linked') return c.CodigoReact; // Tiene código
        if (filterMode === 'unlinked') return !c.CodigoReact; // No tiene código
        return true; // 'all'
    });

    return (
        <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
            {/* LEFT: Client List (Legacy 6061) */}
            <div className="ci-panel left">
                <div className="ci-header flex-col items-start gap-2">
                    <div className="flex justify-between w-full items-center">
                        <h2><i className="fa-solid fa-users text-blue-500 mr-2"></i> Clientes Locales</h2>
                        <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded-full">{filteredClients.length}</span>
                    </div>

                    {/* Buscador Local */}
                    <div className="w-full relative">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                        <input
                            type="text"
                            placeholder="Buscar cliente local..."
                            className="ci-input pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {searchTerm && (
                        <button
                            onClick={handleUnifiedSearch}
                            className="w-full mt-2 bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs py-1.5 rounded-md transition-colors flex items-center justify-center gap-2 border border-slate-300 border-dashed"
                            title="Buscar en base Local, y si no existe, buscar en API Legacy (6061)"
                        >
                            <i className="fa-solid fa-search"></i> Buscar "{searchTerm}"
                        </button>
                    )}

                    {/* Tabs de Filtro */}
                    <div className="flex w-full bg-slate-100 p-1 rounded-lg mt-1 gap-1">
                        <button
                            onClick={() => setFilterMode('all')}
                            className={`flex-1 text-[10px] uppercase font-bold py-1 rounded ${filterMode === 'all' ? 'bg-white shadow text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Todos
                        </button>
                        <button
                            onClick={() => setFilterMode('linked')}
                            className={`flex-1 text-[10px] uppercase font-bold py-1 rounded ${filterMode === 'linked' ? 'bg-white shadow text-green-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Vinc.
                        </button>
                        <button
                            onClick={() => setFilterMode('unlinked')}
                            className={`flex-1 text-[10px] uppercase font-bold py-1 rounded ${filterMode === 'unlinked' ? 'bg-white shadow text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Pend.
                        </button>
                    </div>
                </div>

                <div className="ci-list custom-scrollbar">
                    {loading ? (
                        <div className="p-4 text-center text-slate-400 text-sm"><i className="fa-solid fa-spinner fa-spin mr-2"></i> Cargando...</div>
                    ) : filteredClients.map(c => (
                        <div
                            key={c.CodCliente}
                            onClick={() => handleSelectClient(c)}
                            className={`ci-card border-l-4 ${selectedClient?.CodCliente === c.CodCliente ? 'border-l-purple-500 bg-purple-50 ring-1 ring-purple-200' : (c.CodigoReact ? 'border-l-green-500' : 'border-l-amber-500')} hover:bg-gray-50`}
                        >
                            <h3 className="text-sm font-bold truncate leading-tight text-slate-800" title={c.Nombre}>{c.Nombre}</h3>
                            {c.NombreFantasia && <p className="text-xs text-slate-500 truncate">{c.NombreFantasia}</p>}

                            <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100">
                                <div className="flex gap-2">
                                    <span className="text-[10px] font-mono bg-white border border-slate-200 px-1 rounded text-slate-500">ID: {c.CodCliente}</span>
                                    {c.CioRuc && <span className="text-[10px] font-mono bg-slate-100 px-1 rounded text-slate-500 truncate max-w-[80px]">{c.CioRuc}</span>}
                                </div>
                                {c.CodigoReact ? <i className="fa-solid fa-link text-green-500 text-xs" title="Vinculado"></i> : null}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* CENTER: Work Area */}
            <div className="ci-panel center bg-slate-50/50">
                {/* Search Bar */}
                <div className="mb-6 bg-white p-4 rounded-xl shadow-sm border border-slate-100 sticky top-0 z-10">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="🔍 Buscar cliente por nombre o código..."
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all font-medium text-slate-700"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <i className="fa-solid fa-search absolute left-3.5 top-4 text-slate-400"></i>
                    </div>
                </div>

                {/* Detail Card */}
                {selectedClient ? (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shadow-sm shadow-blue-100">
                                    <i className="fa-solid fa-user-tie text-xl"></i>
                                </div>
                                <div className="flex-1">
                                    <h2 className="text-xl font-bold text-slate-800 leading-tight">{selectedClient.Nombre}</h2>
                                    <div className="flex gap-2 mt-1 items-center">
                                        <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">ID: {selectedClient.CodCliente}</span>
                                        {selectedClient.CodReferencia && <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">Ref: {selectedClient.CodReferencia}</span>}

                                        {!selectedClient.CodigoReact && !selectedClient.isLegacyProvisional && (
                                            <button
                                                onClick={handleCreateInReact}
                                                className="ml-auto text-xs bg-indigo-600 text-white px-3 py-1 rounded-md shadow hover:bg-indigo-700 transition flex items-center gap-1 animate-pulse"
                                                title="Crear este cliente en el sistema React externo"
                                            >
                                                <i className="fa-solid fa-cloud-arrow-up"></i> Exportar a React
                                            </button>
                                        )}

                                        {selectedClient.isLegacyProvisional && (
                                            <button
                                                onClick={() => importLegacyClient(selectedClient)}
                                                className="ml-auto text-xs bg-emerald-600 text-white px-3 py-1 rounded-md shadow hover:bg-emerald-700 transition flex items-center gap-1 animate-bounce"
                                                title="Guardar este cliente legacy en base de datos local"
                                            >
                                                <i className="fa-solid fa-file-import"></i> Importar a Local
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Content Body */}
                        <div className="p-6 overflow-y-auto max-h-[calc(100vh-300px)] custom-scrollbar">

                            {/* 1. Linking Search & Form (Priority) */}
                            <div className="p-6 bg-purple-50/50 mb-8 rounded-xl border border-purple-100 shadow-sm relative overflow-visible">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xs font-black text-purple-600 uppercase tracking-widest flex items-center gap-2">
                                        <i className="fa-solid fa-link"></i> Vincular con Sistema React
                                    </h3>
                                    <span className="text-[10px] bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full font-bold shadow-sm">
                                        {reactClientsList.length > 0 ? `${reactClientsList.length} Clientes Ext.` : 'Cargando...'}
                                    </span>
                                </div>

                                {/* Quick Search React System */}
                                <div className="mb-4 relative z-50">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Buscar en Sistema React</label>
                                    <input
                                        type="text"
                                        className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none bg-white shadow-sm"
                                        placeholder="Escriba Nombre, Empresa o Código..."
                                        value={reactSearchTerm}
                                        onChange={e => setReactSearchTerm(e.target.value)}
                                        autoComplete="off"
                                    />
                                    {reactSearchTerm.length > 1 && (
                                        <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-lg shadow-xl mt-1 max-h-60 overflow-auto z-50">
                                            {(() => {
                                                const matches = reactClientsList.filter(rc => {
                                                    const term = reactSearchTerm.toLowerCase();
                                                    return (
                                                        (rc.NombreCliente && rc.NombreCliente.toLowerCase().includes(term)) ||
                                                        (rc.EmpresaCliente && rc.EmpresaCliente.toLowerCase().includes(term)) ||
                                                        (rc.CodigoCliente && String(rc.CodigoCliente).toLowerCase().includes(term))
                                                    );
                                                }).slice(0, 10);

                                                if (matches.length > 0) {
                                                    return matches.map(rc => (
                                                        <div
                                                            key={rc.IdCliente}
                                                            onClick={() => {
                                                                setLinkCode(rc.CodigoCliente);
                                                                setLinkId(rc.IdCliente);
                                                                setSelectedReactData(rc); // Guardamos para visualizar JSON
                                                                setReactSearchTerm('');
                                                                toast.success(`Seleccionado: ${rc.NombreCliente}`);
                                                            }}
                                                            className="p-3 hover:bg-purple-50 cursor-pointer border-b border-slate-100 last:border-0 group transition-colors"
                                                        >
                                                            <div className="flex justify-between items-center">
                                                                <p className="text-sm font-bold text-slate-700 group-hover:text-purple-700">{rc.NombreCliente}</p>
                                                                <span className="text-[10px] bg-slate-100 group-hover:bg-purple-100 text-slate-500 group-hover:text-purple-600 px-1.5 py-0.5 rounded font-mono border border-slate-200 group-hover:border-purple-200">{rc.CodigoCliente}</span>
                                                            </div>
                                                            {rc.EmpresaCliente && <p className="text-xs text-slate-500 mt-1"><i className="fa-regular fa-building mr-1 opacity-50"></i>{rc.EmpresaCliente}</p>}
                                                        </div>
                                                    ));
                                                } else {
                                                    return (
                                                        <div
                                                            onClick={handleCreateInReact}
                                                            className="p-3 text-center cursor-pointer hover:bg-green-50 text-green-700 font-medium transition-colors"
                                                        >
                                                            <i className="fa-solid fa-plus-circle mr-2"></i>
                                                            Crear "{reactSearchTerm}" en React
                                                        </div>
                                                    );
                                                }
                                            })()}
                                        </div>
                                    )}

                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código React</label>
                                        <input
                                            type="text"
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none text-slate-700 font-mono bg-white"
                                            value={linkCode}
                                            onChange={e => setLinkCode(e.target.value)}
                                            placeholder="Auto o Manual"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ID Numérico</label>
                                        <input
                                            type="number"
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none text-slate-700 font-mono bg-white"
                                            value={linkId}
                                            onChange={e => setLinkId(e.target.value)}
                                            placeholder="Auto o Manual"
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end pt-2 border-t border-purple-100/50">
                                    <button
                                        onClick={handleSaveLink}
                                        disabled={!linkCode || !linkId}
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg shadow-purple-200/50 disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2 transform active:scale-95"
                                    >
                                        <i className="fa-solid fa-link"></i>
                                        Guardar Vinculación
                                    </button>
                                </div>
                            </div>

                            {/* 2. External Data View (Secondary Info) */}
                            {/* 2. Data Comparison View */}
                            <div className="mt-8 pt-6 border-t border-slate-100">
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

                                    {/* A. Legacy Data */}
                                    {/* A. Legacy/External Data */}
                                    <div>
                                        <h3 className={`text-xs font-bold uppercase mb-4 flex items-center gap-2 ${externalData?.IdCliente ? 'text-blue-500' : 'text-slate-400'}`}>
                                            <i className={externalData?.IdCliente ? "fa-brands fa-react" : "fa-solid fa-server"}></i>
                                            {externalData?.IdCliente ? " Datos API Externa (React)" : " Datos Legacy (API 6061)"}
                                        </h3>

                                        {loadingExt ? (
                                            <div className="h-24 bg-slate-50 rounded animate-pulse flex items-center justify-center text-slate-300 text-xs">Cargando...</div>
                                        ) : externalData ? (
                                            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-inner group relative">
                                                <div className="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">JSON Local</span>
                                                    <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded font-mono border border-green-500/20">200 OK</span>
                                                </div>
                                                <div className="overflow-auto max-h-60 custom-scrollbar">
                                                    <pre className="text-[10px] font-mono text-green-400 whitespace-pre-wrap break-all leading-relaxed">
                                                        {JSON.stringify(externalData, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 text-amber-700 text-xs text-center">
                                                Sin datos en API 6061
                                            </div>
                                        )}
                                    </div>

                                    {/* B. React Data (Selected) */}
                                    {selectedReactData && (
                                        <div className="animate-fade-in-up">
                                            <h3 className="text-xs font-bold text-purple-400 uppercase mb-4 flex items-center gap-2">
                                                <i className="fa-brands fa-react"></i> Selección React
                                            </h3>
                                            <div className="bg-slate-900 rounded-xl p-4 border border-purple-500/20 shadow-inner group relative">
                                                <div className="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">JSON Remoto</span>
                                                    <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded font-mono border border-purple-500/20">Candidato</span>
                                                </div>
                                                <div className="overflow-auto max-h-60 custom-scrollbar">
                                                    <pre className="text-[10px] font-mono text-purple-300 whitespace-pre-wrap break-all leading-relaxed">
                                                        {JSON.stringify(selectedReactData, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 min-h-[400px]">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                            <i className="fa-solid fa-arrow-left text-2xl text-slate-400 animate-pulse"></i>
                        </div>
                        <p className="font-medium text-slate-400">Seleccione un cliente de la izquierda</p>
                        <p className="text-xs text-slate-400 mt-2">para ver detalles y vincular</p>
                    </div>
                )}
            </div>

            {/* RIGHT: Linked List */}



            {/* RIGHT PANEL CODE Update */}
            <div className="ci-panel right">
                <div className="ci-header">
                    <h2><i className="fa-brands fa-react text-teal-500 mr-2"></i> Vinculados / Externos</h2>
                    <span className="text-xs text-slate-400 ml-auto">{reactView.length}</span>
                </div>
                <div className="ci-list custom-scrollbar">
                    {reactView.map(c => (
                        <div key={c.IdCliente || Math.random()} className="ci-card border-l-4 border-l-teal-500 hover:bg-teal-50/30 transition-colors group relative">
                            <div className="flex justify-between items-start mb-1">
                                <h3 className="text-sm font-bold truncate text-slate-700">{c.NombreCliente || c.Nombre}</h3> {/* Ajuste nombre campo */}
                                {c.CodCliente && <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 rounded ml-2 whitespace-nowrap">ID: {c.CodCliente}</span>}
                            </div>

                            <div className="flex gap-2">
                                <span className="bg-teal-50 text-teal-700 text-[10px] font-mono px-1.5 py-0.5 rounded border border-teal-100">{c.CodigoCliente || c.CodigoReact}</span>
                                <span className="bg-teal-50 text-teal-700 text-[10px] font-mono px-1.5 py-0.5 rounded border border-teal-100">#{c.IdCliente || c.IDReact}</span>
                            </div>

                            {/* Botón Flotante para Importar (Solo visible on hover y si no está vinculado visualmente aquí) */}
                            {!c.CodCliente && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleImportFromReact(c); }}
                                    className="absolute right-2 top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 text-white text-xs px-2 py-1 rounded shadow hover:bg-blue-700 z-10"
                                    title="Crear este cliente en sistema Local"
                                >
                                    <i className="fa-solid fa-file-import mr-1"></i> Importar
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ClientsIntegration;
