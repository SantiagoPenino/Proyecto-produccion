import React, { useState, useRef, useEffect } from 'react';
import Swal from 'sweetalert2';
import api from '../../services/api';
import { socket } from '../../services/socketService';
import { useMutation, useQuery } from '@tanstack/react-query';
import { logisticsService } from '../../services/modules/logisticsService';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import { Phone, Send, User, ShoppingBag, Tag, Loader2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
                status: resData.status === 202 ? 'info' : 'wsp_waiting', 
                message: resData.status === 202 ? 'La orden se reingresó exitosamente al depósito.' : 'Orden guardada. Esperando WhatsApp...',
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
                        title: '⚠️ Alerta de Seguridad',
                        html: `<p>Este remito aún figura como <strong>'ESPERANDO RETIRO'</strong>.</p><p style="margin-top:8px">El transportista o cadete <strong>NO ha escaneado/validado</strong> la salida de la mercadería.</p>`,
                        showCancelButton: true,
                        confirmButtonText: 'Sí, forzar recepción',
                        cancelButtonText: 'Cancelar',
                        confirmButtonColor: '#d33',
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
                        title: '⛔ Área Incorrecta',
                        html: `<p>Este remito está destinado a: <strong>${data.AreaDestinoID}</strong></p><p style="margin-top:8px">Estás recepcionando en: <strong>${currentArea}</strong></p>`,
                        showCancelButton: true,
                        confirmButtonText: 'Sí, recepcionar aquí',
                        cancelButtonText: 'Cancelar',
                        confirmButtonColor: '#d33',
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
            confirmButtonColor: '#4f46e5',
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
            confirmButtonColor: '#d33',
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

    const handleSync = async () => {
        if (!loadedRemito) return;
        setLoading(true);
        try {
            // Filtrar solo items escaneados/recibidos que NO han sido sincronizados aún
            const scanneableItems = Object.values(itemMap).filter(i => i.scanned && !i.synced);

            if (scanneableItems.length === 0) {
                toast.info("No hay nuevos items recibidos para sincronizar.");
                setLoading(false);
                return;
            }

            // Lógica de Sincronización
            const payload = scanneableItems.map(item => ({
                qr: item.CodigoEtiqueta,
                count: 1, // Bulto Individual
                price: parseFloat(item.Precio || 0), // Usar campos del item del remito si están disponibles
                quantity: parseFloat(item.Cantidad || 0),
                profile: item.PerfilesPrecio || ''
            }));

            const res = await logisticsService.syncDepositItems(payload);
            const successItems = res.results?.filter(r => r.success) || [];

            if (successItems.length > 0) {
                toast.success(`Sincronizados ${successItems.length} bultos correctamente.`);

                // Actualizar estado local para evitar re-sincronización
                setItemMap(prev => {
                    const next = { ...prev };
                    successItems.forEach(r => {
                        if (next[r.qr]) {
                            next[r.qr].synced = true;
                        }
                    });
                    return next;
                });

                // Verificar si todos los items del remito fueron recibidos y sincronizados
                const allItemsScanned = Object.values(itemMap).every(i => i.scanned);
                const allItemsSynced = Object.values(itemMap).every(i => i.synced);

                if (allItemsScanned && allItemsSynced) {
                    toast.success("Todos los items del remito han sido procesados y sincronizados.");
                    // Opcional: Cerrar automáticamente o dejar que el usuario 'Confirme' manualmente para cerrar el remito en UI
                    // setStep(1);
                    // setRemitoCode('');
                    // setLoadedRemito(null);
                }
            } else {
                toast.error("Error al sincronizar bultos. Verifique conexión.");
            }
        } catch (err) {
            console.error(err);
            toast.error("Error de conexión al sincronizar: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    // Metrics
    const totalItems = loadedRemito?.items?.length || 0;
    const scannedCount = Object.values(itemMap).filter(i => i.scanned).length;
    const progressColor = scannedCount === totalItems ? 'text-emerald-500' : 'text-blue-600';

    return (
        <div className="flex h-full bg-slate-100 min-h-screen font-sans">

            {/* LEFT SIDEBAR: INCOMING REMITOS */}
            <div className="w-1/3 min-w-[320px] max-w-sm bg-white border-r border-slate-200 flex flex-col h-full sticky top-0">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">
                        {currentArea && currentArea !== 'TODOS' ? `Envíos llegando a ${currentArea}` : 'Búsqueda de Envíos'}
                    </label>
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-3 top-3 text-slate-400"></i>
                        <input
                            type="text"
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all uppercase"
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

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {loadingIncoming && <div className="p-4 text-center text-slate-400"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Buscando envíos...</div>}

                    {!loadingIncoming && incomingRemitos?.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">
                            <i className="fa-solid fa-check-circle text-3xl mb-2 opacity-30"></i>
                            <p>No hay envíos pendientes de recepción.</p>
                        </div>
                    )}

                    {incomingRemitos?.map(rem => (
                        <div
                            key={rem.EnvioID}
                            onClick={() => handleSearchRemito(null, rem.CodigoRemito)}
                            className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md ${loadedRemito?.EnvioID === rem.EnvioID
                                ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-300'
                                : 'bg-white border-slate-100 hover:border-slate-300'}`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <span className="font-bold text-slate-800 font-mono">{rem.CodigoRemito}</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">
                                    {rem.Estado?.replace('_', ' ')}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                                <i className="fa-solid fa-arrow-right-long text-slate-300"></i>
                                <span>Desde: <strong className="text-slate-700">{rem.AreaOrigenID}</strong></span>
                            </div>
                            <div className="flex justify-between items-center mt-3">
                                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-bold">
                                    {rem.TotalItems} Bultos
                                </span>
                                <span className="text-[10px] text-slate-400">
                                    {new Date(rem.FechaSalida).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">

                {/* Close Button (Floating if viewing detail, or header) */}
                {onClose && (
                    <div className="absolute top-4 right-4 z-50">
                        <button onClick={onClose} className="w-8 h-8 bg-slate-200 rounded-full hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors">
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                )}

                {step === 2 && loadedRemito ? (
                    <div className="flex-1 overflow-y-auto p-6 min-h-0">
                        <div className="max-w-6xl mx-auto space-y-6">
                            {/* LAYOUT VERTICAL COMPACTO */}
                            <div className="flex flex-col gap-2 pb-20">
                                
                                {/* HEADER DETAIL */}
                                <div className="flex justify-between items-center bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-200">
                                    <div>
                                        <h1 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                            <i className="fa-solid fa-dolly text-indigo-600"></i>
                                            {loadedRemito.CodigoRemito}
                                        </h1>
                                        <p className="text-slate-500 text-[10px] font-medium">Validando ingreso desde {loadedRemito.AreaOrigenID}</p>
                                    </div>
                                    <div className="text-right flex items-center gap-2 sm:gap-4">
                                        {manualSelection.length > 0 ? (
                                            <button onClick={confirmManualSelection} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-[10px] sm:text-xs hover:bg-indigo-700 transition-colors uppercase shadow-sm">
                                                Confirmar ({manualSelection.length})
                                            </button>
                                        ) : (
                                            scannedCount < totalItems && (
                                                <button onClick={handleMarkMissing} className="bg-white border border-red-200 text-red-500 px-3 py-1.5 rounded-lg font-bold text-[10px] sm:text-xs hover:bg-red-50 transition-colors uppercase shadow-sm whitespace-nowrap">
                                                    Cerrar Faltantes
                                                </button>
                                            )
                                        )}
                                        {scannedCount === totalItems && manualSelection.length === 0 && (
                                            <div className="text-center text-emerald-600 font-bold text-xs py-1 px-2"><i className="fa-solid fa-check-circle mr-1"></i> Completo</div>
                                        )}
                                        
                                        <div className="border-l border-slate-200 pl-4 ml-2">
                                            <div className={`text-2xl font-black leading-none ${progressColor}`}>
                                                {scannedCount} <span className="text-slate-300 text-lg">/ {totalItems}</span>
                                            </div>
                                            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Ingresados</div>
                                        </div>
                                    </div>
                                </div>

                                {/* SCANNER COMPACT */}
                                <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 p-3 flex flex-col sm:flex-row justify-center items-center gap-3 relative overflow-hidden">
                                    <h3 className="text-slate-300 font-bold uppercase tracking-wider text-xs whitespace-nowrap">Escáner</h3>
                                    <form onSubmit={handleScanItem} className="w-full max-w-md">
                                        <input
                                            ref={scannerRef}
                                            autoFocus
                                            type="text"
                                            value={scanInput}
                                            onChange={handleScanInputChange}
                                            onKeyDown={handleKeyDown}
                                            className="w-full bg-slate-900 border-2 border-slate-600 rounded-lg py-2 px-4 text-center text-white font-mono text-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-700"
                                            placeholder="Escanear QR..."
                                        />
                                    </form>
                                    <div className={`min-w-[180px] flex items-center justify-center rounded-lg p-1.5 font-bold transition-all text-xs ${lastScanMsg?.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : lastScanMsg?.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/50' : lastScanMsg?.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' : 'bg-transparent text-slate-500'}`}>
                                        {lastScanMsg ? lastScanMsg.text : <span>Esperando...</span>}
                                    </div>
                                </div>

                                {/* LIST */}
                                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden max-h-[600px]">
                                    <div className="p-3 bg-slate-50 border-b border-slate-100 font-bold text-slate-700 text-sm flex justify-between items-center">
                                        <div className="flex items-center gap-4">
                                            <span>Items ({totalItems})</span>
                                            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-600 bg-white px-2 py-1 rounded border shadow-sm">
                                                <input type="checkbox" checked={showOnlyPending} onChange={e => setShowOnlyPending(e.target.checked)} className="form-checkbox text-indigo-600 rounded cursor-pointer" />
                                                Solo Pendientes
                                            </label>
                                        </div>
                                        {(() => {
                                            const faltanCount = Object.values(itemMap).filter(item => !item.scanned && !manualSelection.includes(item.BultoID)).length;
                                            return faltanCount > 0 ? (
                                                <span className="text-rose-500 font-bold uppercase text-[10px] bg-rose-50 px-2 py-1 rounded border border-rose-100">
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
                                                        className={`p-2 rounded-lg border flex flex-col gap-1 transition-all cursor-pointer select-none text-xs ${item.scanned
                                                            ? 'bg-emerald-50 border-emerald-200 opacity-75'
                                                            : isSelected
                                                                ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200'
                                                                : 'bg-white border-slate-100 hover:border-slate-300'
                                                            }`}
                                                    >
                                                        <div className="flex justify-between items-start gap-2">
                                                            <div className="font-bold font-mono text-slate-700 truncate">{item.CodigoEtiqueta}</div>
                                                            <div className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${item.scanned ? 'bg-emerald-500 text-white' : isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                                                {item.scanned ? <i className="fa-solid fa-check"></i> : (idx + 1)}
                                                            </div>
                                                        </div>
                                                        {(item.CodigoOrden || item.NumeroBulto) && (
                                                            <div className="text-[10px] font-bold text-indigo-600 truncate w-full">
                                                                {item.CodigoOrden || item.RetiroAsociado || ''}
                                                                {item.NumeroBulto ? <span className="text-slate-400 font-medium"> · Bulto {item.NumeroBulto}/{item.TotalBultos || 1}</span> : null}
                                                            </div>
                                                        )}
                                                        <div className="text-[10px] text-slate-500 truncate w-full">{item.Descripcion}</div>
                                                        {item.scanned && <span className="text-[9px] font-bold text-emerald-600 uppercase mt-0.5">Recibido</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* RECENT SCANS CARDS IF ANY IN STEP 2 */}
                            {recentScans.length > 0 && (
                                <div className="mt-8 border-t pt-8">
                                    <h3 className="text-sm font-bold text-slate-500 mb-4 flex items-center gap-2 uppercase tracking-wider">
                                        Notificaciones de Whatsapp / Sync
                                    </h3>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                                        {recentScans.map(renderScanCard)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full bg-slate-50 p-6 overflow-y-auto">
                        {recentScans.length > 0 ? (
                            <div className="w-full max-w-7xl mx-auto">
                                <div className="mb-6 flex items-center justify-between">
                                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Panel de Ingresos Rápidos</h2>
                                    <button onClick={() => setRecentScans([])} className="text-sm border border-slate-300 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-800 font-bold transition-all hover:bg-slate-200">Limpiar Todo</button>
                                </div>
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 auto-rows-max">
                                    <AnimatePresence>
                                        {recentScans.map(renderScanCard)}
                                    </AnimatePresence>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
                                <div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center mb-6">
                                    <i className="fa-solid fa-truck-ramp-box text-4xl text-slate-300"></i>
                                </div>
                                <h2 className="text-xl font-bold text-slate-600 mb-2">Centro de Recepción</h2>
                                <p className="max-w-md text-center text-sm mb-8">
                                    Seleccione un remito entrante del menú izquierdo para validar su ingreso al stock, o escanee un código/bulto manualmente en el panel izquierdo.
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
                className={`px-4 py-3 rounded-xl border-2 flex flex-col justify-between gap-3 transition-all shadow-sm cursor-pointer self-start
                    ${isError ? 'bg-rose-50 border-rose-300 hover:bg-rose-100' :
                        isWspSuccess ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100' :
                            isWspWaiting ? 'bg-violet-50 border-violet-300 hover:bg-violet-100' :
                                isInfo ? 'bg-blue-50 border-blue-300 hover:bg-blue-100' :
                                    isLoading ? 'bg-amber-50 border-amber-300' :
                                        'bg-white border-slate-200 hover:bg-slate-50'
                    }
                `}
                onClick={(e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
                    setExpandedCardId(prev => prev === code.id ? null : code.id);
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <span className={`font-black text-lg truncate ${isError ? 'text-rose-800' : isWspSuccess ? 'text-emerald-800' : isWspWaiting ? 'text-violet-800' : isLoading ? 'text-amber-800' : 'text-slate-800'}`}>
                        {rawStringDisplay}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                        {isLoading && <Loader2 className="text-amber-500 animate-spin" size={16} />}
                        <span className={`px-2.5 py-1 text-[0.65rem] font-bold uppercase rounded-lg tracking-wider border
                            ${isError ? 'bg-rose-100 text-rose-700 border-rose-300' :
                                isWspSuccess ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                                    isWspWaiting ? 'bg-violet-100 text-violet-700 border-violet-300' :
                                        isInfo ? 'bg-blue-100 text-blue-700 border-blue-300' :
                                            code.status === 'validating' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                                                isLoading ? 'bg-blue-100 text-blue-700 border-blue-300' :
                                                    'bg-slate-100 text-slate-600 border-slate-300'
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
                            <span className={`text-xs transition-transform ${expandedCardId === code.id ? 'rotate-180' : ''} ${isError ? 'text-rose-400' : 'text-slate-400'}`}>▼</span>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); removeScanRow(code.id); }} className="text-slate-400 hover:text-slate-700 ml-1"><XCircle size={16} /></button>
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
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-white/70 rounded-lg p-2 border border-slate-100 text-xs">
                                <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1"><User size={10} /> Cliente</span>
                                    <span className="text-slate-800 font-semibold truncate">{code.parsed.CodigoCliente}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1"><ShoppingBag size={10} /> Producto</span>
                                    <span className="text-slate-800 font-semibold truncate">{code.parsed.ProductoNombre}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 col-span-2">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1"><Tag size={10} /> Trabajo</span>
                                    <span className="text-slate-700 italic truncate">{code.parsed.NombreTrabajo || 'Sin Descripción'}</span>
                                </div>
                            </div>
                        )}

                        {/* Mensaje de error / WSP */}
                        {code.message && (
                            <div className={`text-[0.8rem] font-semibold px-3 py-2 rounded-lg border flex justify-between items-center gap-2
                                ${isError ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                    isWspSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                        isWspWaiting ? 'bg-violet-50 text-violet-700 border-violet-200' :
                                            'bg-blue-50 text-blue-800 border-blue-200'
                                }
                            `}>
                                <span className="flex-1 text-center font-medium">{code.message}</span>
                                {isWspWaiting && code.idOrden && (
                                    <button
                                        title="Marcar como avisado sin enviar WhatsApp"
                                        onClick={() => handleOmitirWsp(code.idOrden)}
                                        className="shrink-0 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-md px-2 py-0.5 text-[0.7rem] font-bold transition-colors flex items-center gap-1"
                                    >
                                        <XCircle size={10} /> Saltar WSP
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Re-Despacho si falla WhatsApp */}
                        {code.wspError && code.idOrden && (
                            <div className="bg-white p-2 border border-rose-200 rounded-lg flex items-center gap-2 mt-1 shadow-sm">
                                <div className="flex bg-rose-50 text-rose-500 p-1.5 border border-rose-100 rounded-md">
                                    <Phone size={14} />
                                </div>
                                <div className="flex-1">
                                    <input
                                        type="text"
                                        placeholder="Celular válido..."
                                        className="w-full bg-slate-50 border border-slate-200 py-[4px] px-2 rounded-md text-[0.8rem] outline-none focus:border-[#409cf9]"
                                        id={`phone-input-${code.idOrden}`}
                                    />
                                </div>
                                <button
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 flex items-center gap-1.5 px-3 rounded-md text-[0.75rem] transition-colors"
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
