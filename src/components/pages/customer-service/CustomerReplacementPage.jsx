import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    RotateCcw, Search, Loader2, Inbox, X, ExternalLink, ClipboardCheck, CheckCircle2, Check, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { fileControlService } from '../../../services/modules/fileControlService';
import { useAuth } from '../../../context/AuthContext';
import useConfirmar from '../../ui/useConfirmar';
import Selector from '../../ui/Selector';

// Estética nueva (23/10/2026, como Reportes y Logística): encabezado con ícono Lucide en brand-cyan y título en
// mayúsculas, la búsqueda y la orden en tarjetas blancas, lo elegido marcado en brand-cyan, campos con el mismo
// estilo del resto y «Generar reposición» como botón principal. En el celular se ve la lista o la orden, una a la vez.
// Los avisos pasan del Toast propio a sonner y el confirm() del navegador a useConfirmar. Lógica sin cambios.
// Razón principal (23/10): una por reposición, de los tipos de falla marcados «para reposiciones» del área de la
// orden o General (se administran en /admin/tipos-falla). Obligatoria si hay alguna cargada; el backend la valida.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const ROTULO = 'block text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1';
const CAMPO = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 placeholder:text-zinc-400 placeholder:font-normal focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

// Listas de a 50 (patrón useDeAPoco de Reportes): al acercarse al final se agregan 50 más; vuelve a 50 cuando
// cambia la lista. El margen de 600 px se mide contra el contenedor que scrollea de verdad.
const DE_A = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(lista) {
    const [cuantos, setCuantos] = useState(DE_A);
    useEffect(() => { setCuantos(DE_A); }, [lista]);
    const centinela = useRef(null);
    const total = lista.length;
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        }, { root: contenedorConScroll(el), rootMargin: '0px 0px 600px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total]);
    return [Math.min(cuantos, total), centinela];
}

// Avisos con sonner (antes el Toast propio de ui/Toast). Los del tope de metros/copias llevan id fijo: salen al
// tipear, y así se reemplazan en vez de apilarse uno por tecla.
const avisar = (message, type = 'info', id) => {
    const fn = type === 'error' ? toast.error : type === 'warning' ? toast.warning : type === 'success' ? toast.success : toast.info;
    fn(message, id ? { id } : undefined);
};

// ── Borrador (08/10/2026) ────────────────────────────────────────────────────
// Lo que se va armando (búsqueda, orden, archivos marcados, metros, copias,
// observaciones) se guarda en el navegador, por usuario. Si la página se recarga
// (p. ej. el reinicio del servidor en un deploy recarga todas las pantallas abiertas)
// o se va a otra pantalla y se vuelve, la reposición sigue donde estaba.
// Se borra al generarla o al cerrar la orden con la X. Vence a las 12 h.
const VIDA_BORRADOR_MS = 12 * 60 * 60 * 1000;
const claveBorrador = (uid) => `reposicion-borrador:${uid ?? 'anon'}`;
const leerBorrador = (uid) => {
    try {
        const b = JSON.parse(localStorage.getItem(claveBorrador(uid)) || 'null');
        if (!b || b.v !== 1 || !(Date.now() - b.ts < VIDA_BORRADOR_MS)) return null;
        return b;
    } catch { return null; }
};
const guardarBorrador = (uid, datos) => {
    try { localStorage.setItem(claveBorrador(uid), JSON.stringify({ v: 1, ts: Date.now(), ...datos })); } catch { /* sin storage: sigue sin borrador */ }
};
const borrarBorrador = (uid) => {
    try { localStorage.removeItem(claveBorrador(uid)); } catch { /* idem */ }
};

const CustomerReplacementPage = () => {
    const { user } = useAuth();
    const uid = user?.id;
    const [confirmar, ventanaConfirmar] = useConfirmar();
    // Se lee una sola vez, al montar: el estado arranca desde el borrador (si hay),
    // así nunca hay un render "vacío" que lo pise antes de restaurarlo.
    const borradorInicial = useRef(undefined);
    if (borradorInicial.current === undefined) borradorInicial.current = leerBorrador(uid);
    const bi = borradorInicial.current;

    // Search & Results
    const [query, setQuery] = useState(() => bi?.query || '');
    const [orders, setOrders] = useState(() => bi?.orders || []);
    const [loadingSearch, setLoadingSearch] = useState(false);

    // Selection
    const [selectedOrder, setSelectedOrder] = useState(() => bi?.selectedOrder || null);
    const [files, setFiles] = useState([]);
    const [relatedOrders, setRelatedOrders] = useState([]); // Services
    const [loadingFiles, setLoadingFiles] = useState(() => !!bi?.selectedOrder);

    // Replacement Form
    const [selectedFileIds, setSelectedFileIds] = useState(() => bi?.selectedFileIds || []);
    const [selectedRelatedOrderIds, setSelectedRelatedOrderIds] = useState(() => bi?.selectedRelatedOrderIds || []);
    const [replacementDetails, setReplacementDetails] = useState(() => bi?.replacementDetails || {}); // { fileId: { meters: '', obs: '' } }
    const [globalObs, setGlobalObs] = useState(() => bi?.globalObs || '');
    const [razonId, setRazonId] = useState(() => bi?.razonId || '');
    const [razones, setRazones] = useState([]);
    const [cargandoRazones, setCargandoRazones] = useState(false);
    const [faltaRazon, setFaltaRazon] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // UI
    const [successData, setSuccessData] = useState(null);
    const [cuantasOrdenes, centinelaOrdenes] = useDeAPoco(orders);

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
            avisar('Error buscando órdenes', 'error');
        } finally {
            setLoadingSearch(false);
        }
    }, [query]);

    // Sin tiempo real a propósito: la lista se actualiza solo cuando el operario busca.
    // (Antes escuchaba los avisos de socket de cualquier orden de la planta y cada uno
    // cerraba la orden abierta y borraba lo cargado.)

    // --- Select Order ---
    // Trae archivos y servicios relacionados de la orden. Devuelve lo cargado, o null si falló.
    const cargarDetalleOrden = async (order) => {
        setLoadingFiles(true);
        setRelatedOrders([]);
        try {
            const [data, related] = await Promise.all([
                fileControlService.getArchivosPorOrden(order.OrdenID),
                fileControlService.getRelatedOrders(order.OrdenID)
            ]);
            const archivos = data || [];
            // Las órdenes de FALLA (-F) son internas/efímeras: no se reponen, así que no se ofrecen
            // como "orden relacionada" para reponer (evita generar una -R de la falla).
            // Tampoco la hermana de terminaciones (TERMINAC): el servidor la crea solo, con sus
            // terminaciones, cuando el archivo ECOUV repuesto las lleva.
            const relacionadas = (related || []).filter(o =>
                !(o.CodigoOrden || '').includes('-F') && String(o.AreaID || '').trim().toUpperCase() !== 'TERMINAC');
            setFiles(archivos);
            setRelatedOrders(relacionadas);
            return { archivos, relacionadas };
        } catch (error) {
            console.error(error);
            avisar('Error cargando archivos', 'error');
            return null;
        } finally {
            setLoadingFiles(false);
        }
    };

    const handleSelectOrder = async (order) => {
        setSelectedOrder(order);
        setSelectedFileIds([]);
        setSelectedRelatedOrderIds([]);
        setReplacementDetails({});
        setRazonId('');
        setFaltaRazon(false);
        await cargarDetalleOrden(order);
    };

    // Cerrar la orden (X): se descarta lo marcado para ella, y con eso el borrador de la reposición.
    const cerrarOrden = () => {
        setSelectedOrder(null);
        setSelectedFileIds([]);
        setSelectedRelatedOrderIds([]);
        setReplacementDetails({});
        setGlobalObs('');
        setRazonId('');
        setFaltaRazon(false);
    };

    // Razones de reposición del área de la orden (más las generales). Si la elegida ya no está (se desactivó),
    // se limpia. Sin AreaID (un borrador de antes) trae todas: igual el backend valida contra el área real.
    const areaOrden = selectedOrder?.AreaID || '';
    const ordenElegidaId = selectedOrder?.OrdenID;
    useEffect(() => {
        if (!ordenElegidaId) { setRazones([]); return undefined; }
        let vivo = true;
        setCargandoRazones(true);
        fileControlService.getTiposFalla(areaOrden || undefined, 'reposicion')
            .then((lista) => {
                if (!vivo) return;
                const r = lista || [];
                setRazones(r);
                setRazonId(prev => (prev && r.some(x => String(x.FallaID) === String(prev)) ? prev : ''));
            })
            .catch((e) => { console.error(e); if (vivo) { setRazones([]); avisar('No se pudieron cargar las razones de reposición', 'error'); } })
            .finally(() => { if (vivo) setCargandoRazones(false); });
        return () => { vivo = false; };
    }, [ordenElegidaId, areaOrden]);

    // Al volver con un borrador: recargar la orden del servidor y quedarse solo con lo marcado
    // que sigue existiendo (un archivo o servicio pudo cambiar mientras tanto).
    useEffect(() => {
        if (!bi?.selectedOrder) return;
        let vivo = true;
        cargarDetalleOrden(bi.selectedOrder).then((r) => {
            if (!vivo || !r) return;
            const idsArchivos = new Set(r.archivos.map(f => f.ArchivoID));
            const idsRelacionadas = new Set(r.relacionadas.map(o => o.OrdenID));
            setSelectedFileIds(prev => prev.filter(id => idsArchivos.has(id)));
            setReplacementDetails(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => idsArchivos.has(Number(id)))));
            setSelectedRelatedOrderIds(prev => prev.filter(id => idsRelacionadas.has(id)));
            avisar('Se recuperó la reposición que estabas armando', 'info');
        });
        return () => { vivo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Guardar el borrador con cada cambio. Sin nada cargado, no queda borrador.
    useEffect(() => {
        if (!selectedOrder && orders.length === 0 && !query) { borrarBorrador(uid); return; }
        guardarBorrador(uid, { query, orders, selectedOrder, selectedFileIds, selectedRelatedOrderIds, replacementDetails, globalObs, razonId });
    }, [uid, query, orders, selectedOrder, selectedFileIds, selectedRelatedOrderIds, replacementDetails, globalObs, razonId]);

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
                avisar(`No podés reponer más de ${maxMeters.toFixed(2)} m (metros originales)`, 'warning', `tope-metros-${fileId}`);
                value = maxMeters.toString();
            }
        }
        if (field === 'copies') {
            const fileData = files.find(f => f.ArchivoID === fileId);
            const maxCopies = parseInt(fileData?.Copias || 0);
            const val = parseInt(value);
            if (!isNaN(val) && maxCopies > 0 && val > maxCopies) {
                avisar(`No podés reponer más de ${maxCopies} copias (copias originales)`, 'warning', `tope-copias-${fileId}`);
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
            avisar('Seleccione al menos un archivo o servicio', 'warning');
            return;
        }
        if (razones.length > 0 && !razonId) {
            setFaltaRazon(true);
            avisar('Elegí la razón principal de la reposición', 'warning');
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
                avisar(`El archivo "${fileData?.NombreArchivo}" supera los metros originales (${maxMeters} m)`, 'error');
                return null; // Flag error
            }
            if (copiesVal > maxCopies && maxCopies > 0) {
                avisar(`El archivo "${fileData?.NombreArchivo}" supera las copias originales (${maxCopies})`, 'error');
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
            if (!(await confirmar({
                titulo: 'Hay archivos con 0 metros',
                texto: 'Algunos archivos tienen 0 metros. ¿Continuar igual?',
                confirmar: 'Continuar',
            }))) return;
        }

        setSubmitting(true);
        try {
            const payload = {
                originalOrderId: selectedOrder.OrdenID,
                files: items, // { id, meters, copies, obs }
                relatedOrderIds: selectedRelatedOrderIds,
                globalObservation: globalObs,
                razonId: razonId ? Number(razonId) : null,
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
                setSelectedRelatedOrderIds([]);
                setReplacementDetails({});
                setRazonId('');
                setGlobalObs(''); // con todo vacío, el efecto de guardado borra el borrador
            } else {
                avisar('Error al crear reposición', 'error');
            }

        } catch (error) {
            console.error(error);
            const msg = error.response?.data?.error || error.message || 'Error de conexión';
            avisar(`Error: ${msg}`, 'error');
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

    const cantidadElegida = selectedFileIds.length + selectedRelatedOrderIds.length;
    const nadaElegido = cantidadElegida === 0;

    // --- RENDER ---
    return (
        <div className="min-h-full md:h-full flex flex-col gap-3 md:gap-4 bg-slate-50 p-3 md:p-6 md:overflow-hidden text-zinc-800">

            {/* Encabezado */}
            <div className="flex items-center gap-3 min-w-0 shrink-0">
                <RotateCcw size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div className="min-w-0">
                    <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight leading-tight">Reposiciones</h1>
                    <p className="text-sm text-zinc-400">Atención al Cliente · repetí archivos o servicios de una orden entregada</p>
                </div>
            </div>

            {/* En el celular, la lista o la orden (una a la vez); en escritorio, una al lado de la otra */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 md:gap-4">

                {/* LEFT: Search Panel */}
                <aside className={`${CARD} w-full md:w-96 shrink-0 flex-col md:overflow-hidden ${selectedOrder ? 'hidden md:flex' : 'flex'}`}>
                    <div className="p-3 md:p-4 border-b border-zinc-100">
                        <form onSubmit={handleSearch} className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                className={`${CAMPO} pl-9 pr-20`}
                                placeholder="Orden o cliente…"
                                aria-label="Buscar orden o cliente"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                autoFocus
                            />
                            <button
                                type="submit"
                                disabled={query.length < 3 || loadingSearch}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Buscar
                            </button>
                        </form>
                        <p className="text-[11px] text-zinc-400 mt-1.5">
                            {orders.length > 0 && <b className="font-bold text-zinc-500">{orders.length} {orders.length === 1 ? 'orden' : 'órdenes'} · </b>}
                            Solo entregadas o finalizadas · mín. 3 letras
                        </p>
                    </div>

                    <div className="flex-1 min-h-0 md:overflow-y-auto p-3">
                        {loadingSearch ? (
                            <div className="py-12 flex flex-col items-center gap-3">
                                <Loader2 size={28} className="animate-spin text-brand-cyan" />
                                <span className="text-sm text-zinc-400">Buscando órdenes...</span>
                            </div>
                        ) : orders.length === 0 ? (
                            <div className="py-12 px-4 flex flex-col items-center gap-2 text-center">
                                <Inbox size={40} className="text-zinc-200" />
                                <p className="text-sm text-zinc-400">Buscá por número de orden o cliente</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {orders.slice(0, cuantasOrdenes).map(order => {
                                    const elegida = selectedOrder?.OrdenID === order.OrdenID;
                                    return (
                                        <button
                                            type="button"
                                            key={order.OrdenID}
                                            onClick={() => handleSelectOrder(order)}
                                            className={`w-full text-left p-3.5 rounded-xl border transition-colors
                                                ${elegida
                                                    ? 'border-brand-cyan bg-brand-cyan/5 ring-2 ring-brand-cyan/15'
                                                    : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'}`}
                                        >
                                            <div className="flex justify-between items-start gap-2">
                                                <span className="font-black text-zinc-800 tracking-tight">
                                                    #{order.NoDocERP || order.CodigoOrden}
                                                </span>
                                                <span className={`${CHIP} uppercase shrink-0 ${order.Estado === 'ENTREGADO' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>
                                                    {order.Estado}
                                                </span>
                                            </div>
                                            <p className="text-sm font-bold text-zinc-700 truncate mt-1">{order.IDCliente}</p>
                                            <p className="text-xs text-zinc-500 truncate">{order.Material}</p>
                                            <p className="text-[11px] text-zinc-400 font-mono mt-1.5">{order.CodigoOrden}</p>
                                        </button>
                                    );
                                })}
                                {cuantasOrdenes < orders.length && (
                                    <div ref={centinelaOrdenes} className="py-3 text-center text-xs text-zinc-400">
                                        Mostrando {cuantasOrdenes} de {orders.length}…
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </aside>

                {/* RIGHT: Details & Form */}
                <section className={`${CARD} flex-1 min-w-0 flex-col md:overflow-hidden ${selectedOrder ? 'flex' : 'hidden md:flex'}`}>
                    {selectedOrder ? (
                        <>
                            {/* Order Info Header */}
                            <div className="px-4 md:px-6 py-4 border-b border-zinc-200 flex justify-between items-start gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h2 className="text-xl md:text-2xl font-black text-zinc-800 tracking-tight break-all">{selectedOrder.CodigoOrden}</h2>
                                        {(selectedOrder.NoDocERP) && (
                                            <span className={`${CHIP} bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20 tabular-nums`}>Pedido {selectedOrder.NoDocERP}</span>
                                        )}
                                    </div>
                                    <p className="font-bold text-zinc-700 mt-0.5">{selectedOrder.Cliente}</p>
                                    {selectedOrder.DescripcionTrabajo && (
                                        <p className="text-sm text-zinc-500 mt-0.5 max-w-2xl">{selectedOrder.DescripcionTrabajo}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={cerrarOrden}
                                    className="w-9 h-9 shrink-0 rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 flex items-center justify-center transition-colors"
                                    title="Cerrar orden (descarta lo marcado)"
                                    aria-label="Cerrar orden"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Files List */}
                            <div className="flex-1 min-h-0 md:overflow-y-auto p-4 md:p-6 space-y-6 bg-zinc-50/60">

                                {/* SECTION 1: ARCHIVOS */}
                                <div>
                                    {loadingFiles ? (
                                        <div className="py-12 flex flex-col items-center gap-3">
                                            <Loader2 size={28} className="animate-spin text-brand-cyan" />
                                            <span className="text-sm text-zinc-400">Cargando archivos...</span>
                                        </div>
                                    ) : files.length === 0 ? (
                                        <div className={`${CARD} py-12 px-4 flex flex-col items-center gap-2 text-center`}>
                                            <Inbox size={40} className="text-zinc-200" />
                                            <p className="text-sm text-zinc-400">Orden sin archivos</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="text-[11px] font-black uppercase tracking-wide text-zinc-400">Archivos a reponer</h3>
                                                {selectedFileIds.length > 0 && (
                                                    <span className={`${CHIP} bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20`}>
                                                        {selectedFileIds.length} {selectedFileIds.length === 1 ? 'elegido' : 'elegidos'}
                                                    </span>
                                                )}
                                            </div>

                                            {files.map(file => {
                                                const isSelected = selectedFileIds.includes(file.ArchivoID);
                                                const details = replacementDetails[file.ArchivoID] || {};
                                                const idCasilla = `archivo-${file.ArchivoID}`;

                                                return (
                                                    <div
                                                        key={file.ArchivoID}
                                                        className={`bg-white rounded-xl border transition-colors
                                                            ${isSelected ? 'border-brand-cyan ring-2 ring-brand-cyan/15' : 'border-zinc-200 hover:border-zinc-300'}`}
                                                    >
                                                        <div className="flex gap-3 p-3.5 md:p-4">
                                                            <input
                                                                id={idCasilla}
                                                                type="checkbox"
                                                                className="mt-0.5 w-4 h-4 shrink-0 rounded accent-brand-cyan cursor-pointer"
                                                                checked={isSelected}
                                                                onChange={() => toggleFileSelection(file.ArchivoID)}
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-start justify-between gap-3">
                                                                    {/* El nombre también marca el archivo */}
                                                                    <label htmlFor={idCasilla} className="font-bold text-sm text-zinc-800 break-all cursor-pointer">{file.NombreArchivo}</label>
                                                                    <a
                                                                        href={file.urlProxy || file.RutaAlmacenamiento || '#'}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="inline-flex items-center gap-1 shrink-0 text-xs font-bold text-brand-cyan hover:underline"
                                                                    >
                                                                        <ExternalLink size={13} /> Ver
                                                                    </a>
                                                                </div>
                                                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                                                    <span className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200 tabular-nums`}>
                                                                        {parseFloat(file.Ancho).toFixed(2)}×{parseFloat(file.Alto).toFixed(2)} m
                                                                    </span>
                                                                    {file.Material && (
                                                                        <span className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200`}>{file.Material}</span>
                                                                    )}
                                                                    <span className="text-[11px] text-zinc-400 tabular-nums">
                                                                        Original: {parseFloat(file.Metros || 0).toFixed(2)} m · {file.Copias} un.
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {isSelected && (
                                                            <div className="px-3.5 md:px-4 pb-4 pt-3 border-t border-zinc-100 grid grid-cols-2 lg:grid-cols-[170px_130px_minmax(0,1fr)] gap-3 animate-in slide-in-from-top-2 duration-200">
                                                                <div>
                                                                    <label className={ROTULO}>
                                                                        Metros a reponer
                                                                        <span className="ml-1 normal-case font-medium tracking-normal">(máx. {parseFloat(file.Metros || 0).toFixed(2)})</span>
                                                                    </label>
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        min="0.01"
                                                                        max={parseFloat(file.Metros || 0)}
                                                                        className={`${CAMPO} tabular-nums`}
                                                                        placeholder={`Ej: ${parseFloat(file.Metros || 0).toFixed(2)}`}
                                                                        value={details.meters ?? ''}
                                                                        onChange={e => updateDetail(file.ArchivoID, 'meters', e.target.value)}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={ROTULO}>
                                                                        Copias
                                                                        <span className="ml-1 normal-case font-medium tracking-normal">(máx. {file.Copias})</span>
                                                                    </label>
                                                                    <input
                                                                        type="number"
                                                                        step="1"
                                                                        min="1"
                                                                        max={parseInt(file.Copias || 1)}
                                                                        className={`${CAMPO} tabular-nums`}
                                                                        placeholder={`${file.Copias}`}
                                                                        value={details.copies ?? parseInt(file.Copias || 1)}
                                                                        onChange={e => updateDetail(file.ArchivoID, 'copies', e.target.value)}
                                                                    />
                                                                </div>
                                                                <div className="col-span-2 lg:col-span-1">
                                                                    <label className={ROTULO}>Motivo / observación de la falla</label>
                                                                    <input
                                                                        type="text"
                                                                        className={`${CAMPO} font-medium`}
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
                                    <div className="pt-5 border-t border-zinc-200">
                                        <div className="flex items-start justify-between gap-2 mb-3">
                                            <div className="min-w-0">
                                                <h3 className="text-[11px] font-black uppercase tracking-wide text-zinc-400 flex items-center gap-1.5">
                                                    <Layers size={13} className="text-brand-cyan" /> Otros servicios relacionados
                                                </h3>
                                                <p className="text-xs text-zinc-400 mt-0.5">Seleccione los servicios que también deben repetirse</p>
                                            </div>
                                            {selectedRelatedOrderIds.length > 0 && (
                                                <span className={`${CHIP} shrink-0 bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20`}>
                                                    {selectedRelatedOrderIds.length} {selectedRelatedOrderIds.length === 1 ? 'elegido' : 'elegidos'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                            {relatedOrders.map(relOrder => {
                                                const isSel = selectedRelatedOrderIds.includes(relOrder.OrdenID);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={relOrder.OrdenID}
                                                        onClick={() => toggleRelatedOrderSelection(relOrder.OrdenID)}
                                                        aria-pressed={isSel}
                                                        className={`w-full text-left p-3 rounded-xl border flex items-center gap-3 transition-colors
                                                            ${isSel ? 'bg-white border-brand-cyan ring-2 ring-brand-cyan/15' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}
                                                    >
                                                        <span className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center transition-colors
                                                            ${isSel ? 'bg-brand-cyan border-brand-cyan text-white' : 'border-zinc-300 bg-white'}`}>
                                                            {isSel && <Check size={12} strokeWidth={3} />}
                                                        </span>
                                                        <span className="flex-1 min-w-0">
                                                            <span className="flex justify-between items-center gap-2">
                                                                <span className="font-bold text-sm text-zinc-800 truncate">{relOrder.CodigoOrden}</span>
                                                                <span className={`${CHIP} shrink-0 bg-zinc-100 text-zinc-600 border-zinc-200 uppercase`}>{relOrder.AreaID}</span>
                                                            </span>
                                                            <span className="block text-xs text-zinc-500 truncate mt-0.5" title={relOrder.DescripcionTrabajo}>{relOrder.DescripcionTrabajo}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer Action: razón principal, observación general y el botón, en una franja */}
                            {/* Hasta 1536 px: razón y botón arriba, la observación abajo a todo el ancho (en una fila sola, en una notebook la observación quedaba angostísima) */}
                            <div className="p-4 md:px-6 md:py-4 border-t border-zinc-200 bg-white rounded-b-2xl grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] 2xl:grid-cols-[18rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
                                <div className="min-w-0">
                                    <label className={ROTULO}>
                                        Razón principal{razones.length > 0 && <span className="text-rose-500"> *</span>}
                                    </label>
                                    <div className={`rounded-xl ${faltaRazon ? 'ring-2 ring-rose-300' : ''}`}>
                                        <Selector
                                            value={razonId}
                                            onChange={e => { setRazonId(e.target.value); setFaltaRazon(false); }}
                                            disabled={cargandoRazones || razones.length === 0}
                                            aria-label="Razón principal de la reposición"
                                            className="w-full"
                                            altoMax={460}
                                        >
                                            <option value="">{cargandoRazones ? 'Cargando razones…' : razones.length === 0 ? 'Sin razones cargadas' : 'Elegí la razón…'}</option>
                                            {razones.map(rz => (
                                                <option key={rz.FallaID} value={String(rz.FallaID)} descripcion={rz.DescripcionDefault || undefined}>{rz.Titulo}</option>
                                            ))}
                                        </Selector>
                                    </div>
                                    <p className={`text-[11px] mt-1 h-4 ${faltaRazon ? 'text-rose-600' : 'text-zinc-400'}`}>
                                        {faltaRazon ? 'Elegí la razón principal' : (!cargandoRazones && razones.length === 0 ? 'Se cargan en Tipos de falla' : '')}
                                    </p>
                                </div>
                                <div className="min-w-0 md:col-span-2 md:order-last 2xl:order-none 2xl:col-span-1">
                                    <label className={ROTULO} htmlFor="reposicion-obs-general">Observación general para la orden de falla</label>
                                    <textarea
                                        id="reposicion-obs-general"
                                        className={`${CAMPO} font-medium resize-none h-[72px]`}
                                        placeholder="Ej: Cliente reclama por decoloración en..."
                                        value={globalObs}
                                        onChange={e => setGlobalObs(e.target.value)}
                                    ></textarea>
                                </div>
                                {/* Rótulo invisible: deja el botón a la altura de los campos de al lado */}
                                <div className="shrink-0">
                                <span className={`${ROTULO} hidden md:block invisible`} aria-hidden="true">.</span>
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={submitting || nadaElegido}
                                    className={`${BTN_PRINCIPAL} w-full md:w-auto shrink-0 md:h-[42px] 2xl:h-[72px] md:px-6`}
                                >
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                                    Generar reposición{!nadaElegido && ` (${cantidadElegida})`}
                                </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-2 p-10 text-center">
                            <ClipboardCheck size={40} className="text-zinc-200" />
                            <h3 className="text-base font-black text-zinc-500">Seleccioná una orden</h3>
                            <p className="max-w-xs text-sm text-zinc-400">Buscá una orden entregada en la lista para ver sus archivos y armar la reposición.</p>
                        </div>
                    )}
                </section>
            </div>

            {/* Success Modal: en portal y z-[6000] (con z-50 quedaba debajo de la barra de arriba) */}
            {successData && createPortal(
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4">
                    <div role="dialog" aria-modal="true" className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-sm w-full p-6 md:p-8 text-center animate-in zoom-in-95 duration-200">
                        <CheckCircle2 size={48} className="mx-auto mb-4 text-emerald-500" aria-hidden="true" />
                        <h2 className="text-xl font-black text-zinc-800 mb-1">Reposición creada</h2>
                        <p className="text-sm text-zinc-500 mb-5">Se generó la nueva orden de reposición.</p>

                        <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-4 py-3 mb-5">
                            <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-0.5">Código de orden</div>
                            <div className="text-xl font-black text-zinc-800 font-mono">{successData.newCode}</div>
                            {successData.hermanaTerminaciones && (
                                <div className="text-xs font-bold text-zinc-500 mt-1.5">
                                    + {successData.hermanaTerminaciones} para Terminaciones
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setSuccessData(null)}
                            className={`${BTN_PRINCIPAL} w-full`}
                            autoFocus
                        >
                            Aceptar
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {ventanaConfirmar}
        </div>
    );
};

export default CustomerReplacementPage;
