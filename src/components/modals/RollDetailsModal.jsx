import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { saveDirectoryHandle, getDirectoryHandle, verifyPermission, deleteDirectoryHandle } from '../../utils/fsStorage';
import { toast } from 'react-toastify';
import api, { ordersService, rollsService, insumosService, productionService } from '../../services/api';
import { downloadManager } from '../../utils/downloadManager';
import { printLabelsHelper } from '../../utils/printHelper';
import { socket } from '../../services/socketService';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Swal from 'sweetalert2';

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
        <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/50  p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
                    <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-barcode"></i> Asignar Bobina
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-brand-magenta"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div className="p-4 border-b border-zinc-100 bg-white sticky top-0 z-10">
                    <div className="relative">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-3 text-zinc-400"></i>
                        <input
                            ref={searchInputRef}
                            autoFocus
                            type="text"
                            placeholder="Escanear etiqueta o buscar material..."
                            className="w-full pl-10 pr-4 py-2 border border-brand-cyan/40 rounded-lg focus:ring-2 focus:ring-brand-cyan outline-none text-lg font-bold text-zinc-700"
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
                                        : 'bg-white border-zinc-200 hover:border-brand-cyan/50 hover:shadow-md'}`}
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
                                <i className="fa-solid fa-chevron-right text-zinc-300 ml-3 group-hover:text-brand-cyan"></i>
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
        <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/60  p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
                    <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-rotate"></i> Cambio de Bobina
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-brand-magenta"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="bg-brand-cyan/10 border border-brand-cyan/20 p-3 rounded-lg flex items-center gap-3">
                        <i className="fa-solid fa-tape text-brand-cyan text-xl"></i>
                        <div>
                            <div className="text-xs text-brand-cyan font-bold uppercase">Bobina Saliente</div>
                            <div className="font-black text-zinc-700">ID: {bobinaId}</div>
                        </div>
                    </div>

                    {/* Estado Bobina Saliente */}
                    <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-3">¿En qué estado queda la bobina?</label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className={`cursor-pointer border-2 rounded-lg p-3 flex flex-col items-center gap-2 transition-all ${action === 'exhausted' ? 'border-brand-magenta bg-brand-magenta/10' : 'border-zinc-200 hover:border-brand-magenta/30'}`}>
                                <input type="radio" name="swapAction" className="hidden" value="exhausted" checked={action === 'exhausted'} onChange={() => setAction('exhausted')} />
                                <i className={`fa-solid fa-skull-crossbones text-2xl ${action === 'exhausted' ? 'text-brand-magenta' : 'text-zinc-300'}`}></i>
                                <span className={`text-xs font-bold ${action === 'exhausted' ? 'text-brand-magenta/90' : 'text-zinc-500'}`}>Se Terminó</span>
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
                    <button onClick={handleSubmit} className="px-4 py-2 bg-brand-cyan hover:bg-brand-cyan/90 text-white font-bold rounded-lg text-sm shadow-md shadow-brand-cyan/20">Continuar <i className="fa-solid fa-arrow-right ml-1"></i></button>
                </div>
            </div>
        </div>
    );
};

const MoveOrderModal = ({ isOpen, onClose, onConfirm, currentRollId, areaCode }) => {
    const [rolls, setRolls] = React.useState([]);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        if (isOpen) {
            setLoading(true);
            productionService.getBoard(areaCode)
                .then(data => {
                    const allRolls = [...(data.pendingRolls || [])];
                    (data.machines || []).forEach(m => {
                        if (m.rolls && Array.isArray(m.rolls)) {
                            allRolls.push(...m.rolls);
                        }
                    });
                    const availableRolls = allRolls.filter(r => String(r.id) !== String(currentRollId));
                    setRolls(availableRolls);
                })
                .catch(err => toast.error('Error cargando lotes'))
                .finally(() => setLoading(false));
        }
    }, [isOpen, areaCode, currentRollId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1800] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
                    <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-arrow-right-arrow-left"></i> Mover a otro Lote
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-brand-magenta"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 bg-zinc-50 space-y-2 custom-scrollbar">
                    {loading ? (
                        <div className="text-center py-10 text-zinc-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl"></i> Cargando lotes...</div>
                    ) : rolls.length === 0 ? (
                        <div className="text-center py-10 opacity-50">
                            <i className="fa-solid fa-box-open text-4xl text-zinc-300 mb-2"></i>
                            <p className="text-sm text-zinc-500">No hay otros lotes activos disponibles.</p>
                        </div>
                    ) : (
                        rolls.map(r => (
                            <div 
                                key={r.id} 
                                onClick={() => onConfirm(r.id)}
                                className="p-3 rounded-lg border border-zinc-200 bg-white hover:border-brand-cyan/50 hover:shadow-md cursor-pointer transition-all flex justify-between items-center group"
                            >
                                <div>
                                    <div className="font-bold text-zinc-800" style={{ color: r.color || '#333' }}>{r.name}</div>
                                    <div className="text-xs text-zinc-500 mt-1">{(r.usage ?? r.currentUsage ?? 0).toFixed(1)}m / {r.capacity}m • {r.orders?.length || 0} órdenes</div>
                                </div>
                                <i className="fa-solid fa-chevron-right text-zinc-300 ml-3 group-hover:text-brand-cyan"></i>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

const RollDetailsModal = ({ roll, onClose, onViewOrder, onUpdate = () => { } }) => {
    // Referencia para cerrar al hacer clic fuera
    const modalRef = useRef(null);

    // Obtener el area code real de la URL o del roll
    const currentAreaCode = roll?.areaId || roll?.AreaID || (typeof window !== 'undefined' ? window.location.pathname.split('/')[2] : 'ECOUV');
    // SB: las órdenes del lote se ordenan por defecto por material/variante (A-Z), no por secuencia manual.
    const isSB = (currentAreaCode || '').toUpperCase() === 'SB';

    // Estado local para datos frescos
    const [freshRoll, setFreshRoll] = React.useState(roll);
    const [loading, setLoading] = React.useState(false);

    // Estado Modal Asignación y Swap
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [isSwapConfigOpen, setIsSwapConfigOpen] = useState(false);
    const [swapConfig, setSwapConfig] = useState(null);

    // Estado Modal Mover Orden
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [orderToMove, setOrderToMove] = useState(null);

    const openMoveModal = (order) => {
        setOrderToMove(order);
        setIsMoveModalOpen(true);
    };

    const handleMoveOrder = async (targetRollId) => {
        if (!orderToMove) return;
        setIsMoveModalOpen(false);
        try {
            await rollsService.moveOrder({
                orderId: orderToMove.id,
                targetRollId: targetRollId
            });
            toast.success("Orden movida correctamente");
            loadFreshData();
            if (onUpdate) onUpdate();
        } catch (err) {
            console.error("Error moviendo orden", err);
            toast.error("No se pudo mover la orden");
        }
        setOrderToMove(null);
    };

    // Función auxiliar para cargar datos frescos
    const loadFreshData = (silent = false) => {
        if (roll?.id) {
            if (!silent) setLoading(true);
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
                .finally(() => { if (!silent) setLoading(false); });
        }
    };

    // Efecto para cargar datos frescos al montar
    useEffect(() => {
        loadFreshData();
    }, [roll?.id]);

    // Ref al lote vigente para que el handler de socket vea siempre las órdenes actuales (sin re-suscribir).
    const freshRollRef = useRef(freshRoll);
    useEffect(() => { freshRollRef.current = freshRoll; }, [freshRoll]);

    // TIEMPO REAL: si se cancela / cambia de estado una orden que está en ESTE lote (p.ej. una
    // cancelación hecha desde otra vista), refrescamos en silencio para que la orden desaparezca
    // del lote sin tener que apretar F5. Así el operario no puede "sacar" una orden ya cancelada
    // (lo que la resucitaba a Pendiente).
    useEffect(() => {
        if (!roll?.id) return;
        const handleOrderUpdate = (payload) => {
            const updatedId = payload?.orderId != null ? String(payload.orderId) : null;
            const currentIds = (freshRollRef.current?.orders || []).map(o => String(o.id || o.OrdenID));
            if (!updatedId || currentIds.includes(updatedId)) {
                loadFreshData(true);
            }
        };
        socket.on('server:order_updated', handleOrderUpdate);
        socket.on('lotes:updated', handleOrderUpdate);
        return () => {
            socket.off('server:order_updated', handleOrderUpdate);
            socket.off('lotes:updated', handleOrderUpdate);
        };
    }, [roll?.id]);

    // Si no hay roll, no mostramos nada
    if (!freshRoll) return null;

    // Calcular Totales (Y Ordenar por Secuencia)
    const orders = (() => {
        const list = [...(freshRoll.orders || [])];
        if (isSB) {
            // Orden por defecto en SB: Material A-Z, luego Variante A-Z, luego código (numérico).
            return list.sort((a, b) =>
                (a.material || a.Material || '').trim().localeCompare((b.material || b.Material || '').trim(), 'es', { sensitivity: 'base' })
                || (a.variantCode || a.Variante || '').trim().localeCompare((b.variantCode || b.Variante || '').trim(), 'es', { sensitivity: 'base' })
                || (a.code || a.CodigoOrden || '').trim().localeCompare((b.code || b.CodigoOrden || '').trim(), 'es', { numeric: true, sensitivity: 'base' })
            );
        }
        return list.sort((a, b) => (a.sequence || a.Secuencia || 0) - (b.sequence || b.Secuencia || 0));
    })();
    const totalOrders = orders.length;
    const totalMeters = orders.reduce((sum, o) => sum + (o.magnitude || 0), 0);
    const totalFiles = orders.reduce((sum, o) => sum + (o.fileCount || 0), 0);
    const capacityPercent = freshRoll.capacity > 0 ? Math.min((freshRoll.currentUsage / freshRoll.capacity) * 100, 100) : 0;

    // State for Checkboxes — la selección persiste por lote (sessionStorage), así sobrevive
    // cierre/reapertura del modal y navegación entre tabs.
    const selectionStorageKey = `lote_order_selection_${roll?.id ?? freshRoll?.id ?? 'x'}`;
    const [selectedOrderIds, setSelectedOrderIds] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem(selectionStorageKey)) || []; } catch { return []; }
    });
    useEffect(() => {
        try { sessionStorage.setItem(selectionStorageKey, JSON.stringify(selectedOrderIds)); } catch {}
    }, [selectedOrderIds, selectionStorageKey]);
    // Descartar de la selección las órdenes que ya no estén en el lote (movidas/sacadas).
    const orderIdsKey = orders.map(o => o.id).join(',');
    useEffect(() => {
        setSelectedOrderIds(prev => {
            const valid = prev.filter(id => orders.some(o => o.id === id));
            return valid.length === prev.length ? prev : valid;
        });
    }, [orderIdsKey]);

    // Marcas "Impreso" (visual, no se guarda en backend). Persiste por lote en sessionStorage.
    const printedStorageKey = `lote_order_printed_${roll?.id ?? freshRoll?.id ?? 'x'}`;
    const [printedOrderIds, setPrintedOrderIds] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem(printedStorageKey)) || []; } catch { return []; }
    });
    useEffect(() => {
        try { sessionStorage.setItem(printedStorageKey, JSON.stringify(printedOrderIds)); } catch {}
    }, [printedOrderIds, printedStorageKey]);
    // Descartar marcas de impreso de órdenes que ya no estén en el lote (movidas/sacadas).
    useEffect(() => {
        setPrintedOrderIds(prev => {
            const valid = prev.filter(id => orders.some(o => o.id === id));
            return valid.length === prev.length ? prev : valid;
        });
    }, [orderIdsKey]);
    const printedMeters = orders.reduce((sum, o) => sum + (printedOrderIds.includes(o.id) ? (o.magnitude || 0) : 0), 0);
    const printedCount = orders.filter(o => printedOrderIds.includes(o.id)).length;
    const printedPercent = totalMeters > 0 ? Math.min((printedMeters / totalMeters) * 100, 100) : 0;
    const allPrinted = totalOrders > 0 && printedCount === totalOrders;

    const materialOf = (o) => (o?.material || o?.Material || '').trim();
    const selectedOrders = orders.filter(o => selectedOrderIds.includes(o.id));
    const selectedMaterials = [...new Set(selectedOrders.map(materialOf).filter(Boolean))];
    // "Agrupar" solo se habilita con 2+ órdenes seleccionadas del MISMO material.
    const canGroup = selectedOrders.length >= 2 && selectedMaterials.length === 1;

    // Grupos manuales (visual): cada uno = lista de OrdenIDs del mismo material. Persisten por lote.
    const groupsStorageKey = `lote_groups_${roll?.id ?? freshRoll?.id ?? 'x'}`;
    const [manualGroups, setManualGroups] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem(groupsStorageKey)) || []; } catch { return []; }
    });
    useEffect(() => {
        try { sessionStorage.setItem(groupsStorageKey, JSON.stringify(manualGroups)); } catch {}
    }, [manualGroups, groupsStorageKey]);
    // Reconciliar: sacar de los grupos las órdenes que ya no están, y disolver los que queden con <2.
    useEffect(() => {
        setManualGroups(prev => {
            const cleaned = prev.map(g => g.filter(id => orders.some(o => o.id === id))).filter(g => g.length >= 2);
            return JSON.stringify(cleaned) === JSON.stringify(prev) ? prev : cleaned;
        });
    }, [orderIdsKey]);

    const handleAgrupar = () => {
        if (!canGroup) return;
        const ids = [...selectedOrderIds];
        setManualGroups(prev => {
            const cleaned = prev.map(g => g.filter(id => !ids.includes(id))).filter(g => g.length >= 2);
            return [...cleaned, ids];
        });
        setSelectedOrderIds([]);
    };
    const handleDesagrupar = (ids) => {
        setManualGroups(prev => prev.filter(g => !(g.length === ids.length && g.every(id => ids.includes(id)))));
    };

    // Orden custom de los grupos/bloques (drag del grupo). Persiste por lote.
    const unitsOrderStorageKey = `lote_units_order_${roll?.id ?? freshRoll?.id ?? 'x'}`;
    const [unitOrder, setUnitOrder] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem(unitsOrderStorageKey)) || []; } catch { return []; }
    });
    useEffect(() => {
        try { sessionStorage.setItem(unitsOrderStorageKey, JSON.stringify(unitOrder)); } catch {}
    }, [unitOrder, unitsOrderStorageKey]);

    // Unidades de render: grupo manual, grupo auto (material con 1 sola orden) u orden suelta.
    // En áreas que NO son SB no se agrupa (todo suelto), como antes.
    const renderUnits = (() => {
        const matCount = {};
        orders.forEach(o => { const m = materialOf(o) || '—'; matCount[m] = (matCount[m] || 0) + 1; });
        const manualIdxOf = {};
        manualGroups.forEach((g, gi) => g.forEach(id => { manualIdxOf[id] = gi; }));
        const list = [];
        const byKey = {};
        orders.forEach(o => {
            let key, kind;
            if (!isSB) { key = 'l:' + o.id; kind = 'loose'; }
            else if (manualIdxOf[o.id] !== undefined) { key = 'm' + manualIdxOf[o.id]; kind = 'manual'; }
            else if (matCount[materialOf(o) || '—'] === 1) { key = 'a:' + (materialOf(o) || '—'); kind = 'auto'; }
            else { key = 'lm:' + (materialOf(o) || '—'); kind = 'loose'; } // sueltas del mismo material = un bloque
            if (!byKey[key]) { byKey[key] = { key, kind, material: materialOf(o) || '—', orders: [] }; list.push(byKey[key]); }
            byKey[key].orders.push(o);
        });
        // Firma estable por unidad (ids ordenados) para recordar el orden custom de grupos.
        list.forEach(u => { u.sig = u.orders.map(o => o.id).slice().sort((a, b) => a - b).join(','); });
        // Aplicar orden custom (drag); las unidades nuevas quedan al final en su orden natural.
        const oIdx = (sig) => { const i = unitOrder.indexOf(sig); return i === -1 ? Infinity : i; };
        list.sort((a, b) => { const ia = oIdx(a.sig), ib = oIdx(b.sig); return ia === ib ? 0 : ia - ib; });
        return list;
    })();

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

    // Toggle "Impreso" (visual): marca/desmarca una orden como impresa
    const handleTogglePrinted = (id) => {
        setPrintedOrderIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    // Función auxiliar para obtener el directorio base de descargas
    const getBaseDirectory = async () => {
        const supportsFileSystem = 'showDirectoryPicker' in window;
        if (!supportsFileSystem) return null;

        try {
            // Intentar recuperar el handle guardado
            let handle = await getDirectoryHandle('defaultRollsDownloadDir');
            
            if (handle) {
                const hasPermission = await verifyPermission(handle);
                if (hasPermission) {
                    // Verificar que la carpeta realmente existe antes de usarla
                    try {
                        // queryPermission no garantiza existencia; intentamos listar entries
                        // Si la carpeta fue borrada, esto lanza NotFoundError
                        // eslint-disable-next-line no-unused-vars
                        for await (const _ of handle.values()) { break; }
                        return handle;
                    } catch (existErr) {
                        // La carpeta fue borrada o movida — limpiar el handle guardado
                        console.warn('[getBaseDirectory] La carpeta guardada ya no existe, limpiando...', existErr);
                        await deleteDirectoryHandle('defaultRollsDownloadDir');
                        // Cae al showDirectoryPicker más abajo
                    }
                }
            }
            
            // Si no teníamos guardado, perdimos acceso, o fue borrada: pedimos al usuario que elija
            handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'rollsDownloadDir' });
            if (handle) {
                await saveDirectoryHandle('defaultRollsDownloadDir', handle);
                return handle;
            }
        } catch (err) {
            console.error("Error obteniendo directorio:", err);
            return null;
        }
        return null;
    };

    // Acción de Desasignar (Undo)
    const handleUnassign = async (order) => {
        // Confirmaciones con modal (Swal) en vez de window.confirm nativo. Mismo estilo que handleCancelRoll.
        const confirmModal = (opts) => Swal.fire({
            showCancelButton: true,
            cancelButtonColor: '#3f3f46',
            cancelButtonText: 'Cancelar',
            background: '#18181b',
            color: '#f4f4f5',
            ...opts
        });

        const isBusy = freshRoll.status === 'Producción' || freshRoll.status === 'Imprimiendo' || (freshRoll.maquinaId && freshRoll.maquinaId !== null);
        if (isBusy) {
            const r = await confirmModal({
                title: 'El rollo está en máquina',
                html: `Está en <b>${freshRoll.maquinaId || 'Producción'}</b>. Sacar esta orden podría afectar la secuencia.`,
                icon: 'warning',
                confirmButtonColor: '#06b6d4',
                confirmButtonText: 'Sí, sacar orden'
            });
            if (!r.isConfirmed) return;
        }

        // Check if it's the last order
        if (orders.length === 1) {
            const r = await confirmModal({
                title: 'Es la última orden del lote',
                html: 'Si la retirás, el lote quedará <b>vacío y se cancelará (cerrará) automáticamente</b>, liberando la máquina.',
                icon: 'warning',
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Quitar y cerrar lote'
            });
            if (!r.isConfirmed) return;
        } else {
            const r = await confirmModal({
                title: '¿Quitar orden del lote?',
                html: `La orden <b>${order.code || order.CodigoOrden}</b> volverá a Pendientes.`,
                icon: 'question',
                confirmButtonColor: '#06b6d4',
                confirmButtonText: 'Sí, quitar'
            });
            if (!r.isConfirmed) return;
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
            dirHandle = await getBaseDirectory();
            if (!dirHandle) return; // Usuario canceló
        } else {
            const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
            const message = `⚠️ FUNCIÓN DE CARPETA AUTOMÁTICA NO DISPONIBLE\n\n` +
                `¿Deseas descargar un ZIP tradicional y enviar la orden de medir al servidor?`;
            if (!window.confirm(message)) return;
        }

        if (!window.confirm(`¿Descargar y medir ${selectedOrderIds.length} órdenes seleccionadas?\nEsto descargará sus archivos en tu PC (creando una subcarpeta para el Rollo) y luego actualizará sus medidas.`)) return;

        try {
            setLoading(true);

            downloadManager.start(`Medición de Lote ${freshRoll?.id || 'Nuevo'}`);

            const measureTask = async () => {
                // 1. DESCARGA ZIP
                const blob = await rollsService.downloadZip(selectedOrderIds, (loaded, total) => {
                    downloadManager.updateDownloadProgress(loaded, total);
                });

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
                    }

                    const zipEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);
                    
                    if (zipEntries.length === 0) {
                        downloadManager.error('El ZIP recibido está vacío. Revisa que las órdenes tengan archivos subidos.');
                        toast.error('El ZIP del servidor llegó vacío.');
                        return;
                    }
                    
                    downloadManager.startProcessing(zipEntries.length);

                    let fileCount = 0;
                    const writeErrors = [];
                    for (const [relativePath, zipEntry] of zipEntries) {
                        const fileName = relativePath.split('/').pop();
                        try {
                            const fileHandle = await rollHandle.getFileHandle(fileName, { create: true });
                            const writable = await fileHandle.createWritable();
                            const content = await zipEntry.async('blob');
                            await writable.write(content);
                            await writable.close();
                            fileCount++;
                            downloadManager.updateProcessingProgress(fileCount);
                        } catch (writeErr) {
                            console.error("❌ Error escribiendo:", fileName, writeErr);
                            writeErrors.push(`${fileName}: ${writeErr.message}`);
                        }
                    }
                    
                    if (fileCount === 0) {
                        throw new Error(`No se pudo escribir ningún archivo. Primer error: ${writeErrors[0] || 'desconocido'}`);
                    }
                } else {
                    saveAsZip(blob);
                }

                // 2. MEDICIÓN SERVIDOR
                const res = await api.post('/measurements/process-server-orders', { orderIds: selectedOrderIds });
                if (res.data.success) {
                    setSelectedOrderIds([]);
                    downloadManager.finish();
                    toast.success("Medición iniciada en el servidor.");
                } else {
                    throw new Error("Error iniciando medición");
                }
            };

            await measureTask();

        } catch (error) {
            console.error("Error process server:", error);
            downloadManager.error(error.response?.data?.error || error.message);
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
            dirHandle = await getBaseDirectory();
            if (!dirHandle) return; // Usuario canceló
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

            downloadManager.start(`Descarga Lote ${freshRoll?.id || 'Nuevo'}`);

            const downloadTask = async () => {
                const blob = await rollsService.downloadZip(selectedOrderIds, (loaded, total) => {
                    downloadManager.updateDownloadProgress(loaded, total);
                });

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
                    }

                    const zipEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);
                    
                    if (zipEntries.length === 0) {
                        downloadManager.error('El ZIP recibido está vacío. Revisa que las órdenes tengan archivos subidos.');
                        toast.error('El ZIP del servidor llegó vacío.');
                        return;
                    }
                    
                    downloadManager.startProcessing(zipEntries.length);

                    let fileCount = 0;
                    const writeErrors = [];
                    for (const [relativePath, zipEntry] of zipEntries) {
                        const fileName = relativePath.split('/').pop();
                        try {
                            const fileHandle = await rollHandle.getFileHandle(fileName, { create: true });
                            const writable = await fileHandle.createWritable();
                            const content = await zipEntry.async('blob');
                            await writable.write(content);
                            await writable.close();
                            fileCount++;
                            downloadManager.updateProcessingProgress(fileCount);
                        } catch (writeErr) {
                            console.error("❌ Error escribiendo:", fileName, writeErr);
                            writeErrors.push(`${fileName}: ${writeErr.message}`);
                        }
                    }
                    
                    if (fileCount === 0) {
                        throw new Error(`No se pudo escribir ningún archivo en la carpeta. Primer error: ${writeErrors[0] || 'permiso denegado o carpeta inaccesible'}`);
                    }
                    
                    downloadManager.finish();
                    if (writeErrors.length > 0) {
                        toast.warning(`${fileCount} archivos descargados en "${safeFolderName}" (${writeErrors.length} fallaron).`);
                    } else {
                        toast.success(`${fileCount} archivos descargados en "${safeFolderName}"`);
                    }
                } else {
                    saveAsZip(blob);
                    downloadManager.finish();
                    toast.success("ZIP descargado");
                }
            };

            await downloadTask();

        } catch (error) {
            console.error("Download Error:", error);
            let errorMsg;
            if (error.response && error.response.data instanceof Blob) {
                errorMsg = "Error del servidor: " + await error.response.data.text();
            } else if (error.name === 'NotFoundError') {
                // La carpeta guardada fue borrada o movida — limpiarla para el próximo intento
                await deleteDirectoryHandle('defaultRollsDownloadDir');
                errorMsg = "La carpeta de destino ya no existe. Probá de nuevo — se te pedirá elegir una nueva carpeta.";
            } else if (error.name === 'NotAllowedError' || (error.message && error.message.includes('permission'))) {
                errorMsg = "Sin permiso para escribir en la carpeta. Probá descargar de nuevo y reelegí la carpeta.";
            } else if (error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = "Error al procesar descarga.";
            }
            downloadManager.error(errorMsg);
            toast.error(errorMsg, { autoClose: 8000 });
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

    const handleCancelRoll = async () => {
        const result = await Swal.fire({
            title: '¿Cancelar lote vacío?',
            text: "Esta acción no se puede revertir y el lote desaparecerá.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#3f3f46',
            confirmButtonText: 'Sí, cancelar lote',
            cancelButtonText: 'Cerrar',
            background: '#18181b',
            color: '#f4f4f5'
        });

        if (!result.isConfirmed) return;

        try {
            setLoading(true);
            await rollsService.update(freshRoll.id, { estado: 'Cancelado' });
            toast.success("Lote cancelado correctamente.");
            onUpdate();
            onClose();
        } catch (error) {
            console.error("Error cancelando lote:", error);
            toast.error("Error al cancelar el lote.");
        } finally {
            setLoading(false);
        }
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

    const handleDragEnd = async (result) => {
        if (!result.destination) return;
        if (result.source.index === result.destination.index) return;

        // SB: el drag mueve el GRUPO/bloque entero (unidad), no la orden individual.
        if (isSB) {
            const rowUnit = [];
            renderUnits.forEach((u, ui) => u.orders.forEach(() => rowUnit.push(ui)));
            const fromU = rowUnit[result.source.index];
            let toU = rowUnit[result.destination.index];
            if (toU === undefined) toU = renderUnits.length - 1;
            if (fromU === undefined || fromU === toU) return;
            const newUnits = [...renderUnits];
            const [moved] = newUnits.splice(fromU, 1);
            newUnits.splice(toU, 0, moved);
            setUnitOrder(newUnits.map(u => u.sig));
            return;
        }

        const items = Array.from(orders);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);

        const newOrders = items.map((o, idx) => ({ ...o, sequence: idx + 1, Secuencia: idx + 1 }));
        setFreshRoll(prev => ({ ...prev, orders: newOrders }));

        const orderIds = newOrders.map(o => o.id || o.OrdenID);
        try {
            await rollsService.reorderOrders(freshRoll.id, orderIds);
            if (onUpdate) onUpdate();
        } catch (err) {
            console.error(err);
            toast.error("Error al reordenar");
            loadFreshData();
        }
    };

    return createPortal(
        <>
            <div className="fixed inset-0 bg-zinc-900/60 z-40 flex items-center justify-center pl-16 pt-14 animate-in fade-in duration-200" onClick={onClose}>
                <div
                    ref={modalRef}
                    className="bg-white rounded-2xl shadow-2xl w-[90%] h-[90%] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 border border-zinc-200/80"
                    onClick={e => e.stopPropagation()}
                >

                    {/* Header */}
                    <div className="shrink-0 border-b border-zinc-100">
                        <div className="px-6 py-4 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm bg-brand-cyan">
                                    <i className="fa-solid fa-scroll text-sm" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-black text-zinc-800 leading-none">
                                            {loading ? 'Cargando...' : freshRoll.name}
                                        </h3>
                                        {loading && <i className="fa-solid fa-spinner fa-spin text-xs text-zinc-400" />}
                                        {freshRoll.id && String(freshRoll.id).startsWith('R-') && (
                                            <span className="text-[10px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                {freshRoll.id}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-zinc-400 mt-0.5">Detalle del lote de producción</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-brand-magenta/10 hover:text-brand-magenta transition-all"
                            >
                                <i className="fa-solid fa-xmark text-base" />
                            </button>
                        </div>
                    </div>

                    {/* Stats Bar */}
                    <div className="px-6 py-4 bg-zinc-50/70 border-b border-zinc-100 flex gap-3 items-stretch flex-wrap shrink-0">
                        {/* Ordenes */}
                        <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3 shadow-sm min-w-[100px]">
                            <div className="w-8 h-8 rounded-lg bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
                                <i className="fa-solid fa-file-lines text-sm" />
                            </div>
                            <div>
                                <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Órdenes</div>
                                <div className="text-2xl font-black text-zinc-800 leading-none">{totalOrders}</div>
                            </div>
                        </div>

                        {/* Archivos */}
                        <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3 shadow-sm min-w-[100px]">
                            <div className="w-8 h-8 rounded-lg bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
                                <i className="fa-solid fa-paperclip text-sm" />
                            </div>
                            <div>
                                <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Archivos</div>
                                <div className={`text-2xl font-black leading-none ${totalFiles > 0 ? 'text-brand-cyan' : 'text-zinc-300'}`}>{totalFiles}</div>
                            </div>
                        </div>

                        {/* Total Metros */}
                        <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3 shadow-sm min-w-[110px]">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-500">
                                <i className="fa-solid fa-ruler-horizontal text-sm" />
                            </div>
                            <div>
                                <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Total m</div>
                                <div className="text-2xl font-black text-zinc-800 leading-none">
                                    {totalMeters.toFixed(2)}<span className="text-xs text-zinc-400 font-bold ml-0.5">m</span>
                                </div>
                            </div>
                        </div>

                        {/* Bobina */}
                        <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3 shadow-sm">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${freshRoll.BobinaID ? 'bg-green-50 text-green-600' : 'bg-brand-magenta/10 text-brand-magenta'}`}>
                                <i className="fa-solid fa-tape" />
                            </div>
                            <div>
                                <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Bobina</div>
                                {freshRoll.BobinaID ? (
                                    <div className="flex items-center gap-1.5">
                                        <span
                                            className="text-xs font-black text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-lg cursor-pointer hover:bg-green-100 transition-colors flex items-center gap-1"
                                            onClick={startSwapProcess}
                                            title="Clic para cambiar bobina"
                                        >
                                            <i className="fa-solid fa-check-circle text-[10px]" />
                                            {freshRoll.CodeBobina || freshRoll.BobinaID}
                                        </span>
                                        <button onClick={startSwapProcess} className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/10 rounded-lg transition-all" title="Cambiar Bobina">
                                            <i className="fa-solid fa-rotate text-xs" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-bold text-brand-magenta">Sin asignar</span>
                                        <button
                                            className="text-[9px] bg-brand-cyan text-white px-2 py-0.5 rounded-lg font-black hover:bg-brand-cyan/90 transition-colors"
                                            onClick={startSwapProcess}
                                        >
                                            ASIGNAR
                                        </button>
                                    </div>
                                )}
                                {orders[0]?.material && (
                                    <div className="text-[9px] text-zinc-400 truncate max-w-[180px] mt-0.5">{orders[0].material}</div>
                                )}
                            </div>
                        </div>

                        {/* Total Impreso (visual) - push to right, junto a Capacidad */}
                        <div className={`ml-auto flex flex-col justify-center border rounded-xl px-4 py-3 shadow-sm min-w-[180px] transition-all duration-500 ${allPrinted ? 'border-emerald-300 bg-emerald-50/50 shadow-md shadow-emerald-200/60' : 'border-zinc-200 bg-white'}`}>
                            <div className="flex justify-between items-center mb-2">
                                <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${allPrinted ? 'text-emerald-600' : 'text-zinc-400'}`}>
                                    {allPrinted && <i className="fa-solid fa-circle-check" />}
                                    Total Impreso
                                </span>
                                <span className="text-xs font-bold text-zinc-600">
                                    <span className={`text-emerald-600 ${allPrinted ? 'font-black' : ''}`}>{printedMeters.toFixed(1)}</span>
                                    <span className="text-zinc-400"> / {totalMeters.toFixed(1)}m</span>
                                </span>
                            </div>
                            <div className={`w-full h-2.5 rounded-full overflow-hidden ${allPrinted ? 'bg-emerald-100' : 'bg-zinc-100'}`}>
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden ${allPrinted ? 'bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]' : 'bg-emerald-500'}`}
                                    style={{ width: `${printedPercent}%` }}
                                >
                                    <div className="absolute inset-0 bg-white/20" />
                                    {allPrinted && (
                                        <div className="absolute inset-0 animate-shine bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                                    )}
                                </div>
                            </div>
                            <div className={`text-[9px] mt-1 text-right ${allPrinted ? 'text-emerald-600 font-black' : 'text-zinc-400 font-bold'}`}>
                                {allPrinted ? '✓ ¡Todo impreso!' : `${printedCount}/${totalOrders} impresas`}
                            </div>
                        </div>

                        {/* Capacidad */}
                        <div className="flex flex-col justify-center bg-white border border-zinc-200 rounded-xl px-4 py-3 shadow-sm min-w-[180px]">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Capacidad</span>
                                <span className="text-xs font-bold text-zinc-600">
                                    <span className="text-zinc-800">{freshRoll.currentUsage?.toFixed(1)}</span>
                                    <span className="text-zinc-400"> / {freshRoll.capacity}m</span>
                                </span>
                            </div>
                            <div className="w-full h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden bg-brand-cyan"
                                    style={{ width: `${capacityPercent}%` }}
                                >
                                    <div className="absolute inset-0 bg-white/20" />
                                </div>
                            </div>
                            <div className="text-[9px] text-zinc-400 mt-1 text-right font-bold">{capacityPercent.toFixed(0)}% usado</div>
                        </div>
                    </div>

                    {/* Body Table */}
                    <div className="flex-1 overflow-y-auto p-5 min-h-[300px] bg-zinc-50/40">
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
                            <table className="w-full text-sm text-left min-w-[800px]">
                                <thead className="text-[10px] text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200 font-black tracking-widest sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 w-10 text-center">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-zinc-300 text-brand-cyan focus:ring-brand-cyan cursor-pointer"
                                                checked={orders.length > 0 && selectedOrderIds.length === orders.length}
                                                onChange={handleToggleAll}
                                            />
                                        </th>
                                        <th className="px-4 py-3 w-10 text-center text-zinc-300">#</th>
                                        <th className="px-4 py-3 w-28">Orden</th>
                                        <th className="px-4 py-3 w-48">Cliente / Trabajo</th>
                                        <th className="px-4 py-3 w-48">Material / Variante</th>
                                        <th className="px-4 py-3 w-16 text-center"><i className="fa-solid fa-paperclip" /></th>
                                        <th className="px-4 py-3 w-20 text-center">Metros</th>
                                        <th className="px-4 py-3 w-28 text-center">Prioridad</th>
                                        <th className="px-4 py-3 w-10 text-center"><i className="fa-regular fa-comment-dots" /></th>
                                        <th className="px-4 py-3 w-44 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <Droppable droppableId={`roll-${freshRoll.id}`}>
                                    {(provided) => (
                                        <tbody 
                                            className="divide-y divide-zinc-100"
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                        >
                                            {/* Gap real entre la barra de columnas y el contenido */}
                                            <tr aria-hidden="true"><td colSpan="10" className="p-0"><div className="h-3" /></td></tr>
                                            {(() => { let dragIdx = -1; return renderUnits.map((unit, ui) => {
                                                const isGroup = unit.kind !== 'loose';
                                                const groupMeters = unit.orders.reduce((s, x) => s + (x.magnitude || 0), 0);
                                                return (
                                                <React.Fragment key={unit.key}>
                                                {isGroup && (
                                                    <tr className={`bg-zinc-100/70 select-none ${ui === 0 ? '' : '[&>td]:border-t-8 [&>td]:border-zinc-200'}`}>
                                                        <td colSpan="10" className="px-4 py-2.5">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="text-xs font-black text-zinc-700 uppercase tracking-wide flex items-center gap-2 truncate">
                                                                    <i className="fa-solid fa-layer-group text-brand-cyan" /> {unit.material}
                                                                </span>
                                                                <span className="text-[11px] font-bold text-zinc-500 whitespace-nowrap flex items-center gap-1.5">
                                                                    {unit.orders.length} {unit.orders.length === 1 ? 'orden' : 'órdenes'} · <span className="text-brand-cyan font-black">{groupMeters.toFixed(2)} m</span>
                                                                    {unit.kind === 'manual' && (
                                                                        <button onClick={() => handleDesagrupar(unit.orders.map(o => o.id))} title="Desagrupar" className="ml-1 w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10">
                                                                            <i className="fa-solid fa-link-slash text-[10px]" />
                                                                        </button>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                {unit.orders.map((o, oi) => { dragIdx++; const idx = dragIdx; return (
                                                <Draggable key={String(o.id || o.OrdenID)} draggableId={String(o.id || o.OrdenID)} index={idx}>
                                                    {(provided, snapshot) => (
                                                        <tr 
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            style={{
                                                                ...provided.draggableProps.style,
                                                                ...(snapshot.isDragging ? { display: 'table', tableLayout: 'fixed' } : {})
                                                            }}
                                                            className={`transition-colors group ${selectedOrderIds.includes(o.id) ? 'bg-brand-cyan/10' : printedOrderIds.includes(o.id) ? 'bg-emerald-50/60' : 'hover:bg-slate-50'} ${snapshot.isDragging ? 'bg-white shadow-xl ring-1 ring-brand-cyan/50 opacity-90' : ''} ${(!isGroup && isSB && ui !== 0 && oi === 0) ? '[&>td]:border-t-8 [&>td]:border-zinc-200' : ''}`}
                                                        >
                                                            <td className="px-2 py-0 align-middle w-10">
                                                                <div className="flex items-center justify-center gap-1.5 h-full">
                                                                    {!isSB && (
                                                                        <div {...provided.dragHandleProps} className="flex items-center text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing">
                                                                            <i className="fa-solid fa-grip-vertical text-xs"></i>
                                                                        </div>
                                                                    )}
                                                                    <input
                                                                        type="checkbox"
                                                                        className="w-4 h-4 rounded border-zinc-300 text-brand-cyan focus:ring-brand-cyan cursor-pointer"
                                                                        checked={selectedOrderIds.includes(o.id)}
                                                                        onChange={() => handleToggleOne(o.id)}
                                                                    />
                                                                </div>
                                                            </td>
                                            <td className="px-4 py-3 text-center text-zinc-300 font-mono text-xs w-10">{idx + 1}</td>
                                            <td className="px-4 py-3 font-bold text-zinc-700 font-mono text-xs w-28 break-all">
                                                {o.code || o.CodigoOrden}
                                            </td>
                                            <td className="px-4 py-3 w-48">
                                                <div className="font-semibold text-zinc-800 truncate text-sm max-w-[170px]">{o.client || o.Cliente}</div>
                                                <div className="text-xs text-zinc-400 truncate mt-0.5 max-w-[170px]">{o.desc || o.DescripcionTrabajo}</div>
                                            </td>
                                            <td className="px-4 py-3 w-48">
                                                <div className="font-semibold text-zinc-800 truncate text-sm max-w-[170px]">
                                                    {o.material || o.Material || '-'}
                                                </div>
                                                {o.variantCode && (
                                                    <div className="text-xs text-zinc-400 truncate mt-0.5 max-w-[170px]">
                                                        {o.variantCode}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center w-16">
                                                {o.fileCount > 0 ? (
                                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-cyan/10 text-brand-cyan text-[10px] font-black border border-brand-cyan/30">
                                                        {o.fileCount}
                                                    </span>
                                                ) : (
                                                    <span className="text-zinc-200 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center w-20">
                                                <span className="font-black text-zinc-800 text-sm">{o.magnitude || 0}</span>
                                                <span className="text-[10px] text-zinc-400 ml-0.5">m</span>
                                            </td>
                                            <td className="px-4 py-3 text-center w-28">
                                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border
                                                    ${o.priority === 'Urgente'
                                                        ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20'
                                                        : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>
                                                    {o.priority || 'Normal'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center w-10">
                                                {o.note && o.note.trim() !== '' && (
                                                    <div className="group/note relative flex justify-center">
                                                        <i className="fa-solid fa-message text-amber-400 cursor-help" />
                                                        <div className="absolute bottom-full mb-2 hidden group-hover/note:block z-50 w-48 p-2 bg-zinc-800 text-white text-xs rounded-lg shadow-lg">
                                                            {o.note}
                                                            <div className="absolute top-full left-1/2 -ml-1 border-4 border-transparent border-t-zinc-800" />
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center w-44">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        onClick={() => onViewOrder && onViewOrder(o)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/10 transition-all"
                                                        title="Ver detalle orden"
                                                    >
                                                        <i className="fa-regular fa-eye text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => openMoveModal(o)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/10 transition-all"
                                                        title="Mover a otro Lote"
                                                    >
                                                        <i className="fa-solid fa-arrow-right-arrow-left text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleUnassign(o)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 transition-all"
                                                        title="Sacar del Rollo"
                                                    >
                                                        <i className="fa-solid fa-rotate-left text-sm" />
                                                    </button>
                                                    {/* 4ta acción: marcar impreso (visual) */}
                                                    <label
                                                        className={`w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-all ${printedOrderIds.includes(o.id) ? 'text-emerald-600 bg-emerald-50' : 'text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                                        title={printedOrderIds.includes(o.id) ? 'Marcar como NO impreso' : 'Marcar impreso'}
                                                        onClick={e => e.stopPropagation()}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            className="w-4 h-4 rounded border-zinc-300 cursor-pointer accent-emerald-500"
                                                            checked={printedOrderIds.includes(o.id)}
                                                            onChange={() => handleTogglePrinted(o.id)}
                                                        />
                                                    </label>
                                                    {/* Drag del GRUPO entero (solo SB), a la derecha del tick de impreso */}
                                                    {isSB && (
                                                        <div {...provided.dragHandleProps} className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-300 hover:text-zinc-600 cursor-grab active:cursor-grabbing" title="Arrastrar grupo">
                                                            <i className="fa-solid fa-grip-vertical text-sm" />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                                        </tr>
                                                    )}
                                                </Draggable>
                                                ); })}
                                                </React.Fragment>
                                                );
                                            }); })()}
                                            {provided.placeholder}
                                            {orders.length === 0 && (
                                                <tr>
                                                    <td colSpan="10" className="text-center py-16">
                                                        <div className="flex flex-col items-center justify-center text-zinc-300">
                                                            <i className="fa-solid fa-folder-open text-5xl mb-3" />
                                                            <span className="text-zinc-400 text-sm font-medium">No hay órdenes en este lote.</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    )}
                                </Droppable>
                            </table>
                        </div>
                        </DragDropContext>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3.5 border-t border-zinc-100 bg-white flex items-center gap-2 z-10 shrink-0">
                        {/* Left group */}
                        <div className="flex items-center gap-2 mr-auto flex-wrap">
                            {/* Botones comentados en TODAS las áreas (Generar Etiquetas / Reporte Excel):
                            <button
                                className={`px-3 py-2 ${freshRoll.labelsCount > 0 ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20' : 'bg-brand-cyan hover:bg-brand-cyan/90 shadow-brand-cyan/20'} text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md active:scale-95`}
                                onClick={handleGenerateLabels}
                                disabled={loading}
                            >
                                <i className={`fa-solid ${freshRoll.labelsCount > 0 ? 'fa-print' : 'fa-tags'}`} />
                                {freshRoll.labelsCount > 0 ? 'Imprimir Etiquetas' : 'Generar Etiquetas'}
                            </button>
                            <button
                                className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
                                onClick={handleExportExcel}
                            >
                                <i className="fa-solid fa-file-excel" /> Reporte Excel
                            </button>
                            */}

                            {/* Agrupar: solo SB, sin función por ahora (a definir) */}
                            {isSB && (
                                <button
                                    type="button"
                                    onClick={handleAgrupar}
                                    disabled={!canGroup}
                                    title={canGroup ? 'Agrupar las órdenes seleccionadas' : 'Seleccioná 2 o más órdenes del mismo material'}
                                    className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all active:scale-95 ${canGroup ? 'bg-brand-cyan hover:bg-brand-cyan/90 text-white shadow-md shadow-brand-cyan/20' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'}`}
                                >
                                    <i className="fa-solid fa-layer-group" /> Agrupar
                                </button>
                            )}
                        </div>

                        {/* Right group */}
                        <div className="flex items-center gap-2">
                            {orders.length === 0 && (
                                <button
                                    className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md shadow-red-500/20 active:scale-95"
                                    onClick={handleCancelRoll}
                                    disabled={loading}
                                >
                                    <i className="fa-solid fa-trash" /> Cancelar Lote
                                </button>
                            )}
                            {selectedOrderIds.length > 0 && (
                                <>
                                    <button
                                        onClick={handleDownloadFiles}
                                        disabled={selectedOrderIds.length === 0 || loading}
                                        className="px-4 py-2 bg-brand-cyan hover:bg-brand-cyan/90 text-white font-bold rounded-lg text-sm transition-all shadow-md shadow-brand-cyan/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        {loading ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-download" />} 
                                        Descargar ({selectedOrderIds.length})
                                    </button>
                                    <button
                                        className="px-3 py-2 bg-brand-magenta hover:bg-brand-magenta/90 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md shadow-brand-magenta/20 active:scale-95 animate-in fade-in"
                                        onClick={handleUnassignMultiple}
                                    >
                                        <i className="fa-solid fa-rotate-left" /> Sacar ({selectedOrderIds.length})
                                    </button>
                                </>
                            )}
                            <button
                                className="px-4 py-2 border border-zinc-200 hover:bg-zinc-50 text-zinc-600 rounded-xl text-xs font-black transition-colors active:scale-95"
                                onClick={onClose}
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* COMPONENTE MODAL HIJO DE SELECCIÓN */}
            <BobinaAssignmentModal
                isOpen={isAssignModalOpen}
                onClose={() => setIsAssignModalOpen(false)}
                onSelect={handleAssignBobina}
                currentMetros={totalMeters}
                areaCode={currentAreaCode}
            />

            {/* NUEVO DIÁLOGO DE CONFIGURACIÓN DE SWAP */}
            <SwapConfigDialog
                isOpen={isSwapConfigOpen}
                onClose={() => setIsSwapConfigOpen(false)}
                onConfirm={handleSwapConfigConfirmed}
                bobinaId={freshRoll.BobinaID}
            />

            {/* MODAL PARA MOVER ORDEN */}
            <MoveOrderModal
                isOpen={isMoveModalOpen}
                onClose={() => setIsMoveModalOpen(false)}
                onConfirm={handleMoveOrder}
                currentRollId={freshRoll.id}
                areaCode={currentAreaCode}
            />
        </>,
        document.body
    );
};

export default RollDetailsModal;

