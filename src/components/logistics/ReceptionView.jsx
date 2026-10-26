import React, { useState, useRef, useEffect } from 'react';
import Swal from 'sweetalert2';
import api from '../../services/api';
import { socket } from '../../services/socketService';
import { useMutation, useQuery } from '@tanstack/react-query';
import { logisticsService } from '../../services/modules/logisticsService';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import {
    Phone, Send, User, ShoppingBag, Tag, Loader2, XCircle, Search, CheckCircle2, MoveRight, X, Check, Truck,
    PackageCheck, PackageX, ScanLine, ChevronDown, Eraser, SkipForward, MessageCircle, MapPin,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, tarjetas blancas con borde, íconos de
// Lucide en brand-cyan (antes Font Awesome) y el color solo para el estado (recibido / en espera / rechazado).
// El escáner pasó de bloque oscuro a tarjeta clara. En el celular la lista de envíos va arriba en vez de al costado.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_DESTRUCTIVO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors whitespace-nowrap';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ROTULO = 'text-[11px] font-black text-zinc-400 uppercase tracking-wide';
const BADGE = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';

const ReceptionView = ({ onClose, areaContext, areaFilter }) => {
    const { user } = useAuth();
    const currentArea = areaFilter || areaContext || user?.areaKey || user?.areaId;

    // Steps: 1 = Scan/Select Remito, 2 = Process Items
    const [step, setStep] = useState(1);

    // Hybrid Universal Scans (CargaDeposito clone)
    const [recentScans, setRecentScans] = useState([]);
    const [modosMap, setModosMap] = useState({});

    // Data
    const [remitoCode, setRemitoCode] = useState('');
    const [loadedRemito, setLoadedRemito] = useState(null);
    const [itemMap, setItemMap] = useState({}); // { 'CODE': { ...item, scanned: bool } }

    // UI
    const [scanInput, setScanInput] = useState('');
    const [lastScanMsg, setLastScanMsg] = useState(null); // { type: 'success'|'error', text: '' }
    const [loading, setLoading] = useState(false);

    // Manual Selection for Batch Processing
    const [manualSelection, setManualSelection] = useState([]);
    const [showOnlyPending, setShowOnlyPending] = useState(false);

    const inputRef = useRef(null);
    const scannerRef = useRef(null);
    const scanTimeoutRef = useRef(null);
    const lastKeyTime = useRef(Date.now());
    const isScannerRef = useRef(false);

    // --- NEW: Incoming Remitos List ---
    const { data: incomingRemitos, isLoading: loadingIncoming } = useQuery({
        queryKey: ['remitos', 'incoming', currentArea],
        queryFn: () => logisticsService.getIncomingRemitos(currentArea),
        enabled: !!currentArea && currentArea !== 'TODOS',
        refetchInterval: 15000
    });

    // --- MODOS AND WSP SOCKETS ---
    useEffect(() => {
        api.get('/apiordenes/modos').then(res => {
            if (res.data) {
                const map = {};
                res.data.forEach(m => { map[m.MOrIdModoOrden] = m.MOrNombreModo; });
                setModosMap(map);
            }
        }).catch(e => console.error(e));

        const handleWspUpdate = (data) => {
            if (data && data.ordId) {
                setRecentScans(prev => {
                    const idx = prev.findIndex(c => c.idOrden === data.ordId);
                    if (idx < 0) return prev;
                    const newScans = [...prev];
                    const target = { ...newScans[idx] };
                    if (data.status === 'success') {
                        target.status = 'wsp_success';
                        target.message = 'Aviso de WhatsApp enviado correctamente.';
                        setTimeout(() => removeScanRow(target.id), 8000);
                    } else if (data.status === 'error') {
                        target.status = 'wsp_error';
                        target.message = data.reason || 'Error conectando con Callbell.';
                        target.wspError = true;
                    }
                    newScans[idx] = target;
                    return newScans;
                });
            }
        };
        socket.on('actualizado_wsp', handleWspUpdate);
        return () => socket.off('actualizado_wsp', handleWspUpdate);
    }, []);

    const removeScanRow = (id) => setRecentScans(prev => prev.filter(c => c.id !== id));

    const handleUpdatePhone = async (idOrden, cbNuevo) => {
        try {
            await api.post('/apiordenes/update-phone', { ordId: idOrden, nuevoTelefono: cbNuevo });
            setRecentScans(prev => prev.map(c => c.idOrden === idOrden ? { ...c, status: 'wsp_waiting', message: 'Número corregido. Intentando...', wspError: false } : c));
        } catch (error) { toast.error("No se pudo redespachar."); }
    };

    const handleOmitirWsp = async (idOrden) => {
        try {
            await api.post('/apiordenes/omitir-wsp', { ordId: idOrden });
            setRecentScans(prev => prev.map(c => c.idOrden === idOrden ? { ...c, status: 'wsp_success', message: 'WSP omitido.', wspError: false } : c));
            setTimeout(() => removeScanRow(idOrden), 8000); // clear omitido early
        } catch (error) { toast.error("No se pudo omitir el WSP."); }
    };

    // --- UNIVERSAL SCAN (AUTO INGRESO) ---
    const processUniversalScan = async (code, skipAccounting = false) => {
        const scanId = Date.now();
        const isDuplicateMsg = recentScans.some(c => c.value === code && !['wsp_error', 'error'].includes(c.status));
        if (isDuplicateMsg) {
            toast.warning(`El código ${code} ya ha sido procesado.`);
            return;
        }

        setRecentScans(prev => [{ id: scanId, value: code, status: 'loading', message: 'Resolviendo y procesando orden...', parsed: null }, ...prev]);
        
        try {
            // 1. Resolve QR
            let qrString = code;
            let resolvedOrdId = null;
            if (!code.includes('$*')) {
                const resQr = await api.post('/logistics/bultos/resolve-qr', { code });
                qrString = resQr.data.qrString;
                resolvedOrdId = resQr.data.ordenId;
            }

            let parsedData = null;
            try {
                const parseRes = await api.post('/apiordenes/parse-qr', { ordenString: qrString });
                if (parseRes.data.valid) parsedData = parseRes.data.data;
            } catch (e) {}

            setRecentScans(prev => prev.map(c => c.id === scanId ? { ...c, status: 'validating', message: 'Registrando en Stock...', parsed: parsedData } : c));

            // 2. Si fue un bulto, ingresarlo silenciosamente si no estamos en remito mode (esto asegura Tracking Logistico real)
            if (code.startsWith('PAQ-') || code.startsWith('PRE-')) {
                try {
                     await receiveItemMutation.mutateAsync({ envioId: null, codigoEtiqueta: code, usuarioId: user?.id || 1 });
                } catch(e) {} // ignore generic receipt error here if it was done elsewhere
            }

            // 3. Ejecutar Ingreso Nativo (Sheets/Whatsapp)
            const resData = await api.post('/apiordenes/data', { 
                ordenString: qrString, 
                estado: 'Ingresado',
                skipAccounting: skipAccounting
            });
            
            // 4. Update the card
            setRecentScans(prev => prev.map(c => c.id === scanId ? { 
                ...c, 
                status: (resData.status === 202 || resData.data?.hermanaTerminac) ? 'info' : 'wsp_waiting',
                message: resData.data?.hermanaTerminac
                    ? 'Hermana de terminaciones: el ingreso y el aviso los lleva la orden madre.'
                    : (resData.status === 202 ? 'La orden se reingresó exitosamente al depósito.' : 'Orden guardada. Esperando WhatsApp...'),
                idOrden: resData.data.idOrden || resolvedOrdId
            } : c));
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Error inesperado.';
            setRecentScans(prev => prev.map(c => c.id === scanId ? { ...c, status: 'error', message: msg } : c));
            toast.error(msg);
        }
    };

    const renderScanCard = useScanCardRenderer(handleUpdatePhone, handleOmitirWsp, removeScanRow, modosMap);

    // --- STEP 1: FETCH REMITO ---
    const handleSearchRemito = async (e, codeOverride) => {
        if (e) e.preventDefault();
        const code = codeOverride || remitoCode.trim();
        if (!code) return;

        setLoading(true);
        try {
            if (code.toUpperCase().startsWith('REM-')) {
                const data = await logisticsService.getRemitoByCode(code);

                // VALIDATIONS
                if (data.Estado === 'ESPERANDO_RETIRO') {
                    const result = await Swal.fire({
                        icon: 'warning',
                        title: 'Alerta de Seguridad',
                        html: `<p>Este remito aún figura como <strong>'ESPERANDO RETIRO'</strong>.</p><p style="margin-top:8px">El transportista o cadete <strong>NO ha escaneado/validado</strong> la salida de la mercadería.</p>`,
                        showCancelButton: true,
                        confirmButtonText: 'Sí, forzar recepción',
                        cancelButtonText: 'Cancelar',
                        confirmButtonColor: '#e11d48',
                        cancelButtonColor: '#6b7280',
                        reverseButtons: true,
                    });
                    if (!result.isConfirmed) {
                        setRemitoCode('');
                        setLoading(false);
                        return;
                    }
                }

                // AREA VALIDATION
                if (currentArea && data.AreaDestinoID !== currentArea && currentArea !== 'ADMIN' && currentArea !== 'TODOS') {
                    const result = await Swal.fire({
                        icon: 'error',
                        title: 'Área Incorrecta',
                        html: `<p>Este remito está destinado a: <strong>${data.AreaDestinoID}</strong></p><p style="margin-top:8px">Estás recepcionando en: <strong>${currentArea}</strong></p>`,
                        showCancelButton: true,
                        confirmButtonText: 'Sí, recepcionar aquí',
                        cancelButtonText: 'Cancelar',
                        confirmButtonColor: '#e11d48',
                        cancelButtonColor: '#6b7280',
                        reverseButtons: true,
                    });
                    if (!result.isConfirmed) {
                        setRemitoCode('');
                        setLoading(false);
                        return;
                    }
                }

                setLoadedRemito(data);
                setRemitoCode(code); // Ensure state sync

                // Build Map
                const map = {};
                data.items.forEach(item => {
                    map[item.CodigoEtiqueta] = {
                        ...item,
                        scanned: item.EstadoRecepcion === 'ESCANEADO' || item.EstadoRecepcion === 'RECIBIDO'
                    };
                });
                setItemMap(map);
                setStep(2);
                setLastScanMsg(null);
                setTimeout(() => scannerRef.current?.focus(), 100);
            } else {
                // UNIVERSAL SCAN (AUTO INGRESO/LOGISTICA)
                await processUniversalScan(code);
                setRemitoCode(''); // clear so they can scan again
            }
        } catch (err) {
            console.error(err);
            toast.error("Error al buscar: " + err.message);
            setRemitoCode('');
        } finally {
            setLoading(false);
        }
    };

    // --- MUTATIONS ---
    const receiveItemMutation = useMutation({
        mutationFn: logisticsService.receiveBulto,
        onSuccess: (_, variables) => {
            const code = variables.codigoEtiqueta;
            setItemMap(prev => ({
                ...prev,
                [code]: { ...prev[code], scanned: true }
            }));
            setLastScanMsg({ type: 'success', text: `RECIBIDO: ${code}` });
            toast.success(`Bulto ${code} ingresado`);
        },
        onError: (err) => {
            // El mensaje útil del backend viene en response.data.error; err.message es el genérico de axios
            const msg = err.response?.data?.error || err.message;
            setLastScanMsg({ type: 'error', text: `ERROR: ${msg}` });
            toast.error(msg);
        }
    });

    const batchReceiveMutation = useMutation({
        mutationFn: logisticsService.receiveDispatchItem,
        onSuccess: (_, variables) => {
            const receivedIds = variables.itemsRecibidos.map(i => i.bultoId);
            setItemMap(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(key => {
                    if (receivedIds.includes(next[key].BultoID)) {
                        next[key].scanned = true;
                    }
                });
                return next;
            });
            setManualSelection([]);
            toast.success("Recepción manual confirmada");
        },
        onError: (err) => {
            // Muestra el motivo real (ej. "Pedido SUB-XXXX incompleto: faltan..."), no el genérico "status 400"
            toast.error(err.response?.data?.error || err.message);
        }
    });

    // --- STEP 2: SCANNER LOGIC ---
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') return;
        
        const now = Date.now();
        const timeDiff = now - lastKeyTime.current;
        
        // Si el tiempo entre teclas es menor a 50ms, asumimos que es un escáner.
        if (timeDiff < 50) {
            isScannerRef.current = true;
        } else {
            isScannerRef.current = false;
        }
        lastKeyTime.current = now;
    };

    const handleScanInputChange = (e) => {
        const val = e.target.value;
        setScanInput(val);
        if (lastScanMsg?.type === 'error' || lastScanMsg?.type === 'warning') {
            setLastScanMsg(null);
        }

        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        
        // Solo aplicar el auto-submit si detectamos que es un escáner
        if (isScannerRef.current) {
            scanTimeoutRef.current = setTimeout(() => {
                if (val.trim().length > 2) {
                    handleScanItem(null, val);
                    isScannerRef.current = false; // reiniciar
                }
            }, 100);
        }
    };

    const handleScanItem = async (e, overrideCode) => {
        if (e) e.preventDefault();
        const code = (overrideCode !== undefined ? overrideCode : scanInput).trim();
        if (!code) return;

        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);

        if (itemMap[code]) {
            if (itemMap[code].scanned) {
                setLastScanMsg({ type: 'warning', text: `YA INGRESADO: ${code}` });
            } else {
                // ORDEN INVERTIDO (gate de bultos): primero el check-in WMS — la fila de
                // OrdenesDeposito nace/queda en estado 13 (Esperando) mientras el pedido esté
                // incompleto — y recién después createOrden, que actualiza datos SIN tocar el
                // estado. Así nunca hay una ventana en estado 1 donde el job WSP pueda avisar antes.
                try {
                    await receiveItemMutation.mutateAsync({
                        envioId: loadedRemito.EnvioID,
                        codigoEtiqueta: code,
                        usuarioId: user?.id || 1
                    });
                } catch (err) {
                    setScanInput('');
                    return; // el onError de la mutación ya mostró el error del check-in
                }
                await processUniversalScan(code, true);
            }
        } else {
            setLastScanMsg({ type: 'error', text: `NO PERTENECE: ${code}` });
            toast.error(`El bulto ${code} no corresponde a este remito`);
        }
        setScanInput('');
    };

    // --- MANUAL ACTIONS ---
    const handleManualToggle = (code) => {
        const item = itemMap[code];
        if (item.scanned) return;

        const bultoId = item.BultoID;
        if (manualSelection.includes(bultoId)) {
            setManualSelection(prev => prev.filter(id => id !== bultoId));
        } else {
            setManualSelection(prev => [...prev, bultoId]);
        }
    };

    const confirmManualSelection = async () => {
        if (manualSelection.length === 0) return;
        const result = await Swal.fire({
            icon: 'question',
            title: 'Confirmar recepción manual',
            text: `¿Confirmar recepción manual de ${manualSelection.length} bulto${manualSelection.length !== 1 ? 's' : ''}?`,
            showCancelButton: true,
            confirmButtonText: 'Sí, confirmar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#006E97',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        });
        if (!result.isConfirmed) return;

        const payload = {
            envioId: loadedRemito.EnvioID,
            usuarioId: user?.id || 1,
            itemsRecibidos: manualSelection.map(id => ({ bultoId: id, estado: 'ESCANEADO' }))
        };
        batchReceiveMutation.mutate(payload);
    };

    const handleMarkMissing = async () => {
        const unscanned = Object.values(itemMap).filter(i => !i.scanned);
        if (unscanned.length === 0) return;

        const result = await Swal.fire({
            icon: 'warning',
            title: '¿Cerrar con faltantes?',
            html: `Se marcarán <strong>${unscanned.length} bulto${unscanned.length !== 1 ? 's' : ''}</strong> como <strong>PERDIDOS/EXTRAVIADOS</strong>.<br><br>Esta acción es <strong>irreversible</strong>.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, cerrar con faltantes',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#e11d48',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        });
        if (!result.isConfirmed) return;

        const payload = {
            envioId: loadedRemito.EnvioID,
            usuarioId: user?.id || 1,
            itemsRecibidos: unscanned.map(i => ({ bultoId: i.BultoID, estado: 'PERDIDO' }))
        };
        batchReceiveMutation.mutate(payload);
    };

    // Metrics
    const totalItems = loadedRemito?.items?.length || 0;
    const scannedCount = Object.values(itemMap).filter(i => i.scanned).length;
    const progressColor = scannedCount === totalItems ? 'text-emerald-600' : 'text-brand-cyan';

    return (
        <div className="flex flex-col md:flex-row h-full bg-slate-50 font-sans text-zinc-800">
            {/* Sin min-h-screen: con el encabezado de Logística arriba, la vista quedaba más alta que su contenedor y se cortaba abajo. */}

            {/* LEFT SIDEBAR: INCOMING REMITOS */}
            {/* En el celular va arriba, con alto acotado (al costado no entra sin scroll horizontal). */}
            <div className="w-full md:w-1/3 md:min-w-[320px] md:max-w-sm bg-white border-b md:border-b-0 md:border-r border-zinc-200 flex flex-col max-h-[45vh] md:max-h-none shrink-0 md:shrink md:h-full md:sticky md:top-0">
                <div className="p-3 md:p-4 border-b border-zinc-100">
                    <label className={`${ROTULO} mb-1.5 block`}>
                        {currentArea && currentArea !== 'TODOS' ? `Envíos llegando a ${currentArea}` : 'Búsqueda de Envíos'}
                    </label>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text"
                            className={`${CAMPO} uppercase placeholder:normal-case`}
                            placeholder="Buscar remito manual..."
                            value={step === 1 ? remitoCode : ''}
                            onChange={(e) => {
                                if (step !== 1) {
                                    setStep(1);
                                    setLoadedRemito(null);
                                }
                                setRemitoCode(e.target.value);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSearchRemito(e);
                            }}
                        />
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                    {loadingIncoming && (
                        <div className="p-4 flex items-center justify-center gap-2 text-sm text-zinc-400">
                            <Loader2 size={16} className="animate-spin text-brand-cyan" />Buscando envíos...
                        </div>
                    )}

                    {/* Con «Todos» la lista de envíos que llegan no se pide (es por área): antes quedaba en blanco sin explicar nada */}
                    {(!currentArea || currentArea === 'TODOS') && (
                        <div className="p-8 flex flex-col items-center gap-2 text-center">
                            <MapPin size={40} className="text-zinc-200" />
                            <p className="text-sm text-zinc-400">Elegí un área arriba para ver los envíos que llegan, o buscá un remito por su código.</p>
                        </div>
                    )}

                    {!loadingIncoming && incomingRemitos?.length === 0 && (
                        <div className="p-8 flex flex-col items-center gap-2 text-center">
                            <CheckCircle2 size={40} className="text-zinc-200" />
                            <p className="text-sm text-zinc-400">No hay envíos pendientes de recepción.</p>
                        </div>
                    )}

                    {incomingRemitos?.map(rem => (
                        <div
                            key={rem.EnvioID}
                            onClick={() => handleSearchRemito(null, rem.CodigoRemito)}
                            className={`p-3.5 rounded-xl border cursor-pointer transition-colors ${loadedRemito?.EnvioID === rem.EnvioID
                                ? 'bg-brand-cyan/5 border-brand-cyan ring-2 ring-brand-cyan/15'
                                : 'bg-white border-zinc-200 hover:border-zinc-400'}`}
                        >
                            <div className="flex justify-between items-start gap-2 mb-2">
                                <span className="font-black text-zinc-800 font-mono break-all">{rem.CodigoRemito}</span>
                                <span className={`${BADGE} shrink-0 uppercase ${rem.Estado === 'ESPERANDO_RETIRO'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-zinc-50 text-zinc-600 border-zinc-200'}`}>
                                    {rem.Estado?.replace('_', ' ')}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                                <MoveRight size={14} className="shrink-0 text-brand-cyan" />
                                <span>Desde: <strong className="text-zinc-700">{rem.AreaOrigenID}</strong></span>
                            </div>
                            <div className="flex justify-between items-center mt-3">
                                <span className={`${BADGE} bg-zinc-50 text-zinc-600 border-zinc-200`}>
                                    {rem.TotalItems} Bultos
                                </span>
                                <span className="text-[11px] text-zinc-400 text-right leading-tight tabular-nums">
                                    {new Date(rem.FechaSalida).toLocaleDateString()}
                                    <br />
                                    {new Date(rem.FechaSalida).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 min-h-0 flex flex-col md:h-full overflow-hidden relative">

                {/* Close Button (Floating if viewing detail, or header) */}
                {onClose && (
                    <div className="absolute top-4 right-4 z-50">
                        <button onClick={onClose} title="Cerrar" aria-label="Cerrar" className="w-8 h-8 rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 flex items-center justify-center transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                )}

                {step === 2 && loadedRemito ? (
                    <div className="flex-1 overflow-y-auto p-3 md:p-6 min-h-0">
                        <div className="space-y-6">
                            {/* LAYOUT VERTICAL COMPACTO */}
                            <div className="flex flex-col gap-3 pb-20">

                                {/* HEADER DETAIL */}
                                <div className={`${CARD} px-4 py-3 flex flex-wrap justify-between items-center gap-3`}>
                                    <div className="min-w-0">
                                        <h1 className="text-lg font-black text-zinc-800 uppercase tracking-tight flex items-center gap-2 break-all">
                                            <PackageCheck size={20} className="shrink-0 text-brand-cyan" />
                                            {loadedRemito.CodigoRemito}
                                        </h1>
                                        <p className="text-sm text-zinc-400">Validando ingreso desde {loadedRemito.AreaOrigenID}</p>
                                    </div>
                                    <div className="text-right flex flex-wrap items-center gap-2 sm:gap-4">
                                        {manualSelection.length > 0 ? (
                                            <button onClick={confirmManualSelection} className={BTN_PRINCIPAL}>
                                                <Check size={15} /> Confirmar ({manualSelection.length})
                                            </button>
                                        ) : (
                                            scannedCount < totalItems && (
                                                <button onClick={handleMarkMissing} className={BTN_DESTRUCTIVO}>
                                                    <PackageX size={15} /> Cerrar Faltantes
                                                </button>
                                            )
                                        )}
                                        {scannedCount === totalItems && manualSelection.length === 0 && (
                                            <div className={`${BADGE} inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200`}><CheckCircle2 size={14} /> Completo</div>
                                        )}

                                        <div className="border-l border-zinc-200 pl-4 ml-2">
                                            <div className={`text-2xl font-black leading-none tabular-nums ${progressColor}`}>
                                                {scannedCount} <span className="text-zinc-300 text-lg">/ {totalItems}</span>
                                            </div>
                                            <div className={`${ROTULO} mt-1`}>Ingresados</div>
                                        </div>
                                    </div>
                                </div>

                                {/* SCANNER COMPACT */}
                                <div className={`${CARD} p-3 flex flex-col sm:flex-row justify-center items-center gap-3`}>
                                    <h3 className={`${ROTULO} whitespace-nowrap flex items-center gap-1.5`}>
                                        <ScanLine size={16} className="text-brand-cyan" /> Escáner
                                    </h3>
                                    <form onSubmit={handleScanItem} className="w-full max-w-md">
                                        <input
                                            ref={scannerRef}
                                            autoFocus
                                            type="text"
                                            value={scanInput}
                                            onChange={handleScanInputChange}
                                            onKeyDown={handleKeyDown}
                                            className="w-full bg-white border-2 border-zinc-200 rounded-xl py-2 px-4 text-center text-zinc-800 font-mono text-lg focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors placeholder:text-zinc-300"
                                            placeholder="Escanear QR..."
                                        />
                                    </form>
                                    <div className={`min-w-[180px] max-w-full flex items-center justify-center rounded-xl px-3 py-1.5 font-bold transition-colors text-xs border ${lastScanMsg?.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : lastScanMsg?.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : lastScanMsg?.type === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-transparent text-zinc-400 border-transparent'}`}>
                                        {lastScanMsg ? lastScanMsg.text : <span>Esperando...</span>}
                                    </div>
                                </div>

                                {/* LIST */}
                                <div className={`${CARD} flex flex-col overflow-hidden max-h-[600px]`}>
                                    <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap justify-between items-center gap-2">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="text-sm font-black text-zinc-800">Items ({totalItems})</span>
                                            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-600 bg-white px-2.5 py-1.5 rounded-lg border border-zinc-200 hover:border-zinc-400 transition-colors">
                                                <input type="checkbox" checked={showOnlyPending} onChange={e => setShowOnlyPending(e.target.checked)} className="form-checkbox text-brand-cyan accent-brand-cyan rounded cursor-pointer" />
                                                Solo Pendientes
                                            </label>
                                        </div>
                                        {(() => {
                                            const faltanCount = Object.values(itemMap).filter(item => !item.scanned && !manualSelection.includes(item.BultoID)).length;
                                            return faltanCount > 0 ? (
                                                <span className={`${BADGE} bg-rose-50 text-rose-700 border-rose-200`}>
                                                    Faltan {faltanCount}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-3">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                            {Object.values(itemMap).filter(item => {
                                                if (!showOnlyPending) return true;
                                                const isSelected = manualSelection.includes(item.BultoID);
                                                return !item.scanned && !isSelected;
                                            }).map((item, idx) => {
                                                const isSelected = manualSelection.includes(item.BultoID);
                                                return (
                                                    <div
                                                        key={item.CodigoEtiqueta}
                                                        onClick={() => handleManualToggle(item.CodigoEtiqueta)}
                                                        className={`p-2.5 rounded-xl border flex flex-col gap-1 transition-colors cursor-pointer select-none text-xs ${item.scanned
                                                            ? 'bg-emerald-50 border-emerald-200 opacity-75'
                                                            : isSelected
                                                                ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan/30'
                                                                : 'bg-white border-zinc-200 hover:border-zinc-400'
                                                            }`}
                                                    >
                                                        <div className="flex justify-between items-start gap-2">
                                                            <div className="font-bold font-mono text-zinc-700 truncate">{item.CodigoEtiqueta}</div>
                                                            <div className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${item.scanned ? 'bg-emerald-500 text-white' : isSelected ? 'bg-brand-cyan text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                                                                {item.scanned ? <Check size={12} strokeWidth={3} /> : (idx + 1)}
                                                            </div>
                                                        </div>
                                                        {(item.CodigoOrden || item.NumeroBulto) && (
                                                            <div className="text-[11px] font-bold text-brand-cyan truncate w-full">
                                                                {item.CodigoOrden || item.RetiroAsociado || ''}
                                                                {item.NumeroBulto ? <span className="text-zinc-400 font-medium"> · Bulto {item.NumeroBulto}/{item.TotalBultos || 1}</span> : null}
                                                            </div>
                                                        )}
                                                        <div className="text-[11px] text-zinc-500 truncate w-full">{item.Descripcion}</div>
                                                        {item.scanned && <span className="text-[10px] font-black text-emerald-600 uppercase tracking-wide mt-0.5">Recibido</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* RECENT SCANS CARDS IF ANY IN STEP 2 */}
                            {recentScans.length > 0 && (
                                <div className="mt-8 border-t border-zinc-200 pt-8">
                                    <h3 className="text-lg font-black text-zinc-800 mb-4 flex items-center gap-2">
                                        <MessageCircle size={18} className="shrink-0 text-brand-cyan" />
                                        Notificaciones de Whatsapp / Sync
                                    </h3>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {recentScans.map(renderScanCard)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full bg-slate-50 p-3 md:p-6 overflow-y-auto">
                        {recentScans.length > 0 ? (
                            <div className="w-full max-w-7xl mx-auto">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <ScanLine size={22} className="shrink-0 text-brand-cyan" />
                                        <div className="min-w-0">
                                            <h2 className="text-lg font-black text-zinc-800">Panel de Ingresos Rápidos</h2>
                                            <p className="text-sm text-zinc-400">Lo último escaneado, con el estado del ingreso y del aviso por WhatsApp.</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setRecentScans([])} className={BTN_SECUNDARIO}><Eraser size={15} /> Limpiar Todo</button>
                                </div>
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 auto-rows-max">
                                    <AnimatePresence>
                                        {recentScans.map(renderScanCard)}
                                    </AnimatePresence>
                                </div>
                            </div>
                        ) : (
                            <div className={`${CARD} w-full max-w-xl m-auto flex flex-col items-center justify-center py-16 px-6 gap-2 text-center`}>
                                <Truck size={40} className="text-zinc-200" />
                                <h2 className="font-bold text-zinc-500">Centro de Recepción</h2>
                                <p className="max-w-md text-sm text-zinc-400">
                                    Seleccione un remito entrante de la lista para validar su ingreso al stock, o escanee un código/bulto en el buscador.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Extracted UI Render for Scan Card (CargaDeposito clone)
function useScanCardRenderer(handleUpdatePhone, handleOmitirWsp, removeScanRow, modosMap) {
    const [expandedCardId, setExpandedCardId] = useState(null);

    return (code) => {
        const isError = code.status === 'error' || code.status === 'wsp_error';
        const isWspSuccess = code.status === 'wsp_success';
        const isWspWaiting = code.status === 'wsp_waiting';
        const isInfo = code.status === 'info';
        const isLoading = code.status === 'loading' || code.status === 'validating';

        const rawStringDisplay = code.parsed ? code.parsed.CodigoOrden : (code.value.length > 25 ? code.value.substring(0, 25) + '...' : code.value);

        return (
            <motion.div
                key={`card-${code.id}`}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`px-4 py-3 rounded-2xl border flex flex-col justify-between gap-3 transition-colors cursor-pointer self-start min-w-0
                    ${isError ? 'bg-rose-50 border-rose-200 hover:bg-rose-100' :
                        isWspSuccess ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' :
                            isWspWaiting ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' :
                                isInfo ? 'bg-brand-cyan/5 border-brand-cyan/30 hover:bg-brand-cyan/10' :
                                    isLoading ? 'bg-white border-zinc-200' :
                                        'bg-white border-zinc-200 hover:bg-zinc-50'
                    }
                `}
                onClick={(e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
                    setExpandedCardId(prev => prev === code.id ? null : code.id);
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <span className={`font-black text-lg truncate ${isError ? 'text-rose-800' : isWspSuccess ? 'text-emerald-800' : isWspWaiting ? 'text-amber-800' : isLoading ? 'text-zinc-800' : 'text-zinc-800'}`}>
                        {rawStringDisplay}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                        {isLoading && <Loader2 className="text-brand-cyan animate-spin" size={16} />}
                        <span className={`${BADGE} uppercase tracking-wide
                            ${isError ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                isWspSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    isWspWaiting ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                        isInfo ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' :
                                            code.status === 'validating' ? 'bg-zinc-50 text-zinc-600 border-zinc-200' :
                                                isLoading ? 'bg-zinc-50 text-zinc-600 border-zinc-200' :
                                                    'bg-zinc-100 text-zinc-600 border-zinc-200'
                            }
                        `}>
                            {isError ? 'RECHAZADO' :
                                isWspSuccess ? 'ENVIADO' :
                                    isWspWaiting ? 'EN ESPERA' :
                                        isInfo ? 'REINGRESADO' :
                                            code.status === 'validating' ? 'VALIDANDO...' :
                                                isLoading ? 'GUARDANDO...' : 'LISTO'}
                        </span>
                        {code.parsed && (
                            <ChevronDown size={16} className={`transition-transform ${expandedCardId === code.id ? 'rotate-180' : ''} ${isError ? 'text-rose-400' : 'text-zinc-400'}`} />
                        )}
                        <button onClick={(e) => { e.stopPropagation(); removeScanRow(code.id); }} title="Quitar de la lista" aria-label="Quitar de la lista" className="text-zinc-400 hover:text-zinc-700 ml-1 transition-colors"><XCircle size={16} /></button>
                    </div>
                </div>

                {/* Información expandida */}
                <AnimatePresence>
                {(expandedCardId === code.id || isError || isWspWaiting || code.wspError) && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                    >
                    <div className="mt-3 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                        {/* Info parseada */}
                        {code.parsed && (
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-white/70 rounded-xl p-2.5 border border-zinc-200 text-xs">
                                <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1 min-w-0">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1"><User size={11} className="text-brand-cyan" /> Cliente</span>
                                    <span className="text-zinc-800 font-semibold truncate">{code.parsed.CodigoCliente}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1 min-w-0">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1"><ShoppingBag size={11} className="text-brand-cyan" /> Producto</span>
                                    <span className="text-zinc-800 font-semibold truncate">{code.parsed.ProductoNombre}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 col-span-2 min-w-0">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1"><Tag size={11} className="text-brand-cyan" /> Trabajo</span>
                                    <span className="text-zinc-700 italic truncate">{code.parsed.NombreTrabajo || 'Sin Descripción'}</span>
                                </div>
                            </div>
                        )}

                        {/* Mensaje de error / WSP */}
                        {code.message && (
                            <div className={`text-[0.8rem] font-semibold px-3 py-2 rounded-xl border flex flex-wrap justify-between items-center gap-2 bg-white/80
                                ${isError ? 'text-rose-700 border-rose-200' :
                                    isWspSuccess ? 'text-emerald-700 border-emerald-200' :
                                        isWspWaiting ? 'text-amber-800 border-amber-200' :
                                            'text-zinc-700 border-zinc-200'
                                }
                            `}>
                                <span className="flex-1 text-center font-medium">{code.message}</span>
                                {isWspWaiting && code.idOrden && (
                                    <button
                                        title="Marcar como avisado sin enviar WhatsApp"
                                        onClick={() => handleOmitirWsp(code.idOrden)}
                                        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-2 py-0.5 text-[0.7rem] font-bold transition-colors"
                                    >
                                        <SkipForward size={11} /> Saltar WSP
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Re-Despacho si falla WhatsApp */}
                        {code.wspError && code.idOrden && (
                            <div className="bg-white p-2 border border-rose-200 rounded-xl flex items-center gap-2 mt-1">
                                <Phone size={15} className="shrink-0 ml-1 text-brand-cyan" />
                                <div className="flex-1 min-w-0">
                                    <input
                                        type="text"
                                        placeholder="Celular válido..."
                                        className="w-full bg-white border border-zinc-200 py-1.5 px-2.5 rounded-lg text-[0.8rem] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                                        id={`phone-input-${code.idOrden}`}
                                    />
                                </div>
                                <button
                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-[0.75rem] font-bold hover:bg-brand-cyan/90 transition-colors"
                                    onClick={() => {
                                        const val = document.getElementById(`phone-input-${code.idOrden}`).value;
                                        if (val) handleUpdatePhone(code.idOrden, val);
                                    }}
                                >
                                    <Send size={12} /> Redespachar
                                </button>
                            </div>
                        )}
                    </div>
                    </motion.div>
                )}
                </AnimatePresence>
            </motion.div>
        );
    };
}

export default ReceptionView;
