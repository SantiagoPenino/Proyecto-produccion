import React, { useState, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner'; // Importar Toast
import Swal from 'sweetalert2';
import { rollsService, productionService } from '../../services/api';
import OrderCard from '../production/components/OrderCard';
import RollCard from '../production/components/RollCard';
import OrderDetailModal from '../production/components/OrderDetailModal';
import RollAssignmentModal from '../modals/RollAssignmentModal';
import RollDetailsModal from '../modals/RollDetailsModal';
import ConfirmationModal from '../modals/ConfirmationModal'; // Importar Modal
import MachineControl from '../production/components/MachineControl';
import { Layers, Printer, Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { motion } from 'framer-motion';
import { Listbox, Transition } from '@headlessui/react';
import { socket } from '../../services/socketService';
import { isTabletDevice } from '../../utils/device';

// Tablet de planta: columnas de equipos más angostas para que entren 4 a lo ancho (1280px)
const IS_TABLET_PLANEACION = isTabletDevice();

const PlaneacionTrabajo = ({ AreaID }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
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

    const [localBoardData, setLocalBoardData] = useState({ machines: [], pendingRolls: [] });
    const [mesaOpen, setMesaOpen] = useState(!IS_TABLET_PLANEACION); // drawer: colapsado por defecto en tablet
    useEffect(() => {
        if (prodData) {
            setLocalBoardData(prodData);
        }
    }, [prodData]);

    // Derived State and Helpers
    const backlogOrders = rollsData?.pendingOrders || [];
    const activeRolls = rollsData?.rolls || [];
    const machines = localBoardData.machines || [];
    const rawPendingRolls = localBoardData.pendingRolls || [];
    const loading = loadingRolls || loadingProd;

    // Helper to determine if roll is from user
    const isMyRoll = (r) => {
        if (!user || !r) return false;
        const uid = String(user.id);
        const uname = user.nombre || '';
        const userEmail = user.usuario || '';
        return String(r.IdEmpleado) === uid || 
               String(r.userId) === uid ||
               String(r.creatorId) === uid ||
               String(r.creadorId) === uid ||
               String(r.idCreator) === uid ||
               String(r.createdBy) === uid ||
               (r.creador && r.creador === uname) ||
               (r.operator && r.operator === uname) ||
               (r.operatorName && r.operatorName === uname) ||
               (r.usuario && r.usuario === userEmail);
    };

    const pendingRolls = useMemo(() => {
        const myRolls = rawPendingRolls.filter(isMyRoll);
        const otherRolls = rawPendingRolls.filter(r => !isMyRoll(r));
        return [...myRolls, ...otherRolls];
    }, [rawPendingRolls, user]);

    const refreshBoard = () => {
        refetchRolls();
        refetchProd();
    };

    // Listeners para actualizaciones en tiempo real
    useEffect(() => {
        const handleUpdate = () => refreshBoard();
        socket.on('server:order_updated', handleUpdate);
        socket.on('server:ordersUpdated', handleUpdate);
        socket.on('lotes:updated', handleUpdate);
        return () => {
            socket.off('server:order_updated', handleUpdate);
            socket.off('server:ordersUpdated', handleUpdate);
            socket.off('lotes:updated', handleUpdate);
        };
    }, [refetchRolls, refetchProd]);

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

    const handleDragEnd = (result) => {
        const { source, destination, draggableId } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        const rollId = draggableId;
        const pureRollId = rollId.startsWith('assigned-') ? rollId.replace('assigned-', '') : rollId;

        // Cancelar consultas en vuelo para evitar que reescriban nuestro estado optimista
        queryClient.cancelQueries({ queryKey: ['productionBoard', areaCode] });

        // Calculamos el nuevo estado basado en el estado local actual
        const oldData = localBoardData;
        const newData = { 
            ...oldData, 
            pendingRolls: [...(oldData.pendingRolls || [])], 
            machines: (oldData.machines || []).map(m => ({...m, rolls: [...m.rolls]})) 
        };
        
        // Encontrar el rollo
        let rollToMove = newData.pendingRolls.find(r => String(r.id) === String(pureRollId));
        if (!rollToMove) {
            for (const m of newData.machines) {
                const r = m.rolls.find(r => String(r.id) === String(pureRollId));
                if (r) {
                    rollToMove = r;
                    break;
                }
            }
        }
        
        if (!rollToMove) return;

        // Remover del origen
        if (source.droppableId === 'mesa-armado') {
            newData.pendingRolls = newData.pendingRolls.filter(r => String(r.id) !== String(pureRollId));
        } else {
            const sourceMachine = newData.machines.find(m => String(m.id) === String(source.droppableId));
            if (sourceMachine) {
                sourceMachine.rolls = sourceMachine.rolls.filter(r => String(r.id) !== String(pureRollId));
            }
        }

        // Agregar al destino
        if (destination.droppableId === 'mesa-armado') {
            newData.pendingRolls.splice(destination.index, 0, rollToMove);
        } else {
            const destMachine = newData.machines.find(m => String(m.id) === String(destination.droppableId));
            if (destMachine) {
                destMachine.rolls.splice(destination.index, 0, rollToMove);
            }
        }

        // Optimistic UI Update síncrono
        flushSync(() => {
            setLocalBoardData(newData);
            queryClient.setQueryData(['productionBoard', areaCode], newData);
        });

        // Persiste el orden (Secuencia) de los lotes de una máquina según el estado local ya actualizado.
        // Reutiliza el mismo endpoint que Coordinación: rollIds[0] = arriba (Secuencia más alta).
        const persistMachineOrder = (machineId, movedId) => {
            const mach = newData.machines.find(m => String(m.id) === String(machineId));
            if (!mach || !mach.rolls.length) return Promise.resolve();
            const rollIds = mach.rolls.map(r => Number(r.id)).filter(n => !Number.isNaN(n));
            if (!rollIds.length) return Promise.resolve();
            return rollsService.reorderRolls(areaCode, rollIds, movedId != null ? Number(movedId) : undefined);
        };

        const swalToast = (title, icon = 'success') => Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: icon === 'error' ? 4000 : 3000, timerProgressBar: true, icon, title, customClass: { container: 'z-[9999]' } });

        // Async API calls
        const executeApiCall = async () => {
            const srcIsMachine = source.droppableId !== 'mesa-armado';
            const destIsMachine = destination.droppableId !== 'mesa-armado';

            // Reordenar dentro de Mesa de Armado: solo visual, no aplica Secuencia de cola de máquina.
            if (!srcIsMachine && !destIsMachine) return;

            try {
                if (!srcIsMachine && destIsMachine) {
                    // Mesa de Armado -> Máquina: asignar y fijar posición en la cola
                    await productionService.assignRolls([pureRollId], destination.droppableId);
                    await persistMachineOrder(destination.droppableId, pureRollId);
                    swalToast('Lote asignado por arrastre');
                } else if (srcIsMachine && !destIsMachine) {
                    // Máquina -> Mesa de Armado: desmontar
                    await productionService.unassignRoll(pureRollId);
                    swalToast('Lote desmontado por arrastre');
                } else if (source.droppableId === destination.droppableId) {
                    // Reordenar dentro de la MISMA máquina (esto antes no se persistía y revertía al refrescar)
                    await persistMachineOrder(destination.droppableId, pureRollId);
                    swalToast('Orden de lotes actualizado');
                } else {
                    // Mover entre máquinas distintas + fijar posición en la máquina destino
                    await productionService.assignRolls([pureRollId], destination.droppableId);
                    await persistMachineOrder(destination.droppableId, pureRollId);
                    swalToast('Lote movido entre máquinas');
                }
                setTimeout(() => refreshBoard(), 1000);
            } catch (error) {
                refreshBoard();
                console.error("Error en drag & drop de lotes:", error);
                const msg = error.response?.data?.error || error.message || "Error desconocido";
                swalToast(`Error: ${msg}`, 'error');
            }
        };

        executeApiCall();
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
        let base = filterMachineIds.length === 0
            ? machines
            : machines.filter(m => filterMachineIds.includes(String(m.id)));
        // TABLET de planta: la tablet vive en la calandra → mostrar SOLO la(s) calandra(s),
        // nada más (ignora el filtro). Fallback: si el área no tiene calandra, muestra todo.
        if (IS_TABLET_PLANEACION) {
            const calandras = machines.filter(m => String(m.name || '').trim().toLowerCase().startsWith('calandra'));
            if (calandras.length > 0) base = calandras;
        }
        // Orden de creación (EquipoID): respeta cómo se cargaron los equipos en el modal de gestión.
        return [...base].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
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
        // Actualización optimista para Play/Pause
        if (action === 'start' || action === 'pause') {
            queryClient.cancelQueries({ queryKey: ['productionBoard', areaCode] });
            flushSync(() => {
                const oldData = localBoardData;
                if (!oldData) return;
                const newData = { ...oldData, machines: oldData.machines.map(m => ({ ...m, rolls: [...m.rolls] })) };
                
                newData.machines.forEach(m => {
                    const r = m.rolls.find(roll => String(roll.id) === String(rollId));
                    if (r) {
                        if (action === 'start') {
                            r.status = 'En maquina';
                            // Pausar optimísticamente cualquier otro rollo en la misma máquina
                            m.rolls.forEach(other => {
                                if (String(other.id) !== String(rollId) && other.status.includes('En maquina')) {
                                    other.status = 'En cola';
                                }
                            });
                        } else if (action === 'pause') {
                            r.status = 'En cola';
                        }
                    }
                });
                
                setLocalBoardData(newData);
                queryClient.setQueryData(['productionBoard', areaCode], newData);
            });
        }

        try {
            await productionService.toggleStatus(rollId, action, destination);
            refreshBoard();
        } catch (error) {
            // Revertir en caso de error refrescando forzosamente
            refreshBoard();
            const msg = error.response?.data?.error || error.message || "Error desconocido";

            // Si es error de validación (400), usar warn para no alarmar en consola
            if (error.response?.status === 400) {
                console.warn("Accion bloqueada por validación:", msg);
            } else {
                console.error("Error cambiando estado:", error);
            }
            Swal.fire({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 4000,
                timerProgressBar: true,
                icon: 'error',
                title: msg,
                customClass: { container: 'z-[9999]' }
            });
        }
    };

    // ... UI RENDER ...
    return (
        <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex flex-col h-full bg-white font-sans overflow-hidden">



                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* HEADERS ROW — spans full width */}
                    <div className="flex border-b border-zinc-200 shrink-0">
                        {/* Mesa de Armado header (drawer colapsable) */}
                        <div className={`shrink-0 flex items-center border-r border-zinc-200 bg-white overflow-hidden transition-all duration-300 ${mesaOpen ? 'w-80 tablet:w-56 px-4 py-3 tablet:px-2 tablet:py-2 justify-between gap-2' : 'w-12 justify-center py-3'}`}>
                            {mesaOpen ? (
                                <>
                                    <h3 className="font-black text-zinc-700 text-sm tablet:text-xs flex items-center gap-2 shrink-0">
                                        <Layers size={15} className="text-brand-cyan" />
                                        Mesa de Armado
                                    </h3>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="h-6 flex items-center bg-brand-cyan/10 text-brand-cyan px-2 rounded-md text-xs tablet:text-[11px] font-bold">{pendingRolls.length}</span>
                                        <button onClick={() => setMesaOpen(false)} title="Ocultar Mesa de Armado" className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/10 transition-colors">
                                            <PanelLeftClose size={16} />
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <button onClick={() => setMesaOpen(true)} title="Mostrar Mesa de Armado" className="relative w-8 h-8 flex items-center justify-center rounded text-zinc-500 hover:text-brand-cyan hover:bg-brand-cyan/10 transition-colors">
                                    <PanelLeftOpen size={18} />
                                    {pendingRolls.length > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center bg-brand-cyan text-white px-1 rounded-full text-[9px] font-bold">{pendingRolls.length}</span>}
                                </button>
                            )}
                        </div>
                        {/* Equipos header */}
                        <div className="flex-1 px-4 py-3 tablet:px-2 tablet:py-2 flex items-center gap-2 bg-white">
                            <Printer size={15} className="text-brand-cyan" />
                            <h3 className="font-black text-zinc-700 text-sm tablet:text-xs">Equipos</h3>
                            {visibleMachines.length > 0 && <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded-md text-xs font-bold">{visibleMachines.length}</span>}
                            
                            <div className="flex-1"></div>
                            
                            {/* CSS Hover Dropdown for Machine Filter — oculto en tablet (siempre la calandra) */}
                                <div className="w-auto relative z-[100] group tablet:hidden">
                                    <div className="relative w-full cursor-pointer rounded-lg bg-white py-1.5 pl-3 pr-8 text-left border border-slate-200 group-hover:border-slate-300 outline-none sm:text-xs font-bold text-slate-700 shadow-sm transition-all flex items-center justify-between">
                                        <span className="block whitespace-nowrap">
                                            Todos los Equipos
                                        </span>
                                        <span className="absolute inset-y-0 right-0 flex items-center pr-2">
                                            <i className="fa-solid fa-chevron-down text-[10px] text-slate-400"></i>
                                        </span>
                                    </div>
                                    
                                    {/* Dropdown Menu (Hidden by default, shown on hover) */}
                                    <div className="absolute top-full right-0 pt-1 w-full hidden group-hover:block transition-all duration-200 origin-top z-[101]">
                                        <div className="max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-base shadow-lg ring-1 ring-black/5 sm:text-xs border border-slate-100">
                                        {machines.length === 0 ? (
                                            <div className="relative cursor-default select-none py-2 px-4 text-slate-500 italic text-center">
                                                No hay equipos
                                            </div>
                                        ) : (
                                            machines.map((machine) => {
                                                const selected = filterMachineIds.includes(String(machine.id));
                                                return (
                                                    <label
                                                        key={machine.id}
                                                        className={`relative cursor-pointer select-none py-2 px-3 transition-colors flex items-center w-full ${selected ? 'bg-brand-cyan/5 text-brand-cyan font-bold' : 'text-slate-600 font-medium hover:bg-slate-50'}`}
                                                    >
                                                        <input 
                                                            type="checkbox" 
                                                            className="mr-2 h-3.5 w-3.5 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan accent-brand-cyan cursor-pointer" 
                                                            checked={selected} 
                                                            onChange={(e) => {
                                                                const strId = String(machine.id);
                                                                if (e.target.checked) {
                                                                    setFilterMachineIds([...filterMachineIds, strId]);
                                                                } else {
                                                                    setFilterMachineIds(filterMachineIds.filter(id => id !== strId));
                                                                }
                                                            }} 
                                                        />
                                                        <span className="block truncate">
                                                            {machine.name}
                                                        </span>
                                                    </label>
                                                );
                                            })
                                        )}
                                        </div>
                                    </div>
                                </div>
                        </div>
                    </div>

                    {/* BODY ROW */}
                    <div className="flex-1 flex overflow-hidden">

                        {/* MESA DE ARMADO body (drawer colapsable) */}
                        <div className={`shrink-0 flex flex-col border-r border-zinc-200 bg-white overflow-hidden transition-all duration-300 ${mesaOpen ? 'w-80 tablet:w-56' : 'w-12'}`}>
                            <Droppable droppableId="mesa-armado">
                                {(provided, snapshot) => (
                                    <div 
                                        ref={provided.innerRef} 
                                        {...provided.droppableProps}
                                        className={`flex-1 overflow-y-auto p-2 flex flex-col gap-2 custom-scrollbar transition-colors ${snapshot.isDraggingOver ? 'bg-brand-cyan/5' : 'bg-zinc-50/30'}`}
                                    >
                                        {mesaOpen && pendingRolls.map((roll, index) => {
                                            const isMine = isMyRoll(roll);
                                            const prevRoll = index > 0 ? pendingRolls[index - 1] : null;
                                            const hasMyRolls = pendingRolls.some(isMyRoll);
                                            
                                            const showMyHeader = index === 0 && isMine;
                                            const showOtherHeader = hasMyRolls && (!isMine) && (index === 0 || isMyRoll(prevRoll));

                                            return (
                                                <React.Fragment key={roll.id}>
                                                    {showMyHeader && (
                                                        <div className="bg-custom-cyan/10 py-1.5 px-3 text-[10px] font-black text-brand-cyan uppercase tracking-widest sticky top-0 z-20 border-b-2 border-custom-cyan/30 backdrop-blur-sm flex items-center gap-2 shadow-sm">
                                                            <i className="fa-solid fa-user text-custom-cyan"></i> Mis Lotes
                                                        </div>
                                                    )}
                                                    {showOtherHeader && (
                                                        <div className="bg-custom-dark/5 py-1.5 px-3 text-[10px] font-black text-brand-dark/80 uppercase tracking-widest sticky top-0 z-20 border-b border-custom-dark/10 backdrop-blur-sm mt-1 flex items-center gap-2">
                                                            <i className="fa-solid fa-users text-custom-dark/50"></i> Otros Lotes
                                                        </div>
                                                    )}
                                                    <Draggable draggableId={String(roll.id)} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                style={{
                                                                    ...provided.draggableProps.style,
                                                                    opacity: snapshot.isDragging ? 0.8 : 1,
                                                                }}
                                                            >
                                                                <RollCard
                                                                    roll={roll}
                                                                    onViewDetails={(r) => setInspectingRollId(r.id)}
                                                                    isSelected={selectedRollIds.includes(roll.id)}
                                                                    onToggleSelect={handleToggleRoll}
                                                                />
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                </React.Fragment>
                                            );
                                        })}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </div>

                        {/* EQUIPOS body */}
                        <div className="flex-1 flex flex-col bg-zinc-50 overflow-hidden">
                            <div className="flex-1 overflow-x-auto tablet:overflow-y-auto p-4 tablet:p-2 custom-scrollbar">
                                {/* En tablet cada equipo se ve GRANDE, uno por fila (los operarios filtran a su máquina).
                                    En desktop, grilla auto-fit de varias columnas. */}
                                <div className="grid gap-4 tablet:gap-2 h-full tablet:h-auto" style={{ gridTemplateColumns: IS_TABLET_PLANEACION ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                                {visibleMachines.map(machine => (
                                    <MachineControl
                                        key={machine.id}
                                        machine={machine}
                                        areaCode={areaCode}
                                        pendingRolls={pendingRolls}
                                        onAssign={async (rollId) => {
                                            // Optimistic update
                                            queryClient.cancelQueries({ queryKey: ['productionBoard', areaCode] });
                                            flushSync(() => {
                                                const oldData = localBoardData;
                                                if (!oldData) return;
                                                const newData = { ...oldData, pendingRolls: [...oldData.pendingRolls], machines: oldData.machines.map(m => ({...m, rolls: [...m.rolls]})) };
                                                const rIndex = newData.pendingRolls.findIndex(r => String(r.id) === String(rollId));
                                                if(rIndex !== -1) {
                                                    const rollToMove = newData.pendingRolls.splice(rIndex, 1)[0];
                                                    const m = newData.machines.find(m => String(m.id) === String(machine.id));
                                                    if (m) m.rolls.push(rollToMove);
                                                }
                                                setLocalBoardData(newData);
                                                queryClient.setQueryData(['productionBoard', areaCode], newData);
                                            });

                                            try {
                                                await productionService.assignRolls([rollId], machine.id);
                                                setTimeout(() => refreshBoard(), 1000);
                                                Swal.fire({
                                                    toast: true,
                                                    position: 'top-end',
                                                    showConfirmButton: false,
                                                    timer: 3000,
                                                    timerProgressBar: true,
                                                    icon: 'success',
                                                    title: 'Lote asignado correctamente',
                                                    customClass: { container: 'z-[9999]' }
                                                });
                                            } catch (e) {
                                                console.error(e);
                                                Swal.fire({
                                                    toast: true,
                                                    position: 'top-end',
                                                    showConfirmButton: false,
                                                    timer: 4000,
                                                    timerProgressBar: true,
                                                    icon: 'error',
                                                    title: 'Error al asignar el lote',
                                                    customClass: { container: 'z-[9999]' }
                                                });
                                            }
                                        }}
                                        onToggleStatus={handleToggleMachineStatus}
                                        onUnassign={(rollId, callback) => {
                                            setConfirmModal({
                                                isOpen: true,
                                                title: '¿Desmontar rollo?',
                                                message: 'El rollo volverá a la mesa de armado.',
                                                isDestructive: true,
                                                onConfirm: async () => {
                                                    if (callback) callback();
                                                    setTimeout(async () => {
                                                        queryClient.cancelQueries({ queryKey: ['productionBoard', areaCode] });
                                                        const oldData = localBoardData;
                                                        if (!oldData) return;
                                                        const newData = { ...oldData, pendingRolls: [...oldData.pendingRolls], machines: oldData.machines.map(m => ({...m, rolls: [...m.rolls]})) };
                                                        let rollToMove = null;
                                                        for (const m of newData.machines) {
                                                            const rIndex = m.rolls.findIndex(r => String(r.id) === String(rollId));
                                                            if (rIndex !== -1) {
                                                                rollToMove = m.rolls.splice(rIndex, 1)[0];
                                                                break;
                                                            }
                                                        }
                                                        if (rollToMove) {
                                                            newData.pendingRolls.unshift(rollToMove);
                                                        }
                                                        setLocalBoardData(newData);
                                                        queryClient.setQueryData(['productionBoard', areaCode], newData);
                                                        try {
                                                            await productionService.unassignRoll(rollId);
                                                            refreshBoard();
                                                            Swal.fire({
                                                                toast: true,
                                                                position: 'top-end',
                                                                showConfirmButton: false,
                                                                timer: 3000,
                                                                timerProgressBar: true,
                                                                icon: 'success',
                                                                title: 'Rollo desmontado correctamente',
                                                                customClass: { container: 'z-[9999]' }
                                                            });
                                                        } catch (e) {
                                                            console.error(e);
                                                            Swal.fire({
                                                                toast: true,
                                                                position: 'top-end',
                                                                showConfirmButton: false,
                                                                timer: 3000,
                                                                timerProgressBar: true,
                                                                icon: 'error',
                                                                title: 'Error al desmontar el rollo',
                                                                customClass: { container: 'z-[9999]' }
                                                            });
                                                        }
                                                    }, 300);
                                                }
                                            });
                                        }}
                                        onViewDetails={(item) => {
                                            if (item.rolls) {
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

                    </div>
                </div>



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
                    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/60  p-4 animate-in fade-in duration-200">
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
                        lockReorder={(() => {
                            // En SB, si el lote está en una máquina que NO es impresora (calandra), no se reordena dentro del modal.
                            const mach = (localBoardData.machines || []).find(m => (m.rolls || []).some(r => String(r.id) === String(inspectingRollId)));
                            return String(areaCode || '').toUpperCase() === 'SB' && !!mach && !mach.separacionImpresion;
                        })()}
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
                <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/80  p-4 animate-in fade-in duration-200">
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
        </DragDropContext>
    );
};
export default PlaneacionTrabajo;
