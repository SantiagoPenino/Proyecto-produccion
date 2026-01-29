import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner'; // Importar Toast
import { rollsService, productionService } from '../../services/api';
import OrderCard from '../production/components/OrderCard';
import RollCard from '../production/components/RollCard';
import OrderDetailModal from '../production/components/OrderDetailModal';
import RollAssignmentModal from '../modals/RollAssignmentModal';
import RollDetailsModal from '../modals/RollDetailsModal';
import ConfirmationModal from '../modals/ConfirmationModal'; // Importar Modal
import MachineControl from '../production/components/MachineControl';

const PlaneacionTrabajo = ({ AreaID }) => {
    const navigate = useNavigate();
    const areaCode = AreaID; // Internal alias for compatibility
    // ESTADOS DE INTERACCIÓN
    const [selectedOrderIds, setSelectedOrderIds] = useState([]);
    const [selectedRollIds, setSelectedRollIds] = useState([]);

    const [inspectingOrder, setInspectingOrder] = useState(null);
    const [inspectingRollId, setInspectingRollId] = useState(null);

    const [isAssignModal, setIsAssignModal] = useState(false);
    const [isMachineModal, setIsMachineModal] = useState(false);

    // Estado para Modal de Confirmación Genérico
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: () => { } });

    // FILTROS
    const [filterMachineIds, setFilterMachineIds] = useState([]); // Array para Multi-Select
    const [isMachineFilterOpen, setIsMachineFilterOpen] = useState(false);

    // FILTROS BACKLOG
    const [priorityFilter, setPriorityFilter] = useState('ALL');
    const [variantFilter, setVariantFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [inkFilter, setInkFilter] = useState('ALL');
    const [materialFilter, setMaterialFilter] = useState([]);
    const [isMaterialOpen, setIsMaterialOpen] = useState(false);

    // NEW STATE: Magic Sort Progress
    const [magicSortProgress, setMagicSortProgress] = useState(null);
    // NEW STATE: Magic Sort Conflict (Existing Rolls)
    const [magicSortConflict, setMagicSortConflict] = useState(null);

    // WRAPPER: Magic Sort Logic
    const handleMagicSortCheck = async () => {
        if (selectedOrderIds.length === 0) {
            toast.warning('Seleccione al menos una orden para utilizar la Varita Mágica.');
            return;
        }

        // 1. Check for Existing Rolls Conflict
        const selectedOrders = backlogOrders.filter(o => selectedOrderIds.includes(o.id));
        const firstMaterial = selectedOrders[0]?.material;
        // Normalize: if material is missing/null, treat as diff
        const isUniformMaterial = selectedOrders.every(o => (o.material || 'X') === (firstMaterial || 'X'));

        if (isUniformMaterial && firstMaterial) {
            // Normalize material comparison
            const normalize = (s) => String(s || '').trim().toUpperCase();
            const targetMat = normalize(firstMaterial);

            // Search in both Active (Processing) and Pending (Mesa de Armado) rolls
            // Ensure we don't have duplicates if lists overlap (unlikely but safe)
            const allOpenRolls = [...activeRolls, ...pendingRolls].filter((r, i, self) =>
                self.findIndex(t => t.id === r.id) === i
            );

            const matches = allOpenRolls.filter(r => {
                // Compatible if same material AND not closed.
                // Check multiple 'closed' statuses
                const badStatus = ['Cerrado', 'Finalizado', 'Cancelado', 'Entregado'];
                return normalize(r.material) === targetMat && !badStatus.includes(r.status);
            });

            if (matches.length > 0) {
                setMagicSortConflict({ matchingRolls: matches, orderIds: selectedOrderIds, material: firstMaterial });
                return; // Stop here, wait for user decision
            }
        }

        // If no conflict, confirm and proceed
        setConfirmModal({
            isOpen: true,
            title: "Ejecutar Armado Mágico",
            message: `¿Activar varita mágica para auto-agrupar y procesar las ${selectedOrderIds.length} órdenes seleccionadas?`,
            onConfirm: () => executeMagicSort(selectedOrderIds)
        });
    };

    // ORIGINAL MAGIC SORT LOGIC (Refactored)
    const executeMagicSort = async (idsToProcess) => {
        setMagicSortProgress({ step: 'Iniciando magia...', status: 'loading' });

        try {
            await new Promise(r => setTimeout(r, 500));
            setMagicSortProgress({ step: 'Analizando órdenes y agrupando...', status: 'loading' });

            const res = await productionService.magicSort(areaCode, idsToProcess);

            setMagicSortProgress({ step: 'Descargando y midiendo archivos...', status: 'loading' });
            await new Promise(r => setTimeout(r, 800));

            setMagicSortProgress({ step: res.message, status: 'success' });
            toast.success(res.message);
            refreshBoard();
            setSelectedOrderIds([]);

            setTimeout(() => setMagicSortProgress(null), 4000);

        } catch (err) {
            console.error(err);
            const errMsg = err.response?.data?.error || err.message;
            setMagicSortProgress({ step: 'Error: ' + errMsg, status: 'error' });
            toast.error("Error en armado mágico: " + errMsg);
            setTimeout(() => setMagicSortProgress(null), 5000);
        }
    };

    // HANDLE ADD TO EXISTING
    const handleAddToExistingRoll = async (targetRollId) => {
        if (!targetRollId) return;
        try {
            setMagicSortConflict(null); // Close modal
            setMagicSortProgress({ step: 'Agregando al lote existente...', status: 'loading' });

            await rollsService.moveOrder({ orderIds: magicSortConflict.orderIds, targetRollId: targetRollId });

            setMagicSortProgress({ step: 'Órdenes agregadas correctamente', status: 'success' });
            toast.success("Órdenes agregadas correctamente al lote");
            refreshBoard();
            setSelectedOrderIds([]);
            setTimeout(() => setMagicSortProgress(null), 3000);

        } catch (error) {
            console.error(error);
            toast.error("Error al agregar al lote existente: " + error.message);
            setMagicSortProgress(null);
        }
    };

    const {
        data: rollsData,
        isLoading: loadingRolls,
        refetch: refetchRolls
    } = useQuery({
        queryKey: ['rollsBoard', areaCode],
        queryFn: () => rollsService.getBoard(areaCode),
        enabled: !!areaCode,
        refetchInterval: 30000
    });

    // 2. QUERY: PRODUCTION BOARD (Machines & Pending Rolls)
    const {
        data: prodData,
        isLoading: loadingProd,
        refetch: refetchProd
    } = useQuery({
        queryKey: ['productionBoard', areaCode],
        queryFn: () => productionService.getBoard(areaCode),
        enabled: !!areaCode,
        refetchInterval: 30000
    });

    // Derived State and Helpers
    const backlogOrders = rollsData?.pendingOrders || [];
    const activeRolls = rollsData?.rolls || [];
    const machines = prodData?.machines || [];
    const pendingRolls = prodData?.pendingRolls || [];
    const loading = loadingRolls || loadingProd;

    const refreshBoard = () => {
        refetchRolls();
        refetchProd();
    };

    // HANDLERS
    const handleToggleOrder = (orderId, isSelected) => {
        if (isSelected) setSelectedOrderIds(prev => [...prev, orderId]);
        else setSelectedOrderIds(prev => prev.filter(id => id !== orderId));
    };

    const handleToggleRoll = (rollId, isSelected) => {
        if (isSelected) setSelectedRollIds(prev => [...prev, rollId]);
        else setSelectedRollIds(prev => prev.filter(id => id !== rollId));
    };

    const handleAssignRollsToMachine = async (machineId) => {
        if (!machineId) return;
        try {
            await productionService.assignRolls(selectedRollIds, machineId);
            setIsMachineModal(false);
            refreshBoard();
            setSelectedRollIds([]); // Clear selection after assignment
            toast.success("Rollos asignados correctamente");
        } catch (error) {
            console.error("Error asignando rollos:", error);
            const msg = error.response?.data?.error || error.message || "Error desconocido";
            toast.error(`Error al asignar algunos rollos: ${msg}`);
        }
    };

    // ... (Filtros Logic - Machine, Priority, etc. kept same, unrelated blocks omitted for brevity if possible, keeping main logic)
    // Re-implementing filter logic to be safe since I'm overwriting a large block
    const toggleMachineFilter = (id) => {
        const strId = String(id);
        setFilterMachineIds(prev =>
            prev.includes(strId) ? prev.filter(x => x !== strId) : [...prev, strId]
        );
    };

    const visibleMachines = useMemo(() => {
        if (filterMachineIds.length === 0) return machines;
        return machines.filter(m => filterMachineIds.includes(String(m.id)));
    }, [machines, filterMachineIds]);

    const availablePriorities = useMemo(() => {
        const unique = new Set(backlogOrders.map(o => o.priority || 'Normal'));
        const orderPreference = ['Normal', 'Urgente', 'Reposición', 'Falla'];
        return ['ALL', ...Array.from(unique).sort((a, b) => {
            const idxA = orderPreference.indexOf(a);
            const idxB = orderPreference.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [backlogOrders]);

    const availableStatuses = useMemo(() => {
        const unique = new Set(backlogOrders.map(o => o.status || 'Pendiente'));
        const orderPreference = ['Pendiente', 'Produccion', 'En Lote', 'Imprimiendo', 'Control y Calidad', 'Pronto', 'Entregado', 'Finalizado', 'Cancelado'];
        return ['ALL', ...Array.from(unique).filter(Boolean).sort((a, b) => {
            const idxA = orderPreference.findIndex(p => p.toLowerCase() === a.toLowerCase());
            const idxB = orderPreference.findIndex(p => p.toLowerCase() === b.toLowerCase());
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [backlogOrders]);

    const uniqueVariants = useMemo(() => {
        const vars = new Set(backlogOrders.map(o => o.variantCode || o.variant).filter(v => v && v !== ''));
        return [...vars].sort();
    }, [backlogOrders]);

    const uniqueInks = useMemo(() => {
        const inks = new Set(backlogOrders.map(o => o.ink).filter(i => i && i !== ''));
        return [...inks].sort();
    }, [backlogOrders]);

    const uniqueMaterials = useMemo(() => {
        const mats = new Set(backlogOrders.map(o => o.material).filter(m => m && m !== ''));
        return [...mats].sort();
    }, [backlogOrders]);

    const filteredBacklogOrders = useMemo(() => {
        return backlogOrders.filter(o => {
            if (priorityFilter !== 'ALL') {
                if ((o.priority || 'Normal').toLowerCase() !== priorityFilter.toLowerCase()) return false;
            }
            if (variantFilter !== 'ALL') {
                if ((o.variantCode || o.variant) !== variantFilter) return false;
            }
            if (inkFilter !== 'ALL') {
                if (o.ink !== inkFilter) return false;
            }
            if (statusFilter !== 'ALL') {
                if ((o.status || 'Pendiente').toLowerCase() !== statusFilter.toLowerCase()) return false;
            }
            if (materialFilter.length > 0) {
                if (!materialFilter.includes(o.material)) return false;
            }
            return true;
        });
    }, [backlogOrders, priorityFilter, variantFilter, statusFilter, materialFilter, inkFilter]);

    const toggleMaterial = (mat) => {
        setMaterialFilter(prev => prev.includes(mat) ? prev.filter(x => x !== mat) : [...prev, mat]);
    };

    const handleViewOrder = (order) => {
        if (!order) { setInspectingOrder(null); return; }
        setInspectingOrder({ ...order, area: order.area || areaCode });
    };

    const handleToggleMachineStatus = async (rollId, action, destination) => {
        try {
            await productionService.toggleStatus(rollId, action, destination);
            refreshBoard();
        } catch (error) {
            const msg = error.response?.data?.error || error.message || "Error desconocido";

            // Si es error de validación (400), usar warn para no alarmar en consola
            if (error.response?.status === 400) {
                console.warn("Accion bloqueada por validación:", msg);
            } else {
                console.error("Error cambiando estado:", error);
            }
            toast.error(msg);
        }
    };

    // ... UI RENDER ...
    return (
        <div className="flex flex-col h-full bg-slate-100 font-sans overflow-hidden">

            {/* Toolbar */}
            <div className="bg-white border-b border-slate-200 shadow-sm z-[100] px-4 py-2 flex flex-wrap gap-3 items-center sticky top-0">

                <span className="text-slate-400 mr-1"><i className="fa-solid fa-filter"></i></span>

                {/* Prioridad */}
                <div className="flex items-center gap-1">
                    {availablePriorities.map(p => (
                        <button key={p} onClick={() => setPriorityFilter(p)}
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border transition-all ${priorityFilter === p ? (['Urgente', 'Reposición', 'Falla'].includes(p) ? 'bg-red-500 text-white border-red-500' : 'bg-slate-700 text-white border-slate-700') : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                            {p === 'ALL' ? 'Prior: Todas' : p}
                        </button>
                    ))}
                </div>

                <div className="w-px h-4 bg-slate-200"></div>

                {/* Estado */}
                <div className="flex items-center gap-1">
                    {availableStatuses.map(s => (
                        <button key={s} onClick={() => setStatusFilter(s)}
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border transition-all ${statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                            {s === 'ALL' ? 'Est: Todos' : s}
                        </button>
                    ))}
                </div>

                <div className="w-px h-4 bg-slate-200"></div>

                {/* Variante */}
                {uniqueVariants.length > 0 && (
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 h-[26px]">
                        <span className="text-[9px] font-black text-slate-400 uppercase">Var:</span>
                        <select
                            value={variantFilter}
                            onChange={(e) => setVariantFilter(e.target.value)}
                            className="bg-transparent text-[10px] uppercase font-bold text-slate-600 outline-none cursor-pointer max-w-[100px]"
                        >
                            <option value="ALL">Todas</option>
                            {uniqueVariants.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <div className="h-4 w-px bg-slate-200 mx-1"></div>
                    </div>
                )}

                {/* Filtro Tinta */}
                {uniqueInks.length > 0 && (
                    <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1 h-[26px]">
                        <span className="text-[9px] font-black text-purple-400 uppercase">Tinta:</span>
                        <select
                            value={inkFilter}
                            onChange={(e) => setInkFilter(e.target.value)}
                            className="bg-transparent text-[10px] uppercase font-bold text-purple-600 outline-none cursor-pointer max-w-[100px]"
                        >
                            <option value="ALL">Todas</option>
                            {uniqueInks.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <div className="h-4 w-px bg-purple-200 mx-1"></div>
                    </div>
                )}

                {/* Material Filter */}
                {uniqueMaterials.length > 0 && (
                    <div className="relative">
                        <button
                            onClick={() => setIsMaterialOpen(!isMaterialOpen)}
                            className={`px-3 py-1 bg-white border rounded-lg text-xs font-bold flex items-center gap-2 transition-all h-[26px] ${materialFilter.length > 0 ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                        >
                            <i className="fa-solid fa-layer-group text-slate-400"></i>
                            <span className="truncate max-w-[100px]">{materialFilter.length === 0 ? 'Materiales' : `(${materialFilter.length})`}</span>
                            <i className="fa-solid fa-chevron-down text-[10px]"></i>
                        </button>

                        {isMaterialOpen && (
                            <>
                                <div className="fixed inset-0 z-[110]" onClick={() => setIsMaterialOpen(false)}></div>
                                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-[120] p-2 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                                    <div className="flex justify-between items-center mb-2 px-1 border-b border-slate-100 pb-2">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Seleccionar Materiales</span>
                                        {materialFilter.length > 0 && (
                                            <button onClick={() => setMaterialFilter([])} className="text-[10px] text-blue-500 hover:underline">Limpiar</button>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        {uniqueMaterials.map(mat => (
                                            <label key={mat} className="flex items-start gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={materialFilter.includes(mat)}
                                                    onChange={() => toggleMaterial(mat)}
                                                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span className={`text-xs leading-tight ${materialFilter.includes(mat) ? 'text-blue-600 font-bold' : 'text-slate-600'}`}>{mat}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                <div className="flex-1"></div>

                {/* FILTRO DE MÁQUINAS (Multi-select) */}
                <div className="relative">
                    <button
                        onClick={() => setIsMachineFilterOpen(!isMachineFilterOpen)}
                        className={`px-3 py-1 bg-white border rounded-lg text-xs font-bold flex items-center gap-2 transition-all h-[26px] ${filterMachineIds.length > 0 ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                    >
                        <i className="fa-solid fa-print text-slate-400"></i>
                        <span className="truncate max-w-[100px]">{filterMachineIds.length === 0 ? 'Todos los Equipos' : `Equipos (${filterMachineIds.length})`}</span>
                        <i className="fa-solid fa-chevron-down text-[10px]"></i>
                    </button>

                    {isMachineFilterOpen && (
                        <>
                            <div className="fixed inset-0 z-[110]" onClick={() => setIsMachineFilterOpen(false)}></div>
                            <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-[120] p-2 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                                <div className="flex justify-between items-center mb-2 px-1 border-b border-slate-100 pb-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Filtrar Equipos</span>
                                    {filterMachineIds.length > 0 && (
                                        <button onClick={() => setFilterMachineIds([])} className="text-[10px] text-indigo-500 hover:underline">Limpiar</button>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    {machines.map(m => (
                                        <label key={m.id} className="flex items-start gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={filterMachineIds.includes(String(m.id))}
                                                onChange={() => toggleMachineFilter(m.id)}
                                                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <span className={`text-xs leading-tight ${filterMachineIds.includes(String(m.id)) ? 'text-indigo-600 font-bold' : 'text-slate-600'}`}>{m.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Magic Sort Button & Progress */}
                <div className="flex items-center gap-2">
                    {magicSortProgress ? (
                        <div className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${magicSortProgress.status === 'error' ? 'bg-red-100 text-red-600 border border-red-200' :
                            magicSortProgress.status === 'success' ? 'bg-green-100 text-green-600 border border-green-200' :
                                'bg-purple-50 text-purple-600 border border-purple-200'
                            }`}>
                            {magicSortProgress.status === 'loading' && <i className="fa-solid fa-spinner fa-spin"></i>}
                            {magicSortProgress.status === 'success' && <i className="fa-solid fa-check"></i>}
                            {magicSortProgress.status === 'error' && <i className="fa-solid fa-triangle-exclamation"></i>}
                            <span>{magicSortProgress.step}</span>
                        </div>
                    ) : (
                        <button
                            onClick={() => {
                                const code = (areaCode || '').toUpperCase();
                                // Support DF (DTF) and ECOUV
                                const isSupported = code.includes('DTF') || code === 'DF' || code.includes('ECOUV');

                                if (!isSupported) {
                                    toast.info(`🚧 Proceso en construcción para esta área (${areaCode || 'N/A'}).`);
                                    return;
                                }

                                if (selectedOrderIds.length > 0) {
                                    handleMagicSortCheck();
                                } else {
                                    setConfirmModal({
                                        isOpen: true,
                                        title: "Armado Mágico Global",
                                        message: "🪄 ¿Ejecutar Armado Mágico GLOBAL?\n\nEsto agrupará TODAS las órdenes pendientes por Variante y Material, creando lotes individuales automáticamente.",
                                        onConfirm: () => {
                                            setMagicSortProgress({ step: 'Iniciando magia global...', status: 'loading' });
                                            rollsService.magicAssignment(areaCode)
                                                .then(res => {
                                                    if (res.success) {
                                                        setMagicSortProgress({ step: res.message, status: 'success' });
                                                        toast.success(res.message);
                                                        refreshBoard();
                                                    } else {
                                                        setMagicSortProgress({ step: "Error: " + res.message, status: 'error' });
                                                        toast.error(res.message);
                                                    }
                                                    setTimeout(() => setMagicSortProgress(null), 4000);
                                                })
                                                .catch(err => {
                                                    console.error(err);
                                                    setMagicSortProgress({ step: "Error en magia", status: 'error' });
                                                    toast.error("Error al ejecutar armado mágico global.");
                                                    setTimeout(() => setMagicSortProgress(null), 4000);
                                                });
                                        }
                                    });
                                }
                            }}
                            className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-xs font-bold shadow-md hover:opacity-90 transition-all flex items-center gap-2"
                            title={selectedOrderIds.length > 0 ? "Agrupar seleccionadas" : "Agrupar TODO automáticamente"}
                        >
                            <i className="fa-solid fa-wand-magic-sparkles"></i>
                            <span className="hidden sm:inline">{selectedOrderIds.length > 0 ? 'Agrupar Sel.' : 'Armado Mágico'}</span>
                        </button>
                    )}
                </div>

                <div className="h-6 w-px bg-slate-200 mx-1"></div>

                <button onClick={refreshBoard} className="px-3 py-1 bg-white border border-slate-300 text-blue-600 text-xs font-bold rounded hover:bg-slate-50 h-[26px]">
                    <i className="fa-solid fa-rotate-right"></i>
                </button>
            </div>

            {/* Same Body Content */}
            {loading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 gap-3">
                    <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
                    <span className="font-bold">Cargando Tablero...</span>
                </div>
            ) : (
                <div className="flex-1 flex overflow-hidden p-4 gap-4">

                    {/* COLUMNA 1: BACKLOG */}
                    <div className="w-80 flex flex-col bg-slate-50 rounded-xl border border-slate-200 shadow-sm shrink-0 overflow-hidden">
                        <div className="p-3 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    checked={filteredBacklogOrders.length > 0 && selectedOrderIds.length === filteredBacklogOrders.length}
                                    onChange={() => {
                                        if (selectedOrderIds.length === filteredBacklogOrders.length) setSelectedOrderIds([]);
                                        else setSelectedOrderIds(filteredBacklogOrders.map(o => o.id));
                                    }}
                                />
                                <h3 className="font-bold text-slate-700 text-sm">Pendientes ({filteredBacklogOrders.length})</h3>
                            </div>

                            {selectedOrderIds.length > 0 && (
                                <button
                                    onClick={() => setIsAssignModal(true)}
                                    className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg shadow-blue-200 hover:bg-blue-700 animate-in zoom-in duration-200"
                                >
                                    AGRUPAR ({selectedOrderIds.length})
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/50 scrollbar-thin">
                            {filteredBacklogOrders.map(order => (
                                <OrderCard
                                    key={order.id}
                                    order={order}
                                    onViewDetails={handleViewOrder}
                                    minimal={true}
                                    isSelected={selectedOrderIds.includes(order.id)}
                                    onToggleSelect={handleToggleOrder}
                                />
                            ))}
                            {filteredBacklogOrders.length === 0 && (
                                <div className="text-center py-10 text-slate-400 italic text-xs">No hay órdenes pendientes con los filtros actuales.</div>
                            )}
                        </div>
                    </div>

                    {/* COLUMNA 2: MESA DE ARMADO */}
                    <div className="w-96 flex flex-col bg-indigo-50/30 rounded-xl border border-indigo-100 shadow-sm shrink-0 relative overflow-hidden">
                        <div className="absolute inset-0 border-2 border-dashed border-indigo-200 rounded-xl pointer-events-none m-1"></div>

                        <div className="p-3 border-b border-indigo-100 bg-indigo-50 flex justify-between items-center z-10 shrink-0">
                            <h3 className="font-bold text-indigo-800 text-sm flex items-center gap-2">
                                <i className="fa-solid fa-layer-group"></i> Mesa de Armado
                            </h3>

                            {selectedRollIds.length > 0 ? (
                                <button
                                    onClick={() => setIsMachineModal(true)}
                                    className="bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg shadow-indigo-200 hover:bg-indigo-700 animate-in zoom-in duration-200"
                                >
                                    ASIGNAR MÁQUINA ({selectedRollIds.length})
                                </button>
                            ) : (
                                <span className="bg-white text-indigo-600 px-2 py-0.5 rounded-full text-xs font-bold shadow-sm">{pendingRolls.length}</span>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 space-y-3 z-10 scrollbar-thin">
                            {pendingRolls.map(roll => (
                                <RollCard
                                    key={roll.id}
                                    roll={roll}
                                    onViewDetails={(r) => setInspectingRollId(r.id)}
                                    isSelected={selectedRollIds.includes(roll.id)}
                                    onToggleSelect={handleToggleRoll}
                                />
                            ))}
                            <div
                                onClick={() => { setSelectedOrderIds([]); setIsAssignModal(true); }}
                                className="p-4 text-center border-2 border-dashed border-indigo-200 rounded-lg bg-white/50 text-indigo-400 text-xs font-bold cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-all"
                            >
                                <i className="fa-solid fa-plus text-lg mb-1 block"></i>
                                Crear Lote Manual
                            </div>
                        </div>
                    </div>

                    {/* COLUMNA 3: EQUIPOS (Estilo Kanban) */}
                    <div className="flex-1 flex flex-col bg-slate-50/50 rounded-xl border border-dashed border-slate-300 overflow-hidden relative">
                        <div className="absolute top-2 right-2 z-0 opacity-10 pointer-events-none">
                            <i className="fa-solid fa-print text-6xl"></i>
                        </div>

                        <div className="flex-1 overflow-x-auto p-4 flex gap-6 align-start">
                            {visibleMachines.map(machine => (
                                <MachineControl
                                    key={machine.id}
                                    machine={machine}
                                    onAssign={() => { }}
                                    onToggleStatus={handleToggleMachineStatus}
                                    onUnassign={async (rollId) => {
                                        setConfirmModal({
                                            isOpen: true,
                                            isDestructive: true,
                                            title: "Desmontar Rollo",
                                            message: '¿Desmontar este rollo de la máquina? Volverá a la Mesa de Armado.',
                                            onConfirm: async () => {
                                                try {
                                                    await productionService.unassignRoll(rollId);
                                                    refreshBoard();
                                                    toast.success("Rollo desmontado correctamente");
                                                } catch (e) {
                                                    console.error(e);
                                                    toast.error("Error al desmontar el rollo");
                                                }
                                            }
                                        });
                                    }}
                                    onViewDetails={(item) => {
                                        if (item.rolls) {
                                            // Ir a Vista Detallada de Máquina
                                            navigate(`/production/machine/${areaCode}/${item.id}`);
                                        } else {
                                            setInspectingRollId(item.id);
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODALES --- */}

            <RollAssignmentModal
                isOpen={isAssignModal}
                onClose={() => setIsAssignModal(false)}
                selectedIds={selectedOrderIds}
                selectedOrders={backlogOrders.filter(o => selectedOrderIds.includes(o.id))}
                areaCode={areaCode}
                onSuccess={() => {
                    refreshBoard();
                    setSelectedOrderIds([]);
                }}
            />

            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                isDestructive={confirmModal.isDestructive}
            />

            {
                isMachineModal && (
                    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border-t-4 border-indigo-500">
                            <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-indigo-800">
                                    <i className="fa-solid fa-print mr-2"></i> Asignar Equipo
                                </h3>
                                <button onClick={() => setIsMachineModal(false)}><i className="fa-solid fa-xmark text-slate-400 hover:text-red-500"></i></button>
                            </div>
                            <div className="p-6">
                                <p className="text-sm text-slate-600 mb-4">
                                    Selecciona el equipo para los <strong className='text-indigo-600'>{selectedRollIds.length} lotes</strong> seleccionados:
                                </p>
                                <div className="space-y-2">
                                    {machines.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => handleAssignRollsToMachine(m.id)}
                                            className="w-full p-3 flex justify-between items-center bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-lg transition-all group"
                                        >
                                            <span className="font-bold text-slate-700 group-hover:text-emerald-700">{m.name}</span>
                                            <div className="flex gap-2">
                                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{m.status}</span>
                                                {m.rolls.length > 0 ? (
                                                    <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Ocupado</span>
                                                ) : (
                                                    <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">Libre</span>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                inspectingRollId && (
                    <RollDetailsModal
                        roll={activeRolls.find(r => r.id === inspectingRollId) || pendingRolls.find(r => r.id === inspectingRollId) || { id: inspectingRollId, name: 'Cargando...', orders: [] }}
                        onClose={() => setInspectingRollId(null)}
                        onViewOrder={handleViewOrder}
                        onUpdate={refreshBoard}
                    />
                )
            }

            <OrderDetailModal
                order={inspectingOrder}
                onClose={() => setInspectingOrder(null)}
                onOrderUpdated={refreshBoard}
            />

            {/* MODAL CONFLICTO MAGIC SORT (Lotes Existentes) */}
            {magicSortConflict && (
                <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border-t-4 border-amber-500">
                        <div className="px-6 py-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-amber-800 flex items-center gap-2">
                                <i className="fa-solid fa-triangle-exclamation"></i> Lotes Existentes Encontrados
                            </h3>
                            <button onClick={() => setMagicSortConflict(null)}>
                                <i className="fa-solid fa-xmark text-slate-400 hover:text-red-500"></i>
                            </button>
                        </div>

                        <div className="p-6">
                            <p className="text-sm text-slate-700 mb-4">
                                Las órdenes seleccionadas son de material <strong className="text-blue-600 uppercase">{magicSortConflict.material}</strong>.<br />
                                Hemos encontrado <strong>{magicSortConflict.matchingRolls.length} lotes abiertos</strong> con este mismo material.
                            </p>

                            <p className="text-xs text-slate-500 font-bold uppercase mb-2">Selecciona un lote existente:</p>

                            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50 p-2 space-y-2 mb-4">
                                {magicSortConflict.matchingRolls.map(roll => (
                                    <label key={roll.id} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 hover:shadow-sm transition-all group">
                                        <input
                                            type="radio"
                                            name="targetRoll"
                                            value={roll.id}
                                            className="w-4 h-4 text-amber-500 focus:ring-amber-500 border-slate-300"
                                            defaultChecked={magicSortConflict.selectedTargetId === roll.id}
                                            onChange={() => setMagicSortConflict(prev => ({ ...prev, selectedTargetId: roll.id }))}
                                        />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-slate-800">{roll.name}</span>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${roll.status === 'Producción' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                                    {roll.status}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 flex gap-3">
                                                <span><i className="fa-solid fa-ruler-combined"></i> {roll.currentUsage?.toFixed(1) || 0}m usados</span>
                                                <span><i className="fa-solid fa-box"></i> {roll.orders?.length || 0} órdenes</span>
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => {
                                        setConfirmModal({
                                            isOpen: true,
                                            title: "Crear Nuevo Lote",
                                            message: "Se crearán nuevos lotes para estas órdenes ignorando los existentes. ¿Continuar?",
                                            onConfirm: () => {
                                                setMagicSortConflict(null);
                                                executeMagicSort(magicSortConflict.orderIds);
                                            }
                                        });
                                    }}
                                    className="flex-1 px-3 py-2 border border-amber-200 text-amber-600 rounded-lg text-sm font-bold hover:bg-amber-50 transition-colors"
                                >
                                    Ignorar y Crear Nuevo
                                </button>
                                <button
                                    onClick={() => handleAddToExistingRoll(magicSortConflict.selectedTargetId)}
                                    disabled={!magicSortConflict.selectedTargetId}
                                    className="flex-1 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold shadow-md hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    Agregar al Lote Seleccionado
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
export default PlaneacionTrabajo;
