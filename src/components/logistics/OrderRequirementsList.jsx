import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Box, Scroll, Package } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

const OrderRequirementsList = ({ ordenId, areaId, readOnly = false }) => {
    const [requirements, setRequirements] = useState([]);
    const [loading, setLoading] = useState(false);

    // Resource Selection State
    const [resourceModalOpen, setResourceModalOpen] = useState(false);
    const [availableResources, setAvailableResources] = useState([]);
    const [selectedReq, setSelectedReq] = useState(null); // The requirement being toggled

    // [BORDADO] "Aprobación del Cliente": no es un recurso físico a vincular, sino
    // registrar CÓMO se enteró/aprobó (portal, WhatsApp, teléfono, presencial) —
    // la fecha/hora ya la pone FechaCumplimiento solo, acá solo pedimos la vía.
    const [viaModalOpen, setViaModalOpen] = useState(false);
    const [viaSeleccionada, setViaSeleccionada] = useState('WhatsApp');
    const [fechaAprobacion, setFechaAprobacion] = useState(''); // valor de <input type="datetime-local">
    const VIAS_APROBACION = ['Portal', 'WhatsApp', 'Teléfono', 'Email', 'Presencial', 'Otro'];

    // Formato que espera <input type="datetime-local">: YYYY-MM-DDTHH:mm, en hora local
    // (no UTC — si no, el "ahora" por defecto queda corrido varias horas).
    const nowForDatetimeLocal = () => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const fetchRequirements = async () => {
        if (!ordenId || !areaId) return;
        try {
            setLoading(true);
            const res = await api.get(`/logistics/requirements?ordenId=${ordenId}&areaId=${areaId}`);
            setRequirements(res.data);
        } catch (error) {
            console.error("Error fetching requirements", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRequirements();
    }, [ordenId, areaId]);

    const handleToggleAttempt = async (req, currentStatus) => {
        if (readOnly) return;
        const newStatus = !currentStatus;

        // [BORDADO] "Aprobación del Cliente": pedir por qué vía, no un recurso físico.
        if (newStatus && req.CodigoRequisito === 'APROBACION') {
            setSelectedReq(req);
            setViaSeleccionada('WhatsApp');
            setFechaAprobacion(nowForDatetimeLocal());
            setViaModalOpen(true);
            return;
        }

        // Si se está MARCANDO como listo y es un requisito de material tangible
        if (newStatus && (req.CodigoRequisito.includes('TELA') || req.CodigoRequisito.includes('PRENDA') || req.CodigoRequisito.includes('CORTES'))) {
            try {
                // Verificar stock disponible
                const res = await api.get(`/logistics/requirements/resources?ordenId=${ordenId}&reqCode=${req.CodigoRequisito}&areaId=${areaId}`);
                const resources = res.data;

                if (resources && resources.length > 0) {
                    // Hay recursos, mostrar modal selección
                    setAvailableResources(resources);
                    setSelectedReq(req);
                    setResourceModalOpen(true);
                    return; // Detener flujo normal, esperar selección
                } else {
                    toast.info("No se encontraron recursos vinculados automáticamente.");
                }
            } catch (e) {
                console.error("Error checking resources", e);
            }
        }

        // Flujo normal (sin recursos o desmarcando)
        executeToggle(req.RequisitoID, newStatus);
    };

    const executeToggle = async (reqId, newStatus, observation = '', fechaCumplimiento = null) => {
        // Optimistic update
        setRequirements(prev => prev.map(r =>
            r.RequisitoID === reqId ? { ...r, Cumplido: newStatus, Observaciones: observation || r.Observaciones, FechaCumplimiento: fechaCumplimiento || r.FechaCumplimiento } : r
        ));

        try {
            await api.post('/logistics/requirements/toggle', {
                ordenId,
                fechaCumplimiento,
                requisitoId: reqId,
                cumplido: newStatus,
                observaciones: observation
            });
        } catch (err) {
            console.error(err);
            toast.error("Error al actualizar requisito");
            fetchRequirements(); // Revert
        }
    };

    const handleConfirmVia = () => {
        if (!selectedReq) return;
        // El <input datetime-local> da "YYYY-MM-DDTHH:mm" en hora LOCAL sin offset — new Date()
        // de ese string lo interpreta local también, así que viaja correcto sin conversiones.
        const fechaISO = fechaAprobacion ? new Date(fechaAprobacion).toISOString() : null;
        executeToggle(selectedReq.RequisitoID, true, `Vía: ${viaSeleccionada}`, fechaISO);
        setViaModalOpen(false);
        setSelectedReq(null);
    };

    const handleResourceSelect = async (resource) => {
        if (!selectedReq) return;

        // Observación del requisito: PRE del ingreso + datos de la tela (no solo "Bobina N")
        const partes = [];
        if (resource.pre) partes.push(resource.pre);
        if (resource.tela) partes.push(resource.tela);
        if (resource.metros != null) partes.push(`${resource.metros}m disp.`);
        if (resource.ancho) partes.push(`ancho ${resource.ancho}m`);
        const note = partes.length > 0
            ? `Asignado: ${partes.join(' — ')} [${resource.label}]`
            : `Asignado: ${resource.description} [${resource.label}]`;
        executeToggle(selectedReq.RequisitoID, true, note);

        // Nota de producción de la orden (visible en "Notas de Producción" y la pestaña
        // Notas): PRE del ingreso + datos de la tela elegida. Informativa — si falla,
        // no corta la asignación.
        if (resource.pre || resource.tela) {
            try {
                const datos = [
                    resource.tela || 'Tela',
                    resource.metros != null ? `${resource.metros}m disponibles` : null,
                    resource.ancho ? `ancho ${resource.ancho}m` : null,
                    resource.peso ? `${resource.peso}kg` : null
                ].filter(Boolean).join(', ');
                await api.post(`/orders/${ordenId}/notas`, {
                    texto: `[TELA CLIENTE] ${resource.pre || resource.label} — ${datos} (${resource.label})`
                });
            } catch (e) { console.error('No se pudo agregar la nota de tela', e); }
        }

        // Close modal
        setResourceModalOpen(false);
        setAvailableResources([]);
        setSelectedReq(null);
    };

    if (loading && requirements.length === 0) return <div className="text-xs text-gray-500">Cargando requisitos...</div>;
    if (!loading && requirements.length === 0) return null;

    return (
        <div className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded-lg relative">
            <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                Requisitos de Producción ({areaId})
            </h4>
            <div className="space-y-2">
                {requirements.map(req => (
                    <div
                        key={req.RequisitoID}
                        onClick={() => handleToggleAttempt(req, !!req.Cumplido)}
                        className={`
                            flex items-center justify-between p-2 rounded-md border cursor-pointer transition-all duration-200
                            ${req.Cumplido
                                ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                            }
                        `}
                    >
                        <div className="flex items-center gap-3">
                            {req.Cumplido ? (
                                <CheckCircle size={18} className="text-emerald-500" />
                            ) : (
                                <AlertCircle size={18} className="text-rose-400" />
                            )}
                            <div className="flex flex-col">
                                <span className={`text-sm font-medium ${req.Cumplido ? 'text-emerald-800' : 'text-gray-700'}`}>
                                    {req.Descripcion}
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 font-mono">
                                        {req.CodigoRequisito}
                                    </span>
                                    {req.EsBloqueante && <span className="text-[9px] bg-rose-100 text-rose-600 px-1 rounded uppercase font-bold">Bloqueante</span>}
                                </div>
                            </div>
                        </div>

                        {!readOnly && (
                            <div className="text-xs text-right">
                                {req.Cumplido ? (
                                    <>
                                        <div className="text-emerald-600 font-bold">OK</div>
                                        {/* Texto completo (PRE, tela, metros...): sin truncar, se envuelve */}
                                        {req.Observaciones && <div className="text-[10px] text-emerald-600 font-medium max-w-[280px] whitespace-normal break-words leading-snug" title={req.Observaciones}>{req.Observaciones}</div>}
                                        {req.FechaCumplimiento && (
                                            <div className="text-[9px] text-emerald-400">
                                                {new Date(req.FechaCumplimiento).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-gray-400">Pendiente</div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* RESOURCE SELECTION MODAL */}
            {resourceModalOpen && (
                <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/40  animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200">
                        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                            <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                                <Package size={16} />
                                Seleccionar Recurso Disponible
                            </h3>
                            <button onClick={() => setResourceModalOpen(false)} className="text-indigo-400 hover:text-indigo-700">
                                <XCircle size={18} />
                            </button>
                        </div>

                        <div className="p-2 max-h-[300px] overflow-y-auto">
                            <p className="text-xs text-gray-500 mb-2 px-2">
                                Se encontraron los siguientes ítems que coinciden con el requisito. Seleccione uno para asignarlo:
                            </p>
                            {availableResources.map(res => (
                                <div
                                    key={res.id}
                                    onClick={() => handleResourceSelect(res)}
                                    className="p-3 mb-1 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer group transition-all"
                                >
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="min-w-0">
                                            {/* Tela + PRE del ingreso, con los datos visibles de la bobina */}
                                            <div className="font-bold text-slate-700 text-sm group-hover:text-indigo-700">
                                                {res.tela || res.description}
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                {res.pre && (
                                                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono">{res.pre}</span>
                                                )}
                                                <span className="text-xs text-slate-400 font-mono">{res.label}</span>
                                                {res.vinculadaAOrden === 1 && (
                                                    <span className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded uppercase font-bold">Vinculada a esta orden</span>
                                                )}
                                                {res.esDelCliente === 1 && res.vinculadaAOrden !== 1 && (
                                                    <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded uppercase font-bold">De este cliente</span>
                                                )}
                                                {res.estadoBobina && res.estadoBobina !== 'Disponible' && (
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                                                        res.estadoBobina === 'Agotado' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700'
                                                    }`}>{res.estadoBobina}</span>
                                                )}
                                            </div>
                                            {(res.metros != null || res.ancho || res.peso) && (
                                                <div className="text-xs text-slate-500 mt-1">
                                                    {[
                                                        res.metros != null ? `${res.metros}m disponibles` : null,
                                                        res.ancho ? `ancho ${res.ancho}m` : null,
                                                        res.peso ? `${res.peso}kg` : null
                                                    ].filter(Boolean).join(' · ')}
                                                </div>
                                            )}
                                            {res.clienteBobina && res.esDelCliente !== 1 && (
                                                <div className="text-[10px] text-amber-600 font-bold mt-0.5">Cliente: {res.clienteBobina}</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            {res.areaBobina && (
                                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200 group-hover:bg-white">
                                                    {res.areaBobina}
                                                </span>
                                            )}
                                            {res.location && (
                                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200 group-hover:bg-white">
                                                    {res.location}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-between">
                            <button
                                onClick={() => setResourceModalOpen(false)}
                                className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    executeToggle(selectedReq.RequisitoID, true, "Confirmación Manual (Sin recurso vinculado)");
                                    setResourceModalOpen(false);
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded"
                            >
                                Confirmar sin vincular
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* VÍA DE APROBACIÓN DEL CLIENTE (Bordado) */}
            {viaModalOpen && (
                <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200">
                        <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
                            <h3 className="font-bold text-emerald-900 text-sm flex items-center gap-2">
                                <CheckCircle size={16} />
                                Registrar Aprobación del Cliente
                            </h3>
                            <button onClick={() => setViaModalOpen(false)} className="text-emerald-400 hover:text-emerald-700">
                                <XCircle size={18} />
                            </button>
                        </div>
                        <div className="p-4">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                                Fecha y hora de la aprobación
                            </label>
                            <input
                                type="datetime-local"
                                value={fechaAprobacion}
                                onChange={(e) => setFechaAprobacion(e.target.value)}
                                max={nowForDatetimeLocal()}
                                className="w-full p-2 mb-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-400"
                            />
                            <p className="text-xs text-gray-500 mb-2">
                                Por defecto es ahora — cambiala si el cliente aprobó antes (ej. te escribió ayer y recién ahora lo cargás). Elegí por qué vía aprobó:
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                {VIAS_APROBACION.map(via => (
                                    <button
                                        key={via}
                                        onClick={() => setViaSeleccionada(via)}
                                        className={`p-2 rounded-lg border text-sm font-bold transition-all ${
                                            viaSeleccionada === via
                                                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                    >
                                        {via}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-between">
                            <button
                                onClick={() => setViaModalOpen(false)}
                                className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmVia}
                                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                            >
                                Confirmar Aprobación
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderRequirementsList;
