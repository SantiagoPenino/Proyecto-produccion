import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { logisticsService } from '../../../services/modules/logisticsService';
import api from '../../../services/apiClient';
import CreateDispatchModal from '../../modals/CreateDispatchModal';
import { toast } from 'sonner';
import { Boxes, Download, Upload, ScanBarcode, Printer, Truck, Loader2, Trash2, PackageOpen } from 'lucide-react';
import useConfirmar from '../../ui/useConfirmar';

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
    const [confirmar, ventanaConfirmar] = useConfirmar();

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

            const ok = await confirmar({
                titulo: `¿Confirmar la recepción de ${validScans.length} bulto${validScans.length !== 1 ? 's' : ''}?`,
                texto: 'Se genera el comprobante para entregarle al cliente.',
                confirmar: 'Confirmar',
            });
            if (ok) await processReception(validScans);
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

    const esIngreso = mode === 'INGRESO';
    const MODOS = [['INGRESO', 'Recepción', Download], ['EGRESO', 'Despacho', Upload]];

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <Boxes size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Módulo de Atención</h1>
                    <p className="text-sm text-zinc-500 mt-1">Ingreso y egreso de mercadería</p>
                </div>
                <div className="flex w-full sm:w-auto rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                    {MODOS.map(([k, label, Icono]) => (
                        <button key={k} type="button" onClick={() => setMode(k)}
                            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${mode === k ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                            <Icono size={15} className={mode === k ? 'text-white' : 'text-brand-cyan'} /> {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-start">

                {/* Escáner */}
                <div className="w-full md:w-[380px] shrink-0 bg-white rounded-2xl border border-zinc-200 p-5 flex flex-col gap-4">
                    <div>
                        <label htmlFor="escaneo-atencion" className="block mb-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400">
                            {esIngreso ? 'Escanear para recibir' : 'Escanear para despachar'}
                        </label>
                        <div className="relative">
                            <ScanBarcode size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-cyan pointer-events-none" />
                            <input
                                id="escaneo-atencion"
                                ref={inputRef}
                                type="text"
                                value={currentInput}
                                onChange={e => setCurrentInput(e.target.value)}
                                onKeyDown={handleScan}
                                placeholder="Escanear etiqueta…"
                                className="w-full pl-12 pr-4 py-3.5 bg-white border border-zinc-200 rounded-xl font-mono text-lg font-bold text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 placeholder:text-zinc-300"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 flex items-baseline justify-center gap-2">
                        <span className="text-3xl font-black tabular-nums text-zinc-900">{scans.length}</span>
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">bulto{scans.length !== 1 ? 's' : ''} en cola</span>
                    </div>

                    <div className="flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={scans.length === 0 || loading}
                            className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-brand-cyan hover:bg-brand-cyan/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : esIngreso ? <Printer size={16} /> : <Truck size={16} />}
                            {esIngreso ? 'Confirmar y generar comprobante' : 'Generar remito de salida'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setScans([])}
                            disabled={scans.length === 0}
                            className="w-full py-2.5 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-500 transition-colors hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-zinc-500 disabled:hover:border-zinc-200"
                        >
                            Limpiar todo
                        </button>
                    </div>
                </div>

                {/* Lo escaneado */}
                <div className="w-full flex-1 min-w-0 bg-white rounded-2xl border border-zinc-200 overflow-hidden flex flex-col min-h-[420px]">
                    <div className="px-5 py-3.5 border-b border-zinc-100 flex justify-between items-center gap-3">
                        <span className="text-sm font-black uppercase tracking-wide text-zinc-800">Detalle de ítems escaneados</span>
                        <span className="text-xs font-bold text-zinc-400 tabular-nums">{new Date().toLocaleDateString('es-UY')}</span>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {scans.length === 0 ? (
                            <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-10">
                                <PackageOpen size={40} className="mb-3 text-brand-cyan" />
                                <span className="text-sm font-bold text-zinc-700">Esperando la lectura de etiquetas</span>
                                <span className="text-xs text-zinc-400 mt-1">Escaneá un bulto y aparece acá.</span>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-white sticky top-0 z-10 text-[10px] font-black uppercase tracking-wider text-zinc-400">
                                    <tr>
                                        <th className="px-5 py-3 border-b border-zinc-100 w-10">#</th>
                                        <th className="px-5 py-3 border-b border-zinc-100">Código</th>
                                        <th className="px-5 py-3 border-b border-zinc-100">Info del sistema</th>
                                        <th className="px-5 py-3 border-b border-zinc-100 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 text-sm">
                                    {scans.map((scan, idx) => (
                                        <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                                            <td className="px-5 py-3 text-zinc-400 font-mono text-xs">{idx + 1}</td>
                                            <td className="px-5 py-3 font-mono font-bold text-zinc-800">{scan.code}</td>
                                            <td className="px-5 py-3">
                                                <div className="flex flex-col">
                                                    <span className={`text-xs font-bold ${scan.isValid ? 'text-emerald-600' : 'text-brand-magenta'}`}>
                                                        {scan.message}
                                                    </span>
                                                    {scan.nextService && <span className="text-[11px] text-zinc-400 mt-0.5">Destino sugerido: {scan.nextService}</span>}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => removeScan(idx)}
                                                    title="Sacar de la cola"
                                                    className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-zinc-400 hover:bg-brand-magenta/10 hover:text-brand-magenta transition-colors"
                                                >
                                                    <Trash2 size={15} />
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
            {ventanaConfirmar}
        </div>
    );
};

export default LogisticsPage;
