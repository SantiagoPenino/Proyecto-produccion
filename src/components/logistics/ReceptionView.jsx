import React, { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { logisticsService } from '../../services/modules/logisticsService';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';

const ReceptionView = ({ onClose, areaContext, areaFilter }) => {
    const { user } = useAuth();
    const currentArea = areaFilter || areaContext || user?.areaKey || user?.areaId;

    // Steps: 1 = Scan/Select Remito, 2 = Process Items
    const [step, setStep] = useState(1);

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

    const inputRef = useRef(null);
    const scannerRef = useRef(null);

    // --- NEW: Incoming Remitos List ---
    const { data: incomingRemitos, isLoading: loadingIncoming } = useQuery({
        queryKey: ['remitos', 'incoming', currentArea],
        queryFn: () => logisticsService.getIncomingRemitos(currentArea),
        enabled: !!currentArea && currentArea !== 'TODOS',
        refetchInterval: 15000
    });

    // --- STEP 1: FETCH REMITO ---
    const handleSearchRemito = async (e, codeOverride) => {
        if (e) e.preventDefault();
        const code = codeOverride || remitoCode.trim();
        if (!code) return;

        setLoading(true);
        try {
            const data = await logisticsService.getRemitoByCode(code);

            // VALIDATIONS
            if (data.Estado === 'ESPERANDO_RETIRO') {
                toast.warning('Remito sin validación de transporte');
                if (!confirm("⚠️ ALERTA DE SEGURIDAD\n\nEste remito aún figura como 'ESPERANDO RETIRO'.\nEl transportista o cadete NO ha escaneado/validado la salida de la mercadería.\n\n¿Desea FORZAR la recepción de todos modos?")) {
                    setRemitoCode('');
                    setLoading(false);
                    return;
                }
            }

            // AREA VALIDATION
            if (currentArea && data.AreaDestinoID !== currentArea && currentArea !== 'ADMIN' && currentArea !== 'TODOS') {
                if (!confirm(`⛔ ALERTA DE AREA INCORRECTA\n\nEste remito está destinado a: ${data.AreaDestinoID}\nEstás recepcionando en: ${currentArea}\n\n¿Estás seguro que deseas recepcionarlo aquí?`)) {
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

        } catch (err) {
            console.error(err);
            toast.error("Remito no encontrado: " + err.message);
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
            setLastScanMsg({ type: 'error', text: `ERROR: ${err.message}` });
            toast.error(err.message);
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
            toast.error("Error batch: " + err.message);
        }
    });

    // --- STEP 2: SCANNER LOGIC ---
    const handleScanItem = (e) => {
        e.preventDefault();
        const code = scanInput.trim();
        if (!code) return;

        if (itemMap[code]) {
            if (itemMap[code].scanned) {
                setLastScanMsg({ type: 'warning', text: `YA INGRESADO: ${code}` });
            } else {
                receiveItemMutation.mutate({
                    envioId: loadedRemito.EnvioID,
                    codigoEtiqueta: code,
                    usuarioId: user?.id || 1
                });
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

    const confirmManualSelection = () => {
        if (manualSelection.length === 0) return;
        if (!confirm(`¿Confirmar recepción manual de ${manualSelection.length} bultos?`)) return;

        const payload = {
            envioId: loadedRemito.EnvioID,
            usuarioId: user?.id || 1,
            itemsRecibidos: manualSelection.map(id => ({ bultoId: id, estado: 'ESCANEADO' }))
        };
        batchReceiveMutation.mutate(payload);
    };

    const handleMarkMissing = () => {
        const unscanned = Object.values(itemMap).filter(i => !i.scanned);
        if (unscanned.length === 0) return;

        if (confirm(`¿Cerrar recepción con FALTANTES?\n\nSe marcarán ${unscanned.length} bultos como PERDIDOS/EXTRAVIADOS.\nEsta acción es irreversible.`)) {
            const payload = {
                envioId: loadedRemito.EnvioID,
                usuarioId: user?.id || 1,
                itemsRecibidos: unscanned.map(i => ({ bultoId: i.BultoID, estado: 'PERDIDO' }))
            };
            batchReceiveMutation.mutate(payload);
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
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="max-w-6xl mx-auto space-y-6">
                            {/* HEADER DETAIL */}
                            <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                                <div>
                                    <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                        <i className="fa-solid fa-dolly text-indigo-600"></i>
                                        {loadedRemito.CodigoRemito}
                                    </h1>
                                    <p className="text-slate-500 text-xs font-medium">Validando ingreso desde {loadedRemito.AreaOrigenID}</p>
                                </div>
                                <div className="text-right">
                                    <div className={`text-3xl font-black ${progressColor}`}>
                                        {scannedCount} <span className="text-slate-300 text-xl">/ {totalItems}</span>
                                    </div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ingresados</div>
                                </div>
                            </div>

                            {/* GRID LAYOUT */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
                                {/* SCANNER */}
                                <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 p-8 flex flex-col justify-center items-center text-center relative overflow-hidden h-fit">
                                    <div className="relative z-10 w-full max-w-xs space-y-6">
                                        <h3 className="text-slate-300 font-bold uppercase tracking-wider text-sm">Escáner de Bultos</h3>
                                        <form onSubmit={handleScanItem}>
                                            <input
                                                ref={scannerRef}
                                                autoFocus
                                                type="text"
                                                value={scanInput}
                                                onChange={e => setScanInput(e.target.value)}
                                                className="w-full bg-slate-900 border-2 border-slate-600 rounded-xl py-4 px-6 text-center text-white font-mono text-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-700"
                                                placeholder="Escanear QR..."
                                            />
                                        </form>
                                        <div className={`min-h-[40px] flex items-center justify-center rounded-lg p-2 font-bold transition-all text-sm ${lastScanMsg?.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : lastScanMsg?.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/50' : lastScanMsg?.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' : 'bg-transparent'}`}>
                                            {lastScanMsg ? lastScanMsg.text : <span className="text-slate-600">Esperando lectura...</span>}
                                        </div>
                                    </div>
                                </div>

                                {/* LIST */}
                                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden max-h-[600px]">
                                    <div className="p-3 bg-slate-50 border-b border-slate-100 font-bold text-slate-700 text-sm flex justify-between items-center">
                                        <span>Items ({totalItems})</span>
                                        {manualSelection.length > 0 && <span className="text-indigo-600">{manualSelection.length} selec.</span>}
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                        {Object.values(itemMap).map((item, idx) => {
                                            const isSelected = manualSelection.includes(item.BultoID);
                                            return (
                                                <div
                                                    key={item.CodigoEtiqueta}
                                                    onClick={() => handleManualToggle(item.CodigoEtiqueta)}
                                                    className={`p-2 rounded-lg border flex justify-between items-center transition-all cursor-pointer select-none text-sm ${item.scanned
                                                        ? 'bg-emerald-50 border-emerald-200 opacity-75'
                                                        : isSelected
                                                            ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200'
                                                            : 'bg-white border-slate-100 hover:border-slate-300'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${item.scanned ? 'bg-emerald-500 text-white' : isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                                            {item.scanned ? <i className="fa-solid fa-check"></i> : (idx + 1)}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold font-mono text-slate-700">{item.CodigoEtiqueta}</div>
                                                            <div className="text-[10px] text-slate-500 truncate w-32">{item.Descripcion}</div>
                                                        </div>
                                                    </div>
                                                    {item.scanned && <span className="text-[10px] font-bold text-emerald-600 uppercase">Recibido</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* ACTIONS FOOTER */}
                                    <div className="p-3 border-t border-slate-100 bg-slate-50">
                                        {manualSelection.length > 0 ? (
                                            <button onClick={confirmManualSelection} className="w-full bg-indigo-600 text-white py-2 rounded-lg font-bold text-xs hover:bg-indigo-700 transition-colors uppercase">
                                                Confirmar Selección
                                            </button>
                                        ) : (
                                            scannedCount < totalItems ? (
                                                <button onClick={handleMarkMissing} className="w-full bg-white border border-red-200 text-red-500 py-2 rounded-lg font-bold text-xs hover:bg-red-50 transition-colors uppercase">
                                                    Cerrar con Faltantes
                                                </button>
                                            ) : (
                                                <div className="text-center text-emerald-600 font-bold text-xs"><i className="fa-solid fa-check-circle mr-1"></i> Completo</div>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
                        <div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center mb-6">
                            <i className="fa-solid fa-truck-ramp-box text-4xl text-slate-300"></i>
                        </div>
                        <h2 className="text-xl font-bold text-slate-600 mb-2">Centro de Recepción</h2>
                        <p className="max-w-md text-center text-sm mb-8">
                            Seleccione un remito entrante del menú izquierdo para validar su ingreso al stock, o escanee un código manualmente.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReceptionView;
