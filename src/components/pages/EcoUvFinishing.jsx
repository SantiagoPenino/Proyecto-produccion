import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { API_URL } from '../../services/apiClient';
import { toast } from 'sonner';
import { printLabelsHelper } from '../../utils/printHelper';
import {
    labelUbicacion, ladosDeUbicacion,
    SOLDADURA_CM, profundidadBolsilloCm, margenOjalCm
} from '../../utils/terminacionesGeo';
import PlanoPieza, { COLOR_CAPA } from '../shared/PlanoPieza';
import OrdenProntaModal from '../production/components/OrdenProntaModal';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// fase 'trabajo' (Bandeja): órdenes con Material Recibido / En Terminaciones — marcar la
//   primera terminación pasa la orden a 'En Terminaciones'; "Finalizar Tarea" la manda a
//   'Control y Calidad' (como el fin de lote de las demás áreas).
// fase 'control' (Control): órdenes en 'Control y Calidad' — "Aprobar Control" etiqueta el
//   producto terminado en la orden de impresión y cierra la orden de terminaciones.
const EcoUvFinishing = ({ fase = 'trabajo' }) => {
    const esControl = fase === 'control';
    const [documents, setDocuments] = useState([]);
    const [selectedDocId, setSelectedDocId] = useState(null); // Usar ID, no objeto
    const [loading, setLoading] = useState(false);
    // Bultos físicos que salen de terminaciones por orden (ej. 3 cuadros por separado)
    const [bultosPorOrden, setBultosPorOrden] = useState({});
    // Magnitudes reales que el taller ajusta antes de confirmar { OrdenTerminacionID: valor }
    const [magnitudes, setMagnitudes] = useState({});
    const [confirmando, setConfirmando] = useState(null);
    const [completedOrderData, setCompletedOrderData] = useState(null);

    // Cache de detalles: { ordenId: [items] }
    const [ordersDetails, setOrdersDetails] = useState({});
    const [loadingDetails, setLoadingDetails] = useState(false);

    // Derivar seleccionado
    const selectedDoc = documents.find(d => d.docId === selectedDocId) || null;

    const fetchDocuments = useCallback(async () => {
        // No setear loading global si ya hay datos (para evitar parpadeo en polling)
        // setLoading(true);
        try {
            const { data } = await api.get(`/finishing/orders?fase=${fase}`);
            setDocuments(data);
            // Ya no tocamos selectedDoc aquí
        } catch (error) {
            console.error(error);
            // toast.error("Error cargando terminaciones"); // Silenciar para no spamear si falla polling
        } finally {
            // setLoading(false);
        }
    }, [fase]);

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
                    // Las líneas de facturación de terminaciones (modelo nuevo) no se muestran
                    // como "materiales extra": ya aparecen en su propio bloque por archivo.
                    const rawExtras = res.data.extras || [];
                    newDetails[ord.OrdenID] = {
                        extras: rawExtras.filter(ex => (ex.Observacion || '') !== 'Terminación por archivo (WebOrder)'),
                        terminaciones: res.data.terminaciones || [],
                        archivos: res.data.archivos || []   // conteo de copias por archivo (Control)
                    };
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
            [ordenId]: {
                ...prev[ordenId],
                extras: (prev[ordenId]?.extras || []).map(item =>
                    item.ServicioID === itemId ? { ...item, Cantidad: newVal } : item
                )
            }
        }));
    };

    // Marcar terminación Pendiente/Hecha (modelo nuevo, por archivo)
    const toggleTerminacion = async (ordenId, term) => {
        const nuevoEstado = term.Estado === 'Hecha' ? 'Pendiente' : 'Hecha';
        // Optimista
        setOrdersDetails(prev => ({
            ...prev,
            [ordenId]: {
                ...prev[ordenId],
                terminaciones: (prev[ordenId]?.terminaciones || []).map(t =>
                    t.ID === term.ID ? { ...t, Estado: nuevoEstado } : t
                )
            }
        }));
        try {
            await api.put(`/finishing/terminaciones/${term.ID}/estado`, { estado: nuevoEstado });
        } catch (e) {
            toast.error("Error actualizando terminación");
            // Revertir
            setOrdersDetails(prev => ({
                ...prev,
                [ordenId]: {
                    ...prev[ordenId],
                    terminaciones: (prev[ordenId]?.terminaciones || []).map(t =>
                        t.ID === term.ID ? { ...t, Estado: term.Estado } : t
                    )
                }
            }));
        }
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

    // Copias controladas en el Control de terminaciones, POR ARCHIVO (como el conteo
    // del control de lotes): 3 del arte A, 5 del arte B. El backend clampa a [0, Copias].
    const saveControlCopiasArchivo = async (ordenId, archivoId, val) => {
        try {
            await api.put(`/finishing/archivos/${archivoId}/control-copias`, { cantidad: parseInt(val, 10) || 0 });
            // Refrescar solo los detalles de esa orden (ahí vive el conteo por archivo)
            const res = await api.get(`/finishing/orders/${ordenId}/details`);
            const rawExtras = res.data.extras || [];
            setOrdersDetails(prev => ({
                ...prev,
                [ordenId]: {
                    extras: rawExtras.filter(ex => (ex.Observacion || '') !== 'Terminación por archivo (WebOrder)'),
                    terminaciones: res.data.terminaciones || [],
                    archivos: res.data.archivos || []
                }
            }));
        } catch (e) {
            toast.error('Error guardando el conteo: ' + (e.response?.data?.error || e.message));
        }
    };

    // Finalizar Orden Específica.
    // Bandeja (trabajo): la orden pasa a 'Terminado' y espera en la pestaña Control.
    // Control: aprobación final -> 'Pronto' + Canasto Producción.
    const handleFinishOrder = async (ordenId) => {
        try {
            const res = await api.post(`/finishing/orders/${ordenId}/control`, {
                fase,
                bultos: esControl ? (parseInt(bultosPorOrden[ordenId], 10) || 1) : undefined,
            });
            const bultos = res.data?.totalBultos || 0;
            if (esControl) {
                // Mismo modal "¡Orden Pronta!" que el área de Impresión (FilePrintControl) y
                // Bordado/Estampado/Corte/Costura (EmbBandeja), para que la confirmación se
                // vea/comporte igual en todas las áreas.
                setCompletedOrderData({
                    ordenId: res.data?.labelOrdenId || ordenId,
                    destino: res.data?.destino,
                    proximoServicio: res.data?.proximoServicio,
                });
            } else {
                toast.success("Trabajo terminado: la orden pasó a Control y Calidad");
            }
            // Refrescar datos
            fetchDocuments();
        } catch (e) {
            toast.error("Error finalizando: " + (e.response?.data?.error || e.message));
        }
    };

    // URL absoluta hacia el backend (los /api/... y /thumbnails/... relativos)
    const resolverUrl = (url) => {
        if (!url) return null;
        if (url.startsWith('/api/') || url.startsWith('/thumbnails/')) {
            const base = API_URL.endsWith('/api') ? API_URL.replace('/api', '') : API_URL;
            return `${base}${url}`;
        }
        return url;
    };

    // Arte para dibujar dentro del boceto. Se decide por la URL (no por el nombre:
    // la miniatura del backend es un .jpg aunque el archivo se llame .pdf). Si la
    // URL no es imagen (PDF sin miniatura), se usa la 1ª página rasterizada acá
    // con pdfjs (cache pdfPreviews por archivo).
    const [pdfPreviews, setPdfPreviews] = useState({});
    const esUrlImagen = (url) => /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(url || '') || (url || '').startsWith('/thumbnails/');
    const arteDeArchivo = (grupo) => {
        if (!grupo?.arteUrl) return null;
        if (esUrlImagen(grupo.arteUrl)) return resolverUrl(grupo.arteUrl);
        const nombre = (grupo.nombre || '').toLowerCase();
        if (/\.(png|jpe?g|webp|gif|bmp)$/.test(nombre)) return resolverUrl(grupo.arteUrl);
        return pdfPreviews[grupo.archivoId] || null;
    };

    // Rasterizar la 1ª página de los PDF sin miniatura (una sola vez por archivo)
    useEffect(() => {
        Object.values(ordersDetails).forEach(det => {
            (det?.terminaciones || []).forEach(t => {
                if (!t.ArchivoID || !t.arteUrl || esUrlImagen(t.arteUrl)) return;
                if (!/\.pdf$/i.test((t.NombreArchivo || '').trim())) return;
                if (pdfPreviews[t.ArchivoID] !== undefined) return;
                setPdfPreviews(prev => ({ ...prev, [t.ArchivoID]: null }));   // en curso
                (async () => {
                    try {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
                        const resp = await fetch(resolverUrl(t.arteUrl));
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        const pdf = await pdfjsLib.getDocument({ data: await resp.arrayBuffer() }).promise;
                        const page = await pdf.getPage(1);
                        const vp = page.getViewport({ scale: 1 });
                        const escala = Math.min(2, 600 / Math.max(vp.width, vp.height));
                        const v2 = page.getViewport({ scale: escala });
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.ceil(v2.width);
                        canvas.height = Math.ceil(v2.height);
                        await page.render({ canvasContext: canvas.getContext('2d'), viewport: v2 }).promise;
                        setPdfPreviews(prev => ({ ...prev, [t.ArchivoID]: canvas.toDataURL('image/jpeg', 0.8) }));
                    } catch (e) {
                        console.warn('Sin preview del PDF', t.NombreArchivo, e.message);
                    }
                })();
            });
        });
    }, [ordersDetails]);

    // Confirmar las magnitudes REALES del trabajo: actualiza lo que se cobra y
    // recotiza el pedido (el cliente pidió una estimación, el taller confirma lo hecho).
    const confirmarMagnitudes = async (ordenId) => {
        const det = ordersDetails[ordenId];
        const terms = det?.terminaciones || [];
        const items = terms
            .filter(t => magnitudes[t.ID] !== undefined && magnitudes[t.ID] !== '')
            .map(t => ({ id: t.ID, cantidad: parseFloat(magnitudes[t.ID]) }))
            .filter(x => Number.isFinite(x.cantidad));
        if (items.length === 0) return toast.info('No cambiaste ninguna cantidad.');

        const resumen = items.map(x => {
            const t = terms.find(y => y.ID === x.id);
            return `${t?.Nombre}: ${parseFloat(t?.Cantidad)} → ${x.cantidad}`;
        }).join('\n');
        if (!window.confirm(`Se van a guardar estas cantidades y se va a actualizar la cotización del pedido:\n\n${resumen}`)) return;

        setConfirmando(ordenId);
        try {
            const res = await api.post(`/finishing/orders/${ordenId}/confirmar-magnitudes`, { items });
            const n = res.data?.cambios?.length || 0;
            toast.success(`${n} cantidad(es) confirmada(s)${res.data?.recotizada ? ' — cotización actualizada' : ''}`);
            setMagnitudes(prev => {
                const next = { ...prev };
                items.forEach(x => delete next[x.id]);
                return next;
            });
            // Releer el detalle para mostrar lo que quedó guardado
            const r = await api.get(`/finishing/orders/${ordenId}/details`);
            const rawExtras = r.data.extras || [];
            setOrdersDetails(prev => ({
                ...prev,
                [ordenId]: {
                    extras: rawExtras.filter(ex => (ex.Observacion || '') !== 'Terminación por archivo (WebOrder)'),
                    terminaciones: r.data.terminaciones || [],
                    archivos: r.data.archivos || []
                }
            }));
        } catch (e) {
            toast.error('Error confirmando magnitudes: ' + (e.response?.data?.error || e.message));
        } finally {
            setConfirmando(null);
        }
    };

    // Reimprimir etiquetas ya generadas de la orden
    const handlePrintLabels = (ordenId) => {
        printLabelsHelper(null, { id: ordenId });
        toast.success('Etiquetas listas para imprimir');
    };

    return (
        <>
        <div className="flex h-full bg-slate-100 overflow-hidden">
            {/* LEFT PANEL: LISTA */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-10 shadow-lg">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <h2 className="font-black text-slate-700 uppercase tracking-wide text-sm flex items-center gap-2">
                        <i className={`fa-solid ${esControl ? 'fa-clipboard-check text-emerald-500' : 'fa-layer-group text-blue-500'}`}></i>
                        {esControl ? 'Control de Terminaciones' : 'Terminaciones ECOUV'}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                        {esControl
                            ? `${documents.length} órdenes terminadas para controlar`
                            : `${documents.length} trabajos con material recibido`}
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
                        // Card estilo "Corte": código de orden arriba, cliente, trabajo,
                        // material/variante y abajo los datos operativos (magnitud, estado,
                        // forma de envío, fecha). Los saca de la primera orden del pedido.
                        const o1 = doc.ordenes?.[0] || {};
                        const codOrden = String(o1.CodigoOrden || '').trim();
                        const masOrdenes = (doc.ordenes?.length || 0) - 1;
                        const material = String(o1.Material || '').trim();
                        const variante = String(o1.Variante || '').trim();
                        const magnitud = `${parseFloat(o1.Magnitud) || 1} ${String(o1.UM || 'u').trim()}`;
                        // Producto terminado: viaja en la nota "[PRODUCTO: Cuadro canvas 70 x 50 | ...]"
                        const producto = (String(o1.Nota || '').match(/\[PRODUCTO:\s*([^\]|]+)/i)?.[1] || '').trim();
                        const modoRetiro = String(o1.ModoRetiro || '').trim();
                        const estadoArea = String(o1.EstadoenArea || '').trim();
                        const estiloEstado = estadoArea === 'En Terminaciones'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : estadoArea === 'Control y Calidad'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : 'bg-cyan-50 text-cyan-700 border-cyan-200'; // Material Recibido

                        return (
                            <div
                                key={doc.docId}
                                onClick={() => setSelectedDocId(doc.docId)}
                                className={`
                                    group p-3 rounded-xl border border-l-4 cursor-pointer transition-all duration-200 relative overflow-hidden
                                    ${isSelected
                                        ? 'bg-blue-50 border-blue-500 border-l-blue-600 shadow-md ring-1 ring-blue-500'
                                        : isUrgent
                                            ? 'bg-white border-slate-200 border-l-red-500 hover:border-blue-300 hover:shadow-sm'
                                            : 'bg-white border-slate-200 border-l-blue-400 hover:border-blue-300 hover:shadow-sm'
                                    }
                                `}
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="font-mono text-xs font-black text-blue-700">
                                        {codOrden || `#${doc.docId}`}
                                        {masOrdenes > 0 && <span className="text-slate-400 font-bold"> +{masOrdenes}</span>}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        {isUrgent && <i className="fa-solid fa-fire text-red-500 text-xs animate-pulse"></i>}
                                        <span className="font-mono text-[10px] text-slate-400">#{doc.docId}</span>
                                    </span>
                                </div>

                                <h3 className="font-bold text-slate-800 text-sm leading-tight line-clamp-1">
                                    {doc.cliente}
                                </h3>

                                <p className="text-xs text-slate-600 line-clamp-1">
                                    {doc.trabajo || 'Sin descripción'}
                                </p>
                                {/* Producto terminado si lo hay; si no, el material de impresión */}
                                <p className="text-[11px] text-slate-400 italic line-clamp-1">
                                    {producto || [material, variante].filter(Boolean).join(' · ') || '—'}
                                </p>

                                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200">
                                        {magnitud}
                                    </span>
                                    {estadoArea && (
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${estiloEstado}`}>
                                            {estadoArea}
                                        </span>
                                    )}
                                    {modoRetiro && (
                                        <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1"
                                            title={`Forma de envío: ${modoRetiro}`}>
                                            <i className={`fa-solid ${/encomienda/i.test(modoRetiro) ? 'fa-truck-fast' : /domicilio|cadeter/i.test(modoRetiro) ? 'fa-motorcycle' : 'fa-store'} text-slate-400`}></i>
                                            {modoRetiro.length > 18 ? modoRetiro.slice(0, 18) + '…' : modoRetiro}
                                        </span>
                                    )}
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
                                const det = ordersDetails[ord.OrdenID] || {};
                                const extras = det.extras || [];
                                const terminaciones = det.terminaciones || [];
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
                                                {ord.ModoRetiro && (
                                                    <span className="px-2 py-1 rounded text-[10px] font-black uppercase bg-violet-50 text-violet-700 border border-violet-200"
                                                        title="Forma de envío elegida por el cliente">
                                                        <i className="fa-solid fa-truck-fast mr-1"></i>{ord.ModoRetiro}
                                                    </span>
                                                )}
                                                {(ord.CantidadEtiquetas || 0) > 0 && (
                                                    <button
                                                        onClick={() => handlePrintLabels(ord.MadreOrdenID || ord.OrdenID)}
                                                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center gap-1.5 transition-colors"
                                                        title={`Reimprimir las ${ord.CantidadEtiquetas} etiqueta(s) del producto (orden de impresión)`}
                                                    >
                                                        <i className="fa-solid fa-tags"></i>
                                                        Etiquetas ({ord.CantidadEtiquetas})
                                                    </button>
                                                )}
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

                                            {/* TERMINACIONES POR ARCHIVO, agrupadas: cada archivo con SU boceto
                                                (lo que el cliente marcó) y las cantidades a confirmar. */}
                                            {terminaciones.length > 0 && (
                                                <div className="mb-4">
                                                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                                                        <h4 className="text-xs font-black text-amber-500 uppercase tracking-wider">
                                                            <i className="fa-solid fa-scissors mr-1.5"></i>
                                                            Terminaciones por archivo ({terminaciones.filter(t => t.Estado === 'Hecha').length}/{terminaciones.length} hechas)
                                                        </h4>
                                                        {!isFinished && (
                                                            <button
                                                                onClick={() => confirmarMagnitudes(ord.OrdenID)}
                                                                disabled={confirmando === ord.OrdenID}
                                                                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                                                title="Guardar las cantidades reales del trabajo y actualizar la cotización del pedido">
                                                                <i className={`fa-solid ${confirmando === ord.OrdenID ? 'fa-circle-notch fa-spin' : 'fa-calculator'}`}></i>
                                                                Confirmar magnitudes y recotizar
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Un bloque por archivo: boceto + sus terminaciones */}
                                                    {Object.values(terminaciones.reduce((acc, t) => {
                                                        const k = t.ArchivoID || 'sin-archivo';
                                                        (acc[k] ||= { archivoId: t.ArchivoID, nombre: t.NombreArchivo, ancho: t.Ancho, alto: t.Alto, copias: t.Copias, arteUrl: t.arteUrl, archivoUrl: t.archivoUrl, items: [] }).items.push(t);
                                                        return acc;
                                                    }, {})).map(grupo => {
                                                        // Capas del boceto con las medidas del taller a la vista:
                                                        // soldadura toma 5 cm, ojal a 2,5 (7,5 con soldadura en el
                                                        // lado), bolsillo = tamaño×2 + 5.
                                                        const ladosSold = new Set(grupo.items
                                                            .filter(t => /soldadura/i.test(t.Nombre || ''))
                                                            .flatMap(t => ladosDeUbicacion(t.Ubicacion)));
                                                        const capas = grupo.items.map((t, i) => {
                                                            const tipo = (t.ReglaCantidad === 'CADA_X_CM') ? 'ojales'
                                                                : /bolsillo/i.test(t.Nombre || '') ? 'bolsillo'
                                                                    : /palo/i.test(t.Nombre || '') ? 'palos'
                                                                        : /roll up/i.test(t.Nombre || '') ? 'rollup' : 'linea';
                                                            const capa = {
                                                                id: t.ID, nombre: t.Nombre,
                                                                color: COLOR_CAPA[i % COLOR_CAPA.length],
                                                                ubicacion: t.Ubicacion, tipo,
                                                                pasoM: (parseFloat(t.Param) || 50) / 100,
                                                            };
                                                            if (tipo === 'bolsillo') {
                                                                const tam = parseFloat(t.Param) || 5;
                                                                capa.anchoCm = profundidadBolsilloCm(tam);
                                                                capa.detalle = `${tam}×2+${SOLDADURA_CM} = ${profundidadBolsilloCm(tam)} cm`;
                                                            }
                                                            if (tipo === 'linea' && /soldadura/i.test(t.Nombre || '')) capa.detalle = `${SOLDADURA_CM} cm`;
                                                            if (tipo === 'ojales') {
                                                                const insets = {};
                                                                const misLados = ladosDeUbicacion(t.Ubicacion);
                                                                misLados.forEach(l => { insets[l] = margenOjalCm(ladosSold.has(l)); });
                                                                capa.insets = insets;
                                                                capa.detalle = misLados.some(l => ladosSold.has(l))
                                                                    ? `a ${SOLDADURA_CM + 2.5} cm (sold. + ojal)` : 'a 2,5 cm';
                                                            }
                                                            return capa;
                                                        });
                                                        const w = parseFloat(grupo.ancho) || 0, h = parseFloat(grupo.alto) || 0;
                                                        return (
                                                            <div key={grupo.archivoId} className="bg-white border border-amber-200 rounded-lg mb-2 overflow-hidden">
                                                                <div className="px-4 py-2 bg-amber-50/60 border-b border-amber-100 flex items-center gap-2 flex-wrap">
                                                                    <i className="fa-regular fa-file text-amber-500"></i>
                                                                    {/* El nombre abre el ARCHIVO ORIGINAL (no la miniatura) en otra pestaña */}
                                                                    {grupo.archivoUrl ? (
                                                                        <a href={resolverUrl(grupo.archivoUrl)} target="_blank" rel="noreferrer"
                                                                            title="Abrir el archivo original"
                                                                            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline truncate">
                                                                            {grupo.nombre || 'Archivo'}
                                                                        </a>
                                                                    ) : (
                                                                        <span className="text-[11px] font-bold text-slate-600 truncate">{grupo.nombre || 'Archivo'}</span>
                                                                    )}
                                                                    {w > 0 && h > 0 && (
                                                                        <span className="text-[10px] font-black text-slate-400">{w.toFixed(2)} × {h.toFixed(2)} m</span>
                                                                    )}
                                                                    {grupo.copias > 1 && (
                                                                        <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">×{grupo.copias} copias</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex gap-4 p-3 items-start flex-wrap md:flex-nowrap">
                                                                    {/* EL BOCETO: cómo lo pidió el cliente */}
                                                                    {w > 0 && h > 0 && (
                                                                        <div className="shrink-0 bg-slate-900 rounded-lg p-2 text-slate-300">
                                                                            <PlanoPieza anchoM={w} altoM={h} capas={capas} size="md"
                                                                                arteUrl={arteDeArchivo(grupo)} />
                                                                        </div>
                                                                    )}
                                                                    <div className="flex-1 min-w-0 divide-y divide-slate-100">
                                                                        {grupo.items.map((t, i) => {
                                                                            const hecha = t.Estado === 'Hecha';
                                                                            const unidad = t.UnidadCobro === 'M2' ? 'm²' : t.UnidadCobro === 'M' ? 'm' : 'u.';
                                                                            const editada = magnitudes[t.ID];
                                                                            return (
                                                                                <div key={t.ID} className={`flex items-center gap-3 py-2 ${hecha ? 'opacity-80' : ''}`}>
                                                                                    <button
                                                                                        onClick={() => !isFinished && toggleTerminacion(ord.OrdenID, t)}
                                                                                        disabled={isFinished}
                                                                                        className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${hecha
                                                                                            ? 'bg-emerald-500 border-emerald-500 text-white'
                                                                                            : 'bg-white border-slate-300 text-transparent hover:border-emerald-400'}`}
                                                                                        title={hecha ? 'Marcar pendiente' : 'Marcar hecha'}>
                                                                                        <i className="fa-solid fa-check text-xs"></i>
                                                                                    </button>
                                                                                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLOR_CAPA[i % COLOR_CAPA.length] }} />
                                                                                    <div className="flex-1 min-w-0">
                                                                                        <p className={`text-sm font-bold ${hecha ? 'text-emerald-700' : 'text-slate-700'}`}>
                                                                                            {t.Nombre}
                                                                                            {t.Ubicacion && <span className="ml-1.5 text-[10px] font-black uppercase text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">{labelUbicacion(String(t.Ubicacion).trim())}</span>}
                                                                                        </p>
                                                                                        {t.Param > 0 && (
                                                                                            <p className="text-[10px] text-slate-400">
                                                                                                {t.ReglaCantidad === 'CADA_X_CM' ? `uno cada ${t.Param} cm` : (/bolsillo/i.test(t.Nombre || '') ? `a ${t.Param} cm del borde` : '')}
                                                                                            </p>
                                                                                        )}
                                                                                    </div>
                                                                                    {/* Magnitud real del trabajo */}
                                                                                    <span className="flex items-center gap-1 shrink-0">
                                                                                        <input type="number" min="0"
                                                                                            step={t.UnidadCobro === 'U' ? 1 : 0.01}
                                                                                            value={editada !== undefined ? editada : (parseFloat(t.Cantidad) || 0)}
                                                                                            onChange={e => setMagnitudes(prev => ({ ...prev, [t.ID]: e.target.value }))}
                                                                                            disabled={isFinished}
                                                                                            title="Cantidad real del trabajo — al confirmar se actualiza la cotización"
                                                                                            className={`w-20 px-2 py-1 text-sm font-black text-center bg-white border rounded outline-none ${editada !== undefined && parseFloat(editada) !== parseFloat(t.Cantidad)
                                                                                                ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-slate-200 text-slate-700'}`} />
                                                                                        <span className="text-[10px] font-black text-slate-400 w-5">{unidad}</span>
                                                                                    </span>
                                                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${hecha ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                                        {t.Estado}
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* TABLA DE MATERIALES EXTRAS (legacy: órdenes-extra viejas) */}
                                            {(extras.length > 0 || terminaciones.length === 0) && (
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
                                            )}

                                            {/* CONTEO DE COPIAS POR ARCHIVO (solo Control): cuántas
                                                unidades de cada arte se controlaron (3 del arte A, 5 del B).
                                                La aprobación exige el conteo completo de TODOS los archivos. */}
                                            {esControl && (det.archivos || []).length > 0 && (
                                                <div className="mb-4">
                                                    <h4 className="text-xs font-black text-emerald-600 uppercase tracking-wider mb-2">
                                                        <i className="fa-solid fa-list-ol mr-1.5"></i>
                                                        Copias controladas por archivo
                                                    </h4>
                                                    <div className="bg-white border border-emerald-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                                                        {det.archivos.map(a => {
                                                            const completo = (a.Controladas || 0) >= (a.Copias || 0);
                                                            return (
                                                                <div key={a.ArchivoID} className={`flex items-center gap-3 px-4 py-2.5 ${completo ? 'bg-emerald-50/60' : ''}`}>
                                                                    <p className="flex-1 min-w-0 text-xs font-bold text-slate-600 truncate" title={a.NombreArchivo}>
                                                                        <i className="fa-regular fa-file mr-1.5 text-slate-400"></i>
                                                                        {a.NombreArchivo}
                                                                    </p>
                                                                    <input
                                                                        key={`cca-${a.ArchivoID}-${a.Controladas ?? 0}`}
                                                                        type="number" min={0} max={a.Copias}
                                                                        defaultValue={a.Controladas ?? 0}
                                                                        onBlur={(e) => saveControlCopiasArchivo(ord.OrdenID, a.ArchivoID, e.target.value)}
                                                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                                                        title="Escribí la cantidad controlada de este arte"
                                                                        className="w-14 text-right text-base font-black text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                    />
                                                                    <span className="text-sm font-bold text-slate-400 w-10">/ {a.Copias}</span>
                                                                    <button
                                                                        onClick={() => saveControlCopiasArchivo(ord.OrdenID, a.ArchivoID, (a.Controladas || 0) + 1)}
                                                                        disabled={completo}
                                                                        className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center shadow-sm transition-all active:scale-95"
                                                                        title="Sumar una copia controlada"
                                                                    >
                                                                        <i className="fa-solid fa-plus text-xs"></i>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* BULTOS A DESPACHAR (solo Control): cuántos paquetes
                                                físicos salen. El bulto con el que llegó el material
                                                impreso se consume, así que no se despacha dos veces. */}
                                            {esControl && (
                                                <div className="flex items-center justify-end gap-2 pb-2">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Bultos a despachar</span>
                                                    <input
                                                        type="number" min={1}
                                                        value={bultosPorOrden[ord.OrdenID] ?? 1}
                                                        onChange={(e) => setBultosPorOrden(prev => ({ ...prev, [ord.OrdenID]: e.target.value }))}
                                                        title="Cantidad de paquetes en los que se envía el trabajo terminado"
                                                        className="w-16 text-right text-base font-black text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    />
                                                    <span className="text-[10px] text-slate-400">se generan sus etiquetas</span>
                                                </div>
                                            )}

                                            {/* ACTIONS — en Control, Aprobar aparece recién con el
                                                conteo de copias COMPLETO en todos los archivos. */}
                                            {!isFinished && (() => {
                                                const archivosCtl = det.archivos || [];
                                                const conteoCompleto = archivosCtl.length === 0
                                                    || archivosCtl.every(a => (a.Controladas || 0) >= (a.Copias || 0));
                                                if (esControl && !conteoCompleto) {
                                                    const contadas = archivosCtl.reduce((s, a) => s + (a.Controladas || 0), 0);
                                                    const total = archivosCtl.reduce((s, a) => s + (a.Copias || 0), 0);
                                                    return (
                                                        <div className="flex justify-end pt-2">
                                                            <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                                <i className="fa-solid fa-circle-info mr-1.5"></i>
                                                                Contá todas las copias para aprobar ({contadas}/{total})
                                                            </p>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div className="flex justify-end pt-2">
                                                        <button
                                                            onClick={() => {
                                                                const msg = esControl
                                                                    ? `¿Aprobar el control? Se generan ${parseInt(bultosPorOrden[ord.OrdenID], 10) || 1} bulto(s) del producto terminado en la orden de impresión (quedan listos para despachar a Depósito) y esta orden de terminaciones se cierra.`
                                                                    : "¿Confirmar que el trabajo está terminado? La orden pasa a Control y Calidad.";
                                                                if (window.confirm(msg)) {
                                                                    handleFinishOrder(ord.OrdenID);
                                                                }
                                                            }}
                                                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm shadow-emerald-200 transition-all flex items-center gap-2"
                                                        >
                                                            <i className={`fa-solid ${esControl ? 'fa-clipboard-check' : 'fa-check'}`}></i>
                                                            {esControl ? 'Aprobar Control' : 'Finalizar Tarea'}
                                                        </button>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
        <OrdenProntaModal
            data={completedOrderData}
            onImprimir={() => {
                const id = completedOrderData?.ordenId;
                setCompletedOrderData(null);
                if (id) printLabelsHelper(null, { id });
            }}
            onClose={() => setCompletedOrderData(null)}
        />
        </>
    );
};

export default EcoUvFinishing;
