import React, { useState, useEffect } from 'react';
import { ordersService, fileControlService } from '../../../services/api';
import FileItem, { ActionButton } from './FileItem';
import ReferenceItem from './ReferenceItem';
import { toast } from 'sonner';

const OrderDetailModal = ({ order, onClose, onOrderUpdated }) => {
    // Estado Pestañas
    const [activeTab, setActiveTab] = useState('files');

    // Estado local Base
    const [currentOrder, setCurrentOrder] = useState(null);
    const [files, setFiles] = useState([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [labels, setLabels] = useState([]);
    const [loadingLabels, setLoadingLabels] = useState(false);

    // Estado de Edición
    const [editingFileId, setEditingFileId] = useState(null);
    const [editValues, setEditValues] = useState({ copias: 1, metros: 0, ancho: 0, alto: 0, link: '' });

    // Estado Cancelación
    const [cancelModalOpen, setCancelModalOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [cancelType, setCancelType] = useState(null); // 'ORDER' | 'REQUEST' | 'FILE'
    const [fileToCancel, setFileToCancel] = useState(null);

    // Carga de Etiquetas
    useEffect(() => {
        if (currentOrder?.id) {
            fileControlService.getEtiquetas(currentOrder.id)
                .then(data => setLabels(data))
                .catch(e => console.error(e));
        } else {
            setLabels([]);
        }
    }, [currentOrder?.id]);

    // Listas filtradas con lógica robusta (Case Insensitive y Catch-All)
    const normalizeType = (t) => (t || '').toUpperCase();

    // Tipos conocidos
    const prodTypes = ['IMPRESION', 'REPOSICION', 'PRODUCCION'];
    const servTypes = ['SERVICIO', 'ACABADO'];

    const productionFiles = files.filter(f => !f.tipo || prodTypes.includes(normalizeType(f.tipo)));
    const serviceFiles = files.filter(f => servTypes.includes(normalizeType(f.tipo)));

    // Referencias: Todo lo que NO sea Producción NI Servicio (atrapa LOGO, BOCETO, CORTE, etc.)
    const referenceFiles = files.filter(f => {
        const t = normalizeType(f.tipo);
        return t && !prodTypes.includes(t) && !servTypes.includes(t);
    });

    const handleAddLabel = () => {
        toast("¿Crear una etiqueta EXTRA para esta orden?", {
            action: {
                label: 'Crear',
                onClick: async () => {
                    try {
                        setLoadingLabels(true);
                        await fileControlService.createExtraLabel(currentOrder.id);
                        const data = await fileControlService.getEtiquetas(currentOrder.id);
                        setLabels(data);
                        toast.success("Etiqueta extra creada");
                    } catch (e) { toast.error("Error: " + e.message); }
                    finally { setLoadingLabels(false); }
                }
            },
        });
    };

    const handlePrintLabels = () => {
        printLabelsHelper(labels, currentOrder);
    };

    const handleRegenerate = async () => {
        let defaultQty = 1;
        const magClean = (currentOrder.magnitude || '').toString().toLowerCase();
        const magVal = parseFloat(magClean.replace(/[^\d.]/g, '')) || 0;
        if (magVal > 0) defaultQty = Math.max(1, Math.ceil(magVal / 50));

        const qtyS = prompt(`¿Cuántas etiquetas (bultos) desea generar?\n(Sug: ${defaultQty} para ${currentOrder.magnitude || '0'})\n\nIMPORTANTE: Esto BORRARÁ las etiquetas existentes.`, defaultQty);
        if (!qtyS) return;

        const qty = parseInt(qtyS);

        toast.promise(
            (async () => {
                await fileControlService.regenerateLabels(currentOrder.id, qty);
                const data = await fileControlService.getEtiquetas(currentOrder.id);
                setLabels(data);
                return data;
            })(),
            {
                loading: 'Regenerando etiquetas...',
                success: (data) => {
                    toast("Etiquetas generadas.", {
                        action: {
                            label: 'Imprimir',
                            onClick: () => printLabelsHelper(data, currentOrder)
                        }
                    });
                    return 'Etiquetas listas';
                },
                error: (e) => `Error: ${e.message}`
            }
        );
    };

    const handleDeleteLabel = (labelId) => {
        toast("¿Eliminar etiqueta?", {
            description: "Esta acción es irreversible.",
            action: {
                label: 'Eliminar',
                onClick: async () => {
                    try {
                        await fileControlService.deleteLabel(labelId);
                        const data = await fileControlService.getEtiquetas(currentOrder.id);
                        setLabels(data || []);
                        toast.success("Etiqueta eliminada");
                    } catch (e) { toast.error("Error: " + e.message); }
                }
            },
        });
    };

    const loadData = (orderId, area) => {
        setLoadingFiles(true);

        Promise.all([
            ordersService.getById(orderId, area),
            ordersService.getReferences(orderId).catch(e => []),
            ordersService.getServices(orderId).catch(e => [])
        ])
            .then(([data, refFiles, servFiles]) => {
                if (data) {
                    setCurrentOrder(data);

                    const prodFiles = data.filesData || data.files || [];

                    // Unificar todo en una sola lista para que los filtros de pestañas funcionen
                    setFiles([...prodFiles, ...refFiles, ...servFiles]);
                }
            })
            .catch(err => console.error("Error cargando orden", err))
            .finally(() => setLoadingFiles(false));
    };

    const reloadFiles = () => {
        if (currentOrder?.id) loadData(currentOrder.id, currentOrder.area);
    };

    const startEditing = (file) => {
        const url = file.link || file.url || file.RutaAlmacenamiento || '';
        const id = file.id || file.ArchivoID;
        setEditingFileId(id);
        const w = file.ancho || file.Ancho || 0;
        const h = file.alto || file.Alto || 0;

        setEditValues({
            copias: file.copias || file.copies || file.Copias || 1,
            metros: file.metros || file.width || file.Metros || 0,
            ancho: w,
            alto: h,
            link: url,
            observaciones: file.observaciones || file.notas || file.Observacion || ''
        });
    };

    const startCancellingFile = (file) => {
        setFileToCancel(file);
        setCancelType('FILE');
        setCancelReason("");
        setCancelModalOpen(true);
    };

    const saveEditing = async () => {
        if (!editingFileId) return;

        const fileToEdit = files.find(f => (f.id || f.ArchivoID) === editingFileId);

        // Manejo específico para SERVICIOS
        if (fileToEdit && fileToEdit.tipo === 'Servicio') {
            toast.promise(
                ordersService.updateService({
                    serviceId: editingFileId,
                    cantidad: parseFloat(editValues.copias) || 1,
                    obs: editValues.observaciones // Ahora enviamos las observaciones editadas
                }).then(() => {
                    setEditingFileId(null);
                    reloadFiles();
                    if (onOrderUpdated) onOrderUpdated();
                }),
                {
                    loading: 'Actualizando servicio...',
                    success: 'Servicio actualizado',
                    error: (e) => `Error: ${e.response?.data?.error || e.message}`
                }
            );
            return;
        }

        // Manejo estándar para ARCHIVOS
        const user = JSON.parse(localStorage.getItem('user')) || {};
        const payload = {
            fileId: editingFileId,
            copias: parseInt(editValues.copias) || 1,
            metros: parseFloat(editValues.metros) || 0,
            ancho: parseFloat(editValues.ancho) || 0,
            alto: parseFloat(editValues.alto) || 0,
            link: editValues.link,
            userId: user.id || user.UsuarioID
        };

        toast.promise(
            ordersService.updateFile(payload).then(() => {
                setEditingFileId(null);
                reloadFiles();
                if (onOrderUpdated) onOrderUpdated();
            }),
            {
                loading: 'Guardando cambios...',
                success: 'Archivo actualizado',
                error: (e) => `No se pudo guardar: ${e.response?.data?.error || e.message}`
            }
        );
    };

    const handleConfirmCancel = async () => {
        if (!cancelReason.trim()) {
            toast.error("Debe ingresar un motivo para cancelar.");
            return;
        }

        const user = JSON.parse(localStorage.getItem('user')) || {};
        const commonPayload = {
            reason: cancelReason,
            usuario: user.id || user.UsuarioID || "Desconocido"
        };

        const promise = (async () => {
            if (cancelType === 'FILE') {
                if (!fileToCancel) return;
                const fileId = fileToCancel.id || fileToCancel.ArchivoID;
                const res = await ordersService.cancelFile({ ...commonPayload, fileId });

                if (res.orderCancelled) onClose();
                else reloadFiles();
                return res.message || 'Archivo cancelado';

            } else if (cancelType === 'REQUEST') {
                await ordersService.cancelRequest({ ...commonPayload, orderId: currentOrder.id });
                onClose();
                return "Pedido completo cancelado (todas las áreas).";

            } else {
                await ordersService.cancelOrder({ ...commonPayload, orderId: currentOrder.id });
                onClose();
                return "Orden cancelada correctamente.";
            }
        })();

        toast.promise(promise, {
            loading: 'Procesando cancelación...',
            success: (msg) => {
                setCancelModalOpen(false);
                setCancelReason("");
                setCancelType(null);
                setFileToCancel(null);
                if (onOrderUpdated) onOrderUpdated();
                return msg;
            },
            error: (e) => `Error al cancelar: ${e.response?.data?.error || e.message}`
        });
    };

    useEffect(() => {
        setCurrentOrder(order);
        if (order && order.id) {
            loadData(order.id, order.area);
        } else {
            setFiles([]);
        }
    }, [order]);

    if (!order || !currentOrder) return null;

    // Helper para acciones de archivo (Definido aquí para acceder al scope)
    const renderFileActionsData = (f, idx) => {
        const fileId = f.id || f.ArchivoID || idx;
        const isEditing = editingFileId === fileId;
        const rawStatus = f.Estado || f.estado || 'PENDIENTE';
        const isCancelled = rawStatus.toUpperCase() === 'CANCELADO';
        const isOrderCancelled = currentOrder.status === 'CANCELADO';

        let editContent = null;

        if (isEditing) {
            const umStr = (currentOrder.UM || currentOrder.unit || 'm').toLowerCase();
            const isAreaStr = umStr.includes('2');

            const handleChange = (field, val) => {
                const newValues = { ...editValues, [field]: val };
                const w = parseFloat(field === 'ancho' ? val : newValues.ancho) || 0;
                const h = parseFloat(field === 'alto' ? val : newValues.alto) || 0;

                if (isAreaStr) {
                    newValues.metros = (w * h).toFixed(2);
                } else {
                    newValues.metros = h.toFixed(2);
                }
                setEditValues(newValues);
            };

            editContent = (
                <div className="flex flex-wrap items-center gap-2">
                    {/* 1. COPIAS */}
                    <div className="flex items-center gap-1 bg-white border border-blue-300 rounded px-1 shadow-sm focus-within:ring-2 focus-within:ring-blue-100">
                        <label className="text-[9px] font-bold text-blue-400 uppercase">Copias:</label>
                        <input
                            type="number" className="w-10 text-center font-bold text-xs outline-none text-slate-700 bg-transparent h-6"
                            value={editValues.copias}
                            onChange={e => setEditValues({ ...editValues, copias: e.target.value })}
                            autoFocus
                        />
                    </div>

                    <span className="text-slate-300 text-xs font-light">x</span>

                    {/* 2. ANCHO */}
                    <div className="flex items-center gap-1 bg-white border border-blue-300 rounded px-1 shadow-sm focus-within:ring-2 focus-within:ring-blue-100">
                        <label className="text-[9px] font-bold text-blue-400 uppercase">Ancho:</label>
                        <input
                            type="number" step="0.01" className="w-12 text-center font-bold text-xs outline-none text-slate-700 bg-transparent h-6"
                            value={editValues.ancho}
                            onChange={e => handleChange('ancho', e.target.value)}
                        />
                    </div>

                    <span className="text-slate-300 text-xs font-light">x</span>

                    {/* 3. ALTO / LARGO */}
                    <div className="flex items-center gap-1 bg-white border border-blue-300 rounded px-1 shadow-sm focus-within:ring-2 focus-within:ring-blue-100">
                        <label className="text-[9px] font-bold text-blue-400 uppercase">Alto:</label>
                        <input
                            type="number" step="0.01" className="w-12 text-center font-bold text-xs outline-none text-slate-700 bg-transparent h-6"
                            value={editValues.alto}
                            onChange={e => handleChange('alto', e.target.value)}
                        />
                    </div>

                    <div className="w-px bg-slate-200 h-4 mx-1"></div>

                    {/* RESULTADO (Calculado) */}
                    <div className="flex items-center gap-1 bg-slate-100/50 px-2 py-0.5 rounded border border-slate-200">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Total:</label>
                        <div className="text-xs font-black text-blue-600">
                            {editValues.metros} {currentOrder.UM || 'm'}
                        </div>
                    </div>
                </div>
            );
        }

        const actions = (
            <div className="flex items-center gap-3">
                {/* Estado Informativo */}
                <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider border select-none 
                    ${rawStatus === 'OK' || rawStatus === 'FINALIZADO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                        rawStatus === 'FALLA' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                            rawStatus === 'CANCELADO' ? 'bg-red-50 text-red-600 border-red-100' :
                                'bg-slate-50 text-slate-400 border-slate-100'
                    }`}>
                    {rawStatus}
                </div>

                {isEditing ? (
                    <div className="flex gap-1 animate-in zoom-in-95 duration-200">
                        <ActionButton icon="fa-check" color="emerald" onClick={saveEditing} title="Guardar Cambios" />
                        <ActionButton icon="fa-xmark" color="slate" onClick={() => setEditingFileId(null)} title="Cancelar" />
                    </div>
                ) : (
                    !isCancelled && !isOrderCancelled && (
                        <div className='flex gap-1'>
                            <ActionButton
                                icon="fa-pen"
                                color="blue"
                                onClick={() => startEditing({ ...f, id: fileId })}
                                title="Editar Dimensiones y Cantidad"
                            />
                            <ActionButton
                                icon="fa-ban"
                                color="red"
                                onClick={() => startCancellingFile({ ...f, id: fileId })}
                                title="Cancelar Archivo"
                            />
                        </div>
                    )
                )}
            </div>
        );

        return { actions, editContent };
    };

    return (
        <div className="fixed inset-0 z-[2000] flex items-start justify-center p-4 overflow-y-auto">

            <div
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col animate-in zoom-in-95 duration-200 border border-slate-200 my-8">

                <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-start shrink-0">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="font-mono bg-slate-200 px-2 py-0.5 rounded text-slate-600 font-bold text-xs border border-slate-300">
                                Orden No.: {currentOrder.code || currentOrder.id}
                            </span>
                            {labels.length > 0 && (
                                <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-xs font-bold border border-indigo-100 flex items-center gap-1">
                                    <i className="fa-solid fa-tags text-[10px]"></i> {labels.length} Bultos
                                </span>
                            )}
                            <span className="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wider border border-blue-100">
                                Detalle de Orden
                            </span>
                            {currentOrder.status === 'CANCELADO' && (
                                <span className="text-xs font-bold text-white bg-red-500 px-2 py-0.5 rounded uppercase tracking-wider">CANCELADA</span>
                            )}
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 leading-tight">{currentOrder.client}</h2>
                        <p className="text-sm text-slate-500 mt-1 max-w-2xl truncate">{currentOrder.desc}</p>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-all flex items-center justify-center shadow-sm"
                    >
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 bg-white">

                    {/* Header Grid: Datos Clave */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">

                        <div className="md:col-span-2 lg:col-span-2">
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Material / Sustrato</label>
                            <div className="font-semibold text-slate-700 text-sm leading-tight">{currentOrder.variant || currentOrder.material || '-'}</div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Magnitud Global</label>
                            <div className="font-black text-blue-600 text-lg leading-none">
                                {(() => {
                                    // 1. Suma de Producción
                                    const prodTotal = productionFiles.reduce((acc, f) => {
                                        if ((f.Estado || '').toUpperCase() === 'CANCELADO') return acc;
                                        return acc + ((parseFloat(f.copias || f.Copias || 1)) * (parseFloat(f.metros || f.width || f.Metros || 0)));
                                    }, 0);

                                    // 2. Suma de Servicios Extras
                                    const servTotal = serviceFiles.reduce((acc, s) => {
                                        return acc + (parseFloat(s.copias || s.Cantidad || 0));
                                    }, 0);

                                    // 3. Total Real
                                    const totalMag = prodTotal + servTotal;

                                    // Si hay total calculado lo mostramos, si no mostramos la magnitud estática
                                    return totalMag > 0 ? totalMag.toFixed(2) : (currentOrder.magnitude || '0');
                                })()}
                                <span className="text-xs font-bold text-slate-500 ml-1">{currentOrder.UM || currentOrder.unit || ''}</span>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Prioridad</label>
                            <div className={`font-bold text-sm ${currentOrder.priority === 'Urgente' ? 'text-red-600' : 'text-slate-600'}`}>
                                {currentOrder.priority || 'Normal'}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Tinta</label>
                            <div className="font-mono text-slate-700 text-sm font-bold bg-white border border-slate-200 px-2 py-0.5 rounded inline-block">
                                {currentOrder.ink || '-'}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Modo Retiro</label>
                            <div className="font-bold text-slate-700 text-sm">
                                {currentOrder.retiro || '-'}
                            </div>
                        </div>
                    </div>

                    {currentOrder.rollId && (
                        <div className="mb-4 flex items-center gap-2 text-xs font-mono text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg w-fit">
                            <i className="fa-solid fa-scroll"></i>
                            Asignado a Rollo/Lote: <b>{currentOrder.rollId}</b>
                        </div>
                    )}

                    {currentOrder.note && (
                        <div className="mb-8 bg-amber-50 border-l-4 border-amber-400 p-3 flex gap-3 shadow-sm rounded-r-lg">
                            <i className="fa-solid fa-note-sticky text-amber-500 text-lg mt-0.5"></i>
                            <div>
                                <h4 className="font-bold text-amber-900 text-xs uppercase mb-0.5">Nota de Producción</h4>
                                <p className="text-amber-800 text-sm italic leading-snug">"{currentOrder.note}"</p>
                            </div>
                        </div>
                    )}

                    {/* TABS DE NAVEGACIÓN */}
                    <div>
                        <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
                            {[
                                { id: 'files', label: 'Producción', count: productionFiles.length, icon: 'fa-layer-group' },
                                { id: 'refs', label: 'Referencias', count: referenceFiles.length, icon: 'fa-paperclip' },
                                { id: 'services', label: 'Servicios Extras', count: serviceFiles.length, icon: 'fa-wand-magic-sparkles' },
                                { id: 'labels', label: 'Etiquetas', count: labels.length, icon: 'fa-tags' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-4 py-3 font-bold text-sm border-b-2 transition-all flex items-center gap-2 whitespace-nowrap
                                        ${activeTab === tab.id
                                            ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                                            : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    <i className={`fa-solid ${tab.icon} ${activeTab === tab.id ? 'text-blue-500' : 'text-slate-300'}`}></i>
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* CONTENIDO TABS */}
                        <div className="min-h-[250px] animate-in fade-in slide-in-from-bottom-2 duration-300">

                            {/* PESTAÑA: ARCHIVOS DE PRODUCCIÓN */}
                            {activeTab === 'files' && (
                                <div className="space-y-2 pr-1 custom-scrollbar">
                                    {productionFiles.length === 0 ? (
                                        <div className="py-12 text-center text-slate-400 italic bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                            No hay archivos de producción cargados.
                                        </div>
                                    ) : (
                                        productionFiles.map((f, idx) => {
                                            const { actions, editContent } = renderFileActionsData(f, idx);
                                            return (
                                                <FileItem
                                                    key={idx}
                                                    file={f}
                                                    readOnly={true}
                                                    extraInfo={{
                                                        roll: currentOrder?.rollId || 'General',
                                                        machine: currentOrder?.printer || 'Sin Asignar',
                                                        um: currentOrder.UM || currentOrder.unit || 'm' // Pasamos unidad
                                                    }}
                                                    actions={actions}
                                                    editingContent={editContent}
                                                />
                                            );
                                        })
                                    )}
                                    {/* Footer Totales */}
                                    {productionFiles.length > 0 && (
                                        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-sm px-2">
                                            <span className="font-bold text-slate-400 uppercase text-xs tracking-wider">Metraje Total Estimado</span>
                                            <span className="font-black text-blue-600 text-xl font-mono">
                                                {productionFiles.reduce((acc, f) => {
                                                    if ((f.Estado || '').toUpperCase() === 'CANCELADO') return acc;
                                                    return acc + ((f.copias || f.copies || f.Copias || 1) * (f.metros || f.width || f.Metros || 0));
                                                }, 0).toFixed(2)}m
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* PESTAÑA: REFERENCIAS */}
                            {activeTab === 'refs' && (
                                <div className="space-y-2">
                                    {referenceFiles.length === 0 ? (
                                        <div className="py-8 text-center text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                            <i className="fa-regular fa-image text-2xl mb-2 block opacity-50"></i>
                                            Sin imágenes de referencia o guías.
                                        </div>
                                    ) : (
                                        referenceFiles.map((f, idx) => (
                                            <ReferenceItem key={idx} file={f} />
                                        ))
                                    )}
                                </div>
                            )}

                            {/* PESTAÑA: SERVICIOS */}
                            {activeTab === 'services' && (
                                <div className="space-y-2">
                                    {serviceFiles.length === 0 ? (
                                        <div className="py-8 text-center text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                            <i className="fa-solid fa-wand-magic-sparkles text-2xl mb-2 block opacity-50"></i>
                                            No hay servicios extras registrados.
                                        </div>
                                    ) : (
                                        serviceFiles.map((f, idx) => {
                                            const fileId = f.id || f.ArchivoID || idx;
                                            const isEditing = editingFileId === fileId;

                                            return (
                                                <div key={idx} className={`p-3 border rounded-lg flex justify-between items-center transition-all ${isEditing ? 'bg-white border-blue-300 ring-2 ring-blue-100 shadow-md' : 'bg-amber-50 border-amber-100 text-amber-900'}`}>
                                                    <div className="flex-1">
                                                        <span className="font-bold text-sm block">{f.nombre}</span>
                                                        {isEditing ? (
                                                            <div className="flex flex-col gap-2 mt-2 animate-in fade-in zoom-in-95 duration-200 w-full">
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-[10px] font-bold uppercase text-slate-500 w-16">Cantidad:</label>
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        className="w-20 px-2 py-1 text-center font-bold border border-slate-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none"
                                                                        value={editValues.copias}
                                                                        onChange={e => setEditValues({ ...editValues, copias: e.target.value })}
                                                                        autoFocus
                                                                    />
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-[10px] font-bold uppercase text-slate-500 w-16">Obs:</label>
                                                                    <input
                                                                        type="text"
                                                                        className="flex-1 px-2 py-1 border border-slate-300 rounded text-xs focus:border-blue-500 outline-none"
                                                                        value={editValues.observaciones || ''}
                                                                        onChange={e => setEditValues({ ...editValues, observaciones: e.target.value })}
                                                                        placeholder="Observaciones..."
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="text-xs mt-1 flex gap-3 text-amber-700/80">
                                                                <span>Cant: <b>{f.copias || f.Cantidad || 1}</b></span>
                                                                {f.notas && <span>| {f.notas}</span>}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-2 pl-4">
                                                        {!isEditing && (
                                                            <span className="text-[10px] font-mono bg-white/50 px-2 py-1 rounded border border-amber-200 uppercase tracking-wider">{f.tipo}</span>
                                                        )}

                                                        {isEditing ? (
                                                            <div className="flex gap-1">
                                                                <ActionButton icon="fa-check" color="emerald" onClick={saveEditing} title="Confirmar Cantidad" />
                                                                <ActionButton icon="fa-xmark" color="slate" onClick={() => setEditingFileId(null)} title="Cancelar Edición" />
                                                            </div>
                                                        ) : (
                                                            <ActionButton
                                                                icon="fa-pen"
                                                                color="amber"
                                                                onClick={() => startEditing({
                                                                    ...f,
                                                                    id: fileId,
                                                                    copias: f.copias || f.Cantidad,
                                                                    observaciones: f.notas || f.Observacion || '',
                                                                    metros: 0,
                                                                    link: ''
                                                                })}
                                                                title="Editar Cantidad de Servicio"
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}

                            {/* PESTAÑA: ETIQUETAS (Tu código existente) */}
                            {activeTab === 'labels' && (
                                <div className="min-h-[200px]">
                                    <div className="flex justify-between items-center mb-4 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                                        <div className="flex items-center gap-2 text-indigo-800">
                                            <i className="fa-solid fa-boxes-stacked"></i>
                                            <h3 className="font-bold text-sm">Gestión de Bultos</h3>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={handleAddLabel} className="px-3 py-1.5 bg-white text-indigo-600 border border-indigo-200 rounded text-xs font-bold hover:bg-indigo-50 transition shadow-sm"><i className="fa-solid fa-plus mr-1"></i> Extra</button>
                                            <button onClick={handleRegenerate} className="px-3 py-1.5 bg-white text-amber-600 border border-amber-200 rounded text-xs font-bold hover:bg-amber-50 transition shadow-sm" title="Regenerar todo"><i className="fa-solid fa-arrows-rotate mr-1"></i> Regenerar</button>
                                            <button onClick={handlePrintLabels} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 transition shadow-sm"><i className="fa-solid fa-print mr-1"></i> Imprimir</button>
                                        </div>
                                    </div>
                                    {/* ... Logic de mapeo de labels (mantenida igual) ... */}
                                    {loadingLabels ? <div className="py-12 text-center text-slate-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br />Cargando...</div> : labels.length === 0 ? <div className="py-8 text-center text-slate-400 italic">No hay etiquetas generadas.</div> :
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto custom-scrollbar p-1">
                                            {labels.map(l => (
                                                <div key={l.EtiquetaID} className="bg-white border border-slate-200 rounded-lg p-3 flex justify-between items-center shadow-sm hover:shadow-md transition group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center text-slate-500 font-bold text-lg border border-slate-200">{l.NumeroBulto}</div>
                                                        <div><div className="font-bold text-slate-700 text-sm">Bulto {l.NumeroBulto}/{l.TotalBultos}</div><div className="text-[10px] text-slate-400 font-mono tracking-widest">{l.CodigoEtiqueta || '---'}</div></div>
                                                    </div>
                                                    <button onClick={() => handleDeleteLabel(l.EtiquetaID)} className="w-7 h-7 rounded bg-white text-slate-300 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition"><i className="fa-solid fa-trash-can text-xs"></i></button>
                                                </div>
                                            ))}
                                        </div>
                                    }
                                </div>
                            )}

                        </div>
                    </div>

                </div>

                {/* FOOTER ACCIONES CONSOLIDADO */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                        {/* Grupo de Botones Peligrosos */}
                        <div className="flex bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
                            <button
                                onClick={() => { setCancelType('ORDER'); setCancelModalOpen(true); }}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-2 hover:bg-red-50 text-slate-500 hover:text-red-600`}
                                disabled={currentOrder.status === 'CANCELADO'}
                                title="Cancelar solo esta orden del área"
                            >
                                <i className="fa-solid fa-ban"></i> Cancelar Orden
                            </button>
                            <div className="w-px bg-slate-200 my-1"></div>
                            <button
                                onClick={() => { setCancelType('REQUEST'); setCancelModalOpen(true); }}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-2 hover:bg-red-50 text-slate-500 hover:text-red-700`}
                                disabled={currentOrder.status === 'CANCELADO'}
                                title="Cancelar todo el pedido (todas las áreas)"
                            >
                                <i className="fa-solid fa-dumpster-fire"></i> Cancelar Pedido
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-700 transition shadow-lg shadow-slate-200 active:scale-95"
                    >
                        Cerrar
                    </button>
                </div>

            </div>

            {/* MODAL DE CANCELACIÓN */}
            {cancelModalOpen && (
                <div className="fixed inset-0 z-[2100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200 border border-red-100">
                        <div className="flex items-center gap-3 text-red-500 mb-4">
                            <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                            <h3 className="text-lg font-black uppercase">
                                {cancelType === 'REQUEST' ? 'Cancelar Pedido Completo' :
                                    cancelType === 'FILE' ? 'Cancelar Archivo' : 'Cancelar Orden'}
                            </h3>
                        </div>

                        <p className="text-slate-600 text-sm mb-4">
                            {cancelType === 'REQUEST' ? (
                                <>
                                    Se cancelarán <b>TODAS las órdenes</b> del pedido <b>{currentOrder.code.split('(')[0]}</b> en <b>TODAS las áreas</b>.
                                    <span className="block mt-2 font-bold text-red-600 bg-red-50 p-2 rounded border border-red-100">
                                        Esta acción afecta a todo el flujo de producción.
                                    </span>
                                </>
                            ) : cancelType === 'FILE' ? (
                                <>
                                    Se cancelará el archivo <b>{fileToCancel?.name || fileToCancel?.NombreArchivo}</b>.
                                    <br />Si este es el último archivo activo, la orden se cancelará automáticamente.
                                </>
                            ) : (
                                <>
                                    Se cancelará solo esta orden <b>({currentOrder.code})</b> del área <b>{currentOrder.area}</b> con sus archivos.
                                </>
                            )}
                        </p>

                        <div className="mb-6">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Motivo de Cancelación</label>
                            <textarea
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-red-400 min-h-[100px] text-sm font-medium text-slate-700 resize-none"
                                placeholder="Indique un motivo..."
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                autoFocus
                            ></textarea>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => { setCancelModalOpen(false); setCancelType(null); setFileToCancel(null); }}
                                className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-50 rounded-lg transition"
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleConfirmCancel}
                                className="px-4 py-2 bg-red-500 text-white font-bold rounded-lg shadow-lg shadow-red-200 hover:bg-red-600 transition transform active:scale-95"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderDetailModal;
