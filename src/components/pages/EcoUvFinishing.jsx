import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

const EcoUvFinishing = () => {
    const [documents, setDocuments] = useState([]);
    const [selectedDocId, setSelectedDocId] = useState(null); // Usar ID, no objeto
    const [loading, setLoading] = useState(false);

    // Cache de detalles: { ordenId: [items] }
    const [ordersDetails, setOrdersDetails] = useState({});
    const [loadingDetails, setLoadingDetails] = useState(false);

    // Derivar seleccionado
    const selectedDoc = documents.find(d => d.docId === selectedDocId) || null;

    const fetchDocuments = useCallback(async () => {
        // No setear loading global si ya hay datos (para evitar parpadeo en polling)
        // setLoading(true);
        try {
            const { data } = await api.get('/finishing/orders');
            setDocuments(data);
            // Ya no tocamos selectedDoc aquí
        } catch (error) {
            console.error(error);
            // toast.error("Error cargando terminaciones"); // Silenciar para no spamear si falla polling
        } finally {
            // setLoading(false);
        }
    }, []);

    useEffect(() => {
        setLoading(true);
        fetchDocuments().then(() => setLoading(false));

        // Polling cada 30s
        const interval = setInterval(fetchDocuments, 30000);
        return () => clearInterval(interval);
    }, [fetchDocuments]);

    // Cargar detalles cuando cambia el ID seleccionado
    useEffect(() => {
        if (!selectedDocId || !selectedDoc) return;

        const loadAllDetails = async () => {
            setLoadingDetails(true);
            const newDetails = { ...ordersDetails };

            try {
                await Promise.all(selectedDoc.ordenes.map(async (ord) => {
                    const res = await api.get(`/finishing/orders/${ord.OrdenID}/details`);
                    newDetails[ord.OrdenID] = res.data.extras || [];
                }));
                setOrdersDetails(newDetails);
            } catch (e) {
                console.error(e);
                toast.error("Error cargando detalles");
            } finally {
                setLoadingDetails(false);
            }
        };

        loadAllDetails();
    }, [selectedDocId, selectedDoc]); // Solo depende del ID (primitivo) y del objeto derivado

    // Manejar cambio en input de cantidad
    const handleQuantityChange = (ordenId, itemId, newVal) => {
        setOrdersDetails(prev => ({
            ...prev,
            [ordenId]: prev[ordenId].map(item =>
                item.ServicioID === itemId ? { ...item, Cantidad: newVal } : item
            )
        }));
    };

    // Guardar cantidad (onBlur)
    const saveQuantity = async (itemId, newVal) => {
        try {
            await api.put(`/finishing/items/${itemId}`, { cantidad: newVal });
            toast.success("Cantidad actualizada");
        } catch (e) {
            toast.error("Error guardando cantidad");
        }
    };

    // Finalizar Orden Específica
    const handleFinishOrder = async (ordenId) => {
        try {
            await api.post(`/finishing/orders/${ordenId}/control`);
            toast.success("Orden finalizada correctamente");
            // Refrescar datos
            fetchDocuments();
        } catch (e) {
            toast.error("Error finalizando orden");
        }
    };

    return (
        <div className="flex h-full bg-slate-100 overflow-hidden">
            {/* LEFT PANEL: LISTA */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-10 shadow-lg">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <h2 className="font-black text-slate-700 uppercase tracking-wide text-sm flex items-center gap-2">
                        <i className="fa-solid fa-layer-group text-blue-500"></i>
                        Terminaciones ECOUV
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                        {documents.length} trabajos pendientes
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {loading && documents.length === 0 && (
                        <div className="text-center py-10 text-slate-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i>
                            <p className="text-xs">Cargando...</p>
                        </div>
                    )}

                    {documents.map(doc => {
                        const isSelected = selectedDocId === doc.docId;
                        const isUrgent = doc.prioridad === 'Urgente';

                        return (
                            <div
                                key={doc.docId}
                                onClick={() => setSelectedDocId(doc.docId)}
                                className={`
                                    group p-4 rounded-xl border cursor-pointer transition-all duration-200 relative overflow-hidden
                                    ${isSelected
                                        ? 'bg-blue-50 border-blue-500 shadow-md ring-1 ring-blue-500'
                                        : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
                                    }
                                `}
                            >
                                {isUrgent && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>}

                                <div className="flex justify-between items-start mb-1 pl-2">
                                    <span className="font-mono text-xs font-bold text-slate-500">
                                        #{doc.docId}
                                    </span>
                                    {isUrgent && <i className="fa-solid fa-fire text-amber-500 text-xs animate-pulse"></i>}
                                </div>

                                <h3 className="font-bold text-slate-800 text-sm leading-tight mb-1 pl-2 line-clamp-2">
                                    {doc.cliente}
                                </h3>

                                <p className="text-xs text-slate-500 pl-2 line-clamp-1 italic">
                                    {doc.trabajo || 'Sin descripción'}
                                </p>

                                <div className="mt-3 flex items-center gap-2 pl-2">
                                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200">
                                        {doc.ordenes.length} Ítems
                                    </span>
                                    <span className="text-[10px] text-slate-400 ml-auto">
                                        {new Date(doc.fecha).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* RIGHT PANEL: DETALLES */}
            <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6">
                {!selectedDoc ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300">
                        <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                            <i className="fa-solid fa-hand-pointer text-4xl"></i>
                        </div>
                        <p className="text-lg font-medium">Seleccione un trabajo para comenzar</p>
                    </div>
                ) : (
                    <div className="max-w-5xl mx-auto animate-fade-in-up">
                        {/* HEADER DOCUMENTO */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 mb-6 flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <h1 className="text-2xl font-black text-slate-800">
                                        {selectedDoc.cliente}
                                    </h1>
                                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                                        Doc: {selectedDoc.docId}
                                    </span>
                                </div>
                                <p className="text-slate-500 font-medium text-lg">
                                    {selectedDoc.trabajo}
                                </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                {selectedDoc.prioridad === 'Urgente' && (
                                    <span className="bg-red-100 text-red-700 px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-2 border border-red-200">
                                        <i className="fa-solid fa-fire"></i> URGENTE
                                    </span>
                                )}
                                <button
                                    onClick={fetchDocuments}
                                    className="text-slate-400 hover:text-blue-600 transition-colors p-2"
                                    title="Actualizar"
                                >
                                    <i className="fa-solid fa-rotate-right"></i>
                                </button>
                            </div>
                        </div>

                        {/* LISTA DE SUB-ORDENES */}
                        <div className="space-y-6">
                            {selectedDoc.ordenes.map(ord => {
                                const extras = ordersDetails[ord.OrdenID] || [];
                                const isFinished = ord.Estado === 'Finalizado' || ord.EstadoenArea === 'Finalizado';

                                // Calcular magnitud dinámica si tengo items y NO son metros (ej: Unidades)
                                let displayMagnitud = ord.Magnitud;
                                if (extras.length > 0 && ord.UM && !ord.UM.toUpperCase().startsWith('M')) {
                                    const sum = extras.reduce((acc, el) => acc + (parseFloat(el.Cantidad) || 0), 0);
                                    displayMagnitud = sum % 1 !== 0 ? sum.toFixed(2) : sum;
                                }

                                return (
                                    <div key={ord.OrdenID} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${isFinished ? 'opacity-60 border-slate-200' : 'border-slate-200 hover:shadow-md transition-shadow'}`}>
                                        {/* Header de la Orden */}
                                        <div className="bg-slate-50 border-b border-slate-100 p-4 flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-lg">
                                                    {ord.CodigoOrden.split(' ')[0]}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-slate-800 text-sm">
                                                        {ord.Variante || ord.Material}
                                                    </h3>
                                                    <p className="text-xs text-slate-500 font-bold">
                                                        {displayMagnitud} {ord.UM}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${isFinished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                    {isFinished ? 'Finalizado' : 'Pendiente'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Body: Materiales y Nota */}
                                        <div className="p-5">
                                            {ord.Nota && ord.Nota.trim() && (
                                                <div className="mb-4 bg-yellow-50 border border-yellow-100 p-3 rounded-lg text-xs text-yellow-800 flex gap-2 items-start">
                                                    <i className="fa-regular fa-note-sticky mt-0.5"></i>
                                                    <p>{ord.Nota}</p>
                                                </div>
                                            )}

                                            {/* TABLA DE MATERIALES EXTRAS */}
                                            <div className="mb-4">
                                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3">
                                                    Materiales Adicionales / Servicios
                                                </h4>

                                                {loadingDetails && !extras.length ? (
                                                    <div className="text-center py-4"><i className="fa-solid fa-spinner fa-spin text-slate-300"></i></div>
                                                ) : extras.length === 0 ? (
                                                    <p className="text-sm text-slate-400 italic bg-slate-50 p-3 rounded border border-dashed border-slate-200">
                                                        No hay materiales extra registrados.
                                                    </p>
                                                ) : (
                                                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                                                        <table className="w-full text-sm">
                                                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold text-left">
                                                                <tr>
                                                                    <th className="px-4 py-2 w-1/2">Descripción</th>
                                                                    <th className="px-4 py-2 w-1/4">Cantidad</th>
                                                                    <th className="px-4 py-2 w-1/4 text-center">UM</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {extras.map((ex, idx) => (
                                                                    <tr key={ex.ServicioID || idx}>
                                                                        <td className="px-4 py-3 font-medium text-slate-700">
                                                                            {ex.Descripcion}
                                                                        </td>
                                                                        <td className="px-4 py-3">
                                                                            <input
                                                                                type="number"
                                                                                className="w-24 px-2 py-1 rounded border border-slate-300 text-slate-800 font-bold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-right"
                                                                                value={ex.Cantidad}
                                                                                onChange={(e) => handleQuantityChange(ord.OrdenID, ex.ServicioID, e.target.value)}
                                                                                onBlur={(e) => saveQuantity(ex.ServicioID, e.target.value)}
                                                                                disabled={isFinished}
                                                                            />
                                                                        </td>
                                                                        <td className="px-4 py-3 text-center text-slate-400 text-xs">
                                                                            {ex.Unidad || 'UN'}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>

                                            {/* ACTIONS */}
                                            {!isFinished && (
                                                <div className="flex justify-end pt-2">
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm("¿Confirmar que la tarea está lista?")) {
                                                                handleFinishOrder(ord.OrdenID);
                                                            }
                                                        }}
                                                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm shadow-emerald-200 transition-all flex items-center gap-2"
                                                    >
                                                        <i className="fa-solid fa-check"></i>
                                                        Finalizar Tarea
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EcoUvFinishing;
