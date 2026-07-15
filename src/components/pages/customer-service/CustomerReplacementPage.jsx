import React, { useState, useEffect, useCallback } from 'react';
import { fileControlService } from '../../../services/modules/fileControlService';
import { useAuth } from '../../../context/AuthContext';
import Toast from '../../ui/Toast';
import { socket } from '../../../services/socketService';

const CustomerReplacementPage = () => {
    const { user } = useAuth();

    // Search & Results
    const [query, setQuery] = useState('');
    const [orders, setOrders] = useState([]);
    const [loadingSearch, setLoadingSearch] = useState(false);

    // Selection
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [files, setFiles] = useState([]);
    const [relatedOrders, setRelatedOrders] = useState([]); // Services
    const [loadingFiles, setLoadingFiles] = useState(false);

    // Replacement Form
    const [selectedFileIds, setSelectedFileIds] = useState([]);
    const [selectedRelatedOrderIds, setSelectedRelatedOrderIds] = useState([]);
    const [replacementDetails, setReplacementDetails] = useState({}); // { fileId: { meters: '', obs: '' } }
    const [globalObs, setGlobalObs] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // UI
    const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
    const [successData, setSuccessData] = useState(null);

    // --- Search Orders ---
    const handleSearch = useCallback(async (e) => {
        e?.preventDefault();
        if (query.length < 3) return;

        setLoadingSearch(true);
        setSelectedOrder(null);
        setFiles([]);
        try {
            const results = await fileControlService.searchDeliveredOrders(query);
            setOrders(results || []);
        } catch (error) {
            console.error(error);
            setToast({ visible: true, message: 'Error buscando órdenes', type: 'error' });
        } finally {
            setLoadingSearch(false);
        }
    }, [query]);

    // --- Tiempo real: re-buscar cuando cambia el estado de alguna orden ---
    useEffect(() => {
        if (query.length < 3) return;
        const handleUpdate = () => handleSearch();
        socket.on('server:order_updated', handleUpdate);
        socket.on('server:ordersUpdated', handleUpdate);
        return () => {
            socket.off('server:order_updated', handleUpdate);
            socket.off('server:ordersUpdated', handleUpdate);
        };
    }, [query, handleSearch]);

    // --- Select Order ---
    const handleSelectOrder = async (order) => {
        setSelectedOrder(order);
        setLoadingFiles(true);
        setSelectedFileIds([]);
        setSelectedRelatedOrderIds([]);
        setReplacementDetails({});
        setRelatedOrders([]);
        try {
            const [data, related] = await Promise.all([
                fileControlService.getArchivosPorOrden(order.OrdenID),
                fileControlService.getRelatedOrders(order.OrdenID)
            ]);
            setFiles(data || []);
            // Las órdenes de FALLA (-F) son internas/efímeras: no se reponen, así que no se ofrecen
            // como "orden relacionada" para reponer (evita generar una -R de la falla).
            setRelatedOrders((related || []).filter(o => !(o.CodigoOrden || '').includes('-F')));
        } catch (error) {
            console.error(error);
            setToast({ visible: true, message: 'Error cargando archivos', type: 'error' });
        } finally {
            setLoadingFiles(false);
        }
    };

    // --- Handle Form Inputs ---
    const toggleRelatedOrderSelection = (orderId) => {
        setSelectedRelatedOrderIds(prev => prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]);
    };

    const toggleFileSelection = (fileId) => {
        setSelectedFileIds(prev => {
            if (prev.includes(fileId)) {
                const copy = { ...replacementDetails };
                delete copy[fileId];
                setReplacementDetails(copy);
                return prev.filter(id => id !== fileId);
            } else {
                // Pre-cargar valores originales como defaults
                const fileData = files.find(f => f.ArchivoID === fileId);
                if (fileData) {
                    setReplacementDetails(prev => ({
                        ...prev,
                        [fileId]: {
                            meters: parseFloat(fileData.Metros || 0).toFixed(2),
                            copies: parseInt(fileData.Copias || 1),
                            obs: ''
                        }
                    }));
                }
                return [...prev, fileId];
            }
        });
    };

    const updateDetail = (fileId, field, value) => {
        // Validar límites para metros y copias
        if (field === 'meters') {
            const fileData = files.find(f => f.ArchivoID === fileId);
            const maxMeters = parseFloat(fileData?.Metros || 0);
            const val = parseFloat(value);
            if (!isNaN(val) && maxMeters > 0 && val > maxMeters) {
                setToast({ visible: true, message: `⚠️ No podés reponer más de ${maxMeters.toFixed(2)}m (metros originales)`, type: 'warning' });
                value = maxMeters.toString();
            }
        }
        if (field === 'copies') {
            const fileData = files.find(f => f.ArchivoID === fileId);
            const maxCopies = parseInt(fileData?.Copias || 0);
            const val = parseInt(value);
            if (!isNaN(val) && maxCopies > 0 && val > maxCopies) {
                setToast({ visible: true, message: `⚠️ No podés reponer más de ${maxCopies} copias (copias originales)`, type: 'warning' });
                value = maxCopies.toString();
            }
        }
        setReplacementDetails(prev => ({
            ...prev,
            [fileId]: {
                ...prev[fileId],
                [field]: value
            }
        }));
    };

    // --- Submit Replacement ---
    const handleSubmit = async () => {
        if (selectedFileIds.length === 0 && selectedRelatedOrderIds.length === 0) {
            setToast({ visible: true, message: 'Seleccione al menos un archivo o servicio', type: 'warning' });
            return;
        }

        // Validate details and enforce limits client-side
        const items = selectedFileIds.map(fid => {
            const details = replacementDetails[fid] || {};
            const fileData = files.find(f => f.ArchivoID === fid);
            const maxMeters = parseFloat(fileData?.Metros || 0);
            const maxCopies = parseInt(fileData?.Copias || 0);
            const metersVal = parseFloat(details.meters) || 0;
            const copiesVal = parseInt(details.copies) || maxCopies;

            // Validate against originals
            if (metersVal > maxMeters && maxMeters > 0) {
                setToast({ visible: true, message: `⛔ El archivo "${fileData?.NombreArchivo}" supera los metros originales (${maxMeters}m)`, type: 'error' });
                return null; // Flag error
            }
            if (copiesVal > maxCopies && maxCopies > 0) {
                setToast({ visible: true, message: `⛔ El archivo "${fileData?.NombreArchivo}" supera las copias originales (${maxCopies})`, type: 'error' });
                return null; // Flag error
            }

            return {
                id: fid,
                meters: metersVal,
                copies: copiesVal,
                obs: details.obs || ''
            };
        });

        // If any validation failed, abort
        if (items.some(i => i === null)) return;

        if (items.some(i => !i.meters || i.meters <= 0)) {
            if (!confirm("Algunos archivos tienen 0 metros. ¿Continuar?")) return;
        }

        setSubmitting(true);
        try {
            const payload = {
                originalOrderId: selectedOrder.OrdenID,
                files: items, // { id, meters, copies, obs }
                relatedOrderIds: selectedRelatedOrderIds,
                globalObservation: globalObs,
                userId: user?.id
            };

            const res = await fileControlService.createReplacement(payload);

            if (res.success) {
                setSuccessData(res);
                setOrders([]);
                setQuery('');
                setSelectedOrder(null);
                setFiles([]);
                setSelectedFileIds([]);
                setReplacementDetails({});
                setGlobalObs('');
            } else {
                setToast({ visible: true, message: 'Error al crear reposición', type: 'error' });
            }

        } catch (error) {
            console.error(error);
            const msg = error.response?.data?.error || error.message || 'Error de conexión';
            setToast({ visible: true, message: `Error: ${msg}`, type: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    // Helper to format error message
    const getErrorMessage = (err) => {
        if (err.response && err.response.data && err.response.data.error) {
            return err.response.data.error;
        }
        return err.message || 'Error desconocido';
    };

    // --- RENDER ---
    return (
        <div className="h-full flex flex-col bg-slate-50 p-6 overflow-hidden">

            {/* Compact Header removed, integrated below */}
            <div className="flex gap-4 flex-1 overflow-hidden">

                {/* LEFT: Search Panel */}
                <div className="w-80 flex-shrink-0 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                        <h1 className="text-lg font-black text-slate-800 tracking-tight mb-1">Reposiciones</h1>
                        <p className="text-xs text-slate-400 font-medium mb-3">Atención al Cliente</p>

                        <form onSubmit={handleSearch} className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                            <input
                                type="text"
                                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700 placeholder:font-normal text-sm"
                                placeholder="Buscar Orden / Cliente..."
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                autoFocus
                            />
                        </form>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 scroll-smooth">
                        {loadingSearch ? (
                            <div className="py-10 text-center text-blue-500"><i className="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>
                        ) : orders.length === 0 ? (
                            <div className="py-10 text-center text-slate-400 px-6">
                                <i className="fa-solid fa-inbox text-4xl mb-2 opacity-20"></i>
                                <p className="text-sm">Ingrese número de orden o cliente (mín. 3 caracteres)</p>
                                <p className="text-xs mt-1 text-slate-300">Solo órdenes Entregadas/Finalizadas</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {orders.map(order => (
                                    <div
                                        key={order.OrdenID}
                                        onClick={() => handleSelectOrder(order)}
                                        className={`p-4 rounded-xl cursor-pointer border transition-all hover:shadow-md
                                            ${selectedOrder?.OrdenID === order.OrdenID
                                                ? 'bg-blue-50 border-blue-200 shadow-sm'
                                                : 'bg-white border-slate-100 hover:border-blue-100'
                                            }
                                        `}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="font-black text-slate-700 text-lg">
                                                #{order.NoDocERP || order.CodigoOrden}
                                            </span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${order.Estado === 'ENTREGADO' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                                {order.Estado}
                                            </span>
                                        </div>
                                        <div className="font-bold text-slate-600 text-sm mb-1">{order.IDCliente}</div>
                                        <div className="text-xs text-slate-400 truncate">{order.Material}</div>
                                        <div className="text-[10px] text-slate-300 mt-2 font-mono">{order.CodigoOrden}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Details & Form */}
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative">
                    {selectedOrder ? (
                        <>
                            {/* Order Info Header */}
                            <div className="p-6 border-b border-slate-100 bg-slate-50/30 flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h2 className="text-2xl font-black text-slate-800">{selectedOrder.CodigoOrden}</h2>
                                        {(selectedOrder.NoDocERP) && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold">{selectedOrder.NoDocERP}</span>}
                                    </div>
                                    <p className="font-bold text-slate-600">{selectedOrder.Cliente}</p>
                                    <p className="text-sm text-slate-500 mt-1 max-w-xl">{selectedOrder.DescripcionTrabajo}</p>
                                </div>
                                <button
                                    onClick={() => setSelectedOrder(null)}
                                    className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 flex items-center justify-center transition-colors"
                                >
                                    <i className="fa-solid fa-times"></i>
                                </button>
                            </div>

                            {/* Files List */}
                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-8">

                                {/* SECTION 1: ARCHIVOS */}
                                <div>
                                    {loadingFiles ? (
                                        <div className="py-10 text-center text-slate-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>
                                    ) : files.length === 0 ? (
                                        <div className="text-center py-10 text-slate-400 italic bg-white rounded-xl border border-dashed border-slate-300">Orden sin archivos</div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between px-2">
                                                <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">Archivos a Reponer</h3>
                                                {selectedFileIds.length > 0 && <span className="text-xs font-bold text-blue-600">{selectedFileIds.length} seleccionados</span>}
                                            </div>

                                            {files.map(file => {
                                                const isSelected = selectedFileIds.includes(file.ArchivoID);
                                                const details = replacementDetails[file.ArchivoID] || {};

                                                return (
                                                    <div
                                                        key={file.ArchivoID}
                                                        className={`relative bg-white rounded-xl border transition-all duration-300 
                                                            ${isSelected ? 'border-blue-500 shadow-md ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300'}
                                                        `}
                                                    >
                                                        <div className="flex p-4 gap-4">
                                                            <div className="pt-1">
                                                                <input
                                                                    type="checkbox"
                                                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                                    checked={isSelected}
                                                                    onChange={() => toggleFileSelection(file.ArchivoID)}
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <span className="font-bold text-slate-700 truncate">{file.NombreArchivo}</span>
                                                                    <a href={file.urlProxy || file.RutaAlmacenamiento || '#'} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 text-xs font-bold"><i className="fa-solid fa-external-link-alt mr-1"></i> Ver</a>
                                                                </div>
                                                                <div className="flex gap-4 text-xs text-slate-500 font-medium">
                                                                    <span>{parseFloat(file.Ancho).toFixed(2)}x{parseFloat(file.Alto).toFixed(2)}m</span>
                                                                    <span>{file.Material}</span>
                                                                    <span className="text-slate-400">Orig: {parseFloat(file.Metros || 0).toFixed(2)}m | {file.Copias} un.</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {isSelected && (
                                                            <div className="px-4 pb-4 pt-0 flex flex-col gap-3 animate-in slide-in-from-top-2 duration-200">
                                                                <div className="flex gap-4">
                                                                    <div className="w-1/3">
                                                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                                                            Metros a Reponer
                                                                            <span className="ml-1 text-blue-400 normal-case font-normal">(máx: {parseFloat(file.Metros || 0).toFixed(2)}m)</span>
                                                                        </label>
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            min="0.01"
                                                                            max={parseFloat(file.Metros || 0)}
                                                                            className="w-full px-3 py-2 bg-slate-50 border border-blue-200 rounded-lg text-sm font-bold text-slate-700 focus:border-blue-500 outline-none bg-blue-50/20"
                                                                            placeholder={`Ej: ${parseFloat(file.Metros || 0).toFixed(2)}`}
                                                                            value={details.meters ?? ''}
                                                                            onChange={e => updateDetail(file.ArchivoID, 'meters', e.target.value)}
                                                                        />
                                                                    </div>
                                                                    <div className="w-1/3">
                                                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                                                            Copias
                                                                            <span className="ml-1 text-blue-400 normal-case font-normal">(máx: {file.Copias})</span>
                                                                        </label>
                                                                        <input
                                                                            type="number"
                                                                            step="1"
                                                                            min="1"
                                                                            max={parseInt(file.Copias || 1)}
                                                                            className="w-full px-3 py-2 bg-slate-50 border border-blue-200 rounded-lg text-sm font-bold text-slate-700 focus:border-blue-500 outline-none bg-blue-50/20"
                                                                            placeholder={`${file.Copias}`}
                                                                            value={details.copies ?? parseInt(file.Copias || 1)}
                                                                            onChange={e => updateDetail(file.ArchivoID, 'copies', e.target.value)}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="flex-1">
                                                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Motivo / Observación de la Falla</label>
                                                                    <input
                                                                        type="text"
                                                                        className="w-full px-3 py-2 bg-slate-50 border border-blue-200 rounded-lg text-sm font-medium text-slate-700 focus:border-blue-500 outline-none bg-blue-50/20"
                                                                        placeholder="Describa el problema (la máquina y lote se agregan automáticamente)"
                                                                        value={details.obs || ''}
                                                                        onChange={e => updateDetail(file.ArchivoID, 'obs', e.target.value)}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* SECTION 2: RELATED SERVICES */}
                                {relatedOrders.length > 0 && (
                                    <div className="pt-4 border-t border-slate-200">
                                        <div className="flex items-center justify-between px-2 mb-4">
                                            <div>
                                                <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">Otros Servicios Relacionados</h3>
                                                <p className="text-[10px] text-slate-400">Seleccione los servicios que también deben repetirse</p>
                                            </div>
                                            {selectedRelatedOrderIds.length > 0 && <span className="text-xs font-bold text-amber-600">{selectedRelatedOrderIds.length} seleccionados</span>}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {relatedOrders.map(relOrder => {
                                                const isSel = selectedRelatedOrderIds.includes(relOrder.OrdenID);
                                                return (
                                                    <div
                                                        key={relOrder.OrdenID}
                                                        onClick={() => toggleRelatedOrderSelection(relOrder.OrdenID)}
                                                        className={`p-3 rounded-xl border cursor-pointer flex items-center gap-3 transition-all
                                                            ${isSel ? 'bg-amber-50 border-amber-500 shadow-sm ring-1 ring-amber-500' : 'bg-white border-slate-200 hover:border-slate-300'}
                                                        `}
                                                    >
                                                        <div className={`w-5 h-5 rounded border flex items-center justify-center
                                                            ${isSel ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 bg-slate-50'}
                                                        `}>
                                                            {isSel && <i className="fa-solid fa-check text-xs"></i>}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex justify-between items-center mb-0.5">
                                                                <span className="font-bold text-slate-700 text-sm">{relOrder.CodigoOrden}</span>
                                                                <span className="text-[10px] font-black uppercase text-slate-400">{relOrder.AreaID}</span>
                                                            </div>
                                                            <p className="text-xs text-slate-500 truncate" title={relOrder.DescripcionTrabajo}>{relOrder.DescripcionTrabajo}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer Action */}
                            <div className="p-6 border-t border-slate-100 bg-white">
                                <div className="mb-4">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observación General para la Orden de Falla</label>
                                    <textarea
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl resize-none h-20 text-sm focus:border-blue-500 outline-none"
                                        placeholder="Ej: Cliente reclama por decoloración en..."
                                        value={globalObs}
                                        onChange={e => setGlobalObs(e.target.value)}
                                    ></textarea>
                                </div>
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || (selectedFileIds.length === 0 && selectedRelatedOrderIds.length === 0)}
                                    className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 font-black text-lg transition-all
                                        ${submitting || (selectedFileIds.length === 0 && selectedRelatedOrderIds.length === 0)
                                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            : 'bg-red-500 text-white shadow-lg shadow-red-200 hover:bg-red-600 active:scale-[0.98]'
                                        }
                                    `}
                                >
                                    {submitting ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-triangle-exclamation"></i>}
                                    GENERAR REPOSICIÓN
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-300 p-10 text-center">
                            <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                                <i className="fa-solid fa-clipboard-check text-4xl opacity-50"></i>
                            </div>
                            <h3 className="text-xl font-black text-slate-400 mb-2">Seleccione una Orden</h3>
                            <p className="max-w-xs mx-auto">Busque una orden entregada en el panel izquierdo para ver sus archivos y gestionar reposiciones.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Notification Toast */}
            {toast.visible && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, visible: false })} />}

            {/* Success Modal */}
            {successData && (
                <div className="fixed inset-0 z-50 bg-black/60  flex items-center justify-center p-6">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center animate-in zoom-in-95 duration-200">
                        <div className="w-20 h-20 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <i className="fa-solid fa-check text-4xl"></i>
                        </div>
                        <h2 className="text-2xl font-black text-slate-800 mb-2">¡Reposición Creada!</h2>
                        <p className="text-slate-500 mb-6">Se ha generado la nueva orden de reposición correctamente.</p>

                        <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200">
                            <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">CÓDIGO ORDEN</div>
                            <div className="text-xl font-black text-slate-700">{successData.newCode}</div>
                        </div>

                        <button
                            onClick={() => setSuccessData(null)}
                            className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors"
                        >
                            Aceptar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerReplacementPage;
