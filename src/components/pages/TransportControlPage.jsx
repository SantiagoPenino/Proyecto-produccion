import React, { useState, useEffect, useRef } from 'react';
import { authService } from '../../services/api';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { Truck, ScanBarcode, ArrowRight, FileSignature, CheckCircle2, Check, ShieldCheck, AlertTriangle, Loader2, ScanLine } from 'lucide-react';

// Estética nueva (22/10/2026): encabezado con ícono brand-cyan sin fondo, tarjetas blancas zinc, escáner claro,
// íconos Lucide en vez de Font Awesome y el modal de firma en z-[6000]. El color queda para el estado del escaneo.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO_MODAL = 'w-full px-4 py-2.5 rounded-xl border border-zinc-200 bg-white outline-none font-bold text-zinc-800 placeholder:text-zinc-300 placeholder:font-normal focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';

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
                // El login interno devuelve userId (no id) — con .id quedaba "ID: undefined"
                // y el backend caía al usuario 1 como firmante
                driverDetails: `Firmado digitalmente por ID: ${authUser.userId}`,
                userId: authUser.userId
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
    const progressColor = scannedCount === totalItems ? 'text-emerald-600' : 'text-zinc-900';

    const faltanCount = totalItems - scannedCount;
    const ESTADO_ESCANEO = {
        success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        error:   'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20',
        warning: 'bg-amber-50 text-amber-700 border-amber-200',
    };

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">
            <div className="space-y-4">

                {/* HEADER */}
                <div className="flex items-center gap-3">
                    <Truck size={30} className="text-brand-cyan shrink-0" />
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Control de Transporte</h1>
                        <p className="text-sm text-zinc-500 mt-1">Validación de carga por transportista/cadete</p>
                    </div>
                </div>

                {/* STEP 1: SELECT REMITO */}
                {step === 1 && (
                    <div className={`${CARD} max-w-2xl mx-auto mt-6 sm:mt-10 px-5 py-8 sm:p-10 text-center`}>
                        <ScanBarcode size={44} className="text-brand-cyan mx-auto mb-4" />
                        <h2 className="text-lg font-black text-zinc-900 mb-1">Escanear remito</h2>
                        <p className="text-sm text-zinc-500 mb-6">Escaneá el código QR del remito (REM-XXXXXX) para comenzar la validación.</p>

                        <form onSubmit={handleSearchRemito} className="relative max-w-md mx-auto">
                            <input
                                autoFocus
                                type="text"
                                className="w-full text-center text-xl sm:text-2xl font-mono font-bold text-zinc-900 py-4 pl-4 pr-20 sm:px-20 bg-white border border-zinc-200 rounded-xl outline-none transition-colors uppercase hover:border-zinc-300 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 placeholder:text-zinc-300"
                                placeholder="REM-000000"
                                value={remitoCode}
                                onChange={e => setRemitoCode(e.target.value)}
                            />
                            <button
                                type="submit"
                                disabled={loading || !remitoCode}
                                title="Buscar remito"
                                className="absolute right-2 top-2 bottom-2 w-14 rounded-lg bg-brand-cyan text-white inline-flex items-center justify-center hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={20} />}
                            </button>
                        </form>
                    </div>
                )}

                {/* STEP 2: SCANNING INTERFACE (COMPACT VERTICAL) */}
                {step === 2 && remitoData && (
                    <div className="flex flex-col gap-3 pb-20">
                        {/* HEADER DETAIL */}
                        <div className={`${CARD} px-4 sm:px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-3`}>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Remito</p>
                                <h2 className="text-lg font-black font-mono text-zinc-900 leading-tight truncate">{remitoData.CodigoRemito}</h2>
                                <p className="text-xs text-zinc-500 mt-0.5">Origen: <span className="font-bold text-zinc-700">{remitoData.AreaOrigenID}</span> · Destino: <span className="font-bold text-zinc-700">{remitoData.AreaDestinoID}</span></p>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="text-right">
                                    <div className={`text-2xl font-black leading-none tabular-nums ${progressColor}`}>
                                        {scannedCount}<span className="text-zinc-300 text-lg"> / {totalItems}</span>
                                    </div>
                                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1 inline-flex items-center gap-1">
                                        {scannedCount === totalItems && <CheckCircle2 size={11} className="text-emerald-600" />}
                                        {scannedCount === totalItems ? 'Completo' : 'Verificados'}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setStep(1)} className={BTN_SECUNDARIO}>
                                        Cambiar
                                    </button>
                                    <button onClick={handleConfirmClick} className={BTN_PRINCIPAL}>
                                        <FileSignature size={15} /> Confirmar retiro
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* SCANNER COMPACT */}
                        <div className={`${CARD} p-3 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3`}>
                            <form onSubmit={(e) => handleScanItem(e)} className="relative flex-1 min-w-0">
                                <ScanLine size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-cyan pointer-events-none" />
                                <input
                                    ref={itemInputRef}
                                    autoFocus
                                    type="text"
                                    value={itemInput}
                                    onChange={handleScanInputChange}
                                    onKeyDown={handleKeyDown}
                                    aria-label="Escáner de bultos"
                                    className="w-full pl-12 pr-4 py-3 bg-white border border-zinc-200 rounded-xl font-mono text-lg font-bold text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 placeholder:text-zinc-300 placeholder:font-normal"
                                    placeholder="Escanear QR..."
                                />
                            </form>
                            <div className={`sm:w-[300px] shrink-0 flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-bold text-center transition-colors min-w-0 ${ESTADO_ESCANEO[lastScanMsg?.type] || 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>
                                {lastScanMsg?.type === 'success' && <CheckCircle2 size={15} className="shrink-0" />}
                                {(lastScanMsg?.type === 'error' || lastScanMsg?.type === 'warning') && <AlertTriangle size={15} className="shrink-0" />}
                                <span className="min-w-0 break-words">{lastScanMsg ? lastScanMsg.text : 'Esperando...'}</span>
                            </div>
                        </div>

                        {/* LIST */}
                        <div className={`${CARD} flex flex-col overflow-hidden max-h-[600px]`}>
                            <div className="px-4 sm:px-5 py-3 border-b border-zinc-100 flex flex-wrap justify-between items-center gap-2">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-sm font-black uppercase tracking-wide text-zinc-800">Lista de carga <span className="text-zinc-400 tabular-nums">({totalItems})</span></span>
                                    <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-zinc-600">
                                        <input type="checkbox" checked={showOnlyPending} onChange={e => setShowOnlyPending(e.target.checked)} className="w-4 h-4 rounded border-zinc-300 accent-brand-cyan cursor-pointer" />
                                        Solo pendientes
                                    </label>
                                </div>
                                <div className="flex items-center gap-2">
                                    {faltanCount > 0 && (
                                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                                            Faltan {faltanCount}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (scannedCodes.size === remitoData.items.length) {
                                                setScannedCodes(new Set());
                                            } else {
                                                setScannedCodes(new Set(remitoData.items.map(i => i.CodigoEtiqueta)));
                                            }
                                        }}
                                        className="px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
                                    >
                                        {scannedCodes.size === remitoData.items.length ? 'Deseleccionar' : 'Marcar todos'}
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
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
                                                className={`px-3 py-2.5 rounded-xl border flex flex-col gap-1 transition-colors cursor-pointer select-none text-xs ${scanned
                                                    ? 'bg-emerald-50 border-emerald-200'
                                                    : 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="font-bold font-mono text-zinc-800 truncate">{item.CodigoEtiqueta}</div>
                                                    <div className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums ${scanned ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                                                        {scanned ? <Check size={12} strokeWidth={3} /> : (idx + 1)}
                                                    </div>
                                                </div>
                                                <div className="text-[11px] text-zinc-500 truncate w-full">{item.Descripcion || "Sin descripción"}</div>
                                                {scanned && <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider mt-0.5">Verificado</span>}
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
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[6000]">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl p-6 sm:p-8 w-full max-w-md animate-in zoom-in duration-200">
                        <div className="text-center mb-6">
                            <ShieldCheck size={40} className="text-brand-cyan mx-auto mb-3" />
                            <h3 className="text-lg font-black text-zinc-900">Autenticación de salida</h3>
                            <p className="text-sm text-zinc-500 mt-1">Ingrese credenciales del responsable para firmar la salida.</p>
                        </div>

                        <form onSubmit={handleAuthSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="transporte-usuario" className="block text-[11px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Usuario</label>
                                <input
                                    id="transporte-usuario"
                                    type="text"
                                    autoFocus
                                    autoComplete="username"
                                    className={CAMPO_MODAL}
                                    placeholder="ej: usuario.sistema"
                                    value={creds.username || ''} // Handle undefined init
                                    onChange={e => setCreds(prev => ({ ...prev, username: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label htmlFor="transporte-clave" className="block text-[11px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Contraseña</label>
                                <input
                                    id="transporte-clave"
                                    type="password"
                                    autoComplete="current-password"
                                    className={CAMPO_MODAL}
                                    placeholder="••••••••"
                                    value={creds.password || ''}
                                    onChange={e => setCreds(prev => ({ ...prev, password: e.target.value }))}
                                />
                            </div>

                            {scannedCount < totalItems && (
                                <div className="px-3.5 py-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs font-medium flex gap-2">
                                    <AlertTriangle size={15} className="shrink-0 mt-px" />
                                    <div>
                                        Advertencia: Solo has verificado {scannedCount} de {totalItems} bultos. Esto generará un retiro parcial.
                                    </div>
                                </div>
                            )}

                            <div className="pt-2 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowAuth(false)}
                                    className={`${BTN_SECUNDARIO} flex-1 py-2.5`}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className={`${BTN_PRINCIPAL} flex-1 py-2.5`}
                                >
                                    {loading ? <Loader2 size={16} className="animate-spin" /> : 'Firmar y Salir'}
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
