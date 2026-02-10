import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import FileItem from '../production/components/FileItem';
import JSZip from 'jszip';

const MeasurementView = ({ areaCode }) => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [filterRoll, setFilterRoll] = useState('ALL');
    const [filterStatus, setFilterStatus] = useState('ALL');

    // SELECTION STATE
    const [selectedFiles, setSelectedFiles] = useState(new Set());

    // 1. CARGA DE DATOS
    const fetchData = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/measurements?area=${areaCode || 'IMPRESION'}`);
            const rawData = res.data;
            const dataList = Array.isArray(rawData) ? rawData : (rawData.data || []);

            const cleanData = dataList.map(order => ({
                ...order,
                id: order.id || order.OrdenID,
                code: order.code || order.CodigoOrden,
                client: order.client || order.Cliente,
                material: order.material || order.Material || 'Estándar',
                rollId: order.rollId || 'Sin Rollo',
                rollName: order.rollName || `Lote ${order.rollId || '?'}`,
                files: (order.files || []).map(f => ({
                    ...f,
                    id: f.id || f.ArchivoID,
                    url: f.url || f.RutaAlmacenamiento || '',
                    urlProxy: (f.url || f.RutaAlmacenamiento || '').includes('drive.google.com')
                        ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.url || f.RutaAlmacenamiento || '')}`
                        : null,
                    confirmed: parseFloat(f.confirmed) || 0,
                    parentOrderId: order.id || order.OrdenID,

                    // Mapping for FileItem compatibility
                    NombreArchivo: f.name || f.NombreArchivo,
                    name: f.name || f.NombreArchivo,
                    Copias: f.copies || 1,
                    Metros: parseFloat(f.confirmed) || 0,
                    Material: order.material || order.Material, // Pass material here for context
                    Estado: (parseFloat(f.confirmed) > 0) ? 'OK' : 'PENDIENTE',

                    // Original fields
                    autoWidth: f.autoWidth,
                    autoHeight: f.autoHeight
                }))
            })).filter(order => order.files.length > 0);

            setOrders(cleanData);
        } catch (e) {
            console.error("Error fetching measurements:", e);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setSelectedFiles(new Set());
    }, [areaCode]);

    // 2. FILTRADO
    const groupedData = useMemo(() => {
        let filtered = orders;

        if (filterRoll !== 'ALL') {
            filtered = filtered.filter(o => o.rollId.toString() === filterRoll.toString());
        }

        if (filterStatus !== 'ALL') {
            filtered = filtered.filter(o => {
                const allMeasured = o.files.every(f => f.confirmed > 0);
                return filterStatus === 'DONE' ? allMeasured : !allMeasured;
            });
        }

        return filtered.map(order => {
            const byMaterial = {};
            order.files.forEach(f => {
                const mat = order.material;
                if (!byMaterial[mat]) byMaterial[mat] = [];
                byMaterial[mat].push(f);
            });
            return { ...order, materials: byMaterial };
        });
    }, [orders, filterRoll, filterStatus]);

    const uniqueRolls = useMemo(() => {
        const rollMap = new Map();
        orders.forEach(o => {
            if (o.rollId && o.rollId !== 'Sin Rollo') {
                rollMap.set(o.rollId, o.rollName);
            }
        });
        return Array.from(rollMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id);
    }, [orders]);

    // 3. HANDLERS
    const handleInput = (orderId, fileId, value) => {
        const numVal = parseFloat(value);
        const finalVal = isNaN(numVal) ? 0 : numVal;

        setOrders(prev => prev.map(o => {
            if (o.id !== orderId) return o;
            return {
                ...o,
                files: o.files.map(f => {
                    if (f.id === fileId) {
                        return {
                            ...f,
                            confirmed: finalVal,
                            Metros: finalVal, // Sync for visual
                            Estado: finalVal > 0 ? 'OK' : 'PENDIENTE'
                        };
                    }
                    return f;
                })
            };
        }));
    };

    const toggleSelect = (fileId) => {
        const newSet = new Set(selectedFiles);
        if (newSet.has(fileId)) newSet.delete(fileId);
        else newSet.add(fileId);
        setSelectedFiles(newSet);
    };

    const toggleSelectAll = () => {
        const allVisibleIds = groupedData.flatMap(o => Object.values(o.materials).flat().map(f => f.id));
        if (selectedFiles.size === allVisibleIds.length && allVisibleIds.length > 0) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(allVisibleIds));
        }
    };

    const handleSave = async () => {
        const changes = [];
        orders.forEach(o => o.files.forEach(f => {
            if (f.confirmed > 0) {
                changes.push({
                    id: f.id,
                    confirmed: f.confirmed,
                    width: f.autoWidth || 0,
                    height: f.autoHeight || 0
                });
            }
        }));

        if (!changes.length) return alert("No hay medidas validas para guardar.");

        const user = JSON.parse(localStorage.getItem('user')) || {};
        try {
            await api.post('/measurements/save', {
                measurements: changes,
                userId: user.id || user.UsuarioID
            });
            fetchData();
            alert("Medidas guardadas correctamente");
        } catch (e) {
            console.error(e);
            alert("Error guardando datos: " + (e.response?.data?.error || e.message));
        }
    };

    // NUEVA FUNCION: Procesar Batch (Cliente decide carpeta)
    const handleBatchProcess = async () => {
        if (selectedFiles.size === 0) {
            alert("Por favor selecciona al menos un archivo.");
            return;
        }

        // 1. Selector de Carpeta (Si soporta)
        const supportsFileSystem = 'showDirectoryPicker' in window;
        let dirHandle = null;

        if (supportsFileSystem) {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (err) {
                return; // Usuario canceló
            }
        } else {
            if (!confirm("Tu navegador no soporta guardar en carpeta. Se descargará un ZIP.")) return;
        }

        setProcessing(true);
        try {
            // 2. Obtener ZIP desde Backend
            const fileIds = Array.from(selectedFiles);
            const res = await api.post('/measurements/process-batch',
                { fileIds },
                { responseType: 'blob' }
            );

            const blob = res.data;

            if (supportsFileSystem && dirHandle) {
                // 3. Descomprimir y guardar en carpeta elegida
                const zip = await JSZip.loadAsync(blob);
                let count = 0;

                for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
                    if (zipEntry.dir) continue;
                    // Aplanar nombre (backend ya renombra, asi que usamos filename directo)
                    const fileName = relativePath.split('/').pop();

                    try {
                        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                        const writable = await fileHandle.createWritable();
                        const content = await zipEntry.async('blob');
                        await writable.write(content);
                        await writable.close();
                        count++;
                    } catch (err) {
                        console.error("Error escribiendo archivo:", fileName, err);
                    }
                }
                alert(`¡Descarga completa! ${count} archivos guardados.`);
            } else {
                // Fallback ZIP
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = "Ordenes_Descarga.zip";
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
            }
            setSelectedFiles(new Set());
        } catch (e) {
            console.error(e);
            alert("Error al descargar: " + (e.message));
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col h-screen items-center justify-center gap-3 text-slate-500">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i>
            <span className="font-bold text-sm">Cargando Mediciones...</span>
        </div>
    );

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden font-sans">
            {/* --- FULL WIDTH PANEL --- */}
            <div className="w-full h-full bg-white flex flex-col">
                {/* Toolbar */}
                <div className="p-4 bg-white border-b border-slate-200 shadow-sm z-10 shrink-0">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight">Medición y Descarga</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={handleBatchProcess}
                                disabled={processing || selectedFiles.size === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white border-none py-1.5 px-4 rounded-lg text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {processing ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-download"></i>}
                                {selectedFiles.size > 0 ? `DESCARGAR (${selectedFiles.size})` : 'SELECCIONA ARCHIVOS'}
                            </button>

                            <button
                                onClick={handleSave}
                                disabled={processing}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white border-none py-1.5 px-3 rounded-lg text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 active:scale-95"
                            >
                                <i className="fa-solid fa-floppy-disk"></i> GUARDAR MANUAL
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-3 items-center">
                        {/* Checkbox Select All */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors" onClick={toggleSelectAll}>
                            <div className={`w-4 h-4 rounded border border-slate-400 flex items-center justify-center bg-white ${selectedFiles.size > 0 ? 'border-blue-500' : ''}`}>
                                {selectedFiles.size > 0 && <div className="w-2.5 h-2.5 bg-blue-500 rounded-sm"></div>}
                            </div>
                            <span className="text-xs font-bold text-slate-600 select-none">Todos</span>
                        </div>

                        {/* Select Rollo */}
                        <div className="flex-1 relative border border-slate-200 rounded-lg bg-slate-50 flex items-center px-2 group hover:border-blue-300 transition-colors">
                            <i className="fa-solid fa-layer-group text-slate-400 text-xs mr-2 group-hover:text-blue-500"></i>
                            <select
                                value={filterRoll}
                                onChange={e => setFilterRoll(e.target.value)}
                                className="w-full bg-transparent py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer appearance-none"
                            >
                                <option value="ALL">Todos los Rollos</option>
                                {uniqueRolls.map(r => <option key={r.id} value={r.id}>{r.name} (ID: {r.id})</option>)}
                            </select>
                            <i className="fa-solid fa-chevron-down text-slate-300 text-[10px] absolute right-2 pointer-events-none"></i>
                        </div>

                        {/* Toggle Status */}
                        <div className="flex border border-slate-200 rounded-lg overflow-hidden shrink-0">
                            {[
                                { id: 'ALL', label: 'Todos' },
                                { id: 'PENDING', label: 'Pendientes' },
                                { id: 'DONE', label: 'Listos' }
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    className={`px-3 py-2 text-[10px] font-bold transition-colors border-r border-slate-200 last:border-r-0 ${filterStatus === opt.id
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'bg-white text-slate-500 hover:bg-slate-50'
                                        }`}
                                    onClick={() => setFilterStatus(opt.id)}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* List Container - FULL WIDTH */}
                <div className="flex-1 overflow-y-auto p-4 bg-slate-50 custom-scrollbar space-y-4">
                    {groupedData.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 text-sm font-medium italic">
                            No hay archivos con los filtros actuales.
                        </div>
                    ) : (
                        groupedData.map(orderGroup => (
                            <div key={orderGroup.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden max-w-5xl mx-auto mb-6">
                                <div className="px-4 py-3 bg-white border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white">
                                    <div className="flex items-center gap-3">
                                        <span className="font-black text-sm text-slate-800 px-2 py-0.5 bg-white rounded border border-slate-200 shadow-sm">
                                            {orderGroup.code}
                                        </span>
                                        <span className="font-bold text-xs text-slate-500 truncate max-w-[300px]" title={orderGroup.client}>
                                            {orderGroup.client}
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100 uppercase tracking-wide">
                                        {orderGroup.rollName}
                                    </span>
                                </div>

                                {Object.entries(orderGroup.materials).map(([materialName, files]) => (
                                    <div key={materialName} className="border-b border-slate-100 last:border-0 p-2">
                                        {files.map(file => {
                                            const isSelected = selectedFiles.has(file.id);

                                            // CUSTOM VISIBLE CONTAINER FOR MEASUREMENT ACTIONS
                                            const MeasurementActions = (
                                                <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg p-1" onClick={e => e.stopPropagation()}>
                                                    {file.autoWidth > 0 && (
                                                        <div className="flex flex-col items-end px-2 border-r border-slate-200">
                                                            <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Automático</span>
                                                            <span className="text-[10px] text-amber-600 font-black">
                                                                {file.autoWidth} x {file.autoHeight}
                                                            </span>
                                                        </div>
                                                    )}

                                                    <div className="flex flex-col px-1">
                                                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Confirmar (M)</span>
                                                        <div className="relative">
                                                            <input
                                                                type="number" step="0.01" placeholder="0.00"
                                                                value={file.confirmed > 0 ? file.confirmed : ''}
                                                                onChange={(e) => handleInput(file.parentOrderId, file.id, e.target.value)}
                                                                className={`w-24 py-1 px-2 text-right font-mono text-xs font-bold rounded border outline-none focus:ring-2 transition-all shadow-sm
                                                                    ${file.confirmed > 0
                                                                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-100'
                                                                        : 'border-slate-300 bg-white text-slate-700 focus:border-blue-500 focus:ring-blue-100'
                                                                    }
                                                                `}
                                                            />
                                                            {file.confirmed > 0 && (
                                                                <i className="fa-solid fa-check text-[10px] text-emerald-600 absolute right-1.5 top-2 pointer-events-none"></i>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );

                                            return (
                                                <div key={file.id}
                                                    className={`flex items-start gap-2 mb-2 p-1 rounded-xl transition-all border ${isSelected ? 'bg-blue-50/30 border-blue-200' : 'border-transparent hover:bg-slate-50'}`}
                                                >
                                                    {/* CHECKBOX */}
                                                    <div className="pt-4 pl-1 cursor-pointer" onClick={() => toggleSelect(file.id)}>
                                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shadow-sm
                                                            ${isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white border-slate-300 hover:border-blue-400'}
                                                        `}>
                                                            {isSelected && <i className="fa-solid fa-check text-white text-[10px]"></i>}
                                                        </div>
                                                    </div>

                                                    {/* FILE ITEM COMPONENT */}
                                                    <div className="flex-1 cursor-pointer" onClick={() => toggleSelect(file.id)}>
                                                        <FileItem
                                                            file={file}
                                                            readOnly={true}
                                                            actions={MeasurementActions}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default MeasurementView;