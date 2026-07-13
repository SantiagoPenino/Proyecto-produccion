import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { io } from "socket.io-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CirclePile, AlertTriangle } from "lucide-react";
import { LayoutGrid, CalendarCheck, ScanLine, Truck } from "lucide-react";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import Swal from 'sweetalert2';
import { toast } from 'react-toastify';
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

export default function AreaView({ areaKey: rawAreaKey, areaConfig, onSwitchTab }) {
    // Normalizar a MAYÚSCULA: si la URL viene '/area/df', areaKey llegaba en minúscula
    // y disparaba queries duplicadas (df + DF) en el board (RollsKanban/ProductionKanban,
    // que reciben areaCode={areaKey}) + un retry inútil en la lista. Con una sola
    // capitalización, todo el árbol pide 'DF' una vez.
    const areaKey = (rawAreaKey || '').toUpperCase();
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
    const [globalSearch, setGlobalSearch] = useState(() => {
        try { return sessionStorage.getItem(`areaSearch_${areaKey}`) || ""; } catch { return ""; }
    });
    const [activeFilters, setActiveFilters] = useState(() => {
        try {
            const saved = sessionStorage.getItem(`areaFilters_${areaKey}`);
            return saved ? JSON.parse(saved) : { priorities: [], statuses: [], areaStatuses: [], variants: [] };
        } catch { return { priorities: [], statuses: [], areaStatuses: [], variants: [] }; }
    });
    const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
    const filterDropdownRef = React.useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target)) {
                setIsFilterDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleFilter = (category, value) => {
        if (showCancelled) {
            setShowCancelled(false);
            setCancelledOrders([]);
        }
        if (showPronto) {
            setShowPronto(false);
            setProntoOrders([]);
        }
        setActiveFilters(prev => {
            const current = prev[category] || [];
            const next = current.includes(value)
                ? { ...prev, [category]: current.filter(v => v !== value) }
                : { ...prev, [category]: [...current, value] };
            try { sessionStorage.setItem(`areaFilters_${areaKey}`, JSON.stringify(next)); } catch {}
            return next;
        });
    };

    const clearFilters = () => {
        const empty = { priorities: [], statuses: [], areaStatuses: [], variants: [] };
        setActiveFilters(empty);
        try { sessionStorage.removeItem(`areaFilters_${areaKey}`); } catch {}
    };

    const activeFilterCount = (activeFilters.priorities?.length || 0) + (activeFilters.statuses?.length || 0) + (activeFilters.areaStatuses?.length || 0) + (activeFilters.variants?.length || 0);

    const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
    const [isStockOpen, setIsStockOpen] = useState(false);
    const [isFailureOpen, setIsFailureOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isRollModalOpen, setIsRollModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [flashingRows, setFlashingRows] = useState([]);
    const [showCancelled, setShowCancelled] = useState(false);
    const [cancelledOrders, setCancelledOrders] = useState([]);
    const [loadingCancelled, setLoadingCancelled] = useState(false);

    const [showPronto, setShowPronto] = useState(false);
    const [prontoOrders, setProntoOrders] = useState([]);
    const [loadingPronto, setLoadingPronto] = useState(false);

    const handleToggleCancelled = async () => {
        const next = !showCancelled;
        setShowCancelled(next);
        if (next) setShowPronto(false);
        setIsFilterDropdownOpen(false);
        if (next && areaKey && areaKey.toLowerCase() !== 'area') {
            setLoadingCancelled(true);
            try {
                // Reutilizamos getByArea (mismo que órdenes activas) con mode='cancelled'
                const data = await ordersService.getByArea(areaKey, 'cancelled');
                setCancelledOrders(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error('Error cargando canceladas:', e);
                setCancelledOrders([]);
            } finally {
                setLoadingCancelled(false);
            }
        } else {
            setCancelledOrders([]);
        }
    };

    const handleTogglePronto = async () => {
        const next = !showPronto;
        setShowPronto(next);
        if (next) setShowCancelled(false);
        setIsFilterDropdownOpen(false);
        if (next && areaKey && areaKey.toLowerCase() !== 'area') {
            setLoadingPronto(true);
            try {
                const data = await ordersService.getByArea(areaKey, 'pronto');
                setProntoOrders(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error('Error cargando prontas:', e);
                setProntoOrders([]);
            } finally {
                setLoadingPronto(false);
            }
        } else {
            setProntoOrders([]);
        }
    };

    const hideImportar = ['corte', 'costura', 'bordado', 'estampado', 'twc', 'twt', 'emb'].includes((areaKey || '').toLowerCase());

    // 3. CARGA DE DATOS (React Query)
    const { data: dbOrders = [], isLoading: loadingOrders, refetch } = useQuery({
        queryKey: ['orders', areaKey],
        queryFn: async () => {
            if (!areaKey || areaKey.toLowerCase() === 'area') return [];
            console.log(`📡 API: Pidiendo datos para área [${areaKey}]`);
            // areaKey ya viene normalizado a MAYÚSCULA, así que una sola llamada alcanza
            // (antes se reintentaba con toUpperCase porque podía venir en minúscula).
            let data = await ordersService.getByArea(areaKey, 'active');

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
            } else if (upperArea === 'DIRECTA' || upperArea === 'IMD') {
                const imdData = await ordersService.getByArea('IMD', 'active') || [];
                const xmdData = await ordersService.getByArea('XMD', 'active') || [];
                extraData = [...imdData, ...xmdData];
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

    const queryClient = useQueryClient();

    // Socket.io: escuchar actualizaciones en tiempo real
    useEffect(() => {
        const socket = io(SOCKET_URL);
        let refetchTimer = null;

        // Throttle con trailing de la parte pesada: los eventos pueden venir en ráfaga O espaciados
        // cada 1-2s (ej. el job de WSP avisa orden por orden; entregas múltiples) — un debounce corto
        // NO los coalesce y termina refetcheando por cada evento en cada pantalla abierta.
        // Regla: máximo UN refetch por ventana; el primer evento sale casi al toque (UI ágil) y el
        // resto de la ráfaga queda cubierto por una única ejecución al cierre de la ventana.
        const REFETCH_WINDOW_MS = 8000;
        let lastRefetchAt = 0;
        const doRefetch = () => {
            lastRefetchAt = Date.now();
            refetch(); // refrescar lista principal
            // Refrescar también los tableros hijos (Planeación, Kanban, etc)
            if (areaKey) {
                queryClient.invalidateQueries(['rollsBoard', areaKey]);
                queryClient.invalidateQueries(['productionBoard', areaKey]);
            }
        };
        const scheduleRefetch = () => {
            if (refetchTimer) return; // ya hay una ejecución agendada que cubre este evento
            const elapsed = Date.now() - lastRefetchAt;
            const wait = elapsed >= REFETCH_WINDOW_MS ? 300 : REFETCH_WINDOW_MS - elapsed;
            refetchTimer = setTimeout(() => { refetchTimer = null; doRefetch(); }, wait);
        };

        const handleSocketUpdate = (payload) => {
            console.log('🔔 Evento socket update:', payload);
            
            // Mostrar Toast para nuevas ordenes
            if (payload && payload.orders && Array.isArray(payload.orders)) {
                payload.orders.forEach(o => {
                    const orderArea = (o.area || '').toUpperCase();
                    const viewArea = (areaKey || '').toUpperCase();
                    const isSameArea = orderArea === viewArea || 
                                     (orderArea === 'DF' && viewArea === 'DTF') || 
                                     (orderArea === 'DTF' && viewArea === 'DF') || 
                                     (orderArea === 'SB' && viewArea === 'SUB') || 
                                     (orderArea === 'SUB' && viewArea === 'SB');
                    
                    const isDFPath = window.location.pathname.toLowerCase().startsWith('/area/df');

                    if (isSameArea && isDFPath) {
                        const isUrgent = ['Urgente', 'Reposición', 'Falla'].includes(o.prioridad);
                        
                        toast(`Se ha creado la orden ${o.codigo || 'ORD-' + o.id}.`, {
                            position: "top-right",
                            autoClose: 1500,
                            style: {
                                background: isUrgent ? '#BD0C7E' : '#006E97', // brand-magenta / brand-cyan
                                color: '#fff',
                                fontWeight: 'bold',
                            },
                            progressStyle: {
                                background: 'rgba(255,255,255,0.5)',
                            },
                            icon: isUrgent ? '🔥' : '✅'
                        });
                    }
                });
            }

            if (payload && payload.movedIds && Array.isArray(payload.movedIds)) {
                setFlashingRows(payload.movedIds);
                setTimeout(() => setFlashingRows([]), 3000);
            }

            // Parte pesada (refetch + invalidaciones): debounced para coalescer ráfagas
            scheduleRefetch();
        };

        socket.on('server:order_updated', handleSocketUpdate);
        socket.on('server:ordersUpdated', handleSocketUpdate);
        socket.on('server:new_order', handleSocketUpdate);
        socket.on('lotes:updated', handleSocketUpdate);

        return () => {
            clearTimeout(refetchTimer);
            toast.dismiss(); // al salir de la vista de área, descolgar toasts de orden que sigan en pantalla (no deben verse fuera de /area/df)
            // socket es el singleton compartido (socket.io multiplexa por URL): NO hacer
            // socket.disconnect() — eso baja el socket de TODA la app y deja los listeners
            // colgados, que se acumulan en cada montaje → un evento dispara N refetches
            // (degradación progresiva). Solo quitar los listeners de ESTE componente.
            socket.off('server:order_updated', handleSocketUpdate);
            socket.off('server:ordersUpdated', handleSocketUpdate);
            socket.off('server:new_order', handleSocketUpdate);
            socket.off('lotes:updated', handleSocketUpdate);
        };
    }, [refetch, areaKey, queryClient]);

    // 4. COMPUTED FILTERS (Dynamic based on data)
    const availablePriorities = useMemo(() => {
        const orderPreference = ['Normal', 'Urgente', 'Reposición', 'Falla'];
        const unique = new Set(dbOrders.map(o => {
            const raw = o.priority || 'Normal';
            const preferred = orderPreference.find(p => p.toLowerCase() === raw.toLowerCase());
            return preferred || raw;
        }));
        return ['ALL', ...Array.from(unique).sort((a, b) => {
            const idxA = orderPreference.indexOf(a);
            const idxB = orderPreference.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [dbOrders]);

    // Filtro por ESTADO EN ÁREA (o.areaStatus). Se omiten los terminales (Finalizado,
    // Cancelado, Avisado, Entregado) porque van en su botón aparte ("Ver finalizadas/canceladas").
    const availableAreaStatuses = useMemo(() => {
        const orderPreference = ['Pendiente', 'En Lote', 'En Maquina', 'Control y Calidad', 'Pronto', 'En transito'];
        const excluded = ['finalizado', 'cancelado', 'avisado', 'entregado'];
        const unique = new Set(dbOrders
            .map(o => (o.areaStatus || '').trim())
            .filter(v => v && !excluded.includes(v.toLowerCase()))
        );
        return [...Array.from(unique).sort((a, b) => {
            const idxA = orderPreference.findIndex(p => p.toLowerCase() === a.toLowerCase());
            const idxB = orderPreference.findIndex(p => p.toLowerCase() === b.toLowerCase());
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [dbOrders]);

    const availableStatuses = useMemo(() => {
        const orderPreference = ['Pendiente', 'Produccion', 'En Lote', 'Imprimiendo', 'Control y Calidad', 'Pronto', 'Entregado', 'Finalizado', 'Cancelado'];
        const unique = new Set(dbOrders.map(o => {
            const raw = o.areaStatus || o.status || 'Pendiente';
            const preferred = orderPreference.find(p => p.toLowerCase() === raw.toLowerCase());
            return preferred || (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase());
        }));
        return ['ALL', ...Array.from(unique).filter(Boolean).sort((a, b) => {
            const idxA = orderPreference.findIndex(p => p.toLowerCase() === a.toLowerCase());
            const idxB = orderPreference.findIndex(p => p.toLowerCase() === b.toLowerCase());
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })];
    }, [dbOrders]);

    const availableVariants = useMemo(() => {
        const unique = new Set(
            dbOrders
                .map(o => (o.variantCode || '').trim().toUpperCase())
                .filter(v => v && v !== 'N/A' && v !== '')
        );
        return ['ALL', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
    }, [dbOrders]);

    const availableMaterials = useMemo(() => {
        const unique = new Set(
            dbOrders
                .map(o => (o.material || '').trim())
                .filter(v => v && v !== '')
        );
        return [...Array.from(unique).sort((a, b) => a.localeCompare(b))];
    }, [dbOrders]);

    const isDTF = ['DF', 'DTF'].includes((areaKey || '').toUpperCase());
    const isSB = (areaKey || '').toUpperCase() === 'SB';
    // DIRECTA arma lotes por material igual que DTF: filtro por Material (la variante es única)
    // y validación de material uniforme al asignar a lote.
    const isDirecta = ['DIRECTA', 'IMD'].includes((areaKey || '').toUpperCase());
    const lotePorMaterial = isDTF || isDirecta;

    // 5. FILTRADO
    const displayOrders = showCancelled ? cancelledOrders : (showPronto ? prontoOrders : dbOrders);
    const filteredOrders = useMemo(() => {
        // En modo canceladas o prontas: mostrar todas sin aplicar filtros activos de la sesión normal
        if (showCancelled || showPronto) {
            let result = [...displayOrders];
            if (globalSearch) {
                const term = globalSearch.toLowerCase().trim();
                result = result.filter(o => 
                    (o.client && o.client.toLowerCase().includes(term)) || 
                    (o.code && o.code.toLowerCase().includes(term)) ||
                    (o.idClienteReact && o.idClienteReact.toString().includes(term)) ||
                    (o.codCliente && o.codCliente.toString().toLowerCase().includes(term))
                );
            }
            return result.sort((a, b) =>
                new Date(b.entryDate || 0) - new Date(a.entryDate || 0)
            );
        }

        let result = displayOrders;
        
        // Fallas: por priority='Falla' O por código con -F
        const isFalla = (o) => (o.priority || '').toLowerCase() === 'falla' || (o.code || '').toUpperCase().includes('-F');
        // Reposiciones: por priority='Reposición' O por código con -R
        const isReposicion = (o) => (o.priority || '').toLowerCase() === 'reposición' || (o.code || '').toUpperCase().includes('-R');

        if (sidebarFilter !== 'ALL') {
            let filterField = sidebarMode === 'rolls' ? 'rollId' : 'printer';
            if (areaKey === 'BORD' && sidebarMode === 'rolls') filterField = 'matrixStatus';
            if (sidebarFilter === 'Sin Asignar') result = result.filter(o => !o[filterField]);
            else result = result.filter(o => o[filterField] === sidebarFilter);
        }
        if (clientFilter) result = result.filter(o => o.client?.toLowerCase().includes(clientFilter.toLowerCase()));
        
        if (globalSearch) {
            const term = globalSearch.toLowerCase().trim();
            result = result.filter(o => 
                (o.client && o.client.toLowerCase().includes(term)) || 
                (o.code && o.code.toLowerCase().includes(term)) ||
                (o.idClienteReact && o.idClienteReact.toString().includes(term)) ||
                (o.codCliente && o.codCliente.toString().toLowerCase().includes(term))
            );
        }

        if (activeFilters.variants && activeFilters.variants.length > 0) {
            if (lotePorMaterial) {
                result = result.filter(o => activeFilters.variants.includes((o.material || '').trim()));
            } else {
                result = result.filter(o => activeFilters.variants.includes((o.variantCode || '').trim().toUpperCase()));
            }
        }
        if (activeFilters.statuses && activeFilters.statuses.length > 0) {
            result = result.filter(o => activeFilters.statuses.some(s => s.toLowerCase() === (o.areaStatus || o.status || 'Pendiente').toLowerCase()));
        }
        if (activeFilters.areaStatuses && activeFilters.areaStatuses.length > 0) {
            result = result.filter(o => activeFilters.areaStatuses.some(s => s.toLowerCase() === (o.areaStatus || '').toLowerCase()));
        }
        if (activeFilters.priorities && activeFilters.priorities.length > 0) {
            result = result.filter(o => activeFilters.priorities.some(p => p.toLowerCase() === (o.priority || 'Normal').toLowerCase()));
        }

        // Quitar fallas y reposiciones del resultado filtrado para ponerlas al inicio
        const allFallas = result.filter(isFalla);
        const allReposiciones = result.filter(o => !isFalla(o) && isReposicion(o));
        const resultWithoutFallas = result.filter(o => !isFalla(o) && !isReposicion(o));

        // SB: respetando la prioridad, ordenar por defecto alfabéticamente por material dentro de
        // cada grupo (Falla → Reposición → Urgente → Normal). Agrupa misma tela para reducir
        // cambios de bobina en la calandra.
        if (isSB) {
            const byMaterial = (a, b) =>
                (a.material || '').trim().localeCompare((b.material || '').trim(), 'es', { sensitivity: 'base' });
            // Dentro del "resto", Urgente va antes que Normal/otras; cada subgrupo alfabético por material.
            const sortRest = (arr) => [...arr].sort((a, b) => {
                const aUrg = (a.priority || 'Normal').toLowerCase() === 'urgente' ? 0 : 1;
                const bUrg = (b.priority || 'Normal').toLowerCase() === 'urgente' ? 0 : 1;
                if (aUrg !== bUrg) return aUrg - bUrg;
                return byMaterial(a, b);
            });
            return [
                ...[...allFallas].sort(byMaterial),
                ...[...allReposiciones].sort(byMaterial),
                ...sortRest(resultWithoutFallas),
            ];
        }

        // Ordenar por defecto: Las de estado "Pendiente" primero (solo en el grupo normal)
        resultWithoutFallas.sort((a, b) => {
            const isAPendiente = (a.status || 'Pendiente').toLowerCase() === 'pendiente';
            const isBPendiente = (b.status || 'Pendiente').toLowerCase() === 'pendiente';

            if (isAPendiente && !isBPendiente) return -1;
            if (!isAPendiente && isBPendiente) return 1;
            return 0;
        });

        // Fallas 1°, Reposiciones 2°, resto
        return [...allFallas, ...allReposiciones, ...resultWithoutFallas];
    }, [displayOrders, sidebarFilter, sidebarMode, clientFilter, activeFilters, areaKey, showCancelled, showPronto, globalSearch]);

    const renderSidebar = () => null;

    if (!areaConfig) return <div className="p-10 text-center text-zinc-400">Cargando configuración...</div>;

    const btnBaseClass = "h-9 px-4 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-sm";
    const btnSecondaryClass = "bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-brand-cyan hover:bg-zinc-50";
    const btnPrimaryClass = "bg-brand-cyan text-white shadow-sm";

    console.log("🔍 [AreaView] Render - Props:", { areaKey, areaConfigName: areaConfig?.name, isRollModalOpen });

    const tableToolbar = (
        <div className="flex flex-nowrap gap-3 tablet:gap-1.5 items-center">
            <button
                className="flex items-center gap-2 px-3 py-1.5 tablet:px-2 tablet:py-1 text-xs tablet:text-[11px] font-bold bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:bg-zinc-50 hover:text-brand-cyan hover:border-brand-cyan/30 transition-colors shadow-sm capitalize"
                onClick={() => navigate('/consultas/rollos', { state: { areaFilter: areaKey } })}
            >
                <i className="fa-solid fa-clock-rotate-left"></i> <span className="tablet:hidden">Historial</span>
            </button>

            <div className="w-px h-5 bg-zinc-200 mx-1"></div>

            {/* Filtro Multiselector */}
            <div className="relative" ref={filterDropdownRef}>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsFilterDropdownOpen(prev => !prev); }}
                    className={`flex items-center gap-2 px-3 py-1.5 tablet:px-2 tablet:py-1 text-xs tablet:text-[11px] font-bold border rounded-lg transition-colors shadow-sm ${
                        activeFilterCount > 0
                            ? 'bg-brand-cyan text-white border-brand-cyan hover:bg-[#005a7a]'
                            : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:text-brand-cyan hover:border-brand-cyan/30'
                    }`}
                >
                    <i className="fa-solid fa-filter"></i>
                    Filtros
                    {activeFilterCount > 0 && (
                        <span className="ml-1 px-1.5 h-4 flex items-center justify-center bg-white/20 rounded-md text-[10px] leading-none">
                            {activeFilterCount}
                        </span>
                    )}
                </button>

                {isFilterDropdownOpen && (
                    <div className="absolute top-full mt-2 left-0 w-[320px] bg-white rounded-xl shadow-xl border border-zinc-200 z-50 flex flex-col">
                        <div className="flex justify-between items-center p-3 border-b border-zinc-100 bg-zinc-50 shrink-0">
                            <span className="text-sm font-bold text-zinc-700">Filtros Activos</span>
                            {activeFilterCount > 0 && (
                                <button onClick={clearFilters} className="text-xs text-brand-cyan hover:text-[#005a7a] hover:underline font-bold transition-colors">
                                    Limpiar todos
                                </button>
                            )}
                        </div>
                        <div className="p-4 flex flex-col gap-5">
                            {/* Prioridad */}
                            <div>
                                <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider mb-2 block">Prioridad</span>
                                <div className="flex flex-wrap gap-2">
                                    {availablePriorities.filter(p => p !== 'ALL' && p.toUpperCase() !== 'ALTA').map(p => {
                                        const isSelected = activeFilters.priorities.includes(p);
                                        const isUrgent = ['Urgente', 'Reposición', 'Falla'].includes(p);
                                        let selectedClass = isUrgent 
                                            ? 'bg-brand-magenta text-white border-brand-magenta' 
                                            : 'bg-zinc-700 text-white border-zinc-700';
                                        let unselectedClass = 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300';
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => toggleFilter('priorities', p)}
                                                className={`px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors capitalize shadow-sm ${isSelected ? selectedClass : unselectedClass}`}
                                            >
                                                {p}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Estado en Área */}
                            {availableAreaStatuses.length > 0 && (
                                <div>
                                    <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider mb-2 block">Estado en Área</span>
                                    <div className="flex flex-wrap gap-2">
                                        {availableAreaStatuses.map(s => {
                                            const isSelected = activeFilters.areaStatuses.includes(s);
                                            return (
                                                <button
                                                    key={s}
                                                    onClick={() => toggleFilter('areaStatuses', s)}
                                                    className={`px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors capitalize shadow-sm ${
                                                        isSelected ? 'bg-brand-cyan text-white border-brand-cyan' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300'
                                                    }`}
                                                >
                                                    {s}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {/* Variante o Material según área */}
                            {lotePorMaterial ? (
                                availableMaterials.length > 0 && (
                                    <div>
                                        <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider mb-2 block">Material</span>
                                        <div className="flex flex-wrap gap-2">
                                            {availableMaterials.map(m => {
                                                const isSelected = activeFilters.variants.includes(m);
                                                return (
                                                    <button
                                                        key={m}
                                                        onClick={() => toggleFilter('variants', m)}
                                                        className={`px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors capitalize shadow-sm ${
                                                            isSelected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300'
                                                        }`}
                                                    >
                                                        {m}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )
                            ) : (
                                availableVariants.filter(v => v !== 'ALL').length > 0 && (
                                    <div>
                                        <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider mb-2 block">Variante</span>
                                        <div className="flex flex-wrap gap-2">
                                            {availableVariants.filter(v => v !== 'ALL').map(v => {
                                                const isSelected = activeFilters.variants.includes(v);
                                                return (
                                                    <button
                                                        key={v}
                                                        onClick={() => toggleFilter('variants', v)}
                                                        className={`px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors capitalize shadow-sm ${
                                                            isSelected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300'
                                                        }`}
                                                    >
                                                        {v}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )
                            )}

                            {/* Separador + Cancelados / Prontas */}
                            <div className="border-t border-zinc-200 pt-4 flex flex-col gap-2">
                                <button
                                    onClick={handleTogglePronto}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold border rounded-lg transition-colors shadow-sm ${
                                        showPronto
                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                            : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300'
                                    }`}
                                >
                                    <i className="fa-solid fa-check-circle"></i>
                                    {showPronto ? 'Ocultar órdenes finalizadas' : 'Ver órdenes finalizadas'}
                                </button>
                                <button
                                    onClick={handleToggleCancelled}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold border rounded-lg transition-colors shadow-sm ${
                                        showCancelled
                                            ? 'bg-red-600 text-white border-red-600'
                                            : 'bg-white text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300'
                                    }`}
                                >
                                    <i className="fa-solid fa-ban"></i>
                                    {showCancelled ? 'Ocultar canceladas' : 'Ver órdenes canceladas'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="w-px h-5 bg-zinc-200 mx-1"></div>

            {/* Buscador */}
            <div className="relative">
                <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs"></i>
                <input
                    type="text"
                    placeholder="Buscar orden, cliente o ID cliente..."
                    value={globalSearch}
                    onChange={(e) => { setGlobalSearch(e.target.value); try { sessionStorage.setItem(`areaSearch_${areaKey}`, e.target.value); } catch {} }}
                    className={`pl-8 ${globalSearch ? 'pr-8' : 'pr-3'} py-1.5 h-[30px] w-64 tablet:w-44 tablet:h-[28px] shrink-0 text-xs tablet:text-[11px] font-medium border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan transition-all shadow-sm placeholder:text-zinc-400`}
                />
                {globalSearch && (
                    <button 
                        onClick={() => { setGlobalSearch(""); try { sessionStorage.removeItem(`areaSearch_${areaKey}`); } catch {} }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-1"
                        title="Limpiar búsqueda"
                    >
                        <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                )}
            </div>

            <div className="w-px h-5 bg-zinc-200 mx-1"></div>

            {/* Asignar Lote */}
            <div className="flex items-center gap-1">
                <button
                    disabled={selectedIds.length === 0}
                    onClick={() => {
                        const selectedOrdersList = dbOrders.filter(o => selectedIds.includes(o.id));
                        
                        // Validación de Estado Pendiente (Aplica a todas las áreas)
                        const hasNonPending = selectedOrdersList.some(o => (o.status || 'Pendiente').toLowerCase() !== 'pendiente');
                        if (hasNonPending) {
                            Swal.fire({
                                title: 'Error!',
                                text: 'Solo se pueden asignar a un lote las órdenes que tengan estado "Pendiente".',
                                iconHtml: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#BD0C7E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
                                customClass: { 
                                    popup: '!p-0 overflow-hidden rounded-xl',
                                    icon: 'border-none !mt-5 !mb-2',
                                    title: '!pt-0',
                                    htmlContainer: 'mb-5 px-6',
                                    actions: '!w-full !m-0',
                                    confirmButton: '!w-full !m-0 !rounded-none py-4 text-lg font-bold'
                                },
                                background: '#f4f4f5',
                                color: '#000000',
                                confirmButtonColor: '#BD0C7E',
                                confirmButtonText: 'Aceptar'
                            }).then(() => {
                                setSelectedIds([]);
                            });
                            return;
                        }

                        const upperArea = (areaKey || '').toUpperCase();
                        if (upperArea === 'DF' || upperArea === 'DTF' || upperArea === 'DIRECTA' || upperArea === 'IMD') {
                            const variantSet = new Set();
                            const materialSet = new Set();
                            
                            selectedOrdersList.forEach(o => {
                                variantSet.add((o.variantCode || '').trim().toLowerCase());
                                materialSet.add((o.material || '').trim().toLowerCase());
                            });

                            if (variantSet.size > 1) {
                                Swal.fire({
                                    title: 'Error!',
                                    text: 'No se permite asignar órdenes con distinto material al mismo lote.',
                                    iconHtml: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#BD0C7E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
                                    customClass: { 
                                        popup: '!p-0 overflow-hidden rounded-xl',
                                        icon: 'border-none !mt-5 !mb-2',
                                        title: '!pt-0',
                                        htmlContainer: 'mb-5 px-6',
                                        actions: '!w-full !m-0',
                                        confirmButton: '!w-full !m-0 !rounded-none py-4 text-lg font-bold'
                                    },
                                    background: '#f4f4f5',
                                    color: '#000000',
                                    confirmButtonColor: '#BD0C7E',
                                    confirmButtonText: 'Aceptar'
                                }).then(() => {
                                    setSelectedIds([]);
                                });
                                return;
                            }
                            if (materialSet.size > 1) {
                                Swal.fire({
                                    title: 'Error!',
                                    text: 'No se permite asignar órdenes con distinto material al mismo lote.',
                                    iconHtml: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#BD0C7E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
                                    customClass: { 
                                        popup: '!p-0 overflow-hidden rounded-xl',
                                        icon: 'border-none !mt-5 !mb-2',
                                        title: '!pt-0',
                                        htmlContainer: 'mb-5 px-6',
                                        actions: '!w-full !m-0',
                                        confirmButton: '!w-full !m-0 !rounded-none py-4 text-lg font-bold'
                                    },
                                    background: '#f4f4f5',
                                    color: '#000000',
                                    confirmButtonColor: '#BD0C7E',
                                    confirmButtonText: 'Aceptar'
                                }).then(() => {
                                    setSelectedIds([]);
                                });
                                return;
                            }
                        }
                        setIsRollModalOpen(true);
                    }}
                    className={`h-[30px] tablet:h-[28px] flex items-center gap-2 px-3 tablet:px-2 text-xs tablet:text-[11px] font-bold border rounded-lg transition-colors shadow-sm whitespace-nowrap ${
                        selectedIds.length > 0
                            ? 'bg-brand-cyan text-white border-brand-cyan hover:bg-[#005a7a]'
                            : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed opacity-80'
                    }`}
                >
                    <i className="fa-solid fa-layer-group"></i>
                    <span className="tablet:hidden">Asignar a Lote</span><span className="hidden tablet:inline">Asignar</span>
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
                <div className="px-4 py-2 tablet:px-2 tablet:py-1 flex items-center justify-between bg-white min-h-[56px] tablet:min-h-[44px] relative w-full overflow-hidden">

                    {/* CENTRO ABSOLUTO: Tabs de Navegación (Siempre en el centro exacto de la pantalla) */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 tablet:gap-0.5 z-30 pointer-events-auto">
                        {!hideImportar && (
                            <button
                                className={`${btnBaseClass} px-3 h-8 text-xs tablet:px-2 tablet:h-7 tablet:text-[11px] ${btnSecondaryClass}`}
                                onClick={() => setIsImportModalOpen(true)}
                            >
                                <i className="fa-solid fa-file-import"></i> <span className="tablet:hidden">Importar Orden</span><span className="hidden tablet:inline">Importar</span>
                            </button>
                        )}
                        <button className={`${btnBaseClass} px-3 h-8 text-xs tablet:px-2 tablet:h-7 tablet:text-[11px] ${isActive('') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('')}><LayoutGrid size={14} /> Planilla</button>
                        <button className={`${btnBaseClass} px-3 h-8 text-xs tablet:px-2 tablet:h-7 tablet:text-[11px] ${isActive('planeacion') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('planeacion')}><CalendarCheck size={14} /> Planeación</button>
                        <button className={`${btnBaseClass} px-3 h-8 text-xs tablet:px-2 tablet:h-7 tablet:text-[11px] ${isActive('control') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('control')}><ScanLine size={14} /> Control</button>
                        <button className={`${btnBaseClass} px-3 h-8 text-xs tablet:px-2 tablet:h-7 tablet:text-[11px] ${isActive('logistica') ? btnPrimaryClass : btnSecondaryClass}`} onClick={() => goTo('logistica')}><Truck size={14} /> Logística</button>
                    </div>

                    {/* LADO IZQUIERDO (Mitad de la pantalla menos un margen protector para las tabs) */}
                    <div className="flex w-1/2 items-center pr-64 pointer-events-auto">
                        {/* BLOQUE 1: Título */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex flex-col justify-center shrink-0">
                                <h1 className="text-xl tablet:text-base font-black text-zinc-800 leading-none whitespace-nowrap">{areaConfig.name}</h1>
                                <span className="text-[10px] tablet:text-[9px] font-bold text-brand-cyan uppercase tracking-widest tablet:tracking-wide">Producción</span>
                            </div>
                            <div className="h-8 w-px bg-zinc-200 mx-1 shrink-0"></div>
                        </div>

                        {/* BLOQUE 2: Asignar Lote (Movido al toolbar) */}
                        <div className="flex-1 flex justify-center min-w-0"></div>
                    </div>

                    {/* LADO DERECHO (Mitad de la pantalla menos el margen protector) */}
                    <div className="flex w-1/2 items-center justify-end pl-64 z-20 pointer-events-auto">
                        {/* BLOQUE 4: Acciones Globales */}
                        <div className="flex items-center gap-2 tablet:gap-1 shrink-0">
                            <Tippy content="Pedir Insumos">
                                <button className="w-9 h-9 tablet:w-8 tablet:h-8 rounded-lg flex items-center justify-center transition-all shadow-sm bg-brand-gold/10 text-brand-gold border border-brand-gold/20 hover:bg-brand-gold/20" onClick={() => setIsStockOpen(true)}>
                                    <CirclePile size={24} />
                                </button>
                            </Tippy>
                            <Tippy content="Reportar Falla">
                                <button className="w-9 h-9 tablet:w-8 tablet:h-8 rounded-lg flex items-center justify-center transition-all shadow-sm bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20 hover:bg-brand-magenta/20" onClick={() => setIsFailureOpen(true)}>
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
                        <Route index element={<ProductionTable rowData={filteredOrders} onRowSelected={setSelectedIds} selectedRowIds={selectedIds} onRowClick={setSelectedOrder} columnDefs={areaConfig.defaultColDefs} toolbarContent={tableToolbar} flashingRowIds={flashingRows} />} />
                        <Route path="tabla" element={<ProductionTable rowData={filteredOrders} onRowSelected={setSelectedIds} selectedRowIds={selectedIds} onRowClick={setSelectedOrder} columnDefs={areaConfig.defaultColDefs} toolbarContent={tableToolbar} flashingRowIds={flashingRows} />} />

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
