import React, { useState } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function ImportadorManualView() {
    const [docsInput, setDocsInput] = useState('');
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [loadingImport, setLoadingImport] = useState(false);
    const [previewData, setPreviewData] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [error, setError] = useState('');
    
    // UI states
    const [isInputCollapsed, setIsInputCollapsed] = useState(false);
    const [selectedRows, setSelectedRows] = useState([]);

    // Modal State
    const [selectedRowContext, setSelectedRowContext] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Client card states
    const [clientSearch, setClientSearch] = useState('');
    const [foundClients, setFoundClients] = useState([]);
    const [selectedClient, setSelectedClient] = useState(null);

    // Effect for client search
    React.useEffect(() => {
        const fetchClients = async () => {
            if (!clientSearch || clientSearch.length < 2) {
                setFoundClients([]);
                return;
            }
            try {
                const res = await axios.get(`${API_BASE_URL}/api/clients?q=${encodeURIComponent(clientSearch)}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
                setFoundClients(res.data || []);
            } catch (err) {
                console.error("Error searching clients:", err);
            }
        };
        const timeout = setTimeout(fetchClients, 500);
        return () => clearTimeout(timeout);
    }, [clientSearch]);

    const getDocsArray = () => {
        return docsInput
            .split(/\n|,/)
            .map(d => d.trim())
            .filter(d => d.length > 0);
    };

    const handlePreview = async () => {
        setError('');
        setPreviewData(null);
        setImportResult(null);
        setSelectedRows([]);

        const docs = getDocsArray();
        if (docs.length === 0) {
            setError('Por favor, ingresa al menos un número de documento.');
            return;
        }

        setLoadingPreview(true);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(`${API_BASE_URL}/api/rest-sync/preview-on-demand`, {
                docNumbers: docs
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setPreviewData(res.data.preview);
            setIsInputCollapsed(true); // Ocultar input para dar espacio a la tabla
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ocurrió un error al procesar la vista previa.');
        } finally {
            setLoadingPreview(false);
        }
    };

    const handleImport = async () => {
        setError('');
        
            // Si no hay filas seleccionadas, no importamos nada.
        if (selectedRows.length === 0) {
            setError('Debes seleccionar al menos una orden marcando la pestaña izquierda para oficializar.');
            return;
        }

        const duplicadas = selectedRows.filter(idx => previewData[idx].yaExiste).map(idx => previewData[idx].orden);
        if (duplicadas.length > 0) {
            const msj = `Las siguientes órdenes ya existen en el sistema:\n\n${duplicadas.join(', ')}\n\nSi continuás, las órdenes anteriores serán ELIMINADAS y reemplazadas por estas. ¿Estás seguro/a?`;
            if (!window.confirm(msj)) {
                return;
            }
        }

        setLoadingImport(true);
        try {
            const token = localStorage.getItem('token');
            
            // Enviamos los numeros de doc y ADEMAS el payload de los seleccionados para obviar buscar de nuevo
            const docsToImport = [...new Set(selectedRows.map(idx => previewData[idx].orden))];
            const payloadsToImport = [...new Set(selectedRows.map(idx => {
                let r = Object.assign({}, previewData[idx]._raw);
                if (previewData[idx].yaExiste) r.OVERWRITE_EXISTING = true;
                return r;
            }))];

            const res = await axios.post(`${API_BASE_URL}/api/rest-sync/import-on-demand`, {
                docNumbers: docsToImport,
                payloads: payloadsToImport
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setImportResult(res.data);
            setPreviewData(null); 
            setIsInputCollapsed(false);
            setDocsInput('');
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ocurrió un error al oficializar la importación.');
        } finally {
            setLoadingImport(false);
            setSelectedRows([]);
        }
    };
    
    const openModal = (rowData) => {
        setSelectedRowContext(rowData);
        setIsModalOpen(true);
    };

    const toggleRowSelection = (idx) => {
        setSelectedRows(prev => 
            prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
        );
    };

    const isRowDisabled = (row, allData) => {
        if (!allData) return false;
        return allData.some(r => r.orden === row.orden && (r.clienteNoEncontrado || r.articuloNoEncontrado));
    };

    const toggleAllRows = () => {
        const validRows = previewData.map((r, idx) => ({r, idx})).filter(o => !isRowDisabled(o.r, previewData)).map(o => o.idx);
        if (selectedRows.length === validRows.length && validRows.length > 0) {
            setSelectedRows([]);
        } else {
            setSelectedRows(validRows);
        }
    };

    const removeRow = (idxToRemove) => {
        setPreviewData(prev => prev.filter((_, idx) => idx !== idxToRemove));
        setSelectedRows(prev => {
            return prev
                .filter(idx => idx !== idxToRemove)
                .map(idx => (idx > idxToRemove ? idx - 1 : idx)); // Shift down indexes
        });
    };

    return (
        <div className="p-6 bg-zinc-50 min-h-screen text-zinc-800">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Importación a Producción</h1>
                    <p className="text-sm text-zinc-500 mt-1">Cargue órdenes desde el ERP y visualice reglas aplicadas.</p>
                </div>
                
                {/* Client Search Widget / Tarjeta */}
                <div className="bg-white border text-left border-indigo-100 rounded-xl shadow-sm p-4 w-full lg:w-96 flex flex-col gap-2 relative">
                    <div className="flex items-center gap-2 mb-1">
                        <i className="fa-solid fa-address-card text-indigo-500"></i>
                        <span className="font-bold text-zinc-700 text-sm">Consultar Cliente (Nomenclador)</span>
                    </div>
                    <input 
                        className="w-full p-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm outline-none focus:border-indigo-400"
                        placeholder="Buscar por ID, Código o Nombre..."
                        value={clientSearch}
                        onChange={(e) => {
                            setClientSearch(e.target.value);
                            setSelectedClient(null);
                        }}
                    />
                    {foundClients.length > 0 && !selectedClient && (
                        <div className="absolute top-20 left-0 w-full bg-white border border-zinc-200 rounded-lg shadow-xl max-h-48 overflow-y-auto z-50">
                            {foundClients.map(c => (
                                <div 
                                    key={c.CliIdCliente} 
                                    className="p-3 hover:bg-indigo-50 cursor-pointer border-b last:border-0"
                                    onClick={() => setSelectedClient(c)}
                                >
                                    <div className="font-bold text-sm text-zinc-800">{c.Nombre || c.NombreFantasia}</div>
                                    <div className="text-xs text-zinc-500">CliIdCliente: <span className="font-mono bg-zinc-100 px-1 rounded">{c.CliIdCliente}</span> | CodERP: {c.CodCliente}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {selectedClient && (
                        <div className="mt-2 bg-indigo-50 rounded-lg p-3 border border-indigo-100 relative">
                            <button className="absolute top-2 right-2 text-indigo-400 hover:text-indigo-600" onClick={() => setSelectedClient(null)}>
                                <i className="fa-solid fa-times"></i>
                            </button>
                            <div className="font-black text-indigo-800 text-sm mb-1 pr-6 truncate" title={selectedClient.NombreFantasia || selectedClient.Nombre}>
                                {selectedClient.NombreFantasia || selectedClient.Nombre}
                            </div>
                            <div className="text-xs text-zinc-600 space-y-1">
                                <div><span className="font-bold">CliIdCliente:</span> <span className="font-mono bg-white px-1 rounded">{selectedClient.CliIdCliente}</span></div>
                                <div><span className="font-bold">CodERP:</span> {selectedClient.CodCliente || 'N/A'}</div>
                                {selectedClient.IDReact && <div><span className="font-bold">IDWeb:</span> {selectedClient.IDReact}</div>}
                            </div>
                        </div>
                    )}
                </div>

                {importResult && (
                    <button 
                        onClick={() => window.location.href = '/produccion/etiquetas'}
                        className="px-5 py-2 rounded font-bold text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 transition-all shadow-sm flex items-center gap-2"
                    >
                        Ir a Pantalla de Etiquetas 
                        <span>→</span>
                    </button>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-zinc-200 mb-6 overflow-hidden transition-all duration-300 relative">
                {/* Cabecera del Accordion */}
                <div 
                    className={`flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-50 ${isInputCollapsed ? 'border-b-0' : 'border-b'} border-zinc-200 transition-colors`}
                    onClick={() => setIsInputCollapsed(!isInputCollapsed)}
                >
                    <h2 className="font-bold text-zinc-700 flex items-center gap-2">
                        <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        Módulo de Lectura de Órdenes (ERP)
                    </h2>
                    <span className="text-blue-600 text-sm font-semibold hover:underline">
                        {isInputCollapsed ? 'Mostrar Área' : 'Ocultar Área'}
                    </span>
                </div>

                {/* Contenido Colapsable */}
                {!isInputCollapsed && (
                    <div className="p-6 bg-zinc-50/50">
                        <textarea 
                            value={docsInput}
                            onChange={(e) => setDocsInput(e.target.value)}
                            placeholder="Ejemplo:&#10;35441&#10;DF-76412"
                            className="w-full h-28 p-3 border border-zinc-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y mb-4 font-mono shadow-inner bg-white"
                        />

                        <div className="flex gap-4">
                            <button 
                                onClick={handlePreview}
                                disabled={loadingPreview || loadingImport}
                                className={`px-8 py-2.5 rounded font-extrabold text-white transition-all shadow-md ${loadingPreview ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
                            >
                                {loadingPreview ? 'Procesando...' : 'Procesar'}
                            </button>
                            <button 
                                onClick={() => setDocsInput('')}
                                disabled={loadingPreview}
                                className="px-6 py-2.5 rounded font-bold text-zinc-600 bg-zinc-200 hover:bg-zinc-300 transition-colors shadow-sm"
                            >
                                Limpiar Caja
                            </button>
                        </div>

                        {error && (
                            <div className="mt-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 rounded block font-medium text-sm">
                                ⚠️ {error}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* TABLA PREVIEW */}
            {previewData && (
                <div className="bg-white p-6 rounded-xl shadow-lg border border-zinc-200 animate-fade-in mb-8">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-extrabold text-zinc-800 flex items-center gap-2">
                            <span>Previsualización y Selección</span>
                            <span className="bg-zinc-200 text-zinc-600 text-sm px-2 py-0.5 rounded-full">{previewData.length} registros</span>
                        </h2>
                        <button 
                            onClick={handleImport}
                            disabled={loadingImport || selectedRows.length === 0}
                            className={`px-8 py-2.5 rounded font-extrabold text-white transition-all shadow-lg flex items-center justify-center gap-2 ${loadingImport ? 'bg-green-400 cursor-not-allowed' : selectedRows.length === 0 ? 'bg-zinc-300 cursor-not-allowed shadow-none text-zinc-500' : 'bg-green-600 hover:bg-green-700 hover:scale-105 active:scale-95'}`}
                        >
                            {loadingImport && <i className="fa-solid fa-spinner fa-spin"></i>}
                            {!loadingImport && <i className="fa-solid fa-check"></i>}
                            {loadingImport ? 'Oficializando...' : `Oficializar en BD (${selectedRows.length})`}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded border border-zinc-200">
                        <table className="min-w-full text-sm text-left text-zinc-700 whitespace-nowrap">
                            <thead className="bg-zinc-100 text-xs uppercase font-extrabold text-zinc-600">
                                <tr>
                                    <th className="px-4 py-3 border-b text-center w-12">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 cursor-pointer accent-blue-600"
                                            checked={selectedRows.length === previewData.filter(r => !isRowDisabled(r, previewData)).length && previewData.length > 0}
                                            onChange={toggleAllRows}
                                        />
                                    </th>
                                    <th className="px-4 py-3 border-b">Modo</th>
                                    <th className="px-4 py-3 border-b">Orden</th>
                                    <th className="px-4 py-3 border-b">ID Cliente</th>
                                    <th className="px-4 py-3 border-b max-w-[200px]">Trabajo</th>
                                    <th className="px-4 py-3 border-b">Material</th>
                                    <th className="px-4 py-3 border-b max-w-[200px]">Nota</th>
                                    <th className="px-4 py-3 border-b text-right">Cant</th>
                                    <th className="px-4 py-3 border-b text-center w-12"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {previewData.map((row, idx) => {
                                    const isDisabled = isRowDisabled(row, previewData);
                                    const isSelected = selectedRows.includes(idx);
                                    return (
                                        <tr key={idx} className={`transition-colors ${isSelected ? 'bg-blue-50/60' : (isDisabled ? 'bg-red-50/30' : 'hover:bg-zinc-50')}`}>
                                            <td className="px-4 py-3 text-center">
                                                <input 
                                                    type="checkbox" 
                                                    className="w-4 h-4 cursor-pointer accent-blue-600 disabled:opacity-50 disabled:bg-zinc-200 disabled:cursor-not-allowed"
                                                    checked={isSelected}
                                                    disabled={isDisabled}
                                                    title={isDisabled ? "Operación bloqueada por error en esta orden o uno de sus ítems asociados." : undefined}
                                                    onChange={() => toggleRowSelection(idx)}
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${row.modo?.toLowerCase().includes('urgent') ? 'bg-red-100 text-red-700' : 'bg-zinc-200 text-zinc-600'}`}>
                                                    {row.modo}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-bold text-zinc-800">
                                                {row.orden}
                                                {row.yaExiste && (
                                                    <span className="ml-2 text-[10px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded border border-yellow-200" title="Ya existe. Será reemplazada.">
                                                        ⚠️ YA EXISTE
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                {row.clienteNoEncontrado ? (
                                                    <div className="bg-red-500 text-white font-bold px-2 py-1 rounded text-[10px] inline-flex items-center justify-center gap-1">
                                                        <span>⚠️ NO ENCONTRADO</span>
                                                        <span className="opacity-80 font-mono ml-1">({row.idCliente || 'VACÍO'})</span>
                                                    </div>
                                                ) : (
                                                    row.idCliente
                                                )}
                                            </td>
                                            <td className="px-4 py-3 max-w-[150px] truncate" title={row.nombreTrabajo}>
                                                {row.nombreTrabajo}
                                            </td>
                                            <td className="px-4 py-3 text-zinc-600 font-medium">
                                                {row.articuloNoEncontrado ? (
                                                    <div className="bg-red-500 text-white font-bold px-2 py-1 rounded text-[10px] inline-flex items-center justify-center gap-1">
                                                        <span>⚠️ NO ENCONTRADO</span>
                                                        <span className="opacity-80 font-mono ml-1">({row.material || 'VACÍO'})</span>
                                                    </div>
                                                ) : (
                                                    row.material
                                                )}
                                            </td>
                                            
                                            <td className="px-4 py-3 max-w-[200px] truncate text-xs text-zinc-500 italic" title={row.nota}>
                                                {row.nota || <span className="text-zinc-300">-</span>}
                                            </td>

                                            <td className="px-4 py-3 text-right font-black text-zinc-800">{row.cantidad}</td>
                                            
                                            <td className="px-4 py-3 text-center">
                                                <button 
                                                    onClick={() => removeRow(idx)}
                                                    className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded-full transition-colors focus:outline-none"
                                                    title="Eliminar fila"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* RESULTADOS DE IMPORTACION */}
            {importResult && importResult.nuevosPedidos && !previewData && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-emerald-200 animate-fade-in relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-emerald-500"></div>
                    <h2 className="text-xl font-bold text-emerald-800 mb-2">
                        ✅ {importResult.message}
                    </h2>
                    <div className="text-zinc-600 font-medium">
                        Se ingresaron <span className="font-bold">{importResult.nuevosPedidos.length}</span> registros en Producción.
                    </div>
                </div>
            )}

            {/* MODAL DE DETALLE ANALÍTICO DE PRECIOS */}
            {isModalOpen && selectedRowContext && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white w-full max-w-lg rounded-xl overflow-hidden shadow-2xl transform transition-all">
                        <div className="px-6 py-4 flex justify-between items-center border-b bg-zinc-50">
                            <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                Tracking de Cotización
                            </h3>
                            <button 
                                onClick={() => setIsModalOpen(false)}
                                className="text-zinc-500 hover:text-zinc-800 bg-white hover:bg-zinc-200 p-1.5 rounded-full transition-colors focus:outline-none border shadow-sm"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>
                        <div className="p-6 bg-white min-h-[150px]">
                            <p className="text-sm text-zinc-500 mb-4 font-medium border-b pb-2">
                                Orden: <span className="text-zinc-800 font-mono font-bold mr-4">{selectedRowContext.orden}</span>
                                Cliente: <span className="text-zinc-800 font-mono font-bold">{selectedRowContext.idCliente}</span>
                            </p>
                            
                            <div className="text-sm font-mono text-zinc-700 whitespace-pre-wrap leading-relaxed py-2 pl-4 border-l-2 border-blue-200 bg-blue-50/30 rounded-r">
                                {selectedRowContext.pricingTrace}
                            </div>
                        </div>
                        <div className="px-6 py-3 bg-zinc-50/80 border-t flex justify-end">
                            <button 
                                onClick={() => setIsModalOpen(false)}
                                className="px-6 py-2 bg-zinc-800 hover:bg-black text-white font-bold rounded shadow-md transition-colors text-sm"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

