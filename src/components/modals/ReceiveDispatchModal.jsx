import React, { useState, useEffect, useRef } from 'react';
import { logisticsService } from '../../services/api';

const ReceiveDispatchModal = ({ isOpen, onClose, onSuccess }) => {
    const [step, setStep] = useState(1); // 1: Scan Dispatch, 2: Scan Items
    const [dispatchCode, setDispatchCode] = useState('');
    const [dispatchData, setDispatchData] = useState(null);
    const [items, setItems] = useState([]);
    const [itemScan, setItemScan] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const scanInputRef = useRef(null);

    // Auto-focus input on open and step change
    useEffect(() => {
        if (isOpen && scanInputRef.current) {
            scanInputRef.current.focus();
        }
    }, [isOpen, step, loading]);

    if (!isOpen) return null;

    // --- STEP 1: LOAD DISPATCH ---
    const handleDispatchScan = async (e) => {
        e.preventDefault();
        if (!dispatchCode.trim()) return;

        // SANITIZE: Replace common mistake '/' with '-', and trim
        const cleanCode = dispatchCode.trim().replace(/\//g, '-').toUpperCase();

        setLoading(true);
        setErrorMsg('');
        try {
            const data = await logisticsService.getRemitoByCode(cleanCode);
            setDispatchData(data);

            // Map items adding local state for UI
            const mappedItems = (data.items || []).map(i => ({
                ...i,
                received: i.EstadoItem === 'RECIBIDO'
            }));
            setItems(mappedItems);

            setStep(2);
            setDispatchCode(''); // Clear for next usage
        } catch (err) {
            setErrorMsg("No se encontró el despacho o hubo un error.");
            setDispatchCode('');
        } finally {
            setLoading(false);
        }
    };

    // --- MASS RECEIVE (Scan Remito again) ---
    const handleReceiveAll = async () => {
        if (!confirm("¿Desea dar por RECIBIDOS todos los bultos de este remito automáticamente?")) {
            setItemScan('');
            return;
        }

        setLoading(true);
        try {
            const unreceived = items.filter(i => !i.received);
            if (unreceived.length === 0) return;

            // Parallel requests
            await Promise.all(unreceived.map(item =>
                logisticsService.receiveDispatchItem({
                    envioId: dispatchData.DespachoID,
                    codigoEtiqueta: item.CodigoBulto || item.CodigoOrden,
                    usuarioId: 1
                })
            ));

            setItems(prev => prev.map(i => ({ ...i, received: true, FechaEscaneo: new Date().toISOString() })));
            setSuccessMsg(`✅ ${unreceived.length} BULTOS RECIBIDOS MASIVAMENTE.`);
            playSound('success');

        } catch (err) {
            setErrorMsg("Error masivo: " + err.message);
            playSound('error');
        } finally {
            setLoading(false);
            setItemScan('');
        }
    };

    // --- STEP 2: SCAN ITEM ---
    const handleItemScan = async (e) => {
        e.preventDefault();
        let code = itemScan.trim();
        if (!code) return;

        // --- PARSING CÓDIGOS QR COMPLEJOS ---
        // Formato detectado: ... $ } ... $ } SB0108/108
        // Algunos scanners usan ' $ * ' como separador tambien.
        if (code.includes('$ }') || code.includes('$ *')) {
            const parts = code.split(/\s*\$\s*[\}\*]\s*/);
            if (parts.length > 0) {
                // Tomamos el último segmento que suele ser el ID unico
                let lastPart = parts[parts.length - 1].trim();

                // Limpieza adicional si quedan caracteres raros (ej: comillas al final)
                lastPart = lastPart.replace(/['"]/g, '');

                // Normalizamos barras por guiones para coincidir con DB
                code = lastPart.replace(/\//g, '-');
                console.log("QR Parseado:", code);
            }
        }
        // -------------------------------------

        // CHECK IF USER SCANNED THE REMITO CODE AGAIN -> PREVENT ACCIDENTAL BULK RECEIVE
        if (code === dispatchData.Codigo) {
            // await handleReceiveAll();
            setErrorMsg("Ese es el código del Remito. Por favor escanee cada bulto individualmente.");
            playSound('error');
            return;
        }

        // Reset feedback
        setErrorMsg('');
        setSuccessMsg('');

        // LÓGICA DE DETECCIÓN INTELIGENTE
        // 1. Buscamos por Código de Bulto exacto (ej: QR del bulto)
        let targetItem = items.find(i => i.CodigoBulto === code);

        // 2. Si no, buscamos por ID de Orden (modo legacy o manual)
        if (!targetItem) {
            // Si el código es "ORD-123", extraemos 123
            let searchId = code;
            if (code.startsWith('ORD-') || code.startsWith('PED-')) {
                searchId = code.split('-')[1];
            }
            // Buscamos el PRIMER item no recibido de esa orden
            targetItem = items.find(i =>
                (String(i.OrdenID) === String(searchId) || String(i.CodigoOrden) === String(code)) && !i.received
            );
            // Si todos recibidos, tomamos cualquiera para mostrar el aviso de "ya recibido"
            if (!targetItem) {
                targetItem = items.find(i => String(i.OrdenID) === String(searchId) || String(i.CodigoOrden) === String(code));
            }
        }

        if (!targetItem) {
            setErrorMsg(`❌ EL CÓDIGO '${code}' NO ESTÁ EN ESTE MANIFIESTO.`);
            playSound('error');
            setItemScan('');
            return;
        }

        if (targetItem.received) {
            setSuccessMsg(`⚠️ El bulto ${targetItem.CodigoBulto || targetItem.CodigoOrden} ya fue recibido.`);
            playSound('warning');
            setItemScan('');
            return;
        }

        // 3. Server-side Process
        setLoading(true);
        try {
            // Enviamos ItemID específico para marcar ESE bulto
            await logisticsService.receiveDispatchItem({
                envioId: dispatchData.DespachoID,
                codigoEtiqueta: targetItem.CodigoBulto || targetItem.CodigoOrden,
                usuarioId: 1
            });

            // Update Local State
            setItems(prev => prev.map(i =>
                i.ItemID === targetItem.ItemID ? { ...i, received: true, FechaEscaneo: new Date().toISOString() } : i
            ));

            setSuccessMsg(`✅ Recibido: ${targetItem.CodigoBulto || targetItem.CodigoOrden}`);
            playSound('success');

        } catch (err) {
            setErrorMsg("Error al procesar recepción: " + err.message);
            playSound('error');
        } finally {
            setLoading(false);
            setItemScan('');
        }
    };

    // Helpers
    const playSound = (type) => {
        const audio = new Audio(
            type === 'success' ? 'https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3' :
                type === 'error' ? 'https://assets.mixkit.co/sfx/preview/mixkit-access-denied-beep-1088.mp3' :
                    'https://assets.mixkit.co/sfx/preview/mixkit-software-interface-back-2575.mp3'
        );
        audio.volume = 0.5;
        audio.play().catch(e => console.log("Audio play error", e));
    };

    // Progress
    const receivedCount = items.filter(i => i.received).length;
    const progress = items.length > 0 ? (receivedCount / items.length) * 100 : 0;
    const isComplete = items.length > 0 && receivedCount === items.length;

    return (
        <div className="fixed inset-0 bg-zinc-900/90 backdrop-blur-md flex items-center justify-center p-4 z-[1500]">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[600px] animate-in zoom-in-95 duration-200">

                {/* HEADER */}
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
                    <h3 className="text-xl font-black text-zinc-800 flex items-center gap-3">
                        <i className="fa-solid fa-barcode text-blue-600"></i>
                        Recepción de Despachos
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-red-500 w-10 h-10 flex items-center justify-center rounded-full hover:bg-zinc-200 transition-colors">
                        <i className="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                {/* DYNAMIC CONTENT */}
                <div className="flex-1 flex flex-col overflow-hidden relative">

                    {/* STEP 1: SCAN DISPATCH CODE */}
                    {step === 1 && (
                        <div className="flex-1 flex flex-col items-center justify-center p-10 gap-8">
                            <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center animate-pulse">
                                <i className="fa-solid fa-qrcode text-5xl text-blue-500"></i>
                            </div>
                            <div className="text-center">
                                <h4 className="text-2xl font-bold text-zinc-800 mb-2">Escanee el Manifiesto</h4>
                                <p className="text-zinc-400">Pistolee el código QR grande de la hoja de ruta</p>
                            </div>

                            <form onSubmit={handleDispatchScan} className="w-full max-w-md">
                                <input
                                    ref={scanInputRef}
                                    type="text"
                                    placeholder="REM-XXXXXX / DSP-XXXXXX"
                                    value={dispatchCode}
                                    onChange={e => setDispatchCode(e.target.value)}
                                    disabled={loading}
                                    autoComplete="off"
                                />
                                {loading && <p className="text-center text-blue-500 mt-4 font-bold animate-pulse">Buscando despacho...</p>}
                                {errorMsg && <p className="text-center text-red-500 mt-4 font-bold bg-red-50 py-2 rounded-lg">{errorMsg}</p>}
                            </form>
                        </div>
                    )}

                    {/* STEP 2: SCAN ITEMS */}
                    {step === 2 && (
                        <div className="flex h-full">
                            {/* LEFT: SCANNER ZONE */}
                            <div className="w-5/12 bg-zinc-50 border-r border-zinc-200 p-6 flex flex-col items-center pt-10">

                                <div className="mb-8 w-full">
                                    <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest text-center mb-1">Despacho Actual</div>
                                    <div className="text-lg font-black text-zinc-800 text-center font-mono">{dispatchData.Codigo}</div>
                                    <div className="flex justify-center mt-2 gap-2 text-[10px] font-bold uppercase">
                                        <span className="bg-white border border-zinc-200 px-2 py-1 rounded text-zinc-500">{dispatchData.AreaOrigenID}</span>
                                        <i className="fa-solid fa-arrow-right text-zinc-300 self-center"></i>
                                        <span className="bg-blue-100 border border-blue-200 px-2 py-1 rounded text-blue-600">{dispatchData.AreaDestinoID}</span>
                                    </div>
                                </div>

                                <form onSubmit={handleItemScan} className="w-full relative group">
                                    <div className={`absolute inset-0 rounded-xl blur opacity-20 transition-all ${errorMsg ? 'bg-red-500' : successMsg ? 'bg-emerald-500' : 'bg-blue-500 group-hover:opacity-40'}`}></div>
                                    <input
                                        ref={scanInputRef}
                                        type="text"
                                        className="relative w-full px-4 py-4 text-center text-xl font-mono font-bold border-2 border-zinc-200 rounded-xl focus:border-blue-500 outline-none bg-white shadow-xl transition-all"
                                        placeholder="Escanear Bulto..."
                                        value={itemScan}
                                        onChange={e => setItemScan(e.target.value)}
                                        disabled={loading || isComplete}
                                        autoComplete="off"
                                    />
                                    {loading && <div className="absolute right-4 top-1/2 -translate-y-1/2"><i className="fa-solid fa-circle-notch fa-spin text-blue-500"></i></div>}
                                </form>

                                <div className="mt-8 w-full">
                                    {errorMsg && (
                                        <div className="bg-red-500 text-white p-4 rounded-xl text-center shadow-lg animate-bounce duration-500">
                                            <i className="fa-solid fa-circle-xmark text-3xl mb-2 block"></i>
                                            <div className="font-bold text-lg leading-tight uppercase">{errorMsg}</div>
                                        </div>
                                    )}
                                    {successMsg && (
                                        <div className="bg-emerald-500 text-white p-4 rounded-xl text-center shadow-lg animate-in fade-in slide-in-from-bottom-4">
                                            <i className="fa-solid fa-circle-check text-3xl mb-2 block"></i>
                                            <div className="font-bold text-lg leading-tight uppercase">{successMsg}</div>
                                        </div>
                                    )}

                                    {isComplete && (
                                        <div className="bg-zinc-800 text-white p-6 rounded-xl text-center shadow-lg mt-4 animate-in zoom-in">
                                            <i className="fa-solid fa-flag-checkered text-4xl mb-3 text-emerald-400"></i>
                                            <div className="font-black text-xl uppercase">¡Despacho Completo!</div>
                                            <div className="text-sm text-zinc-400 mt-1">Todos los bultos han sido validados.</div>
                                            <button
                                                onClick={() => {
                                                    if (onSuccess) onSuccess();
                                                    onClose();
                                                }}
                                                className="mt-4 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg font-bold shadow-lg shadow-emerald-900/20 active:scale-95 transition-all"
                                            >
                                                Finalizar Recepción
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* RIGHT: LIST */}
                            <div className="flex-1 flex flex-col bg-white">
                                <div className="p-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                                    <h5 className="font-black text-zinc-700 text-sm uppercase flex items-center gap-2">
                                        <i className="fa-solid fa-clipboard-list text-zinc-400"></i> Contenido ({receivedCount}/{items.length})
                                    </h5>
                                    <div className="w-32 h-2 bg-zinc-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                                    {items.map((item, idx) => (
                                        <div
                                            key={item.ItemID || idx}
                                            className={`flex items-center gap-4 p-3 rounded-xl border transition-all duration-300 ${item.received ? 'bg-emerald-50 border-emerald-200 order-last opacity-60' : 'bg-white border-zinc-200 shadow-sm'}`}
                                        >
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 ${item.received ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-300'}`}>
                                                <i className={`fa-solid ${item.received ? 'fa-check' : 'fa-box'}`}></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between">
                                                    <span className={`font-bold font-mono text-sm ${item.received ? 'text-emerald-700' : 'text-zinc-800'}`}>
                                                        {item.CodigoBulto && item.CodigoBulto !== 'GENERICO' ? item.CodigoBulto : item.CodigoOrden}
                                                    </span>
                                                    <span className="text-[10px] font-bold bg-zinc-100 px-2 rounded text-zinc-500">
                                                        {item.CodigoBulto && item.CodigoBulto !== 'GENERICO' ? `Orden ${item.CodigoOrden}` : `${item.Bultos} bulto(s)`}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-zinc-500 truncate">{item.Material || 'Sin descripción'}</div>
                                                <div className="text-[10px] text-zinc-400 uppercase font-bold">{item.Cliente}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReceiveDispatchModal;


