import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { ordersService, rollsService, insumosService } from '../../services/api';
import { printLabelsHelper } from '../../utils/printHelper';

// --- SUB-COMPONENT: MODAL DE SELECCIÓN DE BOBINA ---
const BobinaAssignmentModal = ({ isOpen, onClose, onSelect, currentMetros, areaCode = 'ECOUV' }) => {
    const [search, setSearch] = useState('');
    const [bobinas, setBobinas] = useState([]);
    const [loading, setLoading] = useState(false);
    const searchInputRef = useRef(null);

    // Auto-focus al abrir
    useEffect(() => {
        if (isOpen) {
            setSearch('');
            setLoading(true);
            // Cargar Inventario Base del Área
            insumosService.getInventoryByArea(areaCode)
                .then(inventory => {
                    // Aplanar estructura: Insumos -> Batches (Bobinas)
                    const flatBobinas = [];
                    (inventory || []).forEach(insumo => {
                        (insumo.ActiveBatches || []).forEach(batch => {
                            // Filtro básico: Disponible/Uso y con metros
                            if ((batch.Estado === 'Disponible' || batch.Estado === 'En Uso') && batch.MetrosRestantes > 0) {
                                flatBobinas.push({
                                    ...batch,
                                    MaterialName: insumo.Nombre,
                                    InsumoCode: insumo.CodigoReferencia
                                });
                            }
                        });
                    });
                    setBobinas(flatBobinas);
                })
                .catch(err => console.error(err))
                .finally(() => setLoading(false));

            setTimeout(() => {
                if (searchInputRef.current) searchInputRef.current.focus();
            }, 300);
        }
    }, [isOpen, areaCode]);

    if (!isOpen) return null;

    // Filtrado local (Búsqueda rápida o Escaneo)
    const filteredBobinas = bobinas.filter(b => {
        const s = search.trim().toLowerCase(); // Trim espacios de escaner
        if (!s) return true;
        // Match ID exacta (escaneo), o nombre parcial, o código
        return String(b.BobinaID) === s ||
            (b.CodigoEtiqueta || '').toLowerCase().includes(s) ||
            (b.MaterialName || '').toLowerCase().includes(s);
    });

    // Match exacto prioritario para escáner (QR: ID o Código Etiqueta)
    const exactMatch = filteredBobinas.find(b => {
        const s = search.trim(); // Sin toLowerCase para match exacto de ID/Code
        return String(b.BobinaID) === s || (b.CodigoEtiqueta || '') === s;
    });

    const handleSelect = (bobina) => {
        // Validación de Metros
        if (bobina.MetrosRestantes < currentMetros) {
            if (!window.confirm(`⚠️ ADVERTENCIA DE CAPACIDAD\n\nEl rollo requiere: ${currentMetros.toFixed(2)}m\nLa bobina tiene: ${bobina.MetrosRestantes.toFixed(2)}m\n\n¿Estás seguro de asignarla? Se acabará durante la impresión.`)) {
                return;
            }
        }
        onSelect(bobina.BobinaID);
        onClose();
    };

    // Auto-select si escaneo es único y exacto (enter key)
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (exactMatch) handleSelect(exactMatch);
            else if (filteredBobinas.length === 1) handleSelect(filteredBobinas[0]);
        }
    };

    return (
        <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
                    <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-barcode"></i> Asignar Bobina
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div className="p-4 border-b border-zinc-100 bg-white sticky top-0 z-10">
                    <div className="relative">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-3 text-zinc-400"></i>
                        <input
                            ref={searchInputRef}
                            autoFocus
                            type="text"
                            placeholder="Escanear etiqueta o buscar material..."
                            className="w-full pl-10 pr-4 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold text-zinc-700"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 ml-1">
                        Mostrando {filteredBobinas.length} bobinas disponibles. Escanea el código para selección rápida.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 bg-zinc-50 space-y-2">
                    {loading ? (
                        <div className="text-center py-10 text-zinc-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl"></i> Cargando inventario...</div>
                    ) : (
                        filteredBobinas.map(b => (
                            <div
                                key={b.BobinaID}
                                onClick={() => handleSelect(b)}
                                className={`p-3 rounded-lg border cursor-pointer transition-all flex justify-between items-center group
                                    ${b.MetrosRestantes < currentMetros
                                        ? 'bg-amber-50 border-amber-200 hover:border-amber-400'
                                        : 'bg-white border-zinc-200 hover:border-blue-400 hover:shadow-md'}`}
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-black text-zinc-700 text-sm">{b.MaterialName}</span>
                                        <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 rounded border border-zinc-200">{b.CodigoEtiqueta || `ID:${b.BobinaID}`}</span>
                                    </div>
                                    <div className="text-xs text-zinc-500 flex gap-4">
                                        <span><i className="fa-regular fa-calendar mr-1"></i> {new Date(b.FechaIngreso).toLocaleDateString()}</span>
                                        <span><i className="fa-solid fa-box mr-1"></i> Lote Prov: {b.LoteProveedor || 'N/A'}</span>
                                    </div>
                                    {b.Detalle && <div className="text-xs text-orange-500 font-bold mt-1 italic"><i className="fa-solid fa-note-sticky mr-1"></i> {b.Detalle}</div>}
                                </div>
                                <div className="text-right">
                                    <div className={`text-lg font-black ${b.MetrosRestantes < currentMetros ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {b.MetrosRestantes.toFixed(1)} m
                                    </div>
                                    <div className="text-[10px] uppercase font-bold text-zinc-400">{b.Estado}</div>
                                </div>
                                <i className="fa-solid fa-chevron-right text-zinc-300 ml-3 group-hover:text-blue-500"></i>
                            </div>
                        ))
                    )}
                    {!loading && filteredBobinas.length === 0 && (
                        <div className="text-center py-10 opacity-50">
                            <i className="fa-solid fa-box-open text-4xl text-zinc-300 mb-2"></i>
                            <p className="text-sm text-zinc-500">No se encontraron bobinas.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const SwapConfigDialog = ({ isOpen, onClose, onConfirm, bobinaId }) => {
    const [action, setAction] = useState('exhausted'); // exhausted | return
    const [hasWaste, setHasWaste] = useState(false);
    const [wasteMeters, setWasteMeters] = useState('');
    const [wasteReason, setWasteReason] = useState('');

    useEffect(() => {
        if (isOpen) {
            setAction('exhausted');
            setHasWaste(false);
            setWasteMeters('');
            setWasteReason('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (hasWaste && (!wasteMeters || isNaN(wasteMeters) || Number(wasteMeters) <= 0)) {
            toast.warning("Por favor ingrese una cantidad válida de metros desperdiciados.");
            return;
        }
        if (hasWaste && !wasteReason.trim()) {
            toast.warning("Por favor ingrese el motivo del desperdicio.");
            return;
        }

        onConfirm({
            actionOld: action,
            wasteMeters: hasWaste ? Number(wasteMeters) : 0,
            wasteReason: hasWaste ? wasteReason : null
        });
    };

    return (
        <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
                    <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-rotate"></i> Cambio de Bobina
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center gap-3">
                        <i className="fa-solid fa-tape text-blue-500 text-xl"></i>
                        <div>
                            <div className="text-xs text-blue-400 font-bold uppercase">Bobina Saliente</div>
                            <div className="font-black text-zinc-700">ID: {bobinaId}</div>
                        </div>
                    </div>

                    {/* Estado Bobina Saliente */}
                    <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-3">¿En qué estado queda la bobina?</label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className={`cursor-pointer border-2 rounded-lg p-3 flex flex-col items-center gap-2 transition-all ${action === 'exhausted' ? 'border-red-500 bg-red-50' : 'border-zinc-200 hover:border-red-200'}`}>
                                <input type="radio" name="swapAction" className="hidden" value="exhausted" checked={action === 'exhausted'} onChange={() => setAction('exhausted')} />
                                <i className={`fa-solid fa-skull-crossbones text-2xl ${action === 'exhausted' ? 'text-red-600' : 'text-zinc-300'}`}></i>
                                <span className={`text-xs font-bold ${action === 'exhausted' ? 'text-red-700' : 'text-zinc-500'}`}>Se Terminó</span>
                            </label>
                            <label className={`cursor-pointer border-2 rounded-lg p-3 flex flex-col items-center gap-2 transition-all ${action === 'return' ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-200 hover:border-emerald-200'}`}>
                                <input type="radio" name="swapAction" className="hidden" value="return" checked={action === 'return'} onChange={() => setAction('return')} />
                                <i className={`fa-solid fa-recycle text-2xl ${action === 'return' ? 'text-emerald-600' : 'text-zinc-300'}`}></i>
                                <span className={`text-xs font-bold ${action === 'return' ? 'text-emerald-700' : 'text-zinc-500'}`}>Retorna al Stock</span>
                            </label>
                        </div>
                    </div>

                    {/* Reporte de Merma */}
                    <div className="border-t border-zinc-100 pt-4">
                        <label className="flex items-center gap-2 cursor-pointer mb-3 select-none">
                            <input type="checkbox" className="w-4 h-4 text-orange-500 focus:ring-orange-500 rounded" checked={hasWaste} onChange={e => setHasWaste(e.target.checked)} />
                            <span className="text-sm font-bold text-zinc-700">Hubo Desperdicio / Fallo de Material</span>
                        </label>

                        {hasWaste && (
                            <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 space-y-3 animate-in fade-in slide-in-from-top-2">
                                <div>
                                    <label className="block text-xs font-bold text-orange-700 mb-1">Metros Perdidos/Desechados</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            className="w-full pl-3 pr-8 py-2 border border-orange-200 rounded focus:ring-2 focus:ring-orange-300 outline-none text-zinc-700 font-bold"
                                            placeholder="0.00"
                                            value={wasteMeters}
                                            onChange={e => setWasteMeters(e.target.value)}
                                            autoFocus
                                        />
                                        <span className="absolute right-3 top-2 text-orange-400 text-xs font-bold">m</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-orange-700 mb-1">Motivo / Causa</label>
                                    <input
                                        type="text"
                                        className="w-full px-3 py-2 border border-orange-200 rounded focus:ring-2 focus:ring-orange-300 outline-none text-zinc-700 text-sm"
                                        placeholder="Ej: Material arrugado, mancha, rotura..."
                                        value={wasteReason}
                                        onChange={e => setWasteReason(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-zinc-500 font-bold hover:bg-zinc-200 rounded-lg text-sm">Cancelar</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-sm shadow-md shadow-blue-500/20">Continuar <i className="fa-solid fa-arrow-right ml-1"></i></button>
                </div>
            </div>
        </div>
    );
};

const RollDetailsModal = ({ roll, onClose, onViewOrder, onUpdate = () => { } }) => {
    // Referencia para cerrar al hacer clic fuera
    const modalRef = useRef(null);

    // Estado local para datos frescos
    const [freshRoll, setFreshRoll] = React.useState(roll);
    const [loading, setLoading] = React.useState(false);

    // Estado Modal Asignación y Swap
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [isSwapConfigOpen, setIsSwapConfigOpen] = useState(false);
    const [swapConfig, setSwapConfig] = useState(null);

    // Función auxiliar para cargar datos frescos
    const loadFreshData = () => {
        if (roll?.id) {
            setLoading(true);
            rollsService.getDetails(roll.id)
                .then(data => setFreshRoll(data))
                .catch(err => {
                    console.error("Error cargando detalles frescos del rollo:", err);
                    // Si el rollo no se encuentra (404), probablemente fue cancelado/vaciado automÃ¡ticamente.
                    if (err.response && err.response.status === 404) {
                        toast.info("El lote ha sido vaciado y cerrado.");
                        onClose();
                        if (onUpdate) onUpdate();
                    }
                })
                .finally(() => setLoading(false));
        }
    };

    // Efecto para cargar datos frescos al montar
    useEffect(() => {
        loadFreshData();
    }, [roll?.id]);

    // Si no hay roll, no mostramos nada
    if (!freshRoll) return null;

    // Calcular Totales (Y Ordenar por Secuencia)
    const orders = (freshRoll.orders || []).sort((a, b) => (a.sequence || a.Secuencia || 0) - (b.sequence || b.Secuencia || 0));
    const totalOrders = orders.length;
    const totalMeters = orders.reduce((sum, o) => sum + (o.magnitude || 0), 0);
    const totalFiles = orders.reduce((sum, o) => sum + (o.fileCount || 0), 0);
    const capacityPercent = freshRoll.capacity > 0 ? Math.min((freshRoll.currentUsage / freshRoll.capacity) * 100, 100) : 0;

    // State for Checkboxes
    const [selectedOrderIds, setSelectedOrderIds] = useState([]);

    // Checkbox Handlers
    const handleToggleAll = () => {
        if (selectedOrderIds.length === orders.length) {
            setSelectedOrderIds([]); // Uncheck all
        } else {
            setSelectedOrderIds(orders.map(o => o.id)); // Check all
        }
    };

    const handleToggleOne = (id) => {
        setSelectedOrderIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    // Acción de Desasignar (Undo)
    const handleUnassign = async (order) => {
        const isBusy = freshRoll.status === 'Producción' || freshRoll.status === 'Imprimiendo' || (freshRoll.maquinaId && freshRoll.maquinaId !== null);
        if (isBusy) {
            if (!window.confirm(`⚠️ EL ROLLO ESTÁ EN MÁQUINA (${freshRoll.maquinaId || 'Producción'}).\n\n¿Estás seguro de sacar esta orden? Esto podría afectar la secuencia.`)) { return; }
        }

        // Check if it's the last order
        if (orders.length === 1) {
            if (!window.confirm(`⚠️ ESTA ES LA ÚLTIMA ORDEN.\n\nSi retiras esta orden, el rollo quedará vacío y se cancelará (cerrará) automáticamente, liberando la máquina.\n\n¿Confirmas quitar la orden y cerrar el lote?`)) {
                return;
            }
        } else {
            if (!window.confirm(`¿Quitar la orden ${order.code || order.CodigoOrden} del rollo? Volverá a Pendientes.`)) { return; }
        }
        try {
            await ordersService.unassignRoll(order.id || order.OrdenID);
            onUpdate();
            loadFreshData();
            toast.success("Orden removida del lote correctamente");
        } catch (error) {
            console.error("Error desasignando:", error);
            toast.error("Error al desasignar orden.");
        }
    };

    const handleUnassignMultiple = async () => {
        if (!selectedOrderIds.length) return;

        if (!window.confirm(`¿Estás seguro de desasignar ${selectedOrderIds.length} órdenes seleccionadas del rollo?`)) {
            return;
        }

        try {
            setLoading(true);
            // Use sequential execution to ensure accurate "empty roll" checks on the backend
            for (const id of selectedOrderIds) {
                await ordersService.unassignRoll(id);
            }

            toast.success(`${selectedOrderIds.length} órdenes desasignadas.`);
            setSelectedOrderIds([]);
            onUpdate();
            loadFreshData();
        } catch (error) {
            console.error("Error desasignando multiple:", error);
            toast.error("Error al desasignar órdenes seleccionadas.");
        } finally {
            setLoading(false);
        }
    };

    const handleServerProcess = async () => {
        if (!selectedOrderIds.length) return;

        const supportsFileSystem = 'showDirectoryPicker' in window;
        let dirHandle = null;

        if (supportsFileSystem) {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (err) {
                return;
            }
        } else {
            const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
            const message = `⚠️ FUNCIÓN DE CARPETA AUTOMÁTICA NO DISPONIBLE\n\n` +
                `¿Deseas descargar un ZIP tradicional y enviar la orden de medir al servidor?`;
            if (!window.confirm(message)) return;
        }

        if (!window.confirm(`¿Descargar y medir ${selectedOrderIds.length} órdenes seleccionadas?\nEsto descargará sus archivos en tu PC (creando una subcarpeta para el Rollo) y luego actualizará sus medidas.`)) return;

        try {
            setLoading(true);
            toast.info("Descargando y preparando medición...");

            // 1. DESCARGA ZIP (Igual que handleDownloadFiles)
            const blob = await rollsService.downloadZip(selectedOrderIds);

            if (supportsFileSystem && dirHandle) {
                const JSZip = (await import("jszip")).default;
                const zip = await JSZip.loadAsync(blob);

                const rollFolderName = freshRoll.name || `Lote ${freshRoll.id || 'Nuevo'}`;
                const safeFolderName = rollFolderName.replace(/[<>:"/\\|?*]/g, '_').trim();

                let rollHandle;
                try {
                    rollHandle = await dirHandle.getDirectoryHandle(safeFolderName, { create: true });
                } catch (e) {
                    rollHandle = dirHandle;
                    toast.warning(`No se pudo crear carpeta "${safeFolderName}", usando raíz.`);
                }

                let fileCount = 0;
                for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
                    if (zipEntry.dir) continue;
                    const fileName = relativePath.split('/').pop();
                    try {
                        const fileHandle = await rollHandle.getFileHandle(fileName, { create: true });
                        const writable = await fileHandle.createWritable();
                        const content = await zipEntry.async('blob');
                        await writable.write(content);
                        await writable.close();
                        fileCount++;
                    } catch (writeErr) {
                        toast.error(`Error al guardar ${fileName}`);
                    }
                }
                toast.success(`✅ Archivos guardados localmente: ${fileCount} en carpeta "${safeFolderName}"`);
            } else {
                saveAsZip(blob);
            }

            // 2. MEDICIÓN SERVIDOR
            const res = await api.post('/measurements/process-server-orders', { orderIds: selectedOrderIds });
            if (res.data.success) {
                toast.success("Medición iniciada en el servidor.");
                setSelectedOrderIds([]);
            }
        } catch (error) {
            console.error("Error process server:", error);
            toast.error("Error: " + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadFiles = async () => {
        if (!selectedOrderIds.length) return;

        const supportsFileSystem = 'showDirectoryPicker' in window;
        let dirHandle = null;

        if (supportsFileSystem) {
            try {
                // 1. Pedir ruta INMEDIATAMENTE con permisos de ESCRITURA explícitos
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                // Verificar permisos (opcional, pero readwrite debería ser suficiente)
            } catch (err) {
                // Usuario canceló el diálogo o error de permisos
                return;
            }
        } else {
            // Fallback para navegadores antiguos o Inseguros (HTTP)
            const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
            const message = `⚠️ FUNCIÓN DE CARPETA AUTOMÁTICA NO DISPONIBLE\n\n` +
                `El navegador bloquea la "Escritura en Carpeta" porque no estás en una conexión segura (HTTPS) ni en Localhost.\n\n` +
                (isChrome ? `TIP: Puedes habilitarla en "chrome://flags/#unsafely-treat-insecure-origin-as-secure" agregando esta IP.\n\n` : ``) +
                `¿Deseas descargar un ZIP tradicional con los archivos?`;

            if (!window.confirm(message)) return;
        }

        try {
            setLoading(true);
            toast.info("Descargando y procesando archivos...");

            // 2. Descargar ZIP del servidor
            const blob = await rollsService.downloadZip(selectedOrderIds);
            console.log("DEBUG: Blob Size", blob.size);

            if (supportsFileSystem && dirHandle) {
                // 3. Descomprimir y guardar en la carpeta seleccionada
                const JSZip = (await import("jszip")).default;
                const zip = await JSZip.loadAsync(blob);
                console.log("DEBUG: Zip Files", Object.keys(zip.files));

                // A. Crear carpeta del Rollo dentro de la ruta elegida
                const rollFolderName = freshRoll.name || `Lote ${freshRoll.id || 'Nuevo'}`;
                // Sanitizar nombre de carpeta
                const safeFolderName = rollFolderName.replace(/[<>:"/\\|?*]/g, '_').trim();

                let rollHandle;
                try {
                    rollHandle = await dirHandle.getDirectoryHandle(safeFolderName, { create: true });
                } catch (e) {
                    console.error("Error creando carpeta del rollo, usando raíz:", e);
                    rollHandle = dirHandle; // Fallback
                    toast.warning(`No se pudo crear carpeta "${safeFolderName}", usando raíz.`);
                }

                let fileCount = 0;

                for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
                    if (zipEntry.dir) continue;

                    // Aplanar estructura: Usar solo el nombre del archivo final
                    const fileName = relativePath.split('/').pop();

                    try {
                        const fileHandle = await rollHandle.getFileHandle(fileName, { create: true });
                        const writable = await fileHandle.createWritable();
                        const content = await zipEntry.async('blob');
                        await writable.write(content);
                        await writable.close();
                        fileCount++;
                    } catch (writeErr) {
                        console.error("❌ Error escribiendo:", fileName, writeErr);
                        toast.error(`Error al guardar ${fileName}`);
                    }
                }
                toast.success(`✅ Listo: ${fileCount} archivos en carpeta "${safeFolderName}".`);
            } else {
                saveAsZip(blob);
            }

        } catch (error) {
            console.error("Download Error:", error);
            if (error.response && error.response.data instanceof Blob) {
                const text = await error.response.data.text();
                toast.error("Error: " + text);
            } else {
                toast.error("Error al procesar descarga.");
            }
        } finally {
            setLoading(false);
        }
    };

    const saveAsZip = (blob) => {
        const url = window.URL.createObjectURL(new Blob([blob]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Ordenes_${freshRoll.name || 'Lote'}.zip`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success(`ZIP Descargado.`);
    };

    // Función de generación/impresión de etiquetas
    const handleGenerateLabels = async () => {
        const hasLabels = freshRoll.labelsCount > 0;
        if (!hasLabels) {
            if (!window.confirm(`¿Generar etiquetas de bulto para TODAS las órdenes del rollo?\n\nEl sistema calculará las etiquetas necesarias según los metros (aprox 1 por c/50m).`)) return;
        }
        try {
            setLoading(true);
            if (!hasLabels) {
                const res = await rollsService.generateLabels(freshRoll.id);
                toast.success(res.message);
            }
            if (hasLabels || window.confirm("Etiquetas Listas. ¿Desea imprimirlas ahora?")) {
                const allLabels = await rollsService.getLabels(freshRoll.id);
                if (allLabels && allLabels.length > 0) {
                    printLabelsHelper(allLabels, null);
                    onClose();
                } else { toast.info("No se encontraron etiquetas para imprimir."); }
            }
            onUpdate();
        } catch (error) {
            console.error("Error generating labels:", error);
            toast.error("Error al generar etiquetas: " + (error.response?.data?.error || error.message));
        } finally { setLoading(false); }
    };

    // Función de exportación
    const handleExportExcel = async () => {
        try {
            setLoading(true);
            const XLSX = await import("xlsx");

            const dataToExport = orders.map((o, index) => ({
                '#': index + 1,
                'Código Orden': o.code || o.CodigoOrden,
                'Cliente': o.client || o.Cliente,
                'Trabajo': o.desc || o.DescripcionTrabajo,
                'Material': o.material || o.Material,
                'Archivos': o.fileCount || 0,
                'Metros': o.magnitude || 0,
                'Prioridad': o.priority || o.Prioridad,
                'Estado': o.status || o.Estado
            }));
            const worksheet = XLSX.utils.json_to_sheet(dataToExport);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Detalle Lote");
            XLSX.writeFile(workbook, `Reporte_Lote_${freshRoll.name.replace(/\s+/g, '_')}.xlsx`);
        } catch (error) {
            console.error("Error creating Excel:", error);
            toast.error("Error al generar Excel.");
        } finally {
            setLoading(false);
        }
    };

    // Estado Legacy (se mantiene por si acaso, aunque ya no se usa directamente en el nuevo flujo)
    const [swapAction, setSwapAction] = useState(null);

    // Handler Assign/Swap Bobina
    const handleAssignBobina = async (newBobinaId) => {
        try {
            setLoading(true);

            // Si hay bobina previa y config de swap
            if (freshRoll.BobinaID && swapConfig) {
                const swapData = {
                    rollId: freshRoll.id,
                    oldBobinaId: freshRoll.BobinaID,
                    newBobinaId: newBobinaId,
                    actionOld: swapConfig.actionOld,
                    wasteMeters: swapConfig.wasteMeters,
                    wasteReason: swapConfig.wasteReason
                };

                await rollsService.swapBobina(swapData);

                let msg = `✅ Cambio realizado.\nBobina nueva: ${newBobinaId}`;
                if (swapData.actionOld === 'exhausted') msg += `\nBobina anterior: Terminada`;
                else msg += `\nBobina anterior: Devuelta a Stock`;

                if (swapData.wasteMeters > 0) msg += `\n⚠ Desperdicio registrado: ${swapData.wasteMeters}m`;

                toast.success(msg);
            } else {
                // Asignación simple
                await rollsService.update(freshRoll.id, { BobinaID: newBobinaId });
                toast.success(`✅ Bobina ${newBobinaId} asignada correctamente.`);
            }

            setSwapAction(null);
            setSwapConfig(null);
            await loadFreshData();
            if (onUpdate) onUpdate();
            setIsAssignModalOpen(false);

        } catch (err) {
            console.error(err);
            toast.error("❌ Error: " + (err.response?.data?.error || err.message));
        } finally {
            setLoading(false);
        }
    };

    // Función para iniciar el cambio de Bobina
    const startSwapProcess = () => {
        if (freshRoll.BobinaID) {
            setIsSwapConfigOpen(true);
        } else {
            setSwapConfig(null);
            setIsAssignModalOpen(true);
        }
    };

    const handleSwapConfigConfirmed = (config) => {
        setSwapConfig(config);
        setIsSwapConfigOpen(false);
        setIsAssignModalOpen(true);
    };

    return (
        <>
            <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1400] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
                <div
                    ref={modalRef}
                    className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                    onClick={e => e.stopPropagation()}
                >

                    {/* Header */}
                    <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                        <div className="flex flex-col">
                            <h3 className="text-xl font-black text-zinc-800 flex items-center gap-2">
                                <i className="fa-solid fa-scroll text-blue-500"></i>
                                {loading ? 'Cargando...' : freshRoll.name}
                                {loading && <i className="fa-solid fa-spinner fa-spin text-sm text-zinc-400 ml-2"></i>}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                {freshRoll.id && String(freshRoll.id).startsWith('R-') && (
                                    <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded uppercase tracking-wider">
                                        {freshRoll.id}
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors"
                        >
                            <i className="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    {/* Stats Bar */}
                    <div className="px-6 py-5 bg-zinc-50 border-b border-zinc-200 flex gap-8 items-center flex-wrap shrink-0">
                        <div className="flex flex-col items-start min-w-[80px]">
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Órdenes</span>
                            <span className="text-3xl font-black text-zinc-700 leading-none">{totalOrders}</span>
                        </div>

                        <div className="w-px h-10 bg-zinc-200"></div>

                        <div className="flex flex-col items-start min-w-[80px]">
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Archivos</span>
                            <span className={`text-3xl font-black leading-none flex items-center gap-1 ${totalFiles > 0 ? 'text-blue-500' : 'text-zinc-300'}`}>
                                {totalFiles} <i className="fa-solid fa-paperclip text-sm opacity-40 -mt-2"></i>
                            </span>
                        </div>

                        <div className="w-px h-10 bg-zinc-200"></div>

                        {/* SECCIÓN BOBINA / MATERIAL */}
                        <div className="flex flex-col items-start min-w-[200px]">
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Bobina Asignada</span>
                            {freshRoll.BobinaID ? (
                                <div className="flex items-center gap-2">
                                    <span className="bg-green-100 text-green-700 px-3 py-1 rounded font-bold text-sm border border-green-200 shadow-sm flex items-center cursor-pointer hover:bg-green-200" onClick={startSwapProcess} title="Clic para cambiar/agotar bobina">
                                        <i className="fa-solid fa-check-circle mr-2"></i>
                                        ID: {freshRoll.CodeBobina || freshRoll.BobinaID}
                                    </span>
                                    <button onClick={startSwapProcess} className="text-zinc-400 hover:text-blue-500 w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-100" title="Cambiar Bobina"><i className="fa-solid fa-rotate"></i></button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span className="text-red-500 font-bold text-xs italic flex items-center bg-red-50 px-2 py-1 rounded border border-red-100">
                                        <i className="fa-solid fa-circle-exclamation mr-1"></i> Sin Asignar
                                    </span>
                                    <button
                                        className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded font-bold hover:bg-blue-700 transition-colors shadow-sm animate-pulse flex items-center gap-1"
                                        onClick={startSwapProcess}
                                    >
                                        <i className="fa-solid fa-barcode"></i> ASIGNAR
                                    </button>
                                </div>
                            )}
                            <div className="mt-1 text-[10px] text-zinc-400 truncate max-w-[200px]" title={orders[0]?.material}>
                                Mat: {orders[0]?.material || 'N/A'}
                            </div>
                        </div>

                        <div className="w-px h-10 bg-zinc-200"></div>

                        <div className="flex flex-col items-start min-w-[80px]">
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Metros</span>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-black text-zinc-700 leading-none">{totalMeters.toFixed(2)}</span>
                                <span className="text-xs font-bold text-zinc-400">m</span>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col justify-end items-end min-w-[140px] ml-auto">
                            <div className="text-xs font-bold text-zinc-500 mb-2 flex justify-between w-full">
                                <span className="uppercase tracking-wide text-[10px]">Capacidad</span>
                                <span><span className="text-zinc-800">{freshRoll.currentUsage?.toFixed(1)}</span> <span className="text-zinc-400">/ {freshRoll.capacity}m</span></span>
                            </div>
                            <div className="w-full h-3 bg-zinc-200 rounded-full overflow-hidden shadow-inner">
                                <div
                                    className="h-full transition-all duration-700 ease-out relative overflow-hidden"
                                    style={{
                                        width: `${capacityPercent}%`,
                                        background: freshRoll.color || '#3b82f6'
                                    }}
                                >
                                    <div className="absolute inset-0 bg-white/20 animate-[pulse_2s_infinite]"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Body Table */}
                    <div className="flex-1 overflow-y-auto bg-zinc-50/30 p-6 min-h-[300px]">
                        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
                            <table className="w-full text-sm text-left min-w-[800px]">
                                <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200 font-bold tracking-wider sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 w-10 text-center">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                checked={orders.length > 0 && selectedOrderIds.length === orders.length}
                                                onChange={handleToggleAll}
                                            />
                                        </th>
                                        <th className="px-4 py-3 w-12 text-center text-zinc-300">#</th>
                                        <th className="px-4 py-3">Orden</th>
                                        <th className="px-4 py-3">Cliente / Trabajo</th>
                                        <th className="px-4 py-3">Material</th>
                                        <th className="px-4 py-3 w-16 text-center"><i className="fa-solid fa-paperclip"></i></th>
                                        <th className="px-4 py-3 w-16 text-center">Metros</th>
                                        <th className="px-4 py-3 w-32 text-center">Prioridad</th>
                                        <th className="px-4 py-3 w-10 text-center" title="Notas"><i className="fa-regular fa-comment-dots"></i></th>
                                        <th className="px-4 py-3 w-24 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {orders.map((o, idx) => (
                                        <tr key={o.id} className={`transition-colors group ${selectedOrderIds.includes(o.id) ? 'bg-blue-50/60' : 'hover:bg-blue-50/40'}`}>
                                            <td className="px-4 py-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    checked={selectedOrderIds.includes(o.id)}
                                                    onChange={() => handleToggleOne(o.id)}
                                                />
                                            </td>
                                            <td className="px-4 py-3 text-center text-zinc-300 font-mono text-xs">{idx + 1}</td>
                                            <td className="px-4 py-3 font-bold text-zinc-700 min-w-[120px]">Orden No.: {o.code || o.CodigoOrden}</td>
                                            <td className="px-4 py-3 max-w-[240px]">
                                                <div className="font-bold text-zinc-700 truncate">{o.client || o.Cliente}</div>
                                                <div className="text-xs text-zinc-400 truncate italic">{o.desc || o.DescripcionTrabajo}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-zinc-600 font-medium truncate uppercase text-xs">{o.material || o.Material || '-'}</div>
                                                {o.variantCode && (
                                                    <div className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold text-indigo-500 bg-indigo-50 mt-1 border border-indigo-100">
                                                        {o.variantCode}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {o.fileCount > 0 ? (
                                                    <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-[10px] font-bold border border-blue-200">
                                                        {o.fileCount}
                                                    </span>
                                                ) : (
                                                    <span className="text-zinc-200 text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center font-mono font-bold text-zinc-700">
                                                {o.magnitude || 0}<span className="text-[10px] text-zinc-400 ml-0.5">m</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wide
                                                    ${o.priority === 'Urgente'
                                                        ? 'bg-red-50 text-red-600 border-red-100'
                                                        : 'bg-zinc-50 text-zinc-500 border-zinc-100'}`}>
                                                    {(o.priority || 'Normal')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {o.note && o.note.trim() !== '' && (
                                                    <div className="group/note relative flex justify-center">
                                                        <i className="fa-solid fa-message text-amber-500 text-lg cursor-help"></i>
                                                        <div className="absolute bottom-full mb-2 hidden group-hover/note:block z-50 w-48 p-2 bg-zinc-800 text-white text-xs rounded shadow-lg">
                                                            {o.note}
                                                            <div className="absolute top-full left-1/2 -ml-1 border-4 border-transparent border-t-zinc-800"></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => onViewOrder && onViewOrder(o)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                                        title="Ver detalle orden"
                                                    >
                                                        <i className="fa-regular fa-eye"></i>
                                                    </button>
                                                    <button
                                                        onClick={() => handleUnassign(o)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                                        title="Sacar del Rollo (Deshacer)"
                                                    >
                                                        <i className="fa-solid fa-rotate-left"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {orders.length === 0 && (
                                        <tr>
                                            <td colSpan="8" className="text-center py-12">
                                                <div className="flex flex-col items-center justify-center opacity-40">
                                                    <i className="fa-solid fa-folder-open text-4xl mb-2 text-zinc-300"></i>
                                                    <span className="text-zinc-500 italic">No hay órdenes en este lote.</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-zinc-100 bg-white flex justify-end gap-3 z-10 shrink-0">
                        {selectedOrderIds.length > 0 && (
                            <button
                                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md shadow-red-500/20 active:scale-95 mr-auto animate-in fade-in"
                                onClick={handleUnassignMultiple}
                            >
                                <i className="fa-solid fa-rotate-left"></i> Sacar ({selectedOrderIds.length})
                            </button>
                        )}

                        {selectedOrderIds.length > 0 && (
                            <button
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-500/20 active:scale-95 animate-in fade-in"
                                onClick={handleServerProcess}
                            >
                                <i className="fa-solid fa-robot"></i> Descargar y Medir ({selectedOrderIds.length})
                            </button>
                        )}

                        {selectedOrderIds.length > 0 && (
                            <button
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md shadow-blue-500/20 active:scale-95 animate-in fade-in"
                                onClick={handleDownloadFiles}
                            >
                                <i className="fa-solid fa-download"></i> Descargar ({selectedOrderIds.length})
                            </button>
                        )}

                        <button
                            className={`px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md shadow-emerald-500/20 active:scale-95 ${selectedOrderIds.length > 0 ? '' : 'mr-auto'}`}
                            onClick={handleExportExcel}
                        >
                            <i className="fa-solid fa-file-excel"></i> Descargar Reporte Excel
                        </button>
                        <button
                            className={`px-4 py-2 ${freshRoll.labelsCount > 0 ? 'bg-orange-500 hover:bg-orange-600' : 'bg-indigo-500 hover:bg-indigo-600'} text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-500/20 active:scale-95 mr-auto ml-2`}
                            onClick={handleGenerateLabels}
                            disabled={loading}
                        >
                            <i className={`fa-solid ${freshRoll.labelsCount > 0 ? 'fa-print' : 'fa-tags'}`}></i>
                            {freshRoll.labelsCount > 0 ? 'Imprimir Etiquetas Existentes' : 'Generar Etiquetas'}
                        </button>
                        <button
                            className="px-6 py-2 border border-zinc-200 hover:bg-zinc-50 text-zinc-600 rounded-lg text-sm font-bold transition-colors active:scale-95"
                            onClick={onClose}
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>

            {/* COMPONENTE MODAL HIJO DE SELECCIÓN */}
            <BobinaAssignmentModal
                isOpen={isAssignModalOpen}
                onClose={() => setIsAssignModalOpen(false)}
                onSelect={handleAssignBobina}
                currentMetros={totalMeters}
                areaCode={freshRoll.areaId || 'ECOUV'}
            />

            {/* NUEVO DIÁLOGO DE CONFIGURACIÓN DE SWAP */}
            <SwapConfigDialog
                isOpen={isSwapConfigOpen}
                onClose={() => setIsSwapConfigOpen(false)}
                onConfirm={handleSwapConfigConfirmed}
                bobinaId={freshRoll.BobinaID}
            />
        </>
    );
};

export default RollDetailsModal;

