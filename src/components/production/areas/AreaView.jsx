import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { io } from "socket.io-client";
import { useQuery } from "@tanstack/react-query";
import { CirclePile, AlertTriangle } from "lucide-react";
import { LayoutGrid, CalendarCheck, ScanLine, Truck } from "lucide-react";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
// Componentes de Vistas
import ProductionTable from "../../production/components/ProductionTable"; // Restored
// import OrderCard from "../../production/components/OrderCard"; // Grid components commented out
import OrderDetailModal from "../../production/components/OrderDetailModal";
import RollsKanban from "../../pages/RollsKanban";
import ProductionKanban from "../../pages/ProductionKanban";
import FilePrintControl from "../../pages/FilePrintControl";
import LogisticsDashboard from "../../logistics/LogisticsDashboard";
import PlaneacionTrabajo from "../../pages/PlaneacionTrabajo";
import ImportadorManualView from "../ImportadorManualView";

// Modales y Sidebars
import NewOrderModal from "../../modals/NewOrderModal";
import ReportFailureModal from "../../modals/ReportFailureModal";
import StockRequestModal from "../../modals/StockRequestModal";
import LogisticsCartModal from "../../modals/LogisticsCartModal";
import RollAssignmentModal from "../../modals/RollAssignmentModal";
import RollSidebar from "../../layout/RollSidebar";
import MatrixSidebar from "../../layout/MatrixSidebar";

import { ordersService, rollsService } from '../../../services/api';
import { SOCKET_URL } from '../../../services/apiClient';
import { useAuth } from '../../../context/AuthContext';

// --- SUBCOMPONENT: MAGIC BUTTON ---
const MagicButton = ({ areaKey, onSuccess }) => {
    const [loading, setLoading] = useState(false);

    const handleMagic = async () => {
        // Áreas que tienen el procedimiento implementado
        const supportedAreas = ['ECOUV', 'DTF'];

        if (!supportedAreas.includes(areaKey)) {
            alert("🚧 Proceso en construcción para esta área. \n\nLa lógica de armado mágico es diferente para cada sector.");
            return;
        }

        if (!window.confirm("🪄 ¿Ejecutar Armado Mágico?\n\nEsto agrupará TODAS las órdenes pendientes por Variante y Material, creando lotes individuales automáticamente.")) return;

        setLoading(true);
        try {
            const res = await rollsService.magicAssignment(areaKey);
            if (res.success) {
                alert(res.message); // "¡Mágia completada!..."
                if (onSuccess) onSuccess();
            } else {
                alert("Error: " + (res.message || "Desconocido"));
            }
        } catch (error) {
            console.error(error);
            alert("Error ejecutando magia: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleMagic}
            disabled={loading}
            className="h-9 px-4 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-sm bg-purple-600 text-white border border-purple-700 hover:bg-purple-700 hover:shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Agrupar automáticamente por Variante > Material > Prioridad"
        >
            {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-wand-magic-sparkles"></i>}
            <span className="hidden md:inline">Armado Mágico</span>
        </button>
    );
};

export default function AreaView({ areaKey, areaConfig, onSwitchTab }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();

    // 1. NAVEGACIÓN INTELIGENTE (Keep as is)
    const basePath = useMemo(() => {
        const segments = location.pathname.split('/');
        const areaIdx = segments.findIndex(s => s.toLowerCase() === 'area');
        if (areaIdx !== -1 && segments[areaIdx + 1]) {
            return `/${segments[areaIdx]}/${segments[areaIdx + 1]}`;
        }
        return location.pathname;
    }, [location.pathname]);

    const isActive = (path) => {
        const currentPath = location.pathname.toLowerCase();
        if (path === '') {
            return currentPath === basePath.toLowerCase() || currentPath.endsWith('/tabla');
        }
        return currentPath.includes(path.toLowerCase());
    };

    const goTo = (subPath) => {
        if (!subPath || subPath === '') {
            navigate(basePath);
        } else {
            navigate(`${basePath}/${subPath}`);
        }
    };

    // 2. ESTADOS
    // Removed dbOrders and loadingOrders state, replaced by React Query
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [sidebarFilter, setSidebarFilter] = useState("ALL");
    const [sidebarMode, setSidebarMode] = useState("rolls");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [clientFilter, setClientFilter] = useState("");
    const [variantFilter, setVariantFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [priorityFilter, setPriorityFilter] = useState("ALL");

    const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
    const [isStockOpen, setIsStockOpen] = useState(false);
    const [isFailureOpen, setIsFailureOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isRollModalOpen, setIsRollModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    const hideImportar = ['corte', 'costura', 'bordado', 'estampado', 'twc', 'twt', 'emb'].includes((areaKey || '').toLowerCase());

    // 3. CARGA DE DATOS (React Query)
    const { data: dbOrders = [], isLoading: loadingOrders, refetch } = useQuery({
        queryKey: ['orders', areaKey],
        queryFn: async () => {
            if (!areaKey || areaKey.toLowerCase() === 'area') return [];
            console.log(`📡 API: Pidiendo datos para área [${areaKey}]`);
            let data = await ordersService.getByArea(areaKey, 'active');
            if (!data || data.length === 0) {
                // Retry with Uppercase if empty (preserve original logic)
                data = await ordersService.getByArea(areaKey.toUpperCase(), 'active');
            }

            // --- CROSS-COMPATIBILITY PATCH ---
            // El portal usa códigos diferentes ('DF', 'SB') que los de AreaView ('DTF', 'SUB').
            // Buscamos ambos y combinamos los resultados para que no se pierdan pedidos.
            let extraData = [];
            const upperArea = areaKey.toUpperCase();
            
            if (upperArea === 'DTF') {
                extraData = await ordersService.getByArea('DF', 'active');
            } else if (upperArea === 'DF') {
                extraData = await ordersService.getByArea('DTF', 'active');
            } else if (upperArea === 'SUB') {
                extraData = await ordersService.getByArea('SB', 'active');
            } else if (upperArea === 'SB') {
                extraData = await ordersService.getByArea('SUB', 'active');
            }
            
            if (extraData && extraData.length > 0) {
                // Merge and remove duplicates by id just in case
                const combined = [...(data || []), ...extraData];
                const uniqueIds = new Set();
                data = combined.filter(o => {
                    if (uniqueIds.has(o.id)) return false;
                    uniqueIds.add(o.id);
                    return true;
                });
            }

            return data || [];
        },
        enabled: !!areaKey && areaKey.toLowerCase() !== 'area',
        refetchInterval: 30000, // Polling every 30s as backup
    });

    // Socket.io: escuchar actualizaciones en tiempo real
    useEffect(() => {
        const socket = io(SOCKET_URL);
        socket.on('server:order_updated', (payload) => {
            console.log('🔔 Evento socket order_updated:', payload);
            refetch(); // refrescar al recibir notificación
        });
        return () => {
            socket.disconnect();
        };
    }, [refetch]);

    // 4. COMPUTED FILTERS (Dynamic based on data)
    const availablePriorities = useMemo(() => {
        const unique = new Set(dbOrders.map(o => o.priority || 'Normal'));
        const orderPreference = ['Normal', 'Urgente', 'Reposición', 'Falla'];
        return ['ALL', ...Array.from(unique).sort((a, b) => {
            const idxA = orderPreference.indexOf(a);
            const idxB = orderPreference.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [dbOrders]);

    const availableStatuses = useMemo(() => {
        const unique = new Set(dbOrders.map(o => o.status || 'Pendiente'));
        // Standard Workflow Order
        const orderPreference = ['Pendiente', 'Produccion', 'En Lote', 'Imprimiendo', 'Control y Calidad', 'Pronto', 'Entregado', 'Finalizado', 'Cancelado'];
        return ['ALL', ...Array.from(unique).filter(Boolean).sort((a, b) => {
            const idxA = orderPreference.findIndex(p => p.toLowerCase() === a.toLowerCase());
            const idxB = orderPreference.findIndex(p => p.toLowerCase() === b.toLowerCase());
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [dbOrders]);

    // 5. FILTRADO
    const filteredOrders = useMemo(() => {
        let result = dbOrders;
        if (sidebarFilter !== 'ALL') {
            let filterField = sidebarMode === 'rolls' ? 'rollId' : 'printer';
            if (areaKey === 'BORD' && sidebarMode === 'rolls') filterField = 'matrixStatus';
            if (sidebarFilter === 'Sin Asignar') result = result.filter(o => !o[filterField]);
            else result = result.filter(o => o[filterField] === sidebarFilter);
        }
        if (clientFilter) result = result.filter(o => o.client?.toLowerCase().includes(clientFilter.toLowerCase()));
        if (variantFilter !== 'ALL') result = result.filter(o => o.variant === variantFilter);
        if (statusFilter !== 'ALL') {
            // Exact match (case insensitive) now that filters are dynamic
            result = result.filter(o => (o.status || 'Pendiente').toLowerCase() === statusFilter.toLowerCase());
        }
        if (priorityFilter !== 'ALL') {
            // Exact match (case insensitive)
            result = result.filter(o => (o.priority || 'Normal').toLowerCase() === priorityFilter.toLowerCase());
        }
        return result;
    }, [dbOrders, sidebarFilter, sidebarMode, clientFilter, variantFilter, areaKey, statusFilter, priorityFilter]);

    const renderSidebar = () => null;

    if (!areaConfig) return <div className="p-10 text-center text-zinc-400">Cargando configuración...</div>;

    const btnBaseClass = "h-9 px-4 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-sm";
    const btnSecondaryClass = "bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-brand-cyan hover:bg-zinc-50";
    const btnPrimaryClass = "bg-brand-cyan text-white shadow-sm";

    console.log("🔍 [AreaView] Render - Props:", { areaKey, areaConfigName: areaConfig?.name, isRollModalOpen });

    const tableToolbar = (
        <div className="flex flex-nowrap gap-3 items-center">
            <button
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:bg-zinc-50 hover:text-brand-cyan hover:border-brand-cyan/30 transition-colors shadow-sm capitalize"
                onClick={() => navigate('/consultas/rollos', { state: { areaFilter: areaKey } })}
            >
                <i className="fa-solid fa-clock-rotate-left"></i> Historial
            </button>

            <div className="w-px h-5 bg-zinc-200 mx-1"></div>

            {/* Prioridad */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider mr-1">Prioridad:</span>
                {availablePriorities.map(p => {
                    const isSelected = priorityFilter === p;
                    const isUrgent = ['Urgente', 'Reposición', 'Falla'].includes(p);
                    
                    let selectedClass = isUrgent 
                        ? 'bg-brand-magenta text-white border-brand-magenta shadow-sm' 
                        : 'bg-zinc-700 text-white border-zinc-700 shadow-sm';
                        
                    let unselectedClass = 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:text-brand-cyan hover:border-brand-cyan/30 shadow-sm';

                    return (
                        <button
                            key={p}
                            onClick={() => setPriorityFilter(p)}
                            className={`flex items-center px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors capitalize ${isSelected ? selectedClass : unselectedClass}`}
                        >
                            {p === 'ALL' ? 'Todas' : p}
                        </button>
                    );
                })}
            </div>

            <div className="w-px h-5 bg-zinc-200 mx-1"></div>

            {/* Estado */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider mr-1">Estado:</span>
                {availableStatuses.map(s => {
                    const isSelected = statusFilter === s;
                    let selectedClass = 'bg-brand-cyan text-white border-brand-cyan shadow-sm';
                    let unselectedClass = 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:text-brand-cyan hover:border-brand-cyan/30 shadow-sm';

                    return (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`flex items-center px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors capitalize whitespace-nowrap ${isSelected ? selectedClass : unselectedClass}`}
                        >
                            {s === 'ALL' ? 'Todos' : s}
                        </button>
                    );
                })}
            </div>

            <div className="w-px h-5 bg-zinc-200 mx-1"></div>

            {/* Asignar Lote */}
            <div className="flex items-center gap-1">
                <button
                    disabled={selectedIds.length === 0}
                    onClick={() => setIsRollModalOpen(true)}
                    className={`h-[30px] flex items-center gap-2 px-3 text-xs font-bold border rounded-lg transition-colors shadow-sm whitespace-nowrap ${
                        selectedIds.length > 0
                            ? 'bg-brand-cyan text-white border-brand-cyan hover:bg-[#005a7a]'
                            : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed opacity-80'
                    }`}
                >
                    <i className="fa-solid fa-layer-group"></i>
                    Asignar a Lote
                    {selectedIds.length > 0 && (
                        <span className="ml-1 px-1.5 h-4 flex items-center justify-center bg-white/20 rounded-md text-[10px] leading-none">
                            {selectedIds.length}
                        </span>
                    )}
                </button>
                {selectedIds.length > 0 ? (
                    <button onClick={() => setSelectedIds([])} title="Desmarcar todo" className="flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-white border border-zinc-200 text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 hover:border-brand-magenta/30 transition-colors shadow-sm shrink-0">
                        <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                ) : (
                    <div className="w-[30px] h-[30px]"></div>
                )}
            </div>
        </div>
    );

    return (
        <div className="absolute inset-0 flex flex-col bg-zinc-50 overflow-hidden font-sans text-zinc-800 z-10">
            <StockRequestModal isOpen={isStockOpen} onClose={() => setIsStockOpen(false)} areaName={areaConfig.name} areaCode={areaKey} />
            <NewOrderModal isOpen={isNewOrderOpen} onClose={() => { setIsNewOrderOpen(false); refetch(); }} areaName={areaConfig.name} areaCode={areaKey} />
            <ReportFailureModal isOpen={isFailureOpen} onClose={() => setIsFailureOpen(false)} areaName={areaConfig.name} areaCode={areaKey} />
            <LogisticsCartModal isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} areaName={areaConfig.name} areaCode={areaKey} onSuccess={() => refetch()} />
            <RollAssignmentModal isOpen={isRollModalOpen} onClose={() => setIsRollModalOpen(false)} selectedIds={selectedIds} areaCode={areaKey} onSuccess={() => { setSelectedIds([]); refetch(); }} />

            {isImportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 animate-fade-in">
                    <div className="bg-white w-full max-w-7xl max-h-[95vh] rounded-xl overflow-hidden shadow-2xl flex flex-col relative">
                        <button
                            className="absolute top-4 right-6 text-slate-500 hover:text-slate-800 z-10 bg-white hover:bg-slate-200 p-2 rounded-full transition"
                            onClick={() => setIsImportModalOpen(false)}
                        >
                            <i className="fa-solid fa-xmark text-xl"></i>
                        </button>
                        <div className="overflow-y-auto flex-1 p-0">
                            <ImportadorManualView
                                isModal={true}
                                onClose={() => setIsImportModalOpen(false)}
                                onImportSuccess={() => refetch()}
                            />
                        </div>
                    </div>
                </div>
            )}

            <header className="bg-white flex flex-col shrink-0 z-20 w-full relative">
                <div className="px-4 py-2 flex items-center justify-between bg-white min-h-[56px] relative w-full overflow-hidden">

                    {/* CENTRO ABSOLUTO: Tabs de Navegación (Siempre en el centro exacto de la pantalla) */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 z-30 pointer-events-auto">
                        {!hideImportar && (
                            <button
                                className={`${btnBaseClass} px-3 h-8 text-xs ${btnSecondaryClass}`}
                                onClick={() => setIsImportModalOpen(true)}
                            >
                                <i className="fa-solid fa-file-import"></i> Importar Orden
                            </button>
                        )}
                        <button className={`${btnBaseClass} px-3 h-8 text-xs ${isActive('') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('')}><LayoutGrid size={14} /> Planilla</button>
                        <button className={`${btnBaseClass} px-3 h-8 text-xs ${isActive('planeacion') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('planeacion')}><CalendarCheck size={14} /> Planeación</button>
                        <button className={`${btnBaseClass} px-3 h-8 text-xs ${isActive('control') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('control')}><ScanLine size={14} /> Control</button>
                        <button className={`${btnBaseClass} px-3 h-8 text-xs ${isActive('logistica') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('logistica')}><Truck size={14} /> Logística</button>
                    </div>

                    {/* LADO IZQUIERDO (Mitad de la pantalla menos un margen protector para las tabs) */}
                    <div className="flex w-1/2 items-center pr-64 pointer-events-auto">
                        {/* BLOQUE 1: Título */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex flex-col justify-center shrink-0">
                                <h1 className="text-xl font-black text-zinc-800 leading-none whitespace-nowrap">{areaConfig.name}</h1>
                                <span className="text-[10px] font-bold text-brand-cyan uppercase tracking-widest">Producción</span>
                            </div>
                            <div className="h-8 w-px bg-zinc-200 mx-1 shrink-0"></div>
                        </div>

                        {/* BLOQUE 2: Asignar Lote (Movido al toolbar) */}
                        <div className="flex-1 flex justify-center min-w-0"></div>
                    </div>

                    {/* LADO DERECHO (Mitad de la pantalla menos el margen protector) */}
                    <div className="flex w-1/2 items-center justify-end pl-64 z-20 pointer-events-auto">
                        {/* BLOQUE 4: Acciones Globales */}
                        <div className="flex items-center gap-2 shrink-0">
                            <Tippy content="Pedir Insumos">
                                <button className="w-9 h-9 rounded-lg flex items-center justify-center transition-all shadow-sm bg-brand-gold/10 text-brand-gold border border-brand-gold/20 hover:bg-brand-gold/20" onClick={() => setIsStockOpen(true)}>
                                    <CirclePile size={24} />
                                </button>
                            </Tippy>
                            <Tippy content="Reportar Falla">
                                <button className="w-9 h-9 rounded-lg flex items-center justify-center transition-all shadow-sm bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20 hover:bg-brand-magenta/20" onClick={() => setIsFailureOpen(true)}>
                                    <AlertTriangle size={24} />
                                </button>
                            </Tippy>
                        </div>
                    </div>

                </div>
            </header>



            <div className="flex flex-1 overflow-hidden">


                <main className={`flex-1 bg-zinc-50 overflow-hidden flex flex-col h-full items-stretch ${isActive('') || isActive('tabla') || isActive('planeacion') || isActive('control') || isActive('logistica') ? 'p-0' : 'p-6'}`}>
                    <Routes>
                        <Route index element={<ProductionTable rowData={filteredOrders} onRowSelected={setSelectedIds} selectedRowIds={selectedIds} onRowClick={setSelectedOrder} columnDefs={areaConfig.defaultColDefs} toolbarContent={tableToolbar} />} />
                        <Route path="tabla" element={<ProductionTable rowData={filteredOrders} onRowSelected={setSelectedIds} selectedRowIds={selectedIds} onRowClick={setSelectedOrder} columnDefs={areaConfig.defaultColDefs} toolbarContent={tableToolbar} />} />

                        <Route path="lotes" element={<RollsKanban areaCode={areaKey} />} />

                        <Route path="produccion" element={<ProductionKanban areaCode={areaKey} />} />
                        <Route path="control" element={<FilePrintControl areaCode={areaKey} />} />
                        <Route path="planeacion" element={<PlaneacionTrabajo AreaID={areaKey} />} />
                        <Route path="logistica" element={<LogisticsDashboard areaCode={areaKey} />} />

                        <Route path="*" element={<Navigate to="." replace />} />
                    </Routes>
                </main>
            </div>
            {/* Mantener OrderDetailModal en lugar de Panel */}
            <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} onOrderUpdated={refetch} />
        </div>
    );
}
