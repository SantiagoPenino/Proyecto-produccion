import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { logisticsService } from '../../../services/modules/logisticsService';
import api from '../../../services/apiClient';
import CreateDispatchModal from '../../modals/CreateDispatchModal';
import { Toaster, toast } from 'react-hot-toast';

const LogisticsPage = () => {
    const { user } = useAuth();
    const [mode, setMode] = useState('INGRESO'); // INGRESO (De Cliente/Proveedor) | EGRESO (A Cliente o Planta)
    const [areaId, setAreaId] = useState('');
    const [scans, setScans] = useState([]);
    const [currentInput, setCurrentInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Manage Remito Modal
    const [isDispatchModalOpen, setDispatchModalOpen] = useState(false);
    const [dispatchData, setDispatchData] = useState([]); // Selected items to dispatch

    const [areas, setAreas] = useState([]);
    const inputRef = useRef(null);

    // Cargar Áreas
    useEffect(() => {
        api.get('/areas?productive=true').then(res => {
            setAreas(res.data);
            if (user && user.areaId) setAreaId(user.areaId);
            else if (res.data.length > 0) setAreaId(res.data[0].Nombre);
        }).catch(err => console.error(err));
    }, [user]);

    // Focus input
    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, [scans, mode]);

    const handleScan = (e) => {
        if (e.key === 'Enter' && currentInput.trim()) {
            const code = currentInput.trim().toUpperCase();
            if (!scans.find(s => s.code === code)) {
                validateCode(code);
            }
            setCurrentInput('');
        }
    };

    const validateCode = async (code) => {
        setLoading(true);
        try {
            // Usamos legacy validate para chequear info basica
            const res = await api.post('/logistics/validate-batch', { codes: [code], areaId, type: mode });
            const result = res.data.results[0];

            // Si es valido o informativo, lo agregamos
            setScans(prev => [...prev, {
                code: code,
                isValid: result.isValid,
                message: result.message,
                nextService: result.nextService,
                isNew: result.isNew,
                // Info extra para el remito
                id: code, // Fallback ID if not BultoID, but normally backend resolves
                desc: result.entity?.Descripcion || 'Sin descripción',
                client: result.entity?.Cliente || 'Cliente General'
            }]);

            if (result.isValid) toast.success(`Bulto ${code} agregado.`);
            else toast.error(`Alerta en ${code}: ${result.message}`);

        } catch (err) {
            console.error(err);
            toast.error("Error validando código");
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = async () => {
        const validScans = scans.filter(s => s.isValid); // Filtramos solo validos? O permitimos forzar?
        if (validScans.length === 0) return;

        if (mode === 'EGRESO') {
            // ABRIR MODAL DE REMITO WMS
            // Necesitamos pasar objetos con estructura { id, bultos: [{id}] } compatible con el modal
            // Como aqui escaneamos codigos directo, simulamos la estructura de orden

            // PRIMERO: Resolver BultoIDs reales desde Backend para estos codigos
            // (Hack rápido: asumimos que el backend de createDispatch aceptará codigos si adaptamos, 
            // PERO el modal espera IDs. Vamos a buscar los IDs reales).
            try {
                // Hacer una llamada para obtener IDs reales de los codigos escaneados
                // O usar el endpoint de validate que ya podria devolverlos si lo mejoramos.
                // Por ahora, el user quiere funcionalidad: Vamos a asumir que el modal puede manejar esto o
                // hacemos un map rapido.

                // Opción Robusta: Pedir detalles completos
                const details = await Promise.all(validScans.map(async s => {
                    try {
                        const r = await logisticsService.getBultoByLabel(s.code);
                        return {
                            id: r.BultoID,
                            code: r.CodigoEtiqueta,
                            ...r
                        };
                    } catch (e) {
                        return null;
                    }
                }));

                const validBultos = details.filter(Boolean);

                if (validBultos.length === 0) {
                    toast.error("No se encontraron bultos válidos en sistema WMS para generar remito.");
                    return;
                }

                // Estructura para CreateDispatchModal (espera ordenes con bultos)
                const mockOrders = [{
                    id: 'MANUAL_SCAN',
                    code: 'SELECCIÓN MANUAL',
                    client: 'Varios / Manual',
                    mode: 'MANUAL',
                    bultos: validBultos // Paso directo de bultos
                }];

                setDispatchData(mockOrders);
                setDispatchModalOpen(true);

            } catch (error) {
                console.error(error);
                toast.error("Error preparando datos para remito.");
            }

        } else {
            // MODO INGRESO (Recepción de Cliente / Entrega a Cliente?)
            // El usuario dijo "cuando en atencional cliente se reciben los bultos hay que generar tambien un comprobante con todo el detalle para entregar al cliente"
            // Suena a que esto es una RECEPCION DE TELA o PRENDAS del cliente.
            // Generamos comprobante de RECEPCIÓN.

            if (confirm(`¿Confirmar recepción de ${validScans.length} bultos? Esto generará un comprobante.`)) {
                await processReception(validScans);
            }
        }
    };

    const processReception = async (bultos) => {
        setLoading(true);
        try {
            const payload = {
                movements: bultos.map(s => ({ orden: s.code, isNew: s.isNew })),
                areaId,
                type: 'INGRESO',
                usuarioId: user ? user.id : 1
            };

            // Usamos legacy process para actualizar estados masivamente
            const res = await api.post('/logistics/process-batch', payload);

            if (res.data.success) {
                toast.success("Recepción procesada exitosamente.");
                printClientReceipt(bultos, areaId); // IMPRIMIR COMPROBANTE DETALLADO
                setScans([]);
            }
        } catch (error) {
            console.error(error);
            toast.error("Error al procesar recepción: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const printClientReceipt = (items, area) => {
        const date = new Date().toLocaleString();
        const clientName = items[0]?.client || 'Consumidor Final';
        // Agrupar si es posible

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>COMPROBANTE DE RECEPCIÓN</title>
            <style>
                body { font-family: 'Helvetica', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                .logo { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
                .info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                th { background-color: #f4f4f4; }
                .footer { margin-top: 40px; font-size: 10px; text-align: center; border-top: 1px solid #ccc; padding-top: 10px; }
                .signature { margin-top: 50px; display: flex; justify-content: space-between; }
                .sig-box { border-top: 1px solid #000; width: 40%; text-align: center; padding-top: 5px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">USER TEXTIL</div>
                <div>Comprobante de Recepción de Mercadería</div>
                <div>Sucursal: ${area}</div>
            </div>

            <div class="info">
                <div>
                    <strong>Fecha:</strong> ${date}<br>
                    <strong>Usuario:</strong> ${user?.usuario || 'Sistema'}
                </div>
                <div style="text-align: right;">
                    <strong>Cliente Referencia:</strong> ${clientName}<br>
                    <strong>Total Bultos:</strong> ${items.length}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Código / Etiqueta</th>
                        <th>Descripción / Detalle</th>
                        <th>Estado Inicial</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((item, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td><strong>${item.code}</strong></td>
                            <td>${item.message || '-'}</td>
                            <td>RECIBIDO EN PLANTA</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="signature">
                <div class="sig-box">Firma y Aclaración Cliente</div>
                <div class="sig-box">Firma Responsable Recepción</div>
            </div>

            <div class="footer">
                Este documento certifica la recepción de los bultos detallados para su procesamiento.
                Conserve este comprobante para cualquier reclamo.
            </div>

            <script>window.onload = () => window.print();</script>
        </body>
        </html>
        `;

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        iframe.contentDocument.write(html);
        iframe.contentDocument.close();
    };

    const removeScan = (idx) => {
        setScans(scans.filter((_, i) => i !== idx));
    };

    return (
        <div className="p-6 bg-slate-50 min-h-screen font-sans">
            <Toaster position="top-right" />

            {/* Header */}
            <div className="bg-[#1e293b] text-white p-6 rounded-2xl shadow-lg mb-8 flex justify-between items-center flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-3">
                        <span className="bg-blue-500 p-2 rounded-lg text-white text-lg"><i className="fa-solid fa-boxes-stacked"></i></span>
                        Modulo de Atención
                    </h1>
                    <p className="text-slate-400 text-sm font-medium mt-1 ml-1">Ingreso y Egreso de Mercadería</p>
                </div>

                <div className="flex bg-white/5 rounded-xl p-1 gap-1">
                    <button
                        onClick={() => setMode('INGRESO')}
                        className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${mode === 'INGRESO' ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <i className="fa-solid fa-download mr-2"></i> RECEPCIÓN
                    </button>
                    <button
                        onClick={() => setMode('EGRESO')}
                        className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${mode === 'EGRESO' ? 'bg-blue-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <i className="fa-solid fa-upload mr-2"></i> DESPACHO
                    </button>
                </div>
            </div>

            {/* Scanner Area */}
            <div className="flex flex-col md:flex-row gap-6 items-start">

                {/* Input Card */}
                <div className="w-full md:w-1/3 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                        {mode === 'INGRESO' ? 'Escanear para Recibir' : 'Escanear para Despachar'}
                    </label>

                    <div className="relative mb-4">
                        <i className="fa-solid fa-barcode absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl"></i>
                        <input
                            ref={inputRef}
                            type="text"
                            value={currentInput}
                            onChange={e => setCurrentInput(e.target.value)}
                            onKeyDown={handleScan}
                            placeholder="Escanear etiqueta..."
                            className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-xl font-mono text-lg font-bold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                            autoFocus
                        />
                    </div>

                    <div className="text-center p-4 bg-blue-50 rounded-xl border border-blue-100 mb-4">
                        <div className="text-blue-800 font-black text-3xl">{scans.length}</div>
                        <div className="text-blue-600 text-[10px] font-bold uppercase tracking-wider">Bultos en Cola</div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <button
                            onClick={handleConfirm}
                            disabled={scans.length === 0 || loading}
                            className={`w-full py-4 rounded-xl font-bold text-sm shadow-lg active:scale-95 transition-all text-white flex items-center justify-center gap-2
                                ${scans.length === 0 ? 'bg-slate-300 cursor-not-allowed shadow-none' :
                                    mode === 'INGRESO' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200' : 'bg-blue-500 hover:bg-blue-600 shadow-blue-200'}
                            `}
                        >
                            {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> :
                                mode === 'INGRESO' ? <i className="fa-solid fa-print"></i> : <i className="fa-solid fa-truck-fast"></i>
                            }
                            {mode === 'INGRESO' ? 'CONFIRMAR Y GENERAR COMPROBANTE' : 'GENERAR REMITO DE SALIDA'}
                        </button>

                        <button
                            onClick={() => setScans([])}
                            disabled={scans.length === 0}
                            className="w-full py-3 rounded-xl border border-slate-200 text-slate-500 font-bold text-xs hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                        >
                            LIMPIAR TODO
                        </button>
                    </div>
                </div>

                {/* List Card */}
                <div className="w-full md:w-2/3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Detalle de items escaneados</span>
                        <span className="text-xs font-bold text-slate-400">{new Date().toLocaleDateString()}</span>
                    </div>

                    <div className="flex-1 overflow-auto p-0">
                        {scans.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10 opacity-70">
                                <i className="fa-solid fa-basket-shopping text-6xl mb-4"></i>
                                <span className="font-bold text-sm">Esperando lectura de etiquetas...</span>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-white sticky top-0 z-10 text-[10px] font-black uppercase text-slate-400">
                                    <tr>
                                        <th className="px-6 py-3 border-b border-slate-100 w-10">#</th>
                                        <th className="px-6 py-3 border-b border-slate-100">Código</th>
                                        <th className="px-6 py-3 border-b border-slate-100">Info Sistema</th>
                                        <th className="px-6 py-3 border-b border-slate-100 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 text-sm">
                                    {scans.map((scan, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                                            <td className="px-6 py-3 text-slate-400 font-mono text-xs">{idx + 1}</td>
                                            <td className="px-6 py-3 font-bold text-slate-700">{scan.code}</td>
                                            <td className="px-6 py-3">
                                                <div className="flex flex-col">
                                                    <span className={`text-xs font-bold ${scan.isValid ? 'text-emerald-600' : 'text-red-500'}`}>
                                                        {scan.message}
                                                    </span>
                                                    {scan.nextService && <span className="text-[10px] text-slate-400 mt-0.5">Destino Sugerido: {scan.nextService}</span>}
                                                </div>
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <button
                                                    onClick={() => removeScan(idx)}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                                                >
                                                    <i className="fa-solid fa-trash-can"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Remito */}
            <CreateDispatchModal
                isOpen={isDispatchModalOpen}
                onClose={() => setDispatchModalOpen(false)}
                selectedOrders={dispatchData} // Pasamos la "Orden Mock" que contiene los bultos
                originArea={areaId || user?.areaId || 'ATENCION'}
                // nextServices={['LOGISTICA', 'CLIENTE']} // Defaults
                onSuccess={() => {
                    setScans([]);
                    setDispatchModalOpen(false);
                    // toast.success("Remito Generado Correctamente"); -> El modal ya maneja su flujo
                }}
            />
        </div>
    );
};

export default LogisticsPage;
