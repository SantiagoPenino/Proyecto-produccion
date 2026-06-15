import React, { useState, useEffect, useRef } from 'react';
import { authService } from '../../services/api';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';

const TransportControlPage = () => {
    const { user } = useAuth();
    // Steps: 1 = Enter Remito, 2 = Tuning (Scanning Items)
    const [step, setStep] = useState(1);

    // Data
    const [remitoCode, setRemitoCode] = useState('');
    const [remitoData, setRemitoData] = useState(null);
    const [scannedCodes, setScannedCodes] = useState(new Set());

    // UI
    const [itemInput, setItemInput] = useState('');
    const [lastScanMsg, setLastScanMsg] = useState(null); // { type: 'success'|'error', text: '' }
    const [loading, setLoading] = useState(false);
    const [showOnlyPending, setShowOnlyPending] = useState(false);

    // Auth Modal
    const [showAuth, setShowAuth] = useState(false);
    const [creds, setCreds] = useState({ username: '', password: '' });

    // Refs
    const itemInputRef = useRef(null);
    const scanTimeoutRef = useRef(null);
    const lastKeyTime = useRef(Date.now());
    const isScannerRef = useRef(false);

    // Refocus scanner when modal closes
    useEffect(() => {
        if (!showAuth && step === 2) {
            const timer = setTimeout(() => {
                itemInputRef.current?.focus();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [showAuth, step]);

    // --- STEP 1: FETCH REMITO ---
    const handleSearchRemito = async (e) => {
        if (e) e.preventDefault();
        if (!remitoCode.trim()) return;

        setLoading(true);
        try {
            const data = await logisticsService.getRemitoByCode(remitoCode);
            setRemitoData(data);
            setScannedCodes(new Set());
            setStep(2);
            setLastScanMsg(null);
            setTimeout(() => itemInputRef.current?.focus(), 100);
        } catch (error) {
            console.error(error);
            toast.error("Remito no encontrado o error de conexión");
            setRemitoData(null);
        } finally {
            setLoading(false);
        }
    };

    // --- STEP 2: SCAN ITEMS ---
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') return;
        const now = Date.now();
        const timeDiff = now - lastKeyTime.current;
        if (timeDiff < 50) {
            isScannerRef.current = true;
        } else {
            isScannerRef.current = false;
        }
        lastKeyTime.current = now;
    };

    const handleScanInputChange = (e) => {
        const val = e.target.value;
        setItemInput(val);
        if (lastScanMsg?.type === 'error' || lastScanMsg?.type === 'warning') {
            setLastScanMsg(null);
        }

        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        
        if (isScannerRef.current) {
            scanTimeoutRef.current = setTimeout(() => {
                if (val.trim().length > 2) {
                    handleScanItem(null, val);
                    isScannerRef.current = false;
                }
            }, 100);
        }
    };

    const handleScanItem = (e, overrideCode) => {
        if (e) e.preventDefault();
        const code = (overrideCode !== undefined ? overrideCode : itemInput).trim(); // Case sensitive match usually best for IDs, or normalize
        if (!code) return;

        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);

        // Check availability in Remito
        // remitoData.items contains { CodigoEtiqueta, ... }
        const validItem = remitoData.items.find(i => i.CodigoEtiqueta === code || i.CodigoEtiqueta === code.toUpperCase());

        if (validItem) {
            if (scannedCodes.has(validItem.CodigoEtiqueta)) {
                setLastScanMsg({ type: 'warning', text: `Ya escaneado: ${code}` });
            } else {
                setScannedCodes(prev => new Set(prev).add(validItem.CodigoEtiqueta));
                setLastScanMsg({ type: 'success', text: `Verificado: ${code}` });
            }
        } else {
            setLastScanMsg({ type: 'error', text: `NO PERTENECE AL REMITO: ${code}` });
        }
        setItemInput('');
    };

    const handleConfirmClick = () => {
        setShowAuth(true);
    };

    const handleAuthSubmit = async (e) => {
        e.preventDefault();

        if (!creds.username || !creds.password) {
            toast.error("Debe ingresar usuario y contraseña");
            return;
        }

        setLoading(true);
        try {
            // 1. Authenticate
            let authResponse;
            try {
                authResponse = await authService.login(creds.username, creds.password);
            } catch (err) {
                toast.error("Credenciales inválidas");
                setLoading(false);
                return;
            }

            const authUser = authResponse.user;
            if (!authUser) throw new Error("No se pudo identificar al usuario");

            // 2. Confirm Transport
            // Sending 'driverName' as the authenticated user's name (Digital Signature logic)
            await logisticsService.confirmTransport({
                remitoCode: remitoData.CodigoRemito,
                scannedCodes: Array.from(scannedCodes),
                driverName: authUser.username,
                driverDetails: `Firmado digitalmente por ID: ${authUser.id}`,
                userId: authUser.id
            });

            toast.success(`Salida firmada por ${authUser.username}`);

            // Reset
            setShowAuth(false);
            setCreds({ username: '', password: '' });
            setStep(1);
            setRemitoCode('');
            setRemitoData(null);
            setScannedCodes(new Set());

        } catch (error) {
            console.error(error);
            toast.error(error.response?.data?.error || "Error al confirmar transporte");
        } finally {
            setLoading(false);
        }
    };

    // Metrics
    const totalItems = remitoData?.items?.length || 0;
    const scannedCount = scannedCodes.size;
    const progressColor = scannedCount === totalItems ? 'text-emerald-500' : 'text-blue-600';

    return (
        <div className="p-6 bg-slate-100 min-h-screen">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* HEADER */}
                <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">
                            <i className="fa-solid fa-truck-fast mr-3 text-indigo-600"></i>
                            Control de Transporte
                        </h1>
                        <p className="text-slate-500 text-sm font-medium">Validación de carga por transportista/cadete</p>
                    </div>
                </div>

                {/* STEP 1: SELECT REMITO */}
                {step === 1 && (
                    <div className="max-w-2xl mx-auto mt-12 bg-white p-8 rounded-2xl shadow-xl border border-slate-200 text-center">
                        <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-500 text-3xl">
                            <i className="fa-solid fa-barcode"></i>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 mb-2">Escanear Remito</h2>
                        <p className="text-slate-500 mb-6">Escanea el código QR del remito (REM-XXXXXX) para comenzar la validación.</p>

                        <form onSubmit={handleSearchRemito} className="relative max-w-md mx-auto">
                            <input
                                autoFocus
                                type="text"
                                className="w-full text-center text-2xl font-mono font-bold py-4 px-6 border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all uppercase placeholder:text-slate-300"
                                placeholder="REM-000000"
                                value={remitoCode}
                                onChange={e => setRemitoCode(e.target.value)}
                            />
                            <button
                                type="submit"
                                disabled={loading || !remitoCode}
                                className="absolute right-2 top-2 bottom-2 bg-indigo-600 text-white px-6 rounded-lg font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                                <i className="fa-solid fa-arrow-right"></i>
                            </button>
                        </form>
                    </div>
                )}

                {/* STEP 2: SCANNING INTERFACE (COMPACT VERTICAL) */}
                {step === 2 && remitoData && (
                    <div className="flex flex-col gap-2 pb-20 mt-4">
                        {/* HEADER DETAIL */}
                        <div className="flex justify-between items-center bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-200">
                            <div>
                                <h1 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                    <i className="fa-solid fa-truck-fast text-indigo-600"></i>
                                    {remitoData.CodigoRemito}
                                </h1>
                                <p className="text-slate-500 text-[10px] font-medium">Origen: {remitoData.AreaOrigenID} • Destino: {remitoData.AreaDestinoID}</p>
                            </div>
                            <div className="text-right flex items-center gap-2 sm:gap-4">
                                <button onClick={() => setStep(1)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg font-bold text-[10px] sm:text-xs transition-colors uppercase shadow-sm mr-2 whitespace-nowrap">
                                    Cambiar
                                </button>
                                
                                <button onClick={handleConfirmClick} className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-[10px] sm:text-xs hover:bg-slate-900 transition-colors uppercase shadow-sm flex items-center gap-2 whitespace-nowrap">
                                    Confirmar Retiro
                                    <i className="fa-solid fa-file-signature"></i>
                                </button>

                                {scannedCount === totalItems && (
                                    <div className="text-center text-emerald-600 font-bold text-xs py-1 px-2"><i className="fa-solid fa-check-circle mr-1"></i> Completo</div>
                                )}
                                
                                <div className="border-l border-slate-200 pl-4 ml-2">
                                    <div className={`text-2xl font-black leading-none ${progressColor}`}>
                                        {scannedCount} <span className="text-slate-300 text-lg">/ {totalItems}</span>
                                    </div>
                                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Verificados</div>
                                </div>
                            </div>
                        </div>

                        {/* SCANNER COMPACT */}
                        <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 p-3 flex flex-col sm:flex-row justify-center items-center gap-3 relative overflow-hidden">
                            <h3 className="text-slate-300 font-bold uppercase tracking-wider text-xs whitespace-nowrap">Escáner</h3>
                            <form onSubmit={(e) => handleScanItem(e)} className="w-full max-w-md">
                                <input
                                    ref={itemInputRef}
                                    autoFocus
                                    type="text"
                                    value={itemInput}
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
                                    <span>Lista de Carga ({totalItems})</span>
                                    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-600 bg-white px-2 py-1 rounded border shadow-sm">
                                        <input type="checkbox" checked={showOnlyPending} onChange={e => setShowOnlyPending(e.target.checked)} className="form-checkbox text-indigo-600 rounded cursor-pointer" />
                                        Solo Pendientes
                                    </label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            if (scannedCodes.size === remitoData.items.length) {
                                                setScannedCodes(new Set());
                                            } else {
                                                setScannedCodes(new Set(remitoData.items.map(i => i.CodigoEtiqueta)));
                                            }
                                        }}
                                        className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-2 py-1 rounded transition-colors uppercase"
                                    >
                                        {scannedCodes.size === remitoData.items.length ? 'Deseleccionar' : 'Marcar Todos'}
                                    </button>
                                    
                                    {(() => {
                                        const faltanCount = totalItems - scannedCount;
                                        return faltanCount > 0 ? (
                                            <span className="text-rose-500 font-bold uppercase text-[10px] bg-rose-50 px-2 py-1 rounded border border-rose-100">
                                                Faltan {faltanCount}
                                            </span>
                                        ) : null;
                                    })()}
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                    {remitoData.items.filter(item => {
                                        const scanned = scannedCodes.has(item.CodigoEtiqueta);
                                        if (showOnlyPending && scanned) return false;
                                        return true;
                                    }).map((item, idx) => {
                                        const scanned = scannedCodes.has(item.CodigoEtiqueta);
                                        return (
                                            <div
                                                key={idx}
                                                onClick={() => {
                                                    if (scanned) {
                                                        const next = new Set(scannedCodes);
                                                        next.delete(item.CodigoEtiqueta);
                                                        setScannedCodes(next);
                                                    } else {
                                                        setScannedCodes(prev => new Set(prev).add(item.CodigoEtiqueta));
                                                    }
                                                }}
                                                className={`p-2 rounded-lg border flex flex-col gap-1 transition-all cursor-pointer select-none text-xs ${scanned
                                                    ? 'bg-emerald-50 border-emerald-200 opacity-75'
                                                    : 'bg-white border-slate-100 hover:border-slate-300'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="font-bold font-mono text-slate-700 truncate">{item.CodigoEtiqueta}</div>
                                                    <div className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${scanned ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                                        {scanned ? <i className="fa-solid fa-check"></i> : (idx + 1)}
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-slate-500 truncate w-full">{item.Descripcion || "Sin descripción"}</div>
                                                {scanned && <span className="text-[9px] font-bold text-emerald-600 uppercase mt-0.5">Verificado</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* AUTH MODAL */}
            {showAuth && (
                <div className="fixed inset-0 bg-slate-900/80  flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md animate-in zoom-in duration-200">
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-600 text-2xl">
                                <i className="fa-solid fa-user-shield"></i>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800">Autenticación de Salida</h3>
                            <p className="text-slate-500 text-sm">Ingrese credenciales del responsable para firmar la salida.</p>
                        </div>

                        <form onSubmit={handleAuthSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Usuario</label>
                                <input
                                    type="text"
                                    autoFocus
                                    autoComplete="username"
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-200 outline-none font-bold text-slate-700"
                                    placeholder="ej: usuario.sistema"
                                    value={creds.username || ''} // Handle undefined init
                                    onChange={e => setCreds(prev => ({ ...prev, username: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contraseña</label>
                                <input
                                    type="password"
                                    autoComplete="current-password"
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-200 outline-none font-bold text-slate-700"
                                    placeholder="••••••••"
                                    value={creds.password || ''}
                                    onChange={e => setCreds(prev => ({ ...prev, password: e.target.value }))}
                                />
                            </div>

                            {scannedCount < totalItems && (
                                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-xs font-medium flex gap-2">
                                    <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
                                    <div>
                                        Advertencia: Solo has verificado {scannedCount} de {totalItems} bultos. Esto generará un retiro parcial.
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowAuth(false)}
                                    className="flex-1 py-2 rounded-lg border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-md shadow-emerald-200"
                                >
                                    {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : 'Firmar y Salir'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TransportControlPage;
