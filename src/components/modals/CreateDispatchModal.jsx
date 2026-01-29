import React, { useState, useEffect, useMemo } from 'react';
import { logisticsService, authService } from '../../services/api';
import QRCode from "react-qr-code";
import { toast } from 'sonner';

const CreateDispatchModal = ({ isOpen, onClose, selectedOrders, originArea, nextServices, onSuccess }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]); // Array of created dispatches
    const [logs, setLogs] = useState([]);

    // Auth State
    const [credentials, setCredentials] = useState({ username: '', password: '' });

    // 1. Agrupar ordenes por Destino (ProximoServicio)
    const dispatchGroups = useMemo(() => {
        const groups = {};
        selectedOrders.forEach(o => {
            const dest = o.nextService || o.destino || 'LOGISTICA';
            if (!groups[dest]) groups[dest] = [];
            groups[dest].push(o);
        });

        return groups;
    }, [selectedOrders]);

    // Reset state on open
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setResults([]);
            setLogs([]);
            setCredentials({ username: '', password: '' });
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleCreateBatch = async () => {
        if (!credentials.username || !credentials.password) {
            toast.error("Debe ingresar usuario y contraseña para firmar la salida.");
            return;
        }

        setLoading(true);
        setLogs([]);
        const createdParams = [];

        try {
            // 1. Authenticate User
            let authUser = null;
            try {
                const authRes = await authService.login(credentials.username, credentials.password);
                if (authRes && authRes.user) {
                    authUser = authRes.user;
                } else {
                    throw new Error("Credenciales inválidas.");
                }
            } catch (e) {
                toast.error("Error de autenticación: Credenciales incorrectas.");
                setLoading(false);
                return;
            }

            setLogs(prev => [...prev, `Autenticado como: ${authUser.username}`]);

            // 2. Create Dispatches
            const destinations = Object.keys(dispatchGroups);

            for (const dest of destinations) {
                const orders = dispatchGroups[dest];

                // --- MODIFICATION: Handle Virtual Items (Auto-Create) ---
                const bultosIds = [];
                const newBultos = [];

                orders.forEach(o => {
                    if (o.bultos && o.bultos.length > 0) {
                        o.bultos.forEach(b => {
                            if (b.isVirtual || !b.id) {
                                // Add to creation list
                                newBultos.push({
                                    ordenId: o.id,
                                    descripcion: o.desc || 'Bulto generado en despacho'
                                });
                            } else {
                                bultosIds.push(b.id);
                            }
                        });
                    }
                });

                if (bultosIds.length === 0 && newBultos.length === 0) continue;

                setLogs(prev => [...prev, `Generando remito para ${dest} (${bultosIds.length} items, ${newBultos.length} nuevos)...`]);

                const payload = {
                    codigoRemito: 'AUTO',
                    areaOrigen: originArea || 'PRODUCCION',
                    areaDestino: dest,
                    usuarioId: authUser.id, // Use Authenticated User ID
                    transportista: authUser.username, // Use Username as 'Transportista' field for record
                    bultosIds: bultosIds,
                    newBultos: newBultos, // Send new items to create
                    observations: `Remito generado por ${authUser.username} (${authUser.role || 'User'})`
                };

                const res = await logisticsService.createDispatch(payload);
                createdParams.push({
                    ...res,
                    destArea: dest,
                    itemCount: (bultosIds.length + (res.createdCount || 0))
                });
            }

            setResults(createdParams);
            setStep(2); // Show Results
            if (onSuccess) onSuccess();

        } catch (error) {
            console.error(error);
            toast.error("Error generando remitos: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-[1400] print:p-0 print:bg-white">
            <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] print:shadow-none print:w-full print:max-w-none print:h-full print:max-h-none print:rounded-none transition-all`}>

                {/* HEADER */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 print:hidden">
                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-truck-ramp-box text-blue-600"></i>
                        {step === 1 ? 'Autorizar Salida de Mercadería' : 'Remitos Generados'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors">
                        <i className="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                {/* STEP 1: PREVIEW GROUPS & AUTH */}
                {step === 1 && (
                    <div className="p-6 flex flex-col gap-6 overflow-y-auto">

                        {/* Summary Section */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detalle del Envío</h4>
                            {Object.entries(dispatchGroups).map(([dest, orders]) => (
                                <div key={dest} className="flex justify-between items-center p-3 border border-slate-200 rounded-lg bg-slate-50">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                                            {orders.reduce((acc, o) => acc + (o.bultos?.length || 0), 0)}
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm">Hacia: {dest}</div>
                                            <div className="text-[10px] text-slate-500">{orders.length} lotes</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <hr className="border-slate-100" />

                        {/* AUTHENTICATION FORM */}
                        <form id="auth-form" onSubmit={(e) => { e.preventDefault(); handleCreateBatch(); }} className="space-y-4">
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <i className="fa-solid fa-user-shield text-blue-600"></i>
                                Autenticación de Responsable
                            </div>
                            <p className="text-xs text-slate-500">Ingrese sus credenciales para firmar digitalmente la salida de estos materiales.</p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Usuario</label>
                                    <input
                                        type="text"
                                        name="username"
                                        autoFocus
                                        autoComplete="username"
                                        className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                                        placeholder="ej: juan.perez"
                                        value={credentials.username}
                                        onChange={e => setCredentials({ ...credentials, username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Contraseña</label>
                                    <input
                                        type="password"
                                        name="password"
                                        autoComplete="current-password"
                                        className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                                        placeholder="••••••••"
                                        value={credentials.password}
                                        onChange={e => setCredentials({ ...credentials, password: e.target.value })}
                                    />
                                </div>
                            </div>
                            {/* Hidden submit button to enable Enter key submission */}
                            <button type="submit" className="hidden" />
                        </form>

                        {logs.length > 0 && (
                            <div className="p-3 bg-slate-800 text-emerald-400 font-mono text-xs rounded-lg mt-2">
                                {logs.map((l, i) => <div key={i}>{l}</div>)}
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 2: RESULTS (REMITOS) */}
                {step === 2 && (
                    <div className="p-8 flex flex-col items-center gap-8 overflow-y-auto print:p-0">
                        {results.map((res, idx) => (
                            <div key={idx} className="w-full border-2 border-dashed border-slate-800 p-6 rounded-xl bg-white text-center print:border-4 print:border-black print:rounded-none page-break-after-always">
                                <div className="flex justify-between items-end border-b-2 border-slate-900 pb-4 mb-6">
                                    <h1 className="text-4xl font-black uppercase text-slate-900 tracking-tighter">REMITO</h1>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-500">FECHA</div>
                                        <div className="font-mono font-bold">{new Date().toLocaleDateString()}</div>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center bg-slate-100 p-3 rounded mb-6 print:bg-slate-100 print:print-color-adjust-exact">
                                    <div className="text-left">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ORIGEN</div>
                                        <div className="font-black text-xl text-slate-800">{originArea || 'PRODUCCION'}</div>
                                    </div>
                                    <div className="text-2xl text-slate-300"><i className="fa-solid fa-arrow-right"></i></div>
                                    <div className="text-right">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">DESTINO</div>
                                        <div className="font-black text-xl text-slate-800">{res.destArea}</div>
                                    </div>
                                </div>

                                <div className="flex justify-center mb-4">
                                    <QRCode value={res.dispatchCode} size={150} />
                                </div>

                                <div className="text-3xl font-black font-mono tracking-widest text-slate-900 mb-6 select-all border-b border-t border-slate-200 py-4">
                                    {res.dispatchCode}
                                </div>

                                <div className="text-sm font-bold text-slate-500">
                                    {res.itemCount} Bultos | {res.observations}
                                </div>
                            </div>
                        ))}

                        <div className="print:hidden w-full bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-yellow-800 text-sm text-center">
                            <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                            Si generaste múltiples remitos, asegúrate de imprimir todos (scroll hacia abajo o usa la configuración de impresora).
                        </div>
                    </div>
                )}

                {/* FOOTER */}
                <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 print:hidden">
                    {step === 1 ? (
                        <>
                            <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-white transition-colors">Cancelar</button>
                            <button
                                onClick={handleCreateBatch}
                                disabled={loading || !credentials.username || !credentials.password}
                                className="px-6 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm shadow-lg shadow-slate-300 hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 disabled:shadow-none"
                            >
                                {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <><i className="fa-solid fa-signature mr-2"></i> Firmar y Generar</>}
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-white transition-colors">Cerrar</button>
                            <button
                                onClick={handlePrint}
                                className="px-6 py-2.5 rounded-xl bg-slate-800 text-white font-bold text-sm shadow-lg hover:bg-slate-900 active:scale-95 transition-all"
                            >
                                <i className="fa-solid fa-print mr-2"></i> Imprimir Todo
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* CSS Helper for Printing Multiple Pages */}
            <style jsx>{`
                @media print {
                    .page-break-after-always {
                        page-break-after: always;
                    }
                    .page-break-after-always:last-child {
                        page-break-after: auto;
                    }
                }
            `}</style>
        </div>
    );
};

export default CreateDispatchModal;
